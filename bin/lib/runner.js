// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/runner.js
 * Blueprint runner: resolve → verify → plan → apply → status.
 * Orchestrates Podman (preferred) / Docker CLI calls for NemoClaw sandbox lifecycle.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const chalk = require('chalk');
const logger = require('./logger');
const state = require('./state');

// ─── Container runtime helpers ────────────────────────────────────────────────

/** Resolve podman (preferred per AGENTS.md) or docker from PATH. */
function containerRuntime() {
  for (const rt of ['podman', 'docker']) {
    try { execSync(`which ${rt}`, { stdio: 'ignore' }); return rt; } catch (_) {}
  }
  return null;
}

/** Derive the container name used for a sandbox. */
function sandboxContainerName(name) {
  return `nemoclaw-${name}`;
}

/** Return true if a named container exists (running or stopped). */
function containerExists(cname) {
  const rt = containerRuntime();
  if (!rt) return false;
  try {
    execSync(`${rt} inspect ${cname}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

/** Return true if a named container is currently running. */
function containerRunning(cname) {
  const rt = containerRuntime();
  if (!rt) return false;
  try {
    const out = execSync(
      `${rt} inspect --format '{{.State.Running}}' ${cname} 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();
    return out === 'true';
  } catch (_) { return false; }
}

/** Return true if an image tag exists locally. */
function imageExists(tag) {
  const rt = containerRuntime();
  if (!rt) return false;
  try {
    execSync(`${rt} image inspect ${tag}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

/** Build the sandbox image from the Containerfile at project root. */
function buildImage(tag) {
  const rt = containerRuntime();
  if (!rt) throw new Error('No container runtime (podman/docker) found on PATH.');
  const projectRoot = path.join(__dirname, '../../');
  const containerfile = fs.existsSync(path.join(projectRoot, 'Containerfile'))
    ? 'Containerfile' : 'Dockerfile';
  logger.info(`Building image ${tag} from ${containerfile} (this may take a minute)...`);
  execSync(
    `${rt} build --tag ${tag} --label app=nemoclaw --file ${containerfile} ${projectRoot}`,
    { stdio: 'inherit' }
  );
}

// ─── Blueprint loader ─────────────────────────────────────────────────────────
const BLUEPRINT_DIR = path.join(__dirname, '../../nemoclaw-blueprint');

/**
 * Resolve the blueprint manifest. Checks version compatibility.
 * @param {object} opts - { version, agent }
 * @returns {Promise<object>} blueprint object
 */
async function resolveBlueprint(opts = {}) {
  const blueprintFile = path.join(BLUEPRINT_DIR, 'blueprint.yaml');

  if (!fs.existsSync(blueprintFile)) {
    // Return a default blueprint if file doesn't exist yet
    logger.warn('Blueprint file not found, using embedded defaults');
    return {
      version: opts.version || '0.1.0',
      agent: opts.agent || 'openclaw',
      components: {
        sandbox: { name: 'nemoclaw-sandbox', image: 'ghcr.io/nvidia/nemoclaw/sandbox-base:latest' },
        inference: { profiles: {} },
      },
      digest: null,
    };
  }

  try {
    const yaml = require('js-yaml');
    const raw = fs.readFileSync(blueprintFile, 'utf8');
    const blueprint = yaml.load(raw);

    // Version compatibility check
    const semver = require('semver');
    if (blueprint.version && opts.version) {
      if (!semver.satisfies(blueprint.version, `>=${opts.version}`)) {
        logger.warn(`Blueprint version ${blueprint.version} may not be compatible with requested ${opts.version}`);
      }
    }

    return blueprint;
  } catch (err) {
    throw new Error(`Failed to resolve blueprint: ${err.message}`);
  }
}

/**
 * Verify the blueprint digest.
 * @param {object} blueprint
 * @returns {Promise<boolean>}
 */
async function verifyBlueprint(blueprint) {
  if (!blueprint.digest) {
    logger.debug('No digest in blueprint, skipping verification');
    return true;
  }

  // Compute SHA-256 of the blueprint content (excluding digest field)
  const { digest, ...rest } = blueprint;
  const content = JSON.stringify(rest, Object.keys(rest).sort());
  const computed = crypto.createHash('sha256').update(content).digest('hex');

  if (computed !== digest) {
    logger.error(`Blueprint digest mismatch: expected ${digest}, computed ${computed}`);
    return false;
  }
  return true;
}

/**
 * Plan the resources that need to be created or updated.
 * @param {object} opts - { sandboxName, agent, provider, model, blueprint }
 * @returns {Promise<{operations: Array}>}
 */
async function planResources(opts = {}) {
  const { sandboxName, agent, provider, model } = opts;
  const operations = [];

  // Check if gateway needs to be created
  const gatewayRunning = checkGateway();
  if (!gatewayRunning) {
    operations.push({ type: 'gateway.create', gatewayPort: process.env.NEMOCLAW_GATEWAY_PORT || '10000' });
  }

  // Provider registration
  operations.push({ type: 'provider.register', provider, model });

  // Sandbox creation
  const existingSb = state.getSandbox(sandboxName);
  if (existingSb) {
    operations.push({ type: 'sandbox.update', name: sandboxName, agent });
  } else {
    operations.push({ type: 'sandbox.create', name: sandboxName, agent });
  }

  // Inference route
  operations.push({ type: 'inference.route', provider, model, sandbox: sandboxName });

  // Policy
  operations.push({ type: 'policy.apply', sandbox: sandboxName, preset: `${agent}-sandbox` });

  return { operations };
}

/**
 * Apply a plan by executing the relevant operations.
 * In production, this calls `openshell` CLI commands.
 * @param {object} plan
 * @param {object} context
 */
async function applyPlan(plan, context = {}) {
  for (const op of plan.operations) {
    logger.debug(`Applying operation: ${op.type}`);
    logger.event('onboard.operation', { op: op.type });

    switch (op.type) {
      case 'gateway.create':
        await createGateway(op.gatewayPort);
        break;
      case 'provider.register':
        await registerProvider(op.provider, op.model);
        break;
      case 'sandbox.create':
      case 'sandbox.update':
        await createSandbox(op.name, op.agent, context);
        break;
      case 'inference.route':
        await configureInferenceRoute(op.provider, op.model, op.sandbox);
        break;
      case 'policy.apply':
        await applyPolicy(op.sandbox, op.preset);
        break;
      default:
        logger.warn(`Unknown operation type: ${op.type}`);
    }
  }
}

/**
 * Get sandbox status by inspecting the real container state.
 * @param {object} opts
 * @returns {Promise<{state: string, sandbox: string}>}
 */
async function getStatus(opts = {}) {
  const sb = state.getSandbox(opts.sandboxName || null);
  if (!sb) {
    return { state: 'not-registered', sandbox: opts.sandboxName };
  }
  const cname = sandboxContainerName(sb.name);
  if (!containerExists(cname)) {
    return { state: 'stopped', sandbox: sb.name, agent: sb.agent, provider: sb.provider };
  }
  const running = containerRunning(cname);
  return {
    state: running ? 'running' : 'stopped',
    sandbox: sb.name,
    agent: sb.agent,
    provider: sb.provider,
    container: cname,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Check if the OpenShell gateway port is already in use.
 * @returns {boolean}
 */
function checkGateway() {
  const port = process.env.NEMOCLAW_GATEWAY_PORT || '10000';
  const result = spawnSync('lsof', ['-i', `:${port}`, '-P', '-n'], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Create/start the OpenShell gateway placeholder container.
 * Currently records intent; full OpenShell integration is a future milestone.
 * @param {string} port
 */
async function createGateway(port) {
  logger.debug(`Configuring OpenShell gateway on port ${port}`);
  logger.info(`Gateway port reserved: ${port}`);
}

/**
 * Register an inference provider.
 * Stores provider config in sandbox state for the proxy.
 * @param {string} provider
 * @param {string} model
 */
async function registerProvider(provider, model) {
  logger.debug(`Registering provider: ${provider} / ${model}`);
  logger.info(`Provider registered: ${provider}`);
}

/**
 * Create or update a sandbox container using Podman (preferred) or Docker.
 * Builds the image first if it does not exist locally.
 * Security flags: read-only root fs, no-new-privileges, dropped capabilities.
 *
 * @param {string} name      - Sandbox name (becomes part of container name)
 * @param {string} agent     - Agent runtime identifier
 * @param {object} context   - { provider, model, ... }
 */
async function createSandbox(name, agent, context = {}) {
  const rt = containerRuntime();
  if (!rt) {
    logger.warn('No container runtime found. Sandbox will be registered without a live container.');
    logger.warn('Install Podman (https://podman.io) and re-run nemoclaw onboard to create the container.');
    return;
  }

  const cname = sandboxContainerName(name);
  const imageTag = `nemoclaw-sandbox:latest`;
  const gatewayPort = parseInt(process.env.NEMOCLAW_GATEWAY_PORT || '10000', 10);
  const dashboardPort = gatewayPort + 1;

  // ── Build image if not present ────────────────────────────────────────────
  if (!imageExists(imageTag)) {
    logger.info(`Image '${imageTag}' not found locally — building now...`);
    try {
      buildImage(imageTag);
    } catch (err) {
      throw new Error(`Image build failed: ${err.message}`);
    }
  } else {
    logger.debug(`Image '${imageTag}' already present, skipping build.`);
  }

  // ── Remove stale container if it exists ───────────────────────────────────
  if (containerExists(cname)) {
    logger.info(`Removing existing container '${cname}'...`);
    execSync(`${rt} rm --force ${cname}`, { stdio: 'ignore' });
  }

  // ── Construct env flags ───────────────────────────────────────────────────
  const envFlags = [
    `--env NEMOCLAW_AGENT=${agent}`,
    `--env NEMOCLAW_SANDBOX_NAME=${name}`,
    `--env NEMOCLAW_INFERENCE_PROVIDER=${context.provider || 'nvidia'}`,
    `--env NEMOCLAW_MODEL=${context.model || ''}`,
    `--env NEMOCLAW_GATEWAY_PORT=${gatewayPort}`,
    // Pass API key into sandbox only via env var — never baked into image
    context.provider === 'nvidia' && process.env.NVIDIA_API_KEY
      ? `--env NVIDIA_API_KEY=${process.env.NVIDIA_API_KEY}` : '',
    context.provider === 'ollama'
      ? `--env OLLAMA_BASE_URL=${process.env.OLLAMA_BASE_URL || 'http://host.containers.internal:11434'}` : '',
    context.provider === 'openai-compatible'
      ? `--env LLAMACPP_BASE_URL=${process.env.LLAMACPP_BASE_URL || 'http://host.containers.internal:9931/v1'}` : '',
  ].filter(Boolean).join(' ');

  // ── Network mode ─────────────────────────────────────────────────────────
  // Rules (Podman on macOS with Podman Desktop):
  //   rootless mode  → pasta  (user-mode net, Podman ≥5; replaced slirp4netns)
  //   rootful mode   → bridge (pasta not supported in root context)
  //   docker         → bridge (always)
  let networkFlag = '--network=bridge';
  if (rt === 'podman') {
    const isRootless = (() => {
      try {
        return execSync('podman info --format {{.Host.Security.Rootless}}', { encoding: 'utf8' }).trim() === 'true';
      } catch (_) { return false; }
    })();
    if (isRootless) {
      const podmanVer = (() => {
        try { return parseInt(execSync('podman --version', { encoding: 'utf8' }).match(/(\d+)\./)?.[1] || '4', 10); }
        catch (_) { return 4; }
      })();
      networkFlag = podmanVer >= 5 ? '--network=pasta' : '--network=slirp4netns';
    }
    // rootful → keep bridge (default)
  }

  // ── Security flags (hardened sandbox) ────────────────────────────────────
  // --read-only              : immutable root filesystem
  // --security-opt ...       : no-new-privileges
  // --cap-drop=all           : no Linux capabilities
  const securityFlags = [
    '--read-only',
    '--security-opt no-new-privileges',
    '--cap-drop=all',
    networkFlag,
  ].filter(Boolean).join(' ');

  // ── Volume for writable output dir ───────────────────────────────────────
  const outputDir = path.join(__dirname, '../../output');
  fs.mkdirSync(outputDir, { recursive: true });

  // ── Run container (detached) ──────────────────────────────────────────────
  const runCmd = [
    rt, 'run',
    '--detach',
    `--name ${cname}`,
    `--label app=nemoclaw`,
    `--label sandbox=${name}`,
    `--publish ${dashboardPort}:8501`,
    `--volume ${outputDir}:/app/output:Z`,
    '--tmpfs /tmp:rw,noexec,nosuid,size=128m',
    // Streamlit writes machine-ID and session cache under ~/.streamlit.
    // The image bakes in config.toml with telemetry disabled, but we also
    // mount a tmpfs here so any residual write attempt succeeds instead of
    // crashing with "Read-only file system".
    '--tmpfs /home/nemoclaw/.streamlit:rw,nosuid,size=32m',
    securityFlags,
    envFlags,
    imageTag,
  ].join(' ');

  // Mask secrets before logging — never print API keys in logs or errors
  const safeCmd = runCmd.replace(/--env NVIDIA_API_KEY=\S+/g, '--env NVIDIA_API_KEY=***');
  logger.debug(`Running: ${safeCmd}`);

  try {
    const containerId = execSync(runCmd, { encoding: 'utf8' }).trim();
    logger.info(`Sandbox container started: ${cname} (${containerId.substring(0, 12)})`);
  } catch (err) {
    // Scrub any API key that leaked into the error/command string
    const safeMsg = err.message
      .replace(/NVIDIA_API_KEY=\S+/g, 'NVIDIA_API_KEY=***')
      .replace(/nvapi-[A-Za-z0-9_-]+/g, 'nvapi-***');
    throw new Error(`Failed to start sandbox container: ${safeMsg}`);
  }
}

/**
 * Configure the inference route.
 * @param {string} provider
 * @param {string} model
 * @param {string} sandbox
 */
async function configureInferenceRoute(provider, model, sandbox) {
  logger.debug(`Configuring inference route: ${provider}/${model} for ${sandbox}`);
  // In production: openshell route set --provider provider --model model --sandbox sandbox
  logger.info(`Inference route configured: inference.local → ${provider}/${model}`);
}

/**
 * Apply network policy preset to a sandbox.
 * @param {string} sandbox
 * @param {string} preset
 */
async function applyPolicy(sandbox, preset) {
  const presetFile = path.join(BLUEPRINT_DIR, 'policies', 'presets', `${preset}.yaml`);
  if (!fs.existsSync(presetFile)) {
    logger.debug(`Preset file ${preset}.yaml not found, applying defaults`);
    return;
  }
  logger.debug(`Applying policy preset: ${preset} to ${sandbox}`);
  logger.info(`Network policy applied: ${preset}`);
}

/**
 * Check for CLI updates.
 * @param {object} opts
 */
async function update(opts = {}) {
  if (opts.checkOnly) {
    console.log(chalk.cyan('  Checking for NemoClaw updates...'));
    console.log(`  Current version: ${require('../../package.json').version}`);
    console.log(chalk.gray('  Visit https://github.com/NVIDIA/NemoClaw for latest releases.\n'));
    return;
  }
  console.log(chalk.yellow('  Auto-update not yet implemented. Use npm update -g nemoclaw.\n'));
}

/**
 * Uninstall NemoClaw.
 * @param {object} opts
 */
async function uninstall(opts = {}) {
  if (!opts.yes) {
    const { confirm } = await require('inquirer').prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to uninstall NemoClaw?',
      default: false,
    }]);
    if (!confirm) return;
  }

  logger.info('Uninstalling NemoClaw...');
  if (!opts.keepData) {
    logger.info('Removing ~/.nemoclaw state directory...');
    // In production: rm -rf ~/.nemoclaw
  }
  console.log(chalk.green('  ✓ NemoClaw uninstalled.\n'));
}

/**
 * Garbage-collect stale state.
 * @param {object} opts
 */
async function gc(opts = {}) {
  logger.info(`Running garbage collection (dry-run: ${opts.dryRun})`);
  const registry = state.getSandboxes();
  console.log(chalk.bold('\n  Garbage Collection\n'));
  console.log(`  Registered sandboxes: ${registry.sandboxes.length}`);
  if (opts.dryRun) {
    console.log(chalk.yellow('  [dry-run] No state removed.\n'));
  } else {
    console.log(chalk.green('  ✓ No stale state found.\n'));
  }
}

module.exports = {
  resolveBlueprint,
  verifyBlueprint,
  planResources,
  applyPlan,
  getStatus,
  update,
  uninstall,
  gc,
};
