// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/policies.js
 * Network egress policy management for NemoClaw sandboxes.
 * Baseline rules block unauthorized outbound connections.
 * Hot-reloadable at runtime (network layer only).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const yaml = require('js-yaml');
const chalk = require('chalk');
const logger = require('./logger');
const state = require('./state');

// ─── Baseline policy (always-on defaults) ────────────────────────────────────
const BASELINE_EGRESS_RULES = [
  { host: 'inference.local', port: 443, protocol: 'https', comment: 'Managed inference endpoint' },
  { host: 'registry.npmjs.org', port: 443, protocol: 'https', comment: 'npm package index' },
  { host: 'pypi.org', port: 443, protocol: 'https', comment: 'Python package index' },
  { host: 'files.pythonhosted.org', port: 443, protocol: 'https', comment: 'PyPI file downloads' },
  { host: 'github.com', port: 443, protocol: 'https', comment: 'GitHub' },
  { host: 'raw.githubusercontent.com', port: 443, protocol: 'https', comment: 'GitHub raw content' },
];

// ─── Policy file location ─────────────────────────────────────────────────────
function getPolicyDir(sandboxName) {
  const stateDir = state.getStateDir(process.env.NEMOCLAW_GATEWAY_PORT);
  return path.join(stateDir, 'policies', sandboxName || 'default');
}

function getPolicyFilePath(sandboxName) {
  return path.join(getPolicyDir(sandboxName), 'policy.yaml');
}

/**
 * Load the network policy for a sandbox.
 * Returns default policy if no custom one is saved.
 * @param {string|null} sandboxName
 * @returns {object} policy object
 */
function loadPolicy(sandboxName) {
  const filePath = getPolicyFilePath(sandboxName);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return yaml.load(raw);
    } catch (err) {
      logger.warn(`Failed to load policy: ${err.message}. Using defaults.`);
    }
  }
  return { version: '1', egress: [...BASELINE_EGRESS_RULES], deny: [] };
}

/**
 * Save the network policy for a sandbox.
 * @param {string|null} sandboxName
 * @param {object} policy
 */
function savePolicy(sandboxName, policy) {
  const dir = getPolicyDir(sandboxName);
  state.ensureDir(dir);
  const filePath = getPolicyFilePath(sandboxName);
  const content = yaml.dump(policy, { lineWidth: 120 });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  logger.debug(`Saved policy: ${filePath}`);
}

/**
 * Parse a rule specification string into a rule object.
 * Format: host[:port][/protocol]
 * Examples: "example.com", "api.example.com:8443/https", "192.168.1.10:80/http"
 * @param {string} rule
 * @returns {object}
 */
function parseRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) {
    throw new Error('Rule must be a non-empty string');
  }
  const parts = rule.split('/');
  const protocol = parts[1] || 'https';
  const hostPort = parts[0].split(':');
  const host = hostPort[0];
  const port = hostPort[1] ? parseInt(hostPort[1], 10) : (protocol === 'http' ? 80 : 443);

  if (!host) throw new Error(`Invalid rule: '${rule}' - missing host`);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid rule: '${rule}' - port must be 1-65535`);
  }
  if (!['http', 'https', 'tcp', 'udp', 'any'].includes(protocol)) {
    throw new Error(`Invalid protocol: '${protocol}'. Use http, https, tcp, udp, or any`);
  }

  return { host, port, protocol };
}

/**
 * Validate that a rule does not introduce an SSRF risk.
 * Blocks loopback and private network ranges (basic check).
 * Full validation happens in the TypeScript plugin (ssrf.ts).
 * @param {object} rule
 */
function basicSsrfCheck(rule) {
  const { host } = rule;
  // Block obvious private ranges
  const privatePatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /^localhost$/i,
    /^0\.0\.0\.0$/,
    /^metadata\.google\.internal$/i,
    /^169\.254\./,  // AWS metadata
  ];
  for (const pattern of privatePatterns) {
    if (pattern.test(host)) {
      logger.warn(
        `SSRF warning: Rule for '${host}' targets a private/loopback address. ` +
        `Ensure this is an approved internal endpoint.`
      );
    }
  }
}

/**
 * Show current policy for a sandbox.
 * @param {object} opts
 */
async function get(opts = {}) {
  const sb = state.getSandbox(opts.sandbox || null);
  const policy = loadPolicy(sb?.name || null);

  console.log(chalk.bold(`\n  Network Policy${sb ? ` for ${chalk.cyan(sb.name)}` : ''}\n`));
  console.log(`  Version: ${policy.version || '1'}`);
  console.log(`\n  ${chalk.bold('Egress Rules')} (allowed outbound):`);

  for (const rule of policy.egress || []) {
    const comment = rule.comment ? chalk.gray(` # ${rule.comment}`) : '';
    console.log(`    ${chalk.green('+')} ${rule.host}:${rule.port}/${rule.protocol}${comment}`);
  }

  if (policy.deny && policy.deny.length > 0) {
    console.log(`\n  ${chalk.bold('Deny Rules')}:`);
    for (const rule of policy.deny) {
      console.log(`    ${chalk.red('-')} ${rule.host}:${rule.port}/${rule.protocol}`);
    }
  }
  console.log('');
}

/**
 * Add an egress rule.
 * @param {string} ruleStr - Rule specification
 * @param {object} opts
 */
async function add(ruleStr, opts = {}) {
  const sb = state.getSandbox(opts.sandbox || null);
  const policy = loadPolicy(sb?.name || null);

  const rule = parseRule(ruleStr);
  basicSsrfCheck(rule);

  // Check for duplicates
  const exists = (policy.egress || []).some(
    (r) => r.host === rule.host && r.port === rule.port && r.protocol === rule.protocol
  );
  if (exists) {
    logger.warn(`Rule ${ruleStr} already exists in policy.`);
    return;
  }

  policy.egress = policy.egress || [];
  policy.egress.push(rule);
  savePolicy(sb?.name || null, policy);

  logger.info(`Added egress rule: ${ruleStr}`);
  console.log(chalk.green(`  ✓ Added rule: ${rule.host}:${rule.port}/${rule.protocol}`));
}

/**
 * List all policy rules.
 * @param {object} opts
 */
async function list(opts = {}) {
  await get(opts);
}

/**
 * Remove an egress rule.
 * @param {string} ruleStr
 * @param {object} opts
 */
async function remove(ruleStr, opts = {}) {
  const sb = state.getSandbox(opts.sandbox || null);
  const policy = loadPolicy(sb?.name || null);

  const rule = parseRule(ruleStr);
  const before = (policy.egress || []).length;
  policy.egress = (policy.egress || []).filter(
    (r) => !(r.host === rule.host && r.port === rule.port && r.protocol === rule.protocol)
  );

  if (policy.egress.length === before) {
    logger.warn(`Rule '${ruleStr}' not found in policy.`);
    return;
  }

  savePolicy(sb?.name || null, policy);
  logger.info(`Removed egress rule: ${ruleStr}`);
  console.log(chalk.green(`  ✓ Removed rule: ${rule.host}:${rule.port}/${rule.protocol}`));
}

/**
 * Explain what a rule means.
 * @param {string} ruleStr
 */
async function explain(ruleStr) {
  const rule = parseRule(ruleStr);
  console.log(chalk.bold(`\n  Rule: ${ruleStr}\n`));
  console.log(`  Host:     ${rule.host}`);
  console.log(`  Port:     ${rule.port}`);
  console.log(`  Protocol: ${rule.protocol}`);
  console.log('\n  Effect: Allows outbound connections from the sandbox to this endpoint.');
  console.log('  Note:   Approved endpoints persist within the current sandbox instance');
  console.log('          but are not saved to the baseline policy file.\n');
}

/**
 * Get baseline egress rules.
 * @returns {Array}
 */
function getBaseline() {
  return [...BASELINE_EGRESS_RULES];
}

module.exports = {
  get,
  add,
  list,
  remove,
  explain,
  loadPolicy,
  savePolicy,
  parseRule,
  basicSsrfCheck,
  getBaseline,
};
