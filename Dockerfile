# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# NemoClaw multi-stage Dockerfile
# Compatible with Containerfiles (Podman).
# Produces the smallest possible production image.
#
# Build: podman build -t nemoclaw:latest .
# Run:   podman run -p 8501:8501 --env-file .env nemoclaw:latest

# ────────────────────────────────────────────────────────────────────────────
# Stage 1: Node.js builder – compile TypeScript plugin
# ────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS node-builder

WORKDIR /build

# Copy package files for caching
COPY package.json package-lock.json* ./
COPY nemoclaw/package.json nemoclaw/package-lock.json* ./nemoclaw/

# Install ALL deps (including devDeps for build)
RUN npm ci --ignore-scripts && \
    cd nemoclaw && npm ci --ignore-scripts

# Copy source
COPY bin/ ./bin/
COPY nemoclaw/src/ ./nemoclaw/src/
COPY nemoclaw/tsconfig.json ./nemoclaw/
COPY nemoclaw/openclaw.plugin.json ./nemoclaw/

# Compile TypeScript plugin
RUN cd nemoclaw && npm run build

# Prune dev dependencies
RUN npm prune --production && \
    cd nemoclaw && npm prune --production

# ────────────────────────────────────────────────────────────────────────────
# Stage 2: Python builder – install Python dependencies
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-alpine AS python-builder

WORKDIR /build

# Install build deps
RUN apk add --no-cache gcc musl-dev

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ────────────────────────────────────────────────────────────────────────────
# Stage 3: Production image
# ────────────────────────────────────────────────────────────────────────────
FROM python:3.12-alpine AS production

# Install Node.js runtime (no build tools)
RUN apk add --no-cache nodejs

WORKDIR /app

# Copy Python packages
COPY --from=python-builder /install /usr/local

# Copy Node.js app (production deps only)
COPY --from=node-builder /build/node_modules ./node_modules
COPY --from=node-builder /build/nemoclaw/node_modules ./nemoclaw/node_modules
COPY --from=node-builder /build/nemoclaw/dist ./nemoclaw/dist
COPY --from=node-builder /build/nemoclaw/openclaw.plugin.json ./nemoclaw/

# Copy application code
COPY bin/ ./bin/
COPY dashboard/ ./dashboard/
COPY nemoclaw-blueprint/ ./nemoclaw-blueprint/
COPY package.json ./

# Copy entrypoint and config
COPY .env.example ./

# Create required directories
RUN mkdir -p /app/input /app/output /app/logs && \
    chmod +x /app/bin/nemoclaw.js

# Security: run as non-root user
RUN addgroup -S nemoclaw && adduser -S -G nemoclaw nemoclaw && \
    chown -R nemoclaw:nemoclaw /app

# Pre-create Streamlit config directory and bake in a config.toml that:
#   - disables telemetry (no machine-ID write needed)
#   - disables the browser auto-open (headless)
#   - sets a static installation ID so metrics_util never writes one
# This prevents OSError: Read-only file system on /home/nemoclaw/.streamlit
# when the container is started with --read-only.
RUN mkdir -p /home/nemoclaw/.streamlit && \
    printf '[browser]\ngatherUsageStats = false\n\n[server]\nheadless = true\nenableCORS = false\nenableXsrfProtection = false\n\n[global]\nshowWarningOnDirectExecution = false\n' \
    > /home/nemoclaw/.streamlit/config.toml && \
    chown -R nemoclaw:nemoclaw /home/nemoclaw/.streamlit

USER nemoclaw

# Expose dashboard port (not 5000 - reserved for AirDrop on macOS)
EXPOSE 8501

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q --spider http://localhost:8501/_stcore/health || exit 1

# Default: start the Streamlit dashboard
CMD ["python3", "-m", "streamlit", "run", "dashboard/app.py", \
     "--server.port=8501", \
     "--server.headless=true", \
     "--server.address=0.0.0.0"]
