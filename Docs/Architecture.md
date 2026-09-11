# NemoClaw Architecture

## System Architecture

```mermaid
flowchart TB
    subgraph Host["🖥️ Host Machine"]
        CLI["nemoclaw CLI\n(Node.js CJS)\nbin/nemoclaw.js"]
        State["Host State\n~/.nemoclaw/\nsandboxes.json\ncredentials.json"]
        Blueprint["Blueprint Runner\nResolve → Verify\nPlan → Apply → Status"]
        GW["OpenShell Gateway\nL7 Proxy\nCredential Store\nPolicy Enforcement"]
        Creds["Credential Auto-Registration\ncredentials.autoRegisterFromEnv()\nNVIDIA_API_KEY, OLLAMA_BASE_URL\nLLAMACPP_BASE_URL"]
    end

    subgraph Sandbox["🛡️ Sandbox Container (Podman)"]
        direction TB
        Agent["Agent Runtime\n(OpenClaw / Hermes / DeepAgents)"]
        Plugin["NemoClaw Plugin\nTypeScript in-process\n/nemoclaw slash command\nRuntime Context Injection"]
        InfLocal["inference.local\n→ managed endpoint"]
        TmpFS["tmpfs mounts\n/tmp (128 MiB)\n~/.streamlit (32 MiB)"]
    end

    subgraph Providers["☁️ Inference Providers"]
        NVIDIA["NVIDIA Nemotron\nhttps://integrate.api.nvidia.com/v1"]
        Ollama["Ollama\nlocalhost:11434"]
        LlamaCpp["llama.cpp\nlocalhost:9931/v1"]
        Router["Model Router\nPool selection"]
    end

    subgraph Security["🔒 Protection Layers (locked at creation)"]
        Net["Network\nHot-reloadable egress policy"]
        FS["Filesystem\n--read-only root fs\ntmpfs /tmp + ~/.streamlit"]
        Proc["Process\nseccomp + Landlock\ncapability drops"]
        Inf["Inference\nRouted through gateway\nNo raw credentials in sandbox"]
    end

    subgraph NetMode["🌐 Network Mode (auto-detected)"]
        Rootless["rootless Podman ≥5\n--network=pasta"]
        Rootful["rootful Podman\n--network=bridge"]
    end

    CLI -->|orchestrates| GW
    CLI -->|reads/writes| State
    CLI -->|runs| Blueprint
    CLI -->|onboard registers| Creds
    Blueprint -->|openshell CLI calls| GW
    GW -->|lifecycle| Sandbox
    GW -->|L7 proxy forwards| Providers
    Agent -->|inference.local| GW
    Plugin -->|runtime context| Agent
    Security --> Sandbox
    TmpFS --> Sandbox
    NetMode --> Sandbox
```

## Component Descriptions

| Component | Language | Location | Purpose |
|-----------|----------|----------|---------|
| **nemoclaw CLI** | JavaScript (CJS) | `bin/` | Host-side orchestration, user interface |
| **lib modules** | JavaScript (CJS) | `bin/lib/` | Onboard, inference, policies, runner, state, credentials |
| **NemoClaw Plugin** | TypeScript (ESM) | `nemoclaw/src/` | In-sandbox plugin: inference provider, slash commands, context |
| **Blueprint** | YAML | `nemoclaw-blueprint/` | Sandbox definition, policies, inference profiles |
| **Dashboard** | Python/Streamlit | `dashboard/` | Web UI for sandbox management (port 8501) |
| **Scripts** | Bash | `scripts/` | Automation: start, stop, dev-setup, podman-build, podman-clean |

## Blueprint Lifecycle

```mermaid
sequenceDiagram
    participant CLI as nemoclaw CLI
    participant Creds as Credential Store
    participant Runner as Blueprint Runner
    participant GW as OpenShell Gateway
    participant SB as Sandbox

    CLI->>Creds: autoRegisterFromEnv()
    Note right of Creds: Reads NVIDIA_API_KEY,<br/>OLLAMA_BASE_URL,<br/>LLAMACPP_BASE_URL from .env
    CLI->>Runner: onboard(config)
    Runner->>Runner: 1. Resolve blueprint.yaml
    Runner->>Runner: 2. Verify digest
    Runner->>Runner: 3. Plan resources
    Runner->>GW: 4a. gateway.create
    Runner->>GW: 4b. provider.register
    Runner->>GW: 4c. sandbox.create
    Note right of Runner: Builds image if missing<br/>Detects rootful/rootless<br/>Applies security flags + tmpfs
    Runner->>GW: 4d. inference.route
    Runner->>GW: 4e. policy.apply
    GW->>SB: Start container
    Runner->>Runner: 5. status
    Runner-->>CLI: complete
```

## Inference Flow

```mermaid
sequenceDiagram
    participant Agent as Agent (in sandbox)
    participant InfLocal as inference.local
    participant GW as OpenShell Gateway L7
    participant Provider as Inference Provider

    Agent->>InfLocal: POST /v1/chat/completions
    Note right of Agent: No raw API key<br/>in sandbox
    InfLocal->>GW: Forward request
    GW->>GW: Inject Authorization header<br/>(credential from gateway store)
    GW->>Provider: POST (with real credential)
    Provider-->>GW: Response
    GW-->>InfLocal: Response (credential stripped)
    InfLocal-->>Agent: Response
```

## Container Security Flags

Every sandbox container launched by `runner.js` (`createSandbox`) carries the following hardened flags:

| Flag | Purpose |
|------|---------|
| `--read-only` | Immutable root filesystem — prevents agent from modifying system files |
| `--security-opt no-new-privileges` | Blocks `setuid`/`setgid` privilege escalation |
| `--cap-drop=all` | Drops all Linux capabilities |
| `--tmpfs /tmp:rw,noexec,nosuid,size=128m` | Writable temp space; `noexec` prevents script execution |
| `--tmpfs /home/nemoclaw/.streamlit:rw,nosuid,size=32m` | Allows Streamlit session writes without breaking `--read-only` |
| `--network=bridge` or `--network=pasta` | Auto-detected (see below) |

## Podman Network Mode Auto-Detection

`runner.js` inspects the Podman runtime at startup:

```
podman info --format {{.Host.Security.Rootless}}
```

| Mode | Detection | Network flag |
|------|-----------|-------------|
| **Rootless** Podman ≥ 5 | `Rootless=true` + version ≥ 5 | `--network=pasta` |
| **Rootless** Podman < 5 | `Rootless=true` + version < 5 | `--network=slirp4netns` |
| **Rootful** Podman | `Rootless=false` | `--network=bridge` |
| Docker (fallback) | `podman` not on PATH | `--network=bridge` |

> **Note:** Podman 6.x dropped `slirp4netns` entirely. The Podman machine on macOS with Podman Desktop typically runs rootful (`--network=bridge`).

## Credential Auto-Registration

During `nemoclaw onboard`, credentials are automatically registered from environment variables:

```mermaid
flowchart LR
    ENV[".env file"] -->|dotenv load| Process["Node.js process.env"]
    Process -->|autoRegisterFromEnv| Store["~/.nemoclaw/credentials.json"]
    Store -->|gateway inject| GW["OpenShell Gateway\nCredential Store"]

    subgraph "Registered automatically"
        K1["NVIDIA_API_KEY → nvidia-api-key"]
        K2["OLLAMA_BASE_URL → ollama-base-url"]
        K3["LLAMACPP_BASE_URL → llamacpp-base-url"]
    end
```

- Credential **values** are never written to disk (`credentials.json` stores names only)
- The gateway is the only component that holds the actual values in memory
- The dashboard Credentials page shows `.env` status vs. registered status and offers a "Register from .env" button

## Security Layers

| Layer | Applies when | Hot-reloadable |
|-------|-------------|----------------|
| **Network** | Runtime | ✅ Yes |
| **Filesystem** | Sandbox creation | ❌ No |
| **Process** | Sandbox creation | ❌ No |
| **Inference** | Runtime | ✅ Yes |

## Host State Layout

```
~/.nemoclaw/
├── sandboxes.json          # Registered sandbox metadata
├── credentials.json        # Credential names (no values stored)
├── policies/
│   └── <sandbox-name>/
│       └── policy.yaml     # Custom network policy
└── gateways/
    └── <port>/             # Per-gateway state (non-default ports)
```

## tmpfs Mount Rationale

The sandbox image is launched with `--read-only` to prevent the agent from modifying the root filesystem. However, some runtime components need writable space:

| tmpfs path | Size | Reason |
|-----------|------|--------|
| `/tmp` | 128 MiB | General agent scratch space; `noexec` prevents script execution |
| `/home/nemoclaw/.streamlit` | 32 MiB | Streamlit writes session cache + machine-ID here; baking `config.toml` with `gatherUsageStats = false` disables telemetry, but the directory still needs to be writable |

The `config.toml` is baked into the image at build time (multi-stage `Containerfile`) so the `--read-only` container starts cleanly without a network roundtrip to gather telemetry.
