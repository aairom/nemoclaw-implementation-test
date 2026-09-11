# NVIDIA NemoClaw: Reference Stack for Sandboxed AI Agents in OpenShell

[![License](https://img.shields.io/badge/License-Apache_2.0-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.16%2B-green)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.12%2B-blue)](https://python.org)

NVIDIA NemoClaw is an open-source reference stack for running always-on AI agents more safely inside NVIDIA OpenShell sandboxes. It provides guided onboarding, a hardened blueprint, routed inference, network policy, and lifecycle management through a single CLI.

## Supported Agents

| Agent | Description |
|-------|-------------|
| **OpenClaw** (default) | Always-on AI assistant with managed inference |
| **Hermes** | Alternative agent runtime with NemoClaw integration |
| **LangChain Deep Agents Code** | Terminal-based code agent via `dcode` |

## Architecture

```mermaid
flowchart TB
    subgraph Host["🖥️ Host Machine"]
        CLI["nemoclaw CLI\n(Node.js CJS)"]
        Gateway["OpenShell Gateway\n(L7 Proxy)"]
        Creds["Credential Store\n(gateway-owned)"]
        State["~/.nemoclaw/\n(non-secret state)"]
    end

    subgraph Sandbox["🛡️ Sandbox Container (Podman/Docker)\n--read-only + tmpfs mounts"]
        Agent["AI Agent\n(OpenClaw/Hermes/DeepAgents)"]
        Plugin["NemoClaw Plugin\n(TypeScript, in-process)"]
        InfLocal["inference.local\n(managed endpoint)"]
    end

    subgraph Inference["☁️ Inference Providers"]
        NVIDIA["NVIDIA Nemotron\n(Nemotron/NIM)"]
        Ollama["Ollama\n(local :11434)"]
        LlamaCpp["llama.cpp\n(:9931)"]
        Router["Model Router\n(pool selection)"]
    end

    subgraph Security["🔒 Protection Layers"]
        NetPolicy["Network Policy\n(hot-reloadable)"]
        FsPolicy["Filesystem\n(read-only root + /tmp tmpfs)"]
        ProcPolicy["Process\n(seccomp + cap-drop + no-new-privs)"]
    end

    CLI -->|orchestrates| Gateway
    CLI -->|reads/writes| State
    Gateway -->|owns| Creds
    Gateway -->|controls lifecycle| Sandbox
    Gateway -->|L7 proxy| Inference

    Agent -->|talks to| InfLocal
    InfLocal -->|via Gateway| Inference
    Plugin -->|injects context| Agent
    Plugin -->|slash commands| CLI

    Security --> Sandbox

    style Host fill:#1a1a2e,color:#fff
    style Sandbox fill:#0f3460,color:#fff
    style Inference fill:#16213e,color:#fff
    style Security fill:#533483,color:#fff
```

## Workflow

```mermaid
sequenceDiagram
    participant Op as Operator
    participant CLI as nemoclaw CLI
    participant GW as OpenShell Gateway
    participant SB as Sandbox
    participant Inf as Inference Provider

    Op->>CLI: nemoclaw onboard
    CLI->>CLI: 1. Resolve blueprint
    CLI->>CLI: 2. Verify digest
    CLI->>CLI: 3. Plan resources
    CLI->>GW: 4a. Create gateway
    CLI->>GW: 4b. Register provider
    CLI->>GW: 4c. Build & run container (Podman)
    CLI->>GW: 4d. Configure inference route
    CLI->>GW: 4e. Apply network policy
    CLI->>CLI: 4f. Auto-register credentials from .env
    GW->>SB: Start container (hardened, --read-only)
    CLI->>CLI: 5. Check status
    CLI-->>Op: Onboarding complete ✓

    loop Agent operation
        SB->>GW: Inference request (inference.local)
        GW->>GW: Inject credential (L7 proxy)
        GW->>Inf: Forward request + real credential
        Inf-->>GW: Response
        GW-->>SB: Response (credential stripped)
    end
```

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/NVIDIA/NemoClaw.git
cd NemoClaw
cp .env.example .env          # Fill in NVIDIA_API_KEY from build.nvidia.com

# 2. Install everything (deps + link CLI globally)
npm install && cd nemoclaw && npm install && npm run build && cd ..
npm link                      # makes 'nemoclaw' available as a global command

# Or use the one-shot setup script:
./scripts/dev-setup.sh

# 3. Set up Python environment
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 4. Verify host readiness
nemoclaw host probe

# 5. Onboard your first sandbox
#    (builds image, starts container, registers credentials automatically)
nemoclaw onboard

# 6. View live logs
nemoclaw logs --follow

# 7. Launch the Streamlit dashboard
./scripts/start.sh
# Open http://localhost:10001  (gateway port 10000 + 1)
```

> **Getting your NVIDIA API key**: Sign in at [build.nvidia.com](https://build.nvidia.com), open any model page, click **Get API Key → Generate Key**. Free tier gives 1,000 credits/month.

See [`Docs/Quickstart.md`](Docs/Quickstart.md) for detailed step-by-step instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [Quickstart](Docs/Quickstart.md) | Step-by-step setup guide |
| [Architecture](Docs/Architecture.md) | System architecture and component diagrams |
| [CLI Reference](Docs/CLI-Reference.md) | Full nemoclaw command reference |
| [Security](Docs/Security.md) | Security model, controls, and best practices |
| [User Stories](Docs/NemoClaw-User-Stories.md) | Feature specification and acceptance criteria |

## Project Structure

```
nemoclaw-test/
├── bin/                    # CLI entry point and library modules (CommonJS)
│   ├── nemoclaw.js         # Main CLI entry point
│   └── lib/                # onboard, inference, policies, runner, state,
│                           # credentials, sandbox, preflight, logger, completion
├── nemoclaw/               # TypeScript plugin (runs inside OpenClaw sandbox)
│   └── src/
│       ├── blueprint/      # Runner, SSRF validation, state, private networks
│       ├── commands/       # /nemoclaw slash command handlers
│       └── onboard/        # Onboarding configuration and validation
├── nemoclaw-blueprint/     # Blueprint YAML: sandbox image, policies, profiles
│   └── policies/
│       └── presets/        # Policy presets (slack, discord)
├── dashboard/              # Streamlit web UI (port 10001)
├── scripts/                # Bash automation
│   ├── start.sh            # Start Streamlit dashboard (detached)
│   ├── stop.sh             # Stop dashboard gracefully
│   ├── dev-setup.sh        # Full dev environment setup + npm link
│   ├── podman-build.sh     # Build sandbox container image
│   └── podman-clean.sh     # Remove images/containers (--all/--prune/--full)
├── test/                   # Vitest (ESM) + pytest test suites
├── Docs/                   # Project documentation
├── k8s/                    # Kubernetes manifests
├── Containerfile           # Multi-stage optimized image (Podman-compatible)
├── Dockerfile              # Identical copy for Docker compatibility
└── .env.example            # Environment variable template
```

## Podman Image Management

```bash
# Build the sandbox image
./scripts/podman-build.sh

# Force full rebuild (no cache)
./scripts/podman-build.sh --no-cache

# Remove stopped containers + NemoClaw images
./scripts/podman-clean.sh

# Full reset (containers + images + volumes)
./scripts/podman-clean.sh --full

# Or via Makefile
make build-image
make clean-images-all
```

## Development

```bash
# Run all CLI tests (35 tests)
npm test

# Run TypeScript plugin tests (26 tests)
npm run test:plugin

# Run Python dashboard tests (14 tests)
source venv/bin/activate && pytest test/test_dashboard.py -v

# All 75 tests
make test-all

# Type-check CLI
npm run typecheck:cli

# Lint
npm run lint

# Build TypeScript plugin
cd nemoclaw && npm run build

# Re-link CLI after Node version switch
make link
```

## Security

- **No raw credentials in the sandbox** – the OpenShell L7 proxy injects credentials at egress; credentials are auto-registered from `.env` during `nemoclaw onboard`
- **Read-only container root filesystem** – `--read-only` flag; only `/tmp` and `~/.streamlit` are writable via `tmpfs`
- **Network egress controlled** – baseline policy blocks unauthorized connections; unapproved endpoints surface for operator approval
- **Process isolation** – `--cap-drop=all`, `--security-opt no-new-privileges`, seccomp + Landlock + network namespace
- **SSRF protection** – validates all egress endpoints against private/loopback ranges before allowing

**Reporting vulnerabilities**: Use [NVIDIA's private vulnerability disclosure](https://www.nvidia.com/en-us/security/report-vulnerability/). Do NOT open public issues.

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the PR process.
