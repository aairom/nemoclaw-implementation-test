#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# scripts/podman-clean.sh
# ---------------------------------------------------------------------------
# Remove NemoClaw Podman images, containers, and build cache.
#
# Usage:
#   ./scripts/podman-clean.sh              # Remove stopped containers + images
#   ./scripts/podman-clean.sh --all        # Also remove running containers
#   ./scripts/podman-clean.sh --prune      # Also prune dangling images + build cache
#   ./scripts/podman-clean.sh --full       # Full reset: containers + images + volumes + cache
#   ./scripts/podman-clean.sh --dry-run    # Show what would be removed without deleting
#
# Flags can be combined:  ./scripts/podman-clean.sh --all --prune
# ---------------------------------------------------------------------------

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Defaults ─────────────────────────────────────────────────────────────────
REMOVE_ALL_CONTAINERS=false   # --all  : stop + remove running containers too
PRUNE_DANGLING=false          # --prune: remove dangling images + build cache
FULL_RESET=false              # --full : everything including named volumes
DRY_RUN=false                 # --dry-run: print only, no deletions

# ─── Parse arguments ──────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --all)      REMOVE_ALL_CONTAINERS=true ;;
    --prune)    PRUNE_DANGLING=true ;;
    --full)     FULL_RESET=true; REMOVE_ALL_CONTAINERS=true; PRUNE_DANGLING=true ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      sed -n '/^# Usage:/,/^# ---/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${RESET}"
      echo "Run $0 --help for usage."
      exit 1
      ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Run or preview a command depending on --dry-run
run() {
  if $DRY_RUN; then
    echo -e "  ${CYAN}[dry-run]${RESET} $*"
  else
    eval "$@"
  fi
}

# Check that podman is available
require_podman() {
  if ! command -v podman &>/dev/null; then
    echo -e "${RED}✖ podman not found on PATH.${RESET}"
    echo "  Install Podman Desktop from https://podman.io and try again."
    exit 1
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
require_podman

echo ""
echo -e "${BOLD}  NemoClaw — Podman Cleanup${RESET}"
$DRY_RUN && echo -e "  ${CYAN}[dry-run mode — nothing will be deleted]${RESET}"
echo ""

# ── 1. Stop running NemoClaw containers ──────────────────────────────────────
echo -e "${BOLD}  Step 1: Containers${RESET}"

RUNNING=$(podman ps --filter "name=nemoclaw" --format "{{.Names}}" 2>/dev/null || true)
if [ -n "$RUNNING" ]; then
  if $REMOVE_ALL_CONTAINERS; then
    echo -e "  ${YELLOW}Stopping running NemoClaw containers:${RESET}"
    while IFS= read -r cname; do
      echo "    → stopping $cname"
      run podman stop "$cname"
    done <<< "$RUNNING"
  else
    echo -e "  ${YELLOW}⚠ Running containers found (use --all to stop them):${RESET}"
    while IFS= read -r cname; do
      echo "    · $cname (skipped — still running)"
    done <<< "$RUNNING"
  fi
else
  echo -e "  ${GREEN}✓ No running NemoClaw containers.${RESET}"
fi

# Remove stopped NemoClaw containers
STOPPED=$(podman ps -a --filter "name=nemoclaw" --filter "status=exited" --format "{{.Names}}" 2>/dev/null || true)
CREATED=$(podman ps -a --filter "name=nemoclaw" --filter "status=created" --format "{{.Names}}" 2>/dev/null || true)
ALL_STOPPED=$(printf '%s\n%s' "$STOPPED" "$CREATED" | sed '/^$/d' | sort -u)

if [ -n "$ALL_STOPPED" ]; then
  echo -e "  ${YELLOW}Removing stopped NemoClaw containers:${RESET}"
  while IFS= read -r cname; do
    echo "    → removing $cname"
    run podman rm "$cname"
  done <<< "$ALL_STOPPED"
else
  echo -e "  ${GREEN}✓ No stopped NemoClaw containers to remove.${RESET}"
fi
echo ""

# ── 2. Remove NemoClaw images ─────────────────────────────────────────────────
echo -e "${BOLD}  Step 2: Images${RESET}"

# Match images by name patterns used in the project
IMAGE_PATTERNS=("nemoclaw" "nemoclaw-sandbox" "nvidia/nemoclaw")
IMAGES_FOUND=""

for pattern in "${IMAGE_PATTERNS[@]}"; do
  MATCHED=$(podman images --filter "reference=*${pattern}*" --format "{{.Repository}}:{{.Tag}} {{.ID}}" 2>/dev/null || true)
  if [ -n "$MATCHED" ]; then
    IMAGES_FOUND+="$MATCHED"$'\n'
  fi
done

# Deduplicate by image ID
IMAGES_FOUND=$(echo "$IMAGES_FOUND" | sort -uk2 | sed '/^$/d')

if [ -n "$IMAGES_FOUND" ]; then
  echo -e "  ${YELLOW}Removing NemoClaw images:${RESET}"
  while IFS= read -r line; do
    REF=$(echo "$line" | awk '{print $1}')
    ID=$(echo "$line" | awk '{print $2}')
    echo "    → $REF ($ID)"
    run podman rmi --force "$ID"
  done <<< "$IMAGES_FOUND"
else
  echo -e "  ${GREEN}✓ No NemoClaw images found.${RESET}"
fi
echo ""

# ── 3. Prune dangling images + build cache (--prune / --full) ─────────────────
if $PRUNE_DANGLING; then
  echo -e "${BOLD}  Step 3: Dangling Images & Build Cache${RESET}"

  DANGLING=$(podman images --filter "dangling=true" --format "{{.ID}}" 2>/dev/null || true)
  if [ -n "$DANGLING" ]; then
    COUNT=$(echo "$DANGLING" | wc -l | tr -d ' ')
    echo -e "  ${YELLOW}Removing ${COUNT} dangling image(s)...${RESET}"
    run podman image prune --force
  else
    echo -e "  ${GREEN}✓ No dangling images.${RESET}"
  fi

  # Podman build cache (buildah cache)
  if command -v buildah &>/dev/null; then
    echo -e "  ${YELLOW}Pruning buildah build cache...${RESET}"
    run buildah prune --force 2>/dev/null || true
  fi

  echo ""
fi

# ── 4. Remove named volumes (--full only) ─────────────────────────────────────
if $FULL_RESET; then
  echo -e "${BOLD}  Step 4: Named Volumes${RESET}"

  VOLS=$(podman volume ls --filter "label=app=nemoclaw" --format "{{.Name}}" 2>/dev/null || true)
  if [ -n "$VOLS" ]; then
    echo -e "  ${YELLOW}Removing NemoClaw volumes:${RESET}"
    while IFS= read -r vol; do
      echo "    → $vol"
      run podman volume rm "$vol"
    done <<< "$VOLS"
  else
    echo -e "  ${GREEN}✓ No NemoClaw-labelled volumes found.${RESET}"
  fi
  echo ""
fi

# ── 5. Summary ────────────────────────────────────────────────────────────────
echo -e "${BOLD}  Summary${RESET}"
echo -e "  Remaining NemoClaw containers : $(podman ps -a --filter 'name=nemoclaw' --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')"
echo -e "  Remaining NemoClaw images     : $(podman images --filter 'reference=*nemoclaw*' --format '{{.ID}}' 2>/dev/null | wc -l | tr -d ' ')"
echo ""

if $DRY_RUN; then
  echo -e "  ${CYAN}[dry-run] No changes were made. Remove --dry-run to apply.${RESET}"
else
  echo -e "  ${GREEN}✓ Cleanup complete.${RESET}"
fi
echo ""
