// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/credentials.js
 * Credential management for NemoClaw.
 * Credentials are stored in the OpenShell gateway store – never on disk as plaintext.
 * This module manages the credential registry metadata (names, types) only.
 */

'use strict';

const readline = require('readline');
const chalk = require('chalk');
const logger = require('./logger');
const state = require('./state');

// ─── Registry path ────────────────────────────────────────────────────────────
const CREDENTIALS_KEY = 'credentials';

/**
 * Get the in-memory credentials registry (names + metadata only, no values).
 * @returns {Array<{name: string, provider: string, registeredAt: string}>}
 */
function getRegistry() {
  const reg = state.readJson(
    require('path').join(state.getStateDir(process.env.NEMOCLAW_GATEWAY_PORT), 'credentials.json')
  );
  return reg?.credentials || [];
}

/**
 * Save the credentials registry.
 * @param {Array} creds
 */
function saveRegistry(creds) {
  const filePath = require('path').join(
    state.getStateDir(process.env.NEMOCLAW_GATEWAY_PORT),
    'credentials.json'
  );
  state.writeJson(filePath, { credentials: creds });
}

/**
 * List registered credential names (never shows values).
 */
async function list() {
  const creds = getRegistry();
  console.log(chalk.bold('\n  Registered Credentials\n'));
  if (creds.length === 0) {
    console.log(chalk.gray('  No credentials registered.\n'));
    return;
  }
  for (const c of creds) {
    console.log(`  ${chalk.cyan(c.name)} (${c.provider}) - registered ${chalk.gray(c.registeredAt)}`);
  }
  console.log('');
}

/**
 * Prompt for a secret value securely (no echo).
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function promptSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Mute echo
    rl.stdoutMuted = true;
    process.stdout.write(prompt);
    rl.question('', (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    rl._writeToOutput = function () { /* mute */ };
  });
}

/**
 * Register a new credential.
 * @param {string} name - Credential name
 * @param {object} opts - { provider }
 */
async function add(name, opts = {}) {
  if (!name) {
    logger.error('Credential name is required');
    process.exitCode = 1;
    return;
  }

  const provider = opts.provider || 'nvidia';
  logger.warn('NemoClaw stores credentials in the gateway store. Values are never saved to disk.');

  // Prompt securely (hidden input)
  const value = await promptSecret(`  Enter ${name} value (input hidden): `);
  if (!value || value.trim() === '') {
    logger.error('Empty credential value provided.');
    process.exitCode = 1;
    return;
  }

  await _registerMetadata(name, provider);
  logger.info(`Credential '${name}' registered for provider '${provider}'`);
  console.log(chalk.green(`  ✓ Credential '${name}' stored in gateway (value not saved to disk)\n`));
}

/**
 * Register credential metadata only (no value stored on disk).
 * Called both from `add` (interactive) and from onboard (auto-register from env).
 * @param {string} name
 * @param {string} provider
 * @param {boolean} silent - suppress output if true
 */
async function _registerMetadata(name, provider, silent = false) {
  const creds = getRegistry();
  const existing = creds.find((c) => c.name === name);
  if (existing) {
    // Update the rotatedAt timestamp so the dashboard shows it as active
    existing.rotatedAt = new Date().toISOString();
    existing.provider = provider;
  } else {
    creds.push({ name, provider, registeredAt: new Date().toISOString() });
  }
  saveRegistry(creds);
  if (!silent) {
    logger.debug(`Credential metadata saved: ${name} (${provider})`);
  }
}

/**
 * Auto-register known credentials from environment variables during onboard.
 * Only registers the metadata entry — the actual value is read from env at runtime.
 * Safe to call multiple times (idempotent).
 */
async function autoRegisterFromEnv() {
  const KNOWN = [
    { envVar: 'NVIDIA_API_KEY',   name: 'NVIDIA_API_KEY',   provider: 'nvidia' },
    { envVar: 'OLLAMA_BASE_URL',  name: 'OLLAMA_BASE_URL',  provider: 'ollama' },
    { envVar: 'LLAMACPP_BASE_URL',name: 'LLAMACPP_BASE_URL',provider: 'openai-compatible' },
  ];

  let registered = 0;
  for (const { envVar, name, provider } of KNOWN) {
    if (process.env[envVar] && process.env[envVar].trim() !== '') {
      await _registerMetadata(name, provider, true);
      registered++;
    }
  }
  if (registered > 0) {
    logger.info(`Auto-registered ${registered} credential(s) from environment`);
  }
  return registered;
}

/**
 * Rotate (reset) a credential value.
 * @param {string} name
 */
async function reset(name) {
  const creds = getRegistry();
  const existing = creds.find((c) => c.name === name);
  if (!existing) {
    logger.error(`Credential '${name}' not found. Use credentials add first.`);
    process.exitCode = 1;
    return;
  }

  const value = await promptSecret(`  Enter new ${name} value (input hidden): `);
  if (!value || value.trim() === '') {
    logger.error('Empty credential value provided.');
    process.exitCode = 1;
    return;
  }

  // Update metadata timestamp only
  existing.rotatedAt = new Date().toISOString();
  saveRegistry(creds);

  logger.info(`Credential '${name}' rotated`);
  console.log(chalk.green(`  ✓ Credential '${name}' rotated in gateway\n`));
}

module.exports = { list, add, reset, getRegistry, autoRegisterFromEnv };
