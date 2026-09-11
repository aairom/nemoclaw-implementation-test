// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/preflight.js
 * Host-side readiness probe and doctor checks for NemoClaw.
 * Validates prerequisites: Node.js version, Docker, Python, disk space, etc.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const logger = require('./logger');

// ─── Minimum requirements ────────────────────────────────────────────────────
const MIN_NODE_MAJOR = 22;
const MIN_NPM_MAJOR = 10;
const MIN_DISK_GB = 20;
const MIN_RAM_GB = 8;

// ─── Check helpers ───────────────────────────────────────────────────────────

/**
 * Run a command and capture stdout. Returns null on failure.
 * @param {string} cmd
 * @returns {string|null}
 */
function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) {
    return null;
  }
}

/**
 * Check Node.js version meets minimum requirement.
 * @returns {{ ok: boolean, found: string, required: string }}
 */
function checkNode() {
  const ver = process.version; // e.g. 'v22.16.0'
  const major = parseInt(ver.slice(1).split('.')[0], 10);
  return {
    ok: major >= MIN_NODE_MAJOR,
    found: ver,
    required: `v${MIN_NODE_MAJOR}+`,
  };
}

/**
 * Check npm version.
 * @returns {{ ok: boolean, found: string, required: string }}
 */
function checkNpm() {
  const out = tryExec('npm --version');
  if (!out) return { ok: false, found: 'not found', required: `${MIN_NPM_MAJOR}+` };
  const major = parseInt(out.split('.')[0], 10);
  return { ok: major >= MIN_NPM_MAJOR, found: out, required: `${MIN_NPM_MAJOR}+` };
}

/**
 * Check Docker / Podman availability.
 * @returns {{ ok: boolean, found: string, runtime: string }}
 */
function checkDocker() {
  // Prefer Podman (as configured in AGENTS.md - Podman is used locally instead of Docker)
  const podman = tryExec('podman --version');
  if (podman) return { ok: true, found: podman, runtime: 'podman' };
  const docker = tryExec('docker --version');
  if (docker) return { ok: true, found: docker, runtime: 'docker' };
  return { ok: false, found: 'not found', runtime: 'none' };
}

/**
 * Check Python 3 availability.
 * @returns {{ ok: boolean, found: string, path: string }}
 */
function checkPython() {
  // Check trusted locations as specified in NemoClaw docs
  const trustedPaths = [
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    '/opt/local/bin/python3',
  ];

  for (const pyPath of trustedPaths) {
    if (fs.existsSync(pyPath)) {
      const ver = tryExec(`${pyPath} --version`);
      if (ver) return { ok: true, found: ver, path: pyPath };
    }
  }

  // Fallback: check PATH
  const ver = tryExec('python3 --version');
  if (ver) return { ok: true, found: ver, path: 'python3' };
  return { ok: false, found: 'not found', path: '' };
}

/**
 * Check available disk space (in GB) at home directory.
 * @returns {{ ok: boolean, availableGB: number, requiredGB: number }}
 */
function checkDiskSpace() {
  try {
    const homeDir = os.homedir();
    const result = spawnSync('df', ['-BG', homeDir], { stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.status === 0) {
      const lines = result.stdout.toString().trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const availStr = parts[3]; // "Available" column
        const availGB = parseInt(availStr.replace('G', ''), 10);
        return { ok: availGB >= MIN_DISK_GB, availableGB: availGB, requiredGB: MIN_DISK_GB };
      }
    }
  } catch (_) { /* ignore */ }
  return { ok: true, availableGB: -1, requiredGB: MIN_DISK_GB }; // Unknown - assume ok
}

/**
 * Check available RAM (in GB).
 * @returns {{ ok: boolean, totalGB: number, requiredGB: number }}
 */
function checkRam() {
  const totalBytes = os.totalmem();
  const totalGB = Math.round(totalBytes / (1024 ** 3));
  return { ok: totalGB >= MIN_RAM_GB, totalGB, requiredGB: MIN_RAM_GB };
}

/**
 * Check that the port is not in use.
 * @param {number} port
 * @returns {{ ok: boolean, port: number }}
 */
function checkPort(port) {
  const result = tryExec(`lsof -i :${port} -P -n -sTCP:LISTEN 2>/dev/null`);
  return { ok: !result, port };
}

// ─── Probe ───────────────────────────────────────────────────────────────────

/**
 * Run a full host readiness probe.
 * Read-only – does not change host state.
 * @param {object} opts
 * @param {boolean} [opts.json] - Output as JSON
 */
async function probe(opts = {}) {
  logger.info('Running NemoClaw host readiness probe...\n');

  const checks = {
    node: checkNode(),
    npm: checkNpm(),
    docker: checkDocker(),
    python: checkPython(),
    disk: checkDiskSpace(),
    ram: checkRam(),
    port: checkPort(parseInt(process.env.NEMOCLAW_GATEWAY_PORT || '10000', 10)),
  };

  if (opts.json) {
    console.log(JSON.stringify({ probe: checks, timestamp: new Date().toISOString() }, null, 2));
    return;
  }

  // ─── Pretty output ──────────────────────────────────────────────────────
  const pass = chalk.green('✓');
  const fail = chalk.red('✗');
  const warn = chalk.yellow('⚠');

  console.log(chalk.bold('Host Readiness Probe\n'));
  console.log(chalk.bold('  Component          Status    Details'));
  console.log('  ' + '─'.repeat(60));

  const row = (name, ok, detail) =>
    console.log(`  ${(name + ' ').padEnd(20)} ${ok ? pass : fail}         ${detail}`);

  row('Node.js', checks.node.ok, `${checks.node.found} (requires ${checks.node.required})`);
  row('npm', checks.npm.ok, `${checks.npm.found} (requires ${checks.npm.required})`);
  row(`Container runtime`, checks.docker.ok, `${checks.docker.runtime}: ${checks.docker.found}`);
  row('Python 3', checks.python.ok, checks.python.found + (checks.python.path ? ` at ${checks.python.path}` : ''));
  row('Disk space', checks.disk.ok,
    checks.disk.availableGB >= 0
      ? `${checks.disk.availableGB}GB available (requires ${checks.disk.requiredGB}GB)`
      : 'Unknown (check manually)');
  row('RAM', checks.ram.ok, `${checks.ram.totalGB}GB total (requires ${checks.ram.requiredGB}GB)`);
  row('Gateway port', checks.port.ok, `Port ${checks.port.port} is ${checks.port.ok ? 'available' : 'in use'}`);

  console.log('');

  const allOk = Object.values(checks).every((c) => c.ok);
  if (allOk) {
    console.log(chalk.green('  ✓ Host is ready for NemoClaw onboarding.\n'));
  } else {
    const failed = Object.entries(checks)
      .filter(([, v]) => !v.ok)
      .map(([k]) => k);
    console.log(chalk.red(`  ✗ Prerequisites not met: ${failed.join(', ')}`));
    console.log(chalk.yellow(`  Review the prerequisites: https://docs.nvidia.com/nemoclaw/latest/get-started/prerequisites.html\n`));
    process.exitCode = 1;
  }
}

/**
 * Run a comprehensive doctor check on a running sandbox.
 * @param {object} opts
 */
async function doctor(opts = {}) {
  const state = require('./state');
  const sandboxName = opts.sandbox;
  const sb = state.getSandbox(sandboxName || null);

  console.log(chalk.bold('\n🩺 NemoClaw Doctor\n'));

  // Host checks
  await probe({});

  // Sandbox-specific checks
  if (sb) {
    console.log(chalk.bold('\n  Sandbox Checks'));
    console.log(`  Sandbox: ${chalk.cyan(sb.name)}`);
    console.log(`  Agent:   ${chalk.cyan(sb.agent || 'openclaw')}`);
    console.log(`  Provider: ${chalk.cyan(sb.provider || 'nvidia')}`);
    console.log(`  Model:   ${chalk.cyan(sb.model || 'N/A')}`);
    console.log(`  Created: ${chalk.gray(sb.registeredAt || 'N/A')}`);
  } else {
    console.log(chalk.yellow('\n  No active sandbox found. Run nemoclaw list to see registered sandboxes.\n'));
  }
}

module.exports = { probe, doctor, checkNode, checkNpm, checkDocker, checkPython, checkDiskSpace, checkRam, checkPort };
