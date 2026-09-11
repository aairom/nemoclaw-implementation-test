#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# NemoClaw start.sh
# Launches the NemoClaw Streamlit dashboard in detached mode.
# Displays the URL to access the application on the console.
#
# Usage: ./scripts/start.sh [--port PORT] [--no-browser]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ─── Configuration ──────────────────────────────────────────────────────────
# Source .env if it exists
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

DASHBOARD_PORT="${DASHBOARD_PORT:-8501}"
LOG_FILE="${PROJECT_DIR}/logs/dashboard.log"
PID_FILE="${PROJECT_DIR}/logs/dashboard.pid"
VENV_DIR="${PROJECT_DIR}/.venv"

# Parse arguments
NO_BROWSER=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)     DASHBOARD_PORT="$2"; shift 2 ;;
    --no-browser) NO_BROWSER=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ─── Validate ───────────────────────────────────────────────────────────────
if [[ "${DASHBOARD_PORT}" -eq 5000 ]]; then
  echo "ERROR: Port 5000 is reserved for AirDrop on macOS. Use a different port."
  exit 1
fi

# ─── Directories ────────────────────────────────────────────────────────────
mkdir -p "${PROJECT_DIR}/logs"
mkdir -p "${PROJECT_DIR}/output"

# ─── Python virtual environment ──────────────────────────────────────────────
if [[ ! -d "${VENV_DIR}" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "${VENV_DIR}"
fi

echo "Activating virtual environment and installing dependencies..."
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install -q -r "${PROJECT_DIR}/requirements.txt"

# ─── Check if already running ────────────────────────────────────────────────
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(cat "${PID_FILE}")"
  if kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "Dashboard is already running (PID: ${OLD_PID})"
    echo "  Dashboard URL: http://localhost:${DASHBOARD_PORT}"
    exit 0
  else
    rm -f "${PID_FILE}"
  fi
fi

# ─── Launch dashboard ────────────────────────────────────────────────────────
echo "Starting NemoClaw Dashboard..."
nohup "${VENV_DIR}/bin/streamlit" run \
  "${PROJECT_DIR}/dashboard/app.py" \
  --server.port "${DASHBOARD_PORT}" \
  --server.headless true \
  --server.address "0.0.0.0" \
  --browser.serverAddress "localhost" \
  --logger.level "${LOG_LEVEL:-info}" \
  > "${LOG_FILE}" 2>&1 &

DASHBOARD_PID=$!
echo "${DASHBOARD_PID}" > "${PID_FILE}"

# Wait briefly to check it started
sleep 2
if ! kill -0 "${DASHBOARD_PID}" 2>/dev/null; then
  echo "ERROR: Dashboard failed to start. Check logs: ${LOG_FILE}"
  cat "${LOG_FILE}" | tail -20
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       🛡️  NemoClaw Dashboard Started             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  URL:    http://localhost:${DASHBOARD_PORT}              ║"
echo "║  PID:    ${DASHBOARD_PID}                                    ║"
echo "║  Logs:   ${LOG_FILE}    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "To stop: ./scripts/stop.sh"
