# NemoClaw Quickstart Guide

This guide walks you through installing and using NemoClaw from scratch.

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| CPU | 4 vCPU | 4+ vCPU |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free | 40 GB free |
| Node.js | 22.16+ | Latest LTS |
| npm | 10+ | Latest |
| Python | 3.12+ | Latest |
| Container runtime | Podman or Docker | **Podman** (preferred) |

> **macOS note**: Port 5000 is reserved for AirDrop. NemoClaw uses port 8501 (dashboard) and 10001 (sandbox UI) by default.

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/NVIDIA/NemoClaw.git
cd NemoClaw
```

---

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
# Required for NVIDIA cloud inference — get from build.nvidia.com
NVIDIA_API_KEY=nvapi-your-key-here

NEMOCLAW_AGENT=openclaw
NEMOCLAW_INFERENCE_PROVIDER=nvidia
NEMOCLAW_MODEL=nvidia/llama-3.1-nemotron-70b-instruct
```

> **Getting your key**: Go to [build.nvidia.com](https://build.nvidia.com), open any model, click **Get API Key → Generate Key**. The free tier gives 1,000 credits/month.

**Using a local model instead?** Set `NEMOCLAW_INFERENCE_PROVIDER=ollama` (Ollama at `localhost:11434`) or `openai-compatible` (llama.cpp at `localhost:9931/v1`) — `NVIDIA_API_KEY` is then not required.

> **Security**: Never commit `.env` to source control. It is in `.gitignore` by default.

---

## Step 3: Install Dependencies and Link CLI

```bash
# Install Node.js dependencies + build TypeScript plugin
npm install
cd nemoclaw && npm install && npm run build && cd ..

# Make 'nemoclaw' available as a global command
npm link

# Set up Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run the offline sandbox demonstration and five test scenarios
python3 scripts/nemoclaw_sandbox_demo.py --json
python3 -m unittest discover -s test -p 'test_nemoclaw_sandbox.py' -v
```

**One-shot alternative** (does all of the above):
```bash
./scripts/dev-setup.sh
```

Verify the CLI is linked:
```bash
nemoclaw --version   # should print 0.1.0
```

---

## Step 4: Verify Host Readiness

```bash
nemoclaw host probe
```

Expected output:
```
Host Readiness Probe

  Component          Status    Details
  ────────────────────────────────────────────────────────────
  Node.js              ✓         v22.x.x (requires v22+)
  npm                  ✓         10.x.x  (requires 10+)
  Container runtime    ✓         podman: podman version 6.x.x
  Python 3             ✓         Python 3.12.x
  Disk space           ✓         45GB available (requires 20GB)
  RAM                  ✓         16GB total (requires 8GB)
  Gateway port         ✓         Port 10000 is available

  ✓ Host is ready for NemoClaw onboarding.
```

---

## Step 5: Onboard Your First Sandbox

```bash
nemoclaw onboard
```

This runs the 5-step blueprint lifecycle:

| Step | Action |
|------|--------|
| 1. Resolve | Load `nemoclaw-blueprint/blueprint.yaml` |
| 2. Verify | Check blueprint SHA-256 digest |
| 3. Plan | Determine what resources to create (5 operations) |
| 4. Apply | Build image if needed → start Podman container → configure routes and policy |
| 4f. Auto-register | Register `NVIDIA_API_KEY` and other `.env` credentials into the gateway store |
| 5. Status | Confirm container is running |

The sandbox container runs with a **hardened security profile**:
- `--read-only` root filesystem
- `--cap-drop=all` (no Linux capabilities)
- `--security-opt no-new-privileges`
- `--network=bridge` (isolated network namespace)
- `tmpfs` mounts for `/tmp` and `~/.streamlit` (in-memory writable scratch)

On completion you will see:
```
  ✓ Onboarding complete!

  Sandbox:    nemoclaw-sandbox
  Agent:      openclaw
  Inference:  nvidia / nvidia/llama-3.1-nemotron-70b-instruct
  State:      running

  Dashboard:  http://localhost:10001
  Connect:    nemoclaw connect
```

---

## Step 5A: Validate the Sandbox Enforcement Scenarios

The repository includes a dependency-free local harness that demonstrates the
same policy concepts as the production sandbox without starting a container.
It validates:

- private workspace filesystem boundaries;
- allowlisted `inference.local` network access;
- agent capability enforcement;
- memory, CPU, and wall-clock limits;
- communication between registered agents; and
- structured failures followed by sandbox teardown.

Run it from the repository root:

```bash
python3 scripts/nemoclaw_sandbox_demo.py --json
python3 -m unittest discover -s test -p 'test_nemoclaw_sandbox.py' -v
```

The five executable scenarios are defined in [`test/test_nemoclaw_sandbox.py`](../test/test_nemoclaw_sandbox.py), and the complete walkthrough is available in [`Docs/NemoClaw-Sandbox-User-Guide.md`](NemoClaw-Sandbox-User-Guide.md).

> The local harness is a validation test double. Production isolation is provided by the OpenShell/NemoClaw container and gateway layers described in [`Docs/Architecture.md`](Architecture.md).

---

## Step 5A: Validate the Local Sandbox Demonstration

The local demonstration exercises NemoClaw-style policy enforcement without
starting Podman or contacting a model provider. It checks filesystem isolation,
capability allowlists, `inference.local` network access, resource limits,
in-sandbox agent communication, structured failures, audit events, and teardown.

Run the standalone report and the five tests from the repository root:

```bash
python3 scripts/nemoclaw_sandbox_demo.py --json
python3 -m unittest discover -s test -p 'test_nemoclaw_sandbox.py' -v
```

The complete scenario definitions and interpretation guidance are documented in
[the sandbox user guide](NemoClaw-Sandbox-User-Guide.md).

> This harness is a local validation test double. Production isolation is provided by the OpenShell/NemoClaw container and gateway layers used by `nemoclaw onboard`.

---

## Step 6: View Live Logs

```bash
nemoclaw logs --follow
```

Expected output (clean — no errors):
```
2026-xx-xx xx:xx:xx  Uvicorn server started on 0.0.0.0:8501

  You can now view your Streamlit app in your browser.
  Local URL: http://localhost:8501
```

---

## Step 7: Launch the Management Dashboard

The sandbox exposes its Streamlit UI on port **10001** (gateway port 10000 + 1):

```bash
open http://localhost:10001
```

To also run the host-side Streamlit dashboard:

```bash
./scripts/start.sh    # starts on http://localhost:8501
./scripts/stop.sh     # stops it gracefully
```

---

## Common Commands Reference

```bash
# Onboard a sandbox
nemoclaw onboard
nemoclaw onboard --provider ollama --model llama3.2
nemoclaw onboard --fresh               # Force re-create

# Sandbox management
nemoclaw list
nemoclaw status
nemoclaw start / stop
nemoclaw logs --follow
nemoclaw logs --lines 100
nemoclaw exec "ls /app"

# Credentials (auto-registered from .env on onboard)
nemoclaw credentials list
nemoclaw credentials add MY_KEY --provider nvidia
nemoclaw credentials reset MY_KEY

# Inference provider
nemoclaw inference get
nemoclaw inference set --provider ollama --model llama3.2

# Network policy
nemoclaw policy list
nemoclaw policy add api.example.com:443/https

# Diagnostics
nemoclaw host probe
nemoclaw doctor

# Destroy
nemoclaw destroy --yes
```

---

## Podman Image Management

```bash
# Build sandbox image (auto-run by onboard if missing)
./scripts/podman-build.sh
./scripts/podman-build.sh --no-cache   # Force full rebuild

# Clean up
./scripts/podman-clean.sh              # Remove stopped containers + images
./scripts/podman-clean.sh --all        # Also stop running containers
./scripts/podman-clean.sh --full       # Full reset including volumes
./scripts/podman-clean.sh --dry-run    # Preview only
```

---

## Using Ollama (Local Inference — No API Key Needed)

```bash
# In .env:
NEMOCLAW_INFERENCE_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434

nemoclaw onboard --provider ollama --model llama3.2
```

---

## Using llama.cpp (Local Inference — No API Key Needed)

```bash
# In .env:
NEMOCLAW_INFERENCE_PROVIDER=openai-compatible
LLAMACPP_BASE_URL=http://localhost:9931/v1

nemoclaw onboard --provider openai-compatible --model local-model
```

---

## Running Tests

```bash
# CLI tests (35)
npm test

# TypeScript plugin tests (26)
npm run test:plugin

# Python dashboard tests (14)
source venv/bin/activate
pytest test/test_dashboard.py -v

# All 75 tests via Makefile
make test-all
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `zsh: command not found: nemoclaw` | Run `npm link` from the project root |
| `NVIDIA_API_KEY not set` | Copy `.env.example` to `.env` and fill in your key from [build.nvidia.com](https://build.nvidia.com) |
| `Podman not found` | Install [Podman Desktop](https://podman-desktop.io) |
| `pasta networking is only supported for rootless mode` | Fixed automatically — runner detects root vs rootless and picks `bridge` or `pasta` |
| `Read-only file system: /home/nemoclaw/.streamlit` | Fixed — image bakes in `config.toml` with telemetry off + tmpfs mount added |
| `No log output available in simulation mode` | Run `nemoclaw onboard` first to provision a real container |
| `Node version too old` | Install Node.js 22.16+ from [nodejs.org](https://nodejs.org) |
| `Blueprint not found` | Run from the project root directory |

For more help:
- [GitHub Discussions](https://github.com/NVIDIA/NemoClaw/discussions)
- [Official Documentation](https://docs.nvidia.com/nemoclaw/latest/)
- [Discord Community](https://discord.gg/XFpfPv9Uvx)
