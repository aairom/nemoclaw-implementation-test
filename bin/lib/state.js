// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/state.js
 * Host-side persistent state management for NemoClaw.
 * Stores sandbox registry, gateway config, and snapshots at ~/.nemoclaw/
 * Non-secret only – credentials live in the OpenShell gateway store.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger');

// ─── State directory resolution ──────────────────────────────────────────────
function getStateDir(gatewayPort) {
  const baseDir = process.env.NEMOCLAW_STATE_DIR
    ? path.resolve(process.env.NEMOCLAW_STATE_DIR.replace('~', os.homedir()))
    : path.join(os.homedir(), '.nemoclaw');

  // Non-default gateway port gets its own segregated root
  const defaultPort = '10000';
  const port = String(gatewayPort || defaultPort);
  if (port === defaultPort) {
    return baseDir;
  }
  return path.join(baseDir, 'gateways', port);
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    logger.debug(`Created state directory: ${dirPath}`);
  }
}

/**
 * Read a JSON state file. Returns null if it doesn't exist.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`Failed to read state file ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Write a JSON state file atomically (write to tmp, then rename).
 * @param {string} filePath
 * @param {object} data
 */
function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
    logger.debug(`Wrote state file: ${filePath}`);
  } catch (err) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ─── Sandbox registry ────────────────────────────────────────────────────────

/**
 * Get all registered sandboxes.
 * @param {object} opts
 * @param {string} [opts.gatewayPort]
 * @returns {object} sandboxes registry
 */
function getSandboxes(opts = {}) {
  const stateDir = getStateDir(opts.gatewayPort);
  const filePath = path.join(stateDir, 'sandboxes.json');
  return readJson(filePath) || { sandboxes: [], default: null };
}

/**
 * Save sandbox registry.
 * @param {object} registry
 * @param {object} opts
 */
function saveSandboxes(registry, opts = {}) {
  const stateDir = getStateDir(opts.gatewayPort);
  const filePath = path.join(stateDir, 'sandboxes.json');
  writeJson(filePath, registry);
}

/**
 * Register a new sandbox.
 * @param {object} sandboxInfo - { name, agent, provider, model, gatewayPort, createdAt }
 * @param {object} opts
 */
function registerSandbox(sandboxInfo, opts = {}) {
  validateSandboxName(sandboxInfo.name);
  const registry = getSandboxes(opts);
  // Remove any existing entry with the same name
  registry.sandboxes = registry.sandboxes.filter((s) => s.name !== sandboxInfo.name);
  registry.sandboxes.push({ ...sandboxInfo, registeredAt: new Date().toISOString() });
  if (!registry.default) {
    registry.default = sandboxInfo.name;
  }
  saveSandboxes(registry, opts);
  logger.info(`Registered sandbox: ${sandboxInfo.name}`);
}

/**
 * Get a sandbox by name or return the default.
 * @param {string|null} name
 * @param {object} opts
 * @returns {object|null}
 */
function getSandbox(name, opts = {}) {
  const registry = getSandboxes(opts);
  if (name) {
    return registry.sandboxes.find((s) => s.name === name) || null;
  }
  return registry.sandboxes.find((s) => s.name === registry.default) || null;
}

/**
 * Set the default sandbox.
 * @param {string} name
 * @param {object} opts
 */
function setDefaultSandbox(name, opts = {}) {
  const registry = getSandboxes(opts);
  if (!registry.sandboxes.find((s) => s.name === name)) {
    throw new Error(`Sandbox '${name}' is not registered`);
  }
  registry.default = name;
  saveSandboxes(registry, opts);
}

/**
 * Remove a sandbox from the registry.
 * @param {string} name
 * @param {object} opts
 */
function unregisterSandbox(name, opts = {}) {
  const registry = getSandboxes(opts);
  const before = registry.sandboxes.length;
  registry.sandboxes = registry.sandboxes.filter((s) => s.name !== name);
  if (registry.default === name) {
    registry.default = registry.sandboxes[0]?.name || null;
  }
  if (registry.sandboxes.length < before) {
    saveSandboxes(registry, opts);
    logger.info(`Unregistered sandbox: ${name}`);
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a sandbox name against the blueprint schema constraint:
 * 1-63 lowercase letters, numbers, or internal hyphens,
 * starting with a letter and ending with a letter or number.
 * @param {string} name
 */
function validateSandboxName(name) {
  if (typeof name !== 'string') throw new Error('Sandbox name must be a string');
  if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$/.test(name)) {
    throw new Error(
      `Invalid sandbox name '${name}'. Use 1-63 lowercase letters, numbers, or ` +
      `internal hyphens, starting with a letter and ending with a letter or number.`
    );
  }
}

/**
 * Validate an inference provider name.
 * 1-128 letters, numbers, dots, underscores, or hyphens, starting with a letter.
 * @param {string} name
 */
function validateProviderName(name) {
  if (typeof name !== 'string') throw new Error('Provider name must be a string');
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(name)) {
    throw new Error(
      `Invalid provider name '${name}'. Use 1-128 letters, numbers, dots, ` +
      `underscores, or hyphens, starting with a letter.`
    );
  }
}

module.exports = {
  getStateDir,
  getSandboxes,
  saveSandboxes,
  registerSandbox,
  getSandbox,
  setDefaultSandbox,
  unregisterSandbox,
  validateSandboxName,
  validateProviderName,
  readJson,
  writeJson,
  ensureDir,
};
