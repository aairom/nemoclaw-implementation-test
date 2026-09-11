#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# NemoClaw stop.sh
# Gracefully stops the NemoClaw Streamlit dashboard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PID_FILE="${PROJECT_DIR}/logs/dashboard.pid"
DASHBOARD_PORT="${DASHBOARD_PORT:-8501}"

echo "Stopping NemoClaw Dashboard..."

# ─── Stop via PID file ───────────────────────────────────────────────────────
if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}")"
  if kill -0 "${PID}" 2>/dev/null; then
    echo "Sending SIGTERM to PID ${PID}..."
    kill -SIGTERM "${PID}"
    # Wait up to 5 seconds
    for i in {1..5}; do
      if ! kill -0 "${PID}" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "${PID}" 2>/dev/null; then
      echo "Process did not stop gracefully. Sending SIGKILL..."
      kill -SIGKILL "${PID}" || true
    fi
    rm -f "${PID_FILE}"
    echo "Dashboard stopped (PID: ${PID})"
  else
    echo "Process ${PID} is no longer running."
    rm -f "${PID_FILE}"
  fi
else
  echo "No PID file found at ${PID_FILE}."
  # Try to find and kill by port
  if command -v lsof &>/dev/null; then
    PORT_PID="$(lsof -ti :"${DASHBOARD_PORT}" 2>/dev/null || true)"
    if [[ -n "${PORT_PID}" ]]; then
      echo "Found process on port ${DASHBOARD_PORT} (PID: ${PORT_PID}). Stopping..."
      kill -SIGTERM "${PORT_PID}" || true
      echo "Dashboard stopped."
    else
      echo "No process found on port ${DASHBOARD_PORT}."
    fi
  fi
fi
