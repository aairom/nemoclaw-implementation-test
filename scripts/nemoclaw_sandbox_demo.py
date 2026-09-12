#!/usr/bin/env python3
"""Runnable NemoClaw sandbox demonstration.

This local harness models the policy boundary an OpenShell/NemoClaw deployment
would enforce at the container and gateway layers. It intentionally uses only
Python's standard library so the test scenario runs without a container runtime.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import queue
import resource
import shutil
import socket
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


class SandboxViolation(PermissionError):
    """Raised when an agent requests an operation outside its policy."""


class SandboxTimeout(TimeoutError):
    """Raised when an operation exceeds the sandbox execution deadline."""


@dataclass(frozen=True)
class SandboxLimits:
    """Resource and access limits applied to every sandbox operation."""

    memory_limit_mb: int = 64
    timeout_seconds: float = 1.0
    cpu_limit_seconds: int = 1
    allowed_network_hosts: tuple[str, ...] = ("inference.local",)


@dataclass(frozen=True)
class AgentProfile:
    """Identity and capabilities granted to an agent."""

    name: str
    role: str
    capabilities: frozenset[str]


@dataclass
class OperationResult:
    """Serializable result returned by the sandbox boundary."""

    operation: str
    permitted: bool
    value: Any = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "permitted": self.permitted,
            "value": self.value,
            "error": self.error,
        }


@dataclass
class Sandbox:
    """A deterministic local model of a NemoClaw/OpenShell sandbox boundary."""

    limits: SandboxLimits = field(default_factory=SandboxLimits)
    _root: Path | None = field(default=None, init=False)
    _mailboxes: dict[str, queue.Queue[str]] = field(default_factory=dict, init=False)
    audit_log: list[dict[str, Any]] = field(default_factory=list, init=False)
    closed: bool = field(default=False, init=False)

    def __enter__(self) -> "Sandbox":
        self._root = Path(tempfile.mkdtemp(prefix="nemoclaw-sandbox-")).resolve()
        (self._root / "workspace").mkdir()
        self._mailboxes.clear()
        self.closed = False
        self._record("sandbox.started", root=str(self._root))
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.teardown()

    @property
    def root(self) -> Path:
        if self._root is None or self.closed:
            raise RuntimeError("sandbox is not active")
        return self._root

    def register_agent(self, agent: AgentProfile) -> None:
        self._mailboxes.setdefault(agent.name, queue.Queue())
        self._record("agent.registered", agent=agent.name, role=agent.role)

    def run(self, agent: AgentProfile, operation: str, **arguments: Any) -> OperationResult:
        """Authorize, execute, and audit one agent operation."""
        if self.closed:
            raise RuntimeError("sandbox has been torn down")
        try:
            value = self._dispatch(agent, operation, arguments)
            result = OperationResult(operation, True, value=value)
        except (SandboxViolation, SandboxTimeout, ValueError) as exc:
            result = OperationResult(operation, False, error=str(exc))
        self._record("operation.completed", agent=agent.name, **result.as_dict())
        return result

    def teardown(self) -> None:
        """Stop accepting work and remove the private workspace."""
        if self._root is not None and self._root.exists():
            shutil.rmtree(self._root)
        self.closed = True
        self._record("sandbox.stopped")

    def _dispatch(self, agent: AgentProfile, operation: str, args: dict[str, Any]) -> Any:
        if operation == "write_workspace":
            self._require(agent, "write_workspace")
            target = self._safe_path(args["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(str(args["content"]), encoding="utf-8")
            return str(target.relative_to(self.root))
        if operation == "read_workspace":
            self._require(agent, "read_workspace")
            return self._safe_path(args["path"]).read_text(encoding="utf-8")
        if operation == "network_request":
            self._require(agent, "network:inference")
            host = str(args["host"])
            if host not in self.limits.allowed_network_hosts:
                raise SandboxViolation(f"network host denied: {host}")
            return {"host": host, "status": "routed through inference.local"}
        if operation == "send_message":
            self._require(agent, "inter_agent:send")
            recipient = str(args["recipient"])
            if recipient not in self._mailboxes:
                raise SandboxViolation(f"unknown sandbox agent: {recipient}")
            self._mailboxes[recipient].put(str(args["message"]))
            return "message delivered"
        if operation == "receive_message":
            self._require(agent, "inter_agent:receive")
            try:
                return self._mailboxes[agent.name].get_nowait()
            except queue.Empty as exc:
                raise ValueError("mailbox is empty") from exc
        if operation == "busy_loop":
            self._require(agent, "compute")
            return self._run_with_limits(_busy_loop, self.limits.timeout_seconds)
        if operation == "allocate_memory":
            self._require(agent, "compute")
            amount_mb = int(args["megabytes"])
            if amount_mb > self.limits.memory_limit_mb:
                raise SandboxViolation(
                    f"memory request {amount_mb} MiB exceeds limit {self.limits.memory_limit_mb} MiB"
                )
            return self._run_with_limits(_allocate_memory, self.limits.timeout_seconds, amount_mb)
        raise SandboxViolation(f"operation not supported: {operation}")

    def _safe_path(self, requested: str) -> Path:
        candidate = (self.root / requested).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise SandboxViolation(f"filesystem path denied: {requested}") from exc
        return candidate

    @staticmethod
    def _require(agent: AgentProfile, capability: str) -> None:
        if capability not in agent.capabilities:
            raise SandboxViolation(f"capability denied: {capability}")

    def _run_with_limits(self, function: Callable[..., Any], timeout: float, *args: Any) -> Any:
        """Run risky work in a child process and enforce deadline/RLIMITs."""
        result_queue: multiprocessing.Queue[Any] = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=_limited_worker,
            args=(result_queue, function, self.limits, args),
        )
        process.start()
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join()
            raise SandboxTimeout(f"operation exceeded {timeout:.1f}s timeout")
        try:
            success, value = result_queue.get_nowait()
        except queue.Empty as exc:
            raise SandboxViolation("worker stopped before returning a result") from exc
        if not success:
            raise SandboxViolation(str(value))
        return value

    def _record(self, event: str, **details: Any) -> None:
        self.audit_log.append({"event": event, "timestamp": time.time(), **details})


def _limited_worker(output: multiprocessing.Queue[Any], function: Callable[..., Any], limits: SandboxLimits, args: tuple[Any, ...]) -> None:
    """Apply OS-level limits where available, then execute the child operation."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_limit_seconds, limits.cpu_limit_seconds))
        resource.setrlimit(resource.RLIMIT_AS, (limits.memory_limit_mb * 1024 * 1024, limits.memory_limit_mb * 1024 * 1024))
    except (OSError, ValueError):
        # The policy checks still apply on platforms that reject one RLIMIT.
        pass
    try:
        output.put((True, function(*args)))
    except BaseException as exc:  # communicate worker failures to the parent
        output.put((False, f"worker error: {exc}"))


def _busy_loop() -> str:
    while True:
        pass


def _allocate_memory(megabytes: int) -> str:
    payload = bytearray(megabytes * 1024 * 1024)
    payload[0] = 1
    return f"allocated {len(payload) // (1024 * 1024)} MiB"


def demo() -> dict[str, Any]:
    """Run permitted and denied operations and return a JSON-compatible report."""
    analyst = AgentProfile(
        name="analyst",
        role="sandbox test analyst",
        capabilities=frozenset({
            "read_workspace",
            "write_workspace",
            "network:inference",
            "compute",
            "inter_agent:send",
        }),
    )
    reviewer = AgentProfile(
        name="reviewer",
        role="sandbox result reviewer",
        capabilities=frozenset({"inter_agent:send", "inter_agent:receive"}),
    )
    with Sandbox() as sandbox:
        sandbox.register_agent(analyst)
        sandbox.register_agent(reviewer)
        results = [
            sandbox.run(analyst, "write_workspace", path="workspace/result.txt", content="approved"),
            sandbox.run(analyst, "read_workspace", path="workspace/result.txt"),
            sandbox.run(analyst, "network_request", host="inference.local"),
            sandbox.run(analyst, "network_request", host="example.com"),
            sandbox.run(analyst, "read_workspace", path="../../etc/passwd"),
            sandbox.run(analyst, "busy_loop"),
            sandbox.run(analyst, "allocate_memory", megabytes=128),
            sandbox.run(analyst, "send_message", recipient="reviewer", message="result ready"),
            sandbox.run(reviewer, "receive_message"),
        ]
        report = {"results": [result.as_dict() for result in results], "audit_events": len(sandbox.audit_log)}
    report["sandbox_torn_down"] = sandbox.closed
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the NemoClaw sandbox test-case demonstration")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args()
    report = demo()
    print(json.dumps(report, indent=2) if args.json else json.dumps(report, indent=2))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
