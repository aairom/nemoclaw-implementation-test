# NemoClaw Security Model

## Overview

NemoClaw uses a defense-in-depth approach: multiple independent protection layers so that
a failure in one layer does not expose the host or other sandboxes.

## Security Layers

| Layer | What it protects | When applied | Hot-reloadable |
|-------|-----------------|--------------|----------------|
| **Network** | Blocks unauthorized egress | Runtime | ✅ Yes |
| **Filesystem** | Read-only root; writable tmpfs mounts only | Sandbox creation | ❌ No |
| **Process** | Blocks privilege escalation and dangerous syscalls | Sandbox creation | ❌ No |
| **Inference** | Reroutes model API calls to controlled backends | Runtime | ✅ Yes |

## Container Hardening Flags

Every sandbox container is started with the following security flags by `bin/lib/runner.js`:

| Podman / Docker flag | Effect |
|---------------------|--------|
| `--read-only` | Root filesystem is immutable; writes fail unless a `--tmpfs` mount is present |
| `--security-opt no-new-privileges` | Prevents `setuid`/`setgid` privilege escalation |
| `--cap-drop=all` | Drops all Linux capabilities (no `NET_RAW`, `SYS_ADMIN`, etc.) |
| `--tmpfs /tmp:rw,noexec,nosuid,size=128m` | Writable scratch space; `noexec` prevents executing scripts from `/tmp` |
| `--tmpfs /home/nemoclaw/.streamlit:rw,nosuid,size=32m` | Streamlit session cache; avoids `OSError: Read-only file system` |
| `--network=bridge` / `--network=pasta` | Isolated network namespace (auto-detected per rootful/rootless mode) |

### Why two tmpfs mounts?

Running `--read-only` makes the entire container filesystem immutable, which is the desired
state for a hardened agent sandbox.  However, two well-known paths need transient writes:

- **`/tmp`** — standard UNIX temp directory; many tools expect it to be writable.
- **`/home/nemoclaw/.streamlit`** — Streamlit writes a machine-ID file and session cache on
  first launch.  Without a writable mount here the dashboard crashes immediately with
  `OSError: Read-only file system: /home/nemoclaw/.streamlit`.

Both mounts are `nosuid` and sized to prevent excessive disk usage.  `/tmp` is additionally
`noexec` to prevent an agent from writing and then executing arbitrary scripts.

The Streamlit `config.toml` is baked into the image during the multi-stage build
(`COPY dashboard/streamlit_config.toml /home/nemoclaw/.streamlit/config.toml`) with
`gatherUsageStats = false` so that Streamlit does not attempt a telemetry write on startup
even before the tmpfs is mounted.

## Credential Security

NemoClaw **never** stores inference provider credentials on disk or exposes them inside the sandbox.

### Credential Auto-Registration

When `nemoclaw onboard` is run, `credentials.autoRegisterFromEnv()` automatically reads
known credential variables from the environment (loaded from `.env` by `dotenv`) and registers
them with the OpenShell gateway credential store:

| Environment variable | Registered as |
|---------------------|--------------|
| `NVIDIA_API_KEY` | `nvidia-api-key` |
| `OLLAMA_BASE_URL` | `ollama-base-url` |
| `LLAMACPP_BASE_URL` | `llamacpp-base-url` |

Registration flow:

1. `dotenv` loads `.env` into `process.env` at CLI startup
2. `credentials.autoRegisterFromEnv()` is called during `onboard`
3. Each present variable is recorded in `~/.nemoclaw/credentials.json` — **name only, no value**
4. The OpenShell gateway holds the actual value in memory for injection into outbound requests
5. The sandbox sees only `inference.local` — the real URL and API key are never forwarded

### Credential Management

- View registered credentials: `nemoclaw credentials list`
- Add a new credential: `nemoclaw credentials add <name>`
- Rotate a credential: `nemoclaw credentials reset <name>`
- The dashboard Credentials page shows `.env` status vs. gateway-registered status and
  provides a "Register from .env" button for manual registration

## SSRF Protection

All egress endpoints are validated before being allowed:

- Private RFC 1918 ranges (`10.x`, `172.16-31.x`, `192.168.x`) are blocked
- Loopback (`127.x`, `::1`) is blocked
- Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) are blocked
- Link-local and ULA IPv6 ranges are blocked

Full SSRF validation is implemented in [`nemoclaw/src/blueprint/ssrf.ts`](../nemoclaw/src/blueprint/ssrf.ts)
and covers 19 test cases spanning IPv4, IPv6, cloud metadata, and valid public endpoints.

## Network Policy

The default sandbox policy blocks all egress by default and allows only:
- `inference.local` (managed inference)
- `registry.npmjs.org`, `pypi.org` (package indexes)
- `github.com`, `raw.githubusercontent.com` (source control)
- DNS resolution (`1.1.1.1:53`, `8.8.8.8:53`)

When the agent tries to reach an unapproved host, OpenShell blocks the request
and surfaces it in the TUI for operator approval.

To add an egress rule:

```bash
nemoclaw policy add api.example.com:443/https
```

Policy presets are available for common integrations (Slack, Discord):

```bash
nemoclaw policy add slack   # or discord
```

## Podman Network Isolation

`runner.js` auto-detects the Podman execution mode and selects the most secure
available network backend:

| Podman mode | Network flag | Notes |
|-------------|-------------|-------|
| Rootless, Podman ≥ 5 | `--network=pasta` | User-mode networking (replaced slirp4netns in Podman 5) |
| Rootless, Podman < 5 | `--network=slirp4netns` | Legacy user-mode networking |
| Rootful | `--network=bridge` | Default bridge; used on macOS Podman Desktop |
| Docker fallback | `--network=bridge` | Standard Docker bridge |

> **macOS / Podman Desktop:** The Podman machine typically runs rootful, so
> `--network=bridge` is used.  Podman 6.x removed `slirp4netns` entirely; the
> runner handles this by checking the Podman major version before selecting the
> network flag.

## Process Isolation

Sandbox containers run with:
- All Linux capabilities dropped (`--cap-drop ALL`)
- No new privileges (`no-new-privileges=true`)
- Seccomp profile active
- Landlock filesystem restrictions
- Private network namespace

## Sandbox Filesystem

```
/sandbox     ← Read/write for agent workspace (bind-mounted volume)
/tmp         ← tmpfs: rw, noexec, nosuid, 128 MiB
/home/nemoclaw/.streamlit  ← tmpfs: rw, nosuid, 32 MiB
/usr, /etc   ← Read-only (--read-only root fs)
/bin, /sbin  ← Read-only
```

## Shields

Security shields can be inspected and managed on the host:

```bash
nemoclaw shields status    # Show shields posture
nemoclaw shields up        # Enable all shields
nemoclaw shields down      # Disable shields (requires confirmation)
```

## Best Practices

1. **Keep credentials in the gateway store** — never write them to files inside the sandbox
2. **Use `.env` for secrets** — the auto-registration flow picks them up at onboard time
3. **Review egress additions** — before approving a blocked request, verify the destination is legitimate
4. **Use snapshots** before rebuilding or restoring — preserve agent state safely
5. **Run `nemoclaw doctor`** periodically to check host and sandbox health
6. **Rotate credentials** regularly with `nemoclaw credentials reset`
7. **Never rebuild the image with API keys baked in** — always pass them via `--env` at runtime

## Reporting Vulnerabilities

**DO NOT open a public issue for security vulnerabilities.**

Use private disclosure channels:
- [NVIDIA Vulnerability Disclosure Program](https://www.nvidia.com/en-us/security/report-vulnerability/)
- Email: psirt@nvidia.com
- [GitHub private vulnerability reporting](https://github.com/NVIDIA/NemoClaw/security/advisories/new)
