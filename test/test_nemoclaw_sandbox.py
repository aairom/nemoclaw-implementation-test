"""Unit tests for the local NemoClaw sandbox demonstration.

The five tests map directly to the scenarios in Docs/NemoClaw-Sandbox-User-Guide.md.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from nemoclaw_sandbox_demo import AgentProfile, Sandbox, SandboxLimits, SandboxTimeout


class TestNemoClawSandboxScenarios(unittest.TestCase):
    """Validate the sandbox contract without requiring Podman or network access."""

    def setUp(self):
        self.agent = AgentProfile(
            name="agent",
            role="test agent",
            capabilities=frozenset({
                "read_workspace", "write_workspace", "network:inference", "compute", "inter_agent:send",
            }),
        )

    def test_normal_in_sandbox_execution(self):
        """An authorized agent can write and read only its private workspace."""
        with Sandbox() as sandbox:
            sandbox.register_agent(self.agent)
            written = sandbox.run(self.agent, "write_workspace", path="workspace/report.txt", content="pass")
            read = sandbox.run(self.agent, "read_workspace", path="workspace/report.txt")

        self.assertTrue(written.permitted)
        self.assertEqual(read.value, "pass")
        self.assertTrue(sandbox.closed)

    def test_escape_and_network_boundary_are_denied(self):
        """Traversal and non-approved egress are blocked and audited."""
        with Sandbox() as sandbox:
            sandbox.register_agent(self.agent)
            traversal = sandbox.run(self.agent, "read_workspace", path="../../etc/passwd")
            egress = sandbox.run(self.agent, "network_request", host="example.com")

        self.assertFalse(traversal.permitted)
        self.assertIn("filesystem path denied", traversal.error)
        self.assertFalse(egress.permitted)
        self.assertIn("network host denied", egress.error)

    def test_resource_limits_are_enforced(self):
        """Excess memory is rejected and long-running work is terminated."""
        limits = SandboxLimits(memory_limit_mb=8, timeout_seconds=0.1, cpu_limit_seconds=1)
        with Sandbox(limits) as sandbox:
            sandbox.register_agent(self.agent)
            memory = sandbox.run(self.agent, "allocate_memory", megabytes=16)
            timeout = sandbox.run(self.agent, "busy_loop")

        self.assertFalse(memory.permitted)
        self.assertIn("exceeds limit", memory.error)
        self.assertFalse(timeout.permitted)
        self.assertIsInstance(timeout.error, str)
        self.assertIn("timeout", timeout.error)

    def test_inter_agent_communication_stays_inside_sandbox(self):
        """A message can move between registered agents through the local mailbox."""
        sender = self.agent
        receiver = AgentProfile("receiver", "reviewer", frozenset({"inter_agent:receive"}))
        with Sandbox() as sandbox:
            sandbox.register_agent(sender)
            sandbox.register_agent(receiver)
            sent = sandbox.run(sender, "send_message", recipient="receiver", message="approved")
            received = sandbox.run(receiver, "receive_message")

        self.assertTrue(sent.permitted)
        self.assertEqual(received.value, "approved")

    def test_failure_is_reported_and_teardown_is_graceful(self):
        """A denied operation returns a structured error and context is removed."""
        sandbox = Sandbox()
        sandbox.__enter__()
        sandbox.register_agent(self.agent)
        result = sandbox.run(self.agent, "unsupported_operation")
        root = sandbox.root
        sandbox.teardown()

        self.assertFalse(result.permitted)
        self.assertIn("not supported", result.error)
        self.assertTrue(sandbox.closed)
        self.assertFalse(root.exists())
        with self.assertRaises(RuntimeError):
            sandbox.root


if __name__ == "__main__":
    unittest.main()
