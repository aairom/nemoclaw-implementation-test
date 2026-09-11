"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0

NemoClaw Dashboard - Streamlit UI
Provides a web-based management interface for NemoClaw sandboxes.
Runnable locally without any cloud dependency.
"""

import os
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

import streamlit as st

# ─── Configuration ──────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv()

STATE_DIR = Path.home() / ".nemoclaw"
APP_TITLE = "NemoClaw Dashboard"
APP_VERSION = "0.1.0"
DASHBOARD_PORT = int(os.getenv("DASHBOARD_PORT", "8501"))


# ─── Page configuration ──────────────────────────────────────────────────────
st.set_page_config(
    page_title=APP_TITLE,
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        "Get Help": "https://github.com/NVIDIA/NemoClaw/discussions",
        "Report a bug": "https://github.com/NVIDIA/NemoClaw/issues",
        "About": f"NemoClaw Dashboard v{APP_VERSION} - NVIDIA Corporation",
    },
)

# ─── Custom CSS ──────────────────────────────────────────────────────────────
st.markdown("""
<style>
.stMetric { background: #1a1a2e; border-radius: 8px; padding: 12px; }
.stMetric label { color: #76b900; font-weight: bold; }
.status-running { color: #4caf50; font-weight: bold; }
.status-stopped { color: #f44336; font-weight: bold; }
.status-pending { color: #ff9800; font-weight: bold; }
.sandbox-card { border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 8px 0; }
</style>
""", unsafe_allow_html=True)


# ─── State helpers ─────────────────────────────────────────────────────────
@st.cache_data(ttl=5)
def load_sandboxes() -> dict:
    """Load the sandbox registry from ~/.nemoclaw/sandboxes.json"""
    sandboxes_file = STATE_DIR / "sandboxes.json"
    if not sandboxes_file.exists():
        return {"sandboxes": [], "default": None}
    try:
        return json.loads(sandboxes_file.read_text())
    except (json.JSONDecodeError, IOError) as e:
        st.error(f"Failed to load sandboxes: {e}")
        return {"sandboxes": [], "default": None}


@st.cache_data(ttl=5)
def load_credentials_registry() -> list:
    """Load credential names (no values) from ~/.nemoclaw/credentials.json"""
    creds_file = STATE_DIR / "credentials.json"
    if not creds_file.exists():
        return []
    try:
        data = json.loads(creds_file.read_text())
        return data.get("credentials", [])
    except (json.JSONDecodeError, IOError):
        return []


def run_nemoclaw_cmd(args: list[str], timeout: int = 30) -> tuple[int, str, str]:
    """
    Run a nemoclaw CLI command and return (exit_code, stdout, stderr).
    Never passes credentials through command args.
    """
    cmd = ["node", str(Path(__file__).parent.parent / "bin" / "nemoclaw.js")] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "NEMOCLAW_SILENT": "0"},
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 1, "", "Command timed out"
    except FileNotFoundError:
        return 1, "", "nemoclaw CLI not found"


# ─── Sidebar ─────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("# 🛡️ NemoClaw")
    st.markdown(f"*v{APP_VERSION}*")
    st.divider()

    # Navigation
    page = st.radio(
        "Navigation",
        ["🏠 Overview", "📦 Sandboxes", "🔐 Credentials", "🌐 Network Policy",
         "⚙️ Inference", "📊 Logs", "🩺 Doctor"],
        label_visibility="collapsed",
    )

    st.divider()
    st.markdown("**Resources**")
    st.markdown("[📚 Docs](https://docs.nvidia.com/nemoclaw/latest/)")
    st.markdown("[💬 Discord](https://discord.gg/XFpfPv9Uvx)")
    st.markdown("[🐛 Issues](https://github.com/NVIDIA/NemoClaw/issues)")

    st.divider()
    gateway_port = os.getenv("NEMOCLAW_GATEWAY_PORT", "10000")
    st.caption(f"Gateway port: {gateway_port}")
    st.caption(f"Dashboard port: {DASHBOARD_PORT}")


# ─── Main content ─────────────────────────────────────────────────────────────

def page_overview():
    """Overview / home page"""
    st.title("🛡️ NemoClaw Dashboard")
    st.markdown("*NVIDIA NemoClaw: Reference Stack for Sandboxed AI Agents in OpenShell*")

    registry = load_sandboxes()
    sandboxes = registry.get("sandboxes", [])
    default_sb = registry.get("default")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Sandboxes", len(sandboxes))
    with col2:
        running = sum(1 for _ in sandboxes)  # Simplified: all assumed running
        st.metric("Running", running, delta=None)
    with col3:
        st.metric("Default Sandbox", default_sb or "None")
    with col4:
        st.metric("Gateway Port", os.getenv("NEMOCLAW_GATEWAY_PORT", "10000"))

    st.divider()

    if not sandboxes:
        st.info(
            "No sandboxes registered. Run `nemoclaw onboard` from your terminal to create one.",
            icon="ℹ️",
        )
        with st.expander("Quick Start"):
            st.code("nemoclaw onboard --agent openclaw --provider nvidia", language="bash")
        return

    st.subheader("Registered Sandboxes")
    for sb in sandboxes:
        with st.container(border=True):
            c1, c2, c3 = st.columns([3, 2, 1])
            with c1:
                is_default = sb.get("name") == default_sb
                name_label = f"🌟 **{sb['name']}** *(default)*" if is_default else f"📦 **{sb['name']}**"
                st.markdown(name_label)
                st.caption(f"Agent: {sb.get('agent', 'openclaw')} | Provider: {sb.get('provider', 'nvidia')}")
            with c2:
                st.caption(f"Model: {sb.get('model', 'N/A')[:40]}")
                created = sb.get("registeredAt", "N/A")
                if created != "N/A":
                    try:
                        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        created = dt.strftime("%Y-%m-%d %H:%M")
                    except ValueError:
                        pass
                st.caption(f"Created: {created}")
            with c3:
                st.markdown('<span class="status-running">● Running</span>', unsafe_allow_html=True)


def page_sandboxes():
    """Sandbox management page"""
    st.title("📦 Sandbox Management")

    registry = load_sandboxes()
    sandboxes = registry.get("sandboxes", [])
    default_sb = registry.get("default")

    if not sandboxes:
        st.warning("No sandboxes registered.")
        st.code("nemoclaw onboard", language="bash")
        return

    # Sandbox selector
    sandbox_names = [sb["name"] for sb in sandboxes]
    selected = st.selectbox(
        "Select Sandbox",
        sandbox_names,
        index=sandbox_names.index(default_sb) if default_sb in sandbox_names else 0,
    )

    sb = next((s for s in sandboxes if s["name"] == selected), None)
    if not sb:
        return

    # Detail panel
    col1, col2 = st.columns(2)
    with col1:
        st.subheader(f"📦 {sb['name']}")
        st.write(f"**Agent:** {sb.get('agent', 'openclaw')}")
        st.write(f"**Provider:** {sb.get('provider', 'nvidia')}")
        st.write(f"**Model:** {sb.get('model', 'N/A')}")
        st.write(f"**Blueprint:** {sb.get('blueprintVersion', 'N/A')}")
        st.write(f"**Created:** {sb.get('registeredAt', 'N/A')}")
    with col2:
        st.subheader("Actions")
        col_a, col_b = st.columns(2)
        with col_a:
            if st.button("▶️ Start", use_container_width=True):
                code, out, err = run_nemoclaw_cmd(["start", "--sandbox", sb["name"]])
                st.success("Started" if code == 0 else f"Error: {err}")
            if st.button("⟳ Rebuild", use_container_width=True):
                code, out, err = run_nemoclaw_cmd(["rebuild", "--sandbox", sb["name"], "--yes"])
                st.success("Rebuilt" if code == 0 else f"Error: {err}")
        with col_b:
            if st.button("⏹ Stop", use_container_width=True):
                code, out, err = run_nemoclaw_cmd(["stop", "--sandbox", sb["name"]])
                st.success("Stopped" if code == 0 else f"Error: {err}")
            if st.button("🔄 Recover", use_container_width=True):
                code, out, err = run_nemoclaw_cmd(["recover", "--sandbox", sb["name"]])
                st.success("Recovery complete" if code == 0 else f"Error: {err}")


def page_credentials():
    """Credential management page"""
    st.title("🔐 Credentials")
    st.info(
        "Credentials are stored in the OpenShell gateway store. "
        "Values are never shown here — only names and registration metadata.",
        icon="🔒",
    )

    # ── Known credentials derived from .env ──────────────────────────────────
    ENV_CREDS = [
        {"envVar": "NVIDIA_API_KEY",    "name": "NVIDIA_API_KEY",    "provider": "nvidia"},
        {"envVar": "OLLAMA_BASE_URL",   "name": "OLLAMA_BASE_URL",   "provider": "ollama"},
        {"envVar": "LLAMACPP_BASE_URL", "name": "LLAMACPP_BASE_URL", "provider": "openai-compatible"},
    ]

    creds = load_credentials_registry()
    registered_names = {c["name"] for c in creds}

    # ── Show .env credential status ───────────────────────────────────────────
    st.subheader("Environment Credentials (.env)")
    for ec in ENV_CREDS:
        val = os.getenv(ec["envVar"], "")
        env_set    = bool(val and val.strip())
        registered = ec["name"] in registered_names
        col1, col2, col3 = st.columns([3, 2, 2])
        with col1:
            st.markdown(f"**{ec['name']}**  \n`provider: {ec['provider']}`")
        with col2:
            st.markdown("✅ Set in .env" if env_set else "⚠️ Not in .env")
        with col3:
            st.markdown("✅ Registered" if registered else "❌ Not registered")

    # ── Auto-register button ──────────────────────────────────────────────────
    st.divider()
    unregistered = [
        ec for ec in ENV_CREDS
        if os.getenv(ec["envVar"], "").strip() and ec["name"] not in registered_names
    ]
    if unregistered:
        names = ", ".join(f"`{ec['name']}`" for ec in unregistered)
        st.warning(
            f"{len(unregistered)} credential(s) set in .env but not yet registered: {names}",
            icon="⚠️",
        )
        if st.button("⚡ Register from .env now", type="primary", use_container_width=True):
            with st.spinner("Registering credentials..."):
                code, out, err = run_nemoclaw_cmd(["onboard", "--fresh", "--provider",
                                                   os.getenv("NEMOCLAW_INFERENCE_PROVIDER", "nvidia")])
            if code == 0:
                st.success("Credentials registered. Refreshing...")
                st.cache_data.clear()
                st.rerun()
            else:
                # Fallback: run credentials add non-interactively via a helper flag
                st.error("Auto-register via onboard failed. Use the CLI:")
                st.code("nemoclaw credentials add NVIDIA_API_KEY --provider nvidia", language="bash")
    else:
        st.success("All .env credentials are registered.", icon="✅")

    # ── Registered credentials detail ────────────────────────────────────────
    if creds:
        st.divider()
        st.subheader("Registered Credential Records")
        for c in creds:
            with st.container(border=True):
                col1, col2 = st.columns([3, 2])
                with col1:
                    st.markdown(f"**{c['name']}** — provider: `{c.get('provider', 'unknown')}`")
                    st.caption(f"Registered: {c.get('registeredAt', 'N/A')}")
                with col2:
                    if c.get("rotatedAt"):
                        st.caption(f"Last rotated: {c['rotatedAt']}")
                    env_active = bool(os.getenv(c["name"], "").strip())
                    st.markdown("🟢 Active in env" if env_active else "🔴 Env var not set")

    st.divider()
    st.markdown("**Add or rotate via CLI:**")
    st.code(
        "nemoclaw credentials add NVIDIA_API_KEY --provider nvidia\n"
        "nemoclaw credentials reset NVIDIA_API_KEY",
        language="bash",
    )


def page_network_policy():
    """Network policy page"""
    st.title("🌐 Network Policy")

    policy_dir = STATE_DIR / "policies"
    registry = load_sandboxes()
    sandboxes = registry.get("sandboxes", [])

    if not sandboxes:
        st.warning("No sandboxes registered.")
        return

    sandbox_names = [sb["name"] for sb in sandboxes]
    selected_sb = st.selectbox("Sandbox", sandbox_names)

    policy_file = policy_dir / selected_sb / "policy.yaml"
    if policy_file.exists():
        import yaml
        try:
            policy = yaml.safe_load(policy_file.read_text())
            st.subheader("Egress Rules")
            egress = policy.get("egress", [])
            if egress:
                data = {
                    "Host": [r.get("host", "") for r in egress],
                    "Port": [str(r.get("port", "")) for r in egress],
                    "Protocol": [r.get("protocol", "") for r in egress],
                    "Comment": [r.get("comment", "") for r in egress],
                }
                st.dataframe(data, use_container_width=True)
            else:
                st.info("No egress rules defined.")
        except Exception as e:
            st.error(f"Failed to load policy: {e}")
    else:
        st.info("No custom policy file found. Using baseline defaults.")
        st.markdown("Baseline egress rules:")
        baseline = [
            "inference.local:443/https",
            "registry.npmjs.org:443/https",
            "pypi.org:443/https",
            "github.com:443/https",
        ]
        for rule in baseline:
            st.code(rule)


def page_inference():
    """Inference configuration page"""
    st.title("⚙️ Inference Configuration")

    registry = load_sandboxes()
    sandboxes = registry.get("sandboxes", [])

    if not sandboxes:
        st.warning("No sandboxes registered.")
        return

    sandbox_names = [sb["name"] for sb in sandboxes]
    selected_sb = st.selectbox("Sandbox", sandbox_names)
    sb = next((s for s in sandboxes if s["name"] == selected_sb), None)

    if not sb:
        return

    st.subheader("Current Configuration")
    col1, col2 = st.columns(2)
    with col1:
        st.write(f"**Provider:** {sb.get('provider', 'nvidia')}")
        st.write(f"**Model:** {sb.get('model', 'N/A')}")
    with col2:
        st.write("**Inference route:** `inference.local` (managed)")
        cred_ok = bool(os.getenv("NVIDIA_API_KEY"))
        st.write(f"**Credential:** {'✅ Configured' if cred_ok else '❌ Not set (check .env)'}")

    st.divider()
    st.subheader("Update Inference")
    with st.form("update_inference"):
        providers = ["nvidia", "ollama", "openai-compatible", "model-router"]
        new_provider = st.selectbox("Provider", providers,
                                    index=providers.index(sb.get("provider", "nvidia")))
        new_model = st.text_input("Model", value=sb.get("model", ""))
        submitted = st.form_submit_button("Update")
        if submitted:
            code, _, err = run_nemoclaw_cmd([
                "inference", "set",
                "--provider", new_provider,
                "--model", new_model,
                "--sandbox", selected_sb,
            ])
            if code == 0:
                st.success("Inference updated. Reload to see changes.")
                st.cache_data.clear()
            else:
                st.error(f"Update failed: {err}")


def page_logs():
    """Logs viewer page"""
    st.title("📊 Logs")

    registry = load_sandboxes()
    sandboxes = registry.get("sandboxes", [])

    if not sandboxes:
        st.warning("No sandboxes registered.")
        return

    sandbox_names = [sb["name"] for sb in sandboxes]
    col1, col2 = st.columns([3, 1])
    with col1:
        selected_sb = st.selectbox("Sandbox", sandbox_names)
    with col2:
        lines = st.number_input("Lines", min_value=10, max_value=500, value=50, step=10)

    if st.button("🔄 Refresh Logs"):
        code, out, err = run_nemoclaw_cmd(["logs", "--sandbox", selected_sb, "--lines", str(lines)])
        st.code(out or err or "[No log output]", language="bash")

    st.info("Run `nemoclaw logs --follow` in your terminal for real-time streaming.")


def page_doctor():
    """Doctor / diagnostics page"""
    st.title("🩺 NemoClaw Doctor")

    if st.button("Run Diagnostics"):
        with st.spinner("Running host readiness probe..."):
            code, out, err = run_nemoclaw_cmd(["host", "probe", "--json"])

        if code == 0:
            try:
                probe_data = json.loads(out)
                probe = probe_data.get("probe", {})

                st.subheader("Host Readiness")
                checks = {
                    "Node.js": probe.get("node", {}),
                    "npm": probe.get("npm", {}),
                    "Container Runtime": probe.get("docker", {}),
                    "Python 3": probe.get("python", {}),
                    "Disk Space": probe.get("disk", {}),
                    "RAM": probe.get("ram", {}),
                    "Gateway Port": probe.get("port", {}),
                }
                for name, check in checks.items():
                    ok = check.get("ok", False)
                    found = check.get("found", "N/A")
                    icon = "✅" if ok else "❌"
                    st.markdown(f"{icon} **{name}**: {found}")
            except json.JSONDecodeError:
                st.code(out or err or "[No output]")
        else:
            st.error(f"Probe failed: {err}")
            st.code(out)


# ─── Page routing ─────────────────────────────────────────────────────────────
match page:
    case "🏠 Overview":
        page_overview()
    case "📦 Sandboxes":
        page_sandboxes()
    case "🔐 Credentials":
        page_credentials()
    case "🌐 Network Policy":
        page_network_policy()
    case "⚙️ Inference":
        page_inference()
    case "📊 Logs":
        page_logs()
    case "🩺 Doctor":
        page_doctor()
    case _:
        page_overview()
