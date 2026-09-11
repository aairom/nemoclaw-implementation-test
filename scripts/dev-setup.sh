#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# NemoClaw dev-setup.sh
# Sets up the development environment for NemoClaw contributors.
# Does NOT create a runtime sandbox unless --with-runtime is passed.
#
# Usage:
#   ./scripts/dev-setup.sh             # Default: install deps and hooks
#   ./scripts/dev-setup.sh --repair    # Repair/re-run local setup
#   ./scripts/dev-setup.sh --expose-cli  # Also expose nemoclaw CLI on PATH
#   ./scripts/dev-setup.sh --with-runtime  # Include sandbox validation setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ─── Parse arguments ──────────────────────────────────────────────────────────
WITH_RUNTIME=false
REPAIR=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --with-runtime)  WITH_RUNTIME=true; shift ;;
    --repair)        REPAIR=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

cd "${PROJECT_DIR}"

# ─── Check prerequisites ──────────────────────────────────────────────────────
echo "Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required. Install Node.js 22.16+ from https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "ERROR: Node.js 22+ required. Found: $(node --version)"
  exit 1
fi
echo "  ✓ Node.js $(node --version)"

# npm
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm is required."
  exit 1
fi
echo "  ✓ npm $(npm --version)"

# Python 3
if command -v python3 &>/dev/null; then
  echo "  ✓ Python3 $(python3 --version)"
else
  echo "  ⚠ Python3 not found. Dashboard features may be limited."
fi

# ─── Install Node.js dependencies ─────────────────────────────────────────────
echo ""
echo "Installing Node.js dependencies..."
npm install

echo "Installing TypeScript plugin dependencies..."
cd nemoclaw && npm install && npm run build && cd ..

# ─── Python virtual environment ──────────────────────────────────────────────
echo "Setting up Python virtual environment..."
if [[ ! -d ".venv" ]] || [[ "${REPAIR}" == "true" ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
deactivate
echo "  ✓ Python virtual environment ready at .venv/"

# ─── Copy .env.example if .env does not exist ────────────────────────────────
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "  ✓ Created .env from .env.example — please fill in your API keys"
fi

# ─── Create required directories ─────────────────────────────────────────────
mkdir -p input output logs

# ─── Link CLI globally via npm link ──────────────────────────────────────────
# Makes `nemoclaw` available as a global command without a global install.
echo ""
echo "Linking nemoclaw CLI globally..."
chmod +x bin/nemoclaw.js
if npm link 2>/dev/null; then
  echo "  ✓ nemoclaw linked: $(which nemoclaw 2>/dev/null || echo 'check your PATH')"
else
  echo "  ⚠ npm link failed (may need sudo or nvm). You can still run:"
  echo "    node ${PROJECT_DIR}/bin/nemoclaw.js <command>"
fi

# ─── Runtime setup (sandbox validation) ───────────────────────────────────────
if [[ "${WITH_RUNTIME}" == "true" ]]; then
  echo ""
  echo "Runtime setup (sandbox validation mode)..."
  # In production: this would set up a local OpenShell gateway
  echo "  ⚠ Runtime setup requires Docker/Podman. Checking..."
  if command -v podman &>/dev/null; then
    echo "  ✓ Podman found: $(podman --version)"
  elif command -v docker &>/dev/null; then
    echo "  ✓ Docker found: $(docker --version)"
  else
    echo "  ERROR: Docker or Podman required for runtime setup."
    exit 1
  fi
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        NemoClaw Dev Setup Complete               ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Run tests:   npm test                           ║"
echo "║  Run linter:  make check                         ║"
echo "║  Start UI:    ./scripts/start.sh                 ║"
echo "║  Onboard:     nemoclaw onboard                   ║"
echo "║  Probe:       nemoclaw host probe                ║"
echo "╚══════════════════════════════════════════════════╝"
