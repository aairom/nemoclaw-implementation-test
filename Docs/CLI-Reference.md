# NemoClaw CLI Reference

Full reference for all `nemoclaw` CLI commands.

## Global Options

| Option | Description |
|--------|-------------|
| `--debug` | Enable debug logging |
| `--gateway-port <port>` | Override OpenShell gateway port (default: 10000) |
| `-v, --version` | Print CLI version |
| `-h, --help` | Show help |

## Onboarding

### `nemoclaw onboard`

Onboard a new NemoClaw sandbox (primary operator entry point).

```bash
nemoclaw onboard \
  --agent openclaw \
  --name my-sandbox \
  --provider nvidia \
  --model nvidia/llama-3.1-nemotron-70b-instruct
```

| Flag | Default | Description |
|------|---------|-------------|
| `--agent` | `openclaw` | Agent runtime: `openclaw`, `hermes`, `langchain-deepagents-code` |
| `--name` | `nemoclaw-sandbox` | Sandbox name (1-63 lowercase, letters/numbers/hyphens) |
| `--provider` | `nvidia` | Inference provider |
| `--model` | env default | Model name |
| `--resume` | false | Resume an interrupted onboarding |
| `--fresh` | false | Force fresh onboarding |
| `--from <blueprint>` | latest | Use specific blueprint version |
| `--events=jsonl` | false | Emit structured JSONL events to stdout |
| `--tool-disclosure` | `progressive` | Tool disclosure mode: `progressive` or `direct` |

What `onboard` does automatically:
1. Calls `credentials.autoRegisterFromEnv()` to register `NVIDIA_API_KEY`, `OLLAMA_BASE_URL`, and `LLAMACPP_BASE_URL` from `.env`
2. Resolves and verifies the blueprint (`nemoclaw-blueprint/blueprint.yaml`)
3. Builds the sandbox image (`nemoclaw-sandbox:latest`) if not already present
4. Detects rootful vs. rootless Podman and selects the correct network mode
5. Starts the container with hardened flags (`--read-only`, `--cap-drop=all`, tmpfs mounts)
6. Configures the inference route and applies network policy

## Sandbox Lifecycle

| Command | Description |
|---------|-------------|
| `nemoclaw list` | List registered sandboxes |
| `nemoclaw use <name>` | Set active/default sandbox |
| `nemoclaw status` | Show sandbox and inference status |
| `nemoclaw start` | Start a stopped sandbox |
| `nemoclaw stop` | Stop a running sandbox gracefully |
| `nemoclaw connect` | Connect to the agent dashboard |
| `nemoclaw logs [--follow] [--lines N]` | View sandbox logs |
| `nemoclaw exec <cmd>` | Execute a command inside the sandbox |
| `nemoclaw rebuild [--yes]` | Recreate sandbox from recorded config |
| `nemoclaw recover` | Repair a stopped or degraded runtime |
| `nemoclaw destroy [--yes]` | Destroy the sandbox |

## Inference

| Command | Description |
|---------|-------------|
| `nemoclaw inference get` | Show current inference provider and model |
| `nemoclaw inference set --provider P --model M` | Update inference configuration |

## Network Policy

| Command | Description |
|---------|-------------|
| `nemoclaw policy get` | Show current policy |
| `nemoclaw policy list` | List all egress rules |
| `nemoclaw policy add <rule>` | Add an egress rule (format: `host[:port][/protocol]`) |
| `nemoclaw policy remove <rule>` | Remove an egress rule |
| `nemoclaw policy explain <rule>` | Explain what a rule does |

## Credentials

| Command | Description |
|---------|-------------|
| `nemoclaw credentials list` | List credential names (no values) |
| `nemoclaw credentials add <name>` | Register a new credential |
| `nemoclaw credentials reset <name>` | Rotate a credential value |

Credentials are auto-registered from `.env` during `nemoclaw onboard` —
you do not need to run `credentials add` manually for the standard variables.

## Security

| Command | Description |
|---------|-------------|
| `nemoclaw shields status` | Show shields posture |
| `nemoclaw shields up` | Enable all security shields |
| `nemoclaw shields down [--yes]` | Disable shields |

## Snapshots

| Command | Description |
|---------|-------------|
| `nemoclaw snapshot create` | Create a sandbox snapshot |
| `nemoclaw snapshot list` | List available snapshots |
| `nemoclaw snapshot restore [selector]` | Restore a snapshot |

## MCP Servers

| Command | Description |
|---------|-------------|
| `nemoclaw mcp list` | List configured MCP servers |
| `nemoclaw mcp add <server>` | Add an MCP server |
| `nemoclaw mcp status` | Show MCP server status |
| `nemoclaw mcp restart [server]` | Restart MCP server |
| `nemoclaw mcp remove <server>` | Remove an MCP server |

## Agents

| Command | Description |
|---------|-------------|
| `nemoclaw agents list` | List installed agent runtimes |
| `nemoclaw agents add <name>` | Register an agent runtime |
| `nemoclaw agents delete <name>` | Remove an agent runtime |

## Diagnostics

| Command | Description |
|---------|-------------|
| `nemoclaw host probe [--json]` | Read-only host readiness probe |
| `nemoclaw doctor` | Check host and sandbox health |
| `nemoclaw dashboard-url` | Print the sandbox dashboard URL |
| `nemoclaw gateway-token` | Print an ephemeral gateway token |

## Maintenance

| Command | Description |
|---------|-------------|
| `nemoclaw update [--check-only]` | Update the CLI |
| `nemoclaw gc [--dry-run]` | Garbage-collect stale state |
| `nemoclaw uninstall [--yes] [--keep-data]` | Uninstall NemoClaw |
| `nemoclaw completion [bash|zsh|fish]` | Generate shell completions |
| `nemoclaw resources` | Show documentation links |

## In-Sandbox /nemoclaw Commands

Available inside the OpenClaw chat interface:

| Command | Description |
|---------|-------------|
| `/nemoclaw` | Show slash-command help |
| `/nemoclaw status` | Show sandbox and inference state |
| `/nemoclaw shields` | Redirect to host shields commands |
| `/nemoclaw onboard` | Show onboarding status |
| `/nemoclaw eject` | Show rollback instructions |

## Bash Scripts (`scripts/`)

### `start.sh` — Start the Streamlit dashboard

```bash
./scripts/start.sh
```

Starts the Streamlit dashboard in the background (port 8501) and prints the URL.
Creates a PID file at `logs/dashboard.pid`.

---

### `stop.sh` — Stop the dashboard

```bash
./scripts/stop.sh
```

Gracefully stops the running Streamlit dashboard using the stored PID.

---

### `dev-setup.sh` — Developer environment setup

```bash
./scripts/dev-setup.sh
```

Installs all dependencies (`npm install`, `pip install -r requirements.txt`) and
runs `npm link` to make the `nemoclaw` command available globally.

---

### `podman-build.sh` — Build the sandbox container image

```bash
# Default build
./scripts/podman-build.sh

# Custom image tag
./scripts/podman-build.sh --tag my-tag

# Force full rebuild (no layer cache)
./scripts/podman-build.sh --no-cache

# Cross-platform build
./scripts/podman-build.sh --platform linux/amd64
```

| Flag | Description |
|------|-------------|
| `--tag <tag>` | Override image tag (default: `nemoclaw-sandbox:latest`) |
| `--no-cache` | Disable Podman layer cache for a clean rebuild |
| `--platform <platform>` | Target platform (e.g. `linux/amd64`, `linux/arm64`) |

Automatically prefers `Containerfile` over `Dockerfile`. Adds build-date and version
labels to the image. Equivalent `make` target: `make build-image`.

---

### `podman-clean.sh` — Remove NemoClaw containers and images

```bash
# Remove stopped containers + images (default)
./scripts/podman-clean.sh

# Also stop and remove running containers
./scripts/podman-clean.sh --all

# Also prune dangling images and build cache
./scripts/podman-clean.sh --prune

# Full reset: containers + images + named volumes + cache
./scripts/podman-clean.sh --full

# Preview what would be removed without deleting
./scripts/podman-clean.sh --dry-run

# Flags can be combined
./scripts/podman-clean.sh --all --prune
```

| Flag | Description |
|------|-------------|
| `--all` | Stop and remove running containers (default: skip running) |
| `--prune` | Prune dangling images and buildah build cache |
| `--full` | Full reset: implies `--all` + `--prune` + removes named volumes |
| `--dry-run` | Print what would be deleted without making any changes |

Equivalent `make` targets: `make clean-images` (default), `make clean-images-all` (`--full`).

---

## Makefile Targets

Run `make help` to see all available targets. Key targets:

| Target | Command(s) run | Description |
|--------|---------------|-------------|
| `make install` | `npm install` + plugin install + `pip install` + `npm link` | Full install — all dependencies and global CLI link |
| `make link` | `npm link` | Link `nemoclaw` CLI globally |
| `make build` | `cd nemoclaw && npm run build` | Build TypeScript plugin |
| `make test` | `npm test` | Run CLI integration tests (35 tests, Vitest) |
| `make test-plugin` | `cd nemoclaw && npm test` | Run TypeScript plugin tests (26 tests) |
| `make test-python` | `.venv/bin/python -m pytest ...` | Run Python dashboard tests (14 tests) |
| `make test-all` | All three test suites | Run all 75 tests |
| `make lint` | `npm run lint` | Run ESLint |
| `make typecheck` | ESLint + TypeScript typecheck | Check types across CLI + plugin |
| `make check` | lint + typecheck + test | Full pre-commit gate |
| `make format` | `npm run format` | Auto-format code |
| `make start` | `./scripts/start.sh` | Launch Streamlit dashboard |
| `make stop` | `./scripts/stop.sh` | Stop Streamlit dashboard |
| `make dev-setup` | `./scripts/dev-setup.sh` | Developer environment setup |
| `make build-image` | `./scripts/podman-build.sh` | Build Podman sandbox image |
| `make build-image-nocache` | `./scripts/podman-build.sh --no-cache` | Rebuild without layer cache |
| `make clean-images` | `./scripts/podman-clean.sh` | Remove NemoClaw containers + images |
| `make clean-images-all` | `./scripts/podman-clean.sh --full` | Full Podman reset |
| `make run-image` | `podman run -p 10001:8501 ...` | Run sandbox image directly |
| `make clean` | Remove `node_modules`, `dist`, `.venv`, logs | Clean build artifacts |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NVIDIA_API_KEY` | – | NVIDIA inference API key (auto-registered at onboard) |
| `NEMOCLAW_AGENT` | `openclaw` | Default agent runtime |
| `NEMOCLAW_MODEL` | see `.env.example` | Default model |
| `NEMOCLAW_INFERENCE_PROVIDER` | `nvidia` | Default provider |
| `NEMOCLAW_GATEWAY_PORT` | `10000` | OpenShell gateway port |
| `NEMOCLAW_SANDBOX_NAME` | `nemoclaw-sandbox` | Default sandbox name |
| `NEMOCLAW_STATE_DIR` | `~/.nemoclaw` | State directory |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint (auto-registered) |
| `LLAMACPP_BASE_URL` | `http://localhost:9931/v1` | llama.cpp endpoint (auto-registered) |
| `LOG_LEVEL` | `info` | Log verbosity |
| `DASHBOARD_PORT` | `8501` | Streamlit dashboard port |
