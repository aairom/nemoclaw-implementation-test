#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# scripts/podman-build.sh
# ---------------------------------------------------------------------------
# Build the NemoClaw sandbox container image using Podman.
# Uses the Containerfile (compatible with Dockerfile) at the project root.
#
# Usage:
#   ./scripts/podman-build.sh                   # Build with default tag
#   ./scripts/podman-build.sh --tag my-tag      # Custom image tag
#   ./scripts/podman-build.sh --no-cache        # Force full rebuild
#   ./scripts/podman-build.sh --platform linux/amd64
# ---------------------------------------------------------------------------

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Defaults ─────────────────────────────────────────────────────────────────
IMAGE_TAG="nemoclaw-sandbox:latest"
NO_CACHE=""
PLATFORM=""
CONTAINERFILE="Containerfile"   # preferred; falls back to Dockerfile

# ─── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)       IMAGE_TAG="$2"; shift 2 ;;
    --no-cache)  NO_CACHE="--no-cache"; shift ;;
    --platform)  PLATFORM="--platform $2"; shift 2 ;;
    --help|-h)
      sed -n '/^# Usage:/,/^# ---/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${RESET}"
      echo "Run $0 --help for usage."
      exit 1
      ;;
  esac
done

# ─── Validate environment ─────────────────────────────────────────────────────
if ! command -v podman &>/dev/null; then
  echo -e "${RED}✖ podman not found on PATH.${RESET}"
  echo "  Install Podman Desktop from https://podman.io and try again."
  exit 1
fi

# Prefer Containerfile; fall back to Dockerfile
if [ ! -f "$CONTAINERFILE" ]; then
  CONTAINERFILE="Dockerfile"
fi
if [ ! -f "$CONTAINERFILE" ]; then
  echo -e "${RED}✖ Neither Containerfile nor Dockerfile found in project root.${RESET}"
  exit 1
fi

# ─── Build ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  NemoClaw — Podman Image Build${RESET}"
echo ""
echo -e "  ${CYAN}Containerfile : ${CONTAINERFILE}${RESET}"
echo -e "  ${CYAN}Image tag     : ${IMAGE_TAG}${RESET}"
[ -n "$NO_CACHE" ]  && echo -e "  ${YELLOW}Cache         : disabled${RESET}"
[ -n "$PLATFORM" ]  && echo -e "  ${CYAN}Platform      : ${PLATFORM/--platform /}${RESET}"
echo ""

START_TIME=$(date +%s)

# shellcheck disable=SC2086
podman build \
  $NO_CACHE \
  $PLATFORM \
  --tag "$IMAGE_TAG" \
  --label "app=nemoclaw" \
  --label "version=$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')" \
  --label "build-date=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --file "$CONTAINERFILE" \
  .

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))

echo ""
echo -e "  ${GREEN}✓ Image built successfully in ${ELAPSED}s${RESET}"
echo -e "  ${CYAN}Tag: ${IMAGE_TAG}${RESET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "  Run the sandbox:   podman run --rm -it ${IMAGE_TAG}"
echo -e "  Or onboard:        node bin/nemoclaw.js onboard --provider nvidia"
echo ""
