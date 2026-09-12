#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Remove project-local Node.js dependencies, Python virtual environments, and
# recursively generated __pycache__ directories.
#
# Usage:
#   ./scripts/clean-dependencies.sh             # Preview removals
#   ./scripts/clean-dependencies.sh --yes       # Remove dependencies
#   ./scripts/clean-dependencies.sh --dry-run   # Explicit preview
#
# The script only removes known project-local directories and __pycache__ folders
# below the project root. It never removes globally installed Node.js packages,
# user Python installations, source code, configuration files, or the .env file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONFIRM=false
DRY_RUN=false

usage() {
  sed -n '/^# Usage:/,/^# The script/p' "$0" | sed 's/^# \?//'
}

for arg in "$@"; do
  case "$arg" in
    --yes|-y) CONFIRM=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

TARGETS=(
  "${PROJECT_DIR}/node_modules"
  "${PROJECT_DIR}/nemoclaw/node_modules"
  "${PROJECT_DIR}/.venv"
  "${PROJECT_DIR}/venv"
)

FOUND=()
for target in "${TARGETS[@]}"; do
  if [[ -e "$target" || -L "$target" ]]; then
    FOUND+=("$target")
  fi
done

# Find generated Python bytecode directories without following symlinks.
while IFS= read -r -d '' cache_dir; do
  FOUND+=("$cache_dir")
done < <(find "$PROJECT_DIR" -type d -name '__pycache__' -prune -print0)

echo "NemoClaw local dependency cleanup"
echo "Project: ${PROJECT_DIR}"

if [[ ${#FOUND[@]} -eq 0 ]]; then
  echo "No project-local dependencies, virtual environments, or __pycache__ folders found."
  exit 0
fi

echo "Directories selected for removal:"
for target in "${FOUND[@]}"; do
  echo "  - ${target#"${PROJECT_DIR}/"}"
done

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: no files were removed."
  exit 0
fi

if [[ "$CONFIRM" != true ]]; then
  echo "Nothing was removed. Re-run with --yes to confirm deletion."
  exit 0
fi

for target in "${FOUND[@]}"; do
  rm -rf -- "$target"
  echo "Removed ${target#"${PROJECT_DIR}/"}"
done

echo "Cleanup complete."
