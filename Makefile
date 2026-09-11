# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# NemoClaw Makefile

.PHONY: install link build test test-all lint check format docs docs-live clean

# ─── Install ──────────────────────────────────────────────────────────────────
install:
	npm install
	cd nemoclaw && npm install && npm run build && cd ..
	@if command -v python3 >/dev/null 2>&1; then \
		python3 -m venv .venv 2>/dev/null || true; \
		.venv/bin/pip install -q -r requirements.txt; \
	fi
	npm link
	@echo "  ✓ 'nemoclaw' command available globally"

# ─── Link CLI globally ────────────────────────────────────────────────────────
link:
	npm link
	@echo "  ✓ nemoclaw linked: $$(which nemoclaw)"

# ─── Build ────────────────────────────────────────────────────────────────────
build:
	cd nemoclaw && npm run build

# ─── Test ─────────────────────────────────────────────────────────────────────
test:
	npm test

test-plugin:
	cd nemoclaw && npm test

test-python:
	.venv/bin/python -m pytest test/test_dashboard.py -v --tb=short

test-all: test test-plugin test-python

# ─── Lint / Check ─────────────────────────────────────────────────────────────
lint:
	npm run lint

typecheck:
	npm run typecheck:cli
	cd nemoclaw && npm run typecheck

check: lint typecheck test

# ─── Format ──────────────────────────────────────────────────────────────────
format:
	npm run format

# ─── Docs ────────────────────────────────────────────────────────────────────
docs:
	@echo "Building docs (Sphinx/MyST)..."
	@echo "Open Docs/ directory for Markdown docs."

docs-live:
	@echo "Serving docs locally..."

# ─── Run ─────────────────────────────────────────────────────────────────────
start:
	./scripts/start.sh

stop:
	./scripts/stop.sh

dev-setup:
	./scripts/dev-setup.sh

# ─── Docker / Podman ─────────────────────────────────────────────────────────
build-image:
	./scripts/podman-build.sh

build-image-nocache:
	./scripts/podman-build.sh --no-cache

clean-images:
	./scripts/podman-clean.sh

clean-images-all:
	./scripts/podman-clean.sh --full

run-image:
	podman run -p 10001:8501 --env-file .env nemoclaw-sandbox:latest

# ─── Clean ───────────────────────────────────────────────────────────────────
clean:
	rm -rf node_modules nemoclaw/node_modules nemoclaw/dist dist-cli
	rm -rf .venv coverage .nyc_output
	rm -f logs/*.log logs/*.pid

.DEFAULT_GOAL := help

help:
	@echo ""
	@echo "NemoClaw Makefile Commands"
	@echo "─────────────────────────────────────────────"
	@echo "  make install           Install all dependencies + link CLI"
	@echo "  make link              Link 'nemoclaw' CLI globally (npm link)"
	@echo "  make build             Build TypeScript plugin"
	@echo "  make test              Run CLI integration tests"
	@echo "  make test-plugin       Run TypeScript plugin tests"
	@echo "  make test-python       Run Python tests"
	@echo "  make test-all          Run all tests"
	@echo "  make lint              Run linters"
	@echo "  make check             lint + typecheck + test"
	@echo "  make format            Auto-format code"
	@echo "  make start             Launch the Streamlit dashboard"
	@echo "  make stop              Stop the dashboard"
	@echo "  make build-image       Build Podman sandbox image"
	@echo "  make build-image-nocache  Force rebuild (no layer cache)"
	@echo "  make clean-images      Remove NemoClaw Podman images/containers"
	@echo "  make clean-images-all  Full Podman reset (images + volumes)"
	@echo "  make clean             Clean build artifacts"
	@echo ""
