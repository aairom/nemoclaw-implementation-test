// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/inference.js
 * Inference provider management for NemoClaw.
 * Handles provider selection, validation, and SSRF-safe endpoint checks.
 * NemoClaw never gives the sandbox a raw provider key – credentials live
 * in the OpenShell gateway store.
 */

'use strict';

const chalk = require('chalk');
const logger = require('./logger');
const state = require('./state');

// ─── Supported providers ──────────────────────────────────────────────────────
const SUPPORTED_PROVIDERS = {
  nvidia: {
    label: 'NVIDIA Nemotron / NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresKey: true,
    envKey: 'NVIDIA_API_KEY',
    description: 'NVIDIA hosted Nemotron and NIM models',
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    requiresKey: false,
    description: 'Locally installed Ollama models',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible API',
    baseUrl: process.env.LLAMACPP_BASE_URL || 'http://localhost:9931/v1',
    requiresKey: false,
    description: 'Any OpenAI-compatible inference endpoint (llama.cpp, vLLM, etc.)',
  },
  'model-router': {
    label: 'Model Router',
    baseUrl: 'inference.local',
    requiresKey: true,
    envKey: 'NVIDIA_API_KEY',
    description: 'Host-side router that selects from a configured NVIDIA model pool',
  },
};

// ─── Validated models for each provider ──────────────────────────────────────
const KNOWN_MODELS = {
  nvidia: [
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    'nvidia/nemotron-4-340b-instruct',
    'meta/llama-3.1-8b-instruct',
    'meta/llama-3.1-70b-instruct',
  ],
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5-coder', 'deepseek-coder-v2'],
  'openai-compatible': ['*'],
  'model-router': ['auto'],
};

/**
 * Validate that a provider name is supported.
 * @param {string} provider
 */
function validateProvider(provider) {
  if (!SUPPORTED_PROVIDERS[provider]) {
    throw new Error(
      `Unsupported inference provider: '${provider}'. ` +
      `Supported: ${Object.keys(SUPPORTED_PROVIDERS).join(', ')}`
    );
  }
}

/**
 * Validate that a model name is acceptable for the given provider.
 * @param {string} provider
 * @param {string} model
 */
function validateModel(provider, model) {
  const models = KNOWN_MODELS[provider];
  if (!models) return; // Unknown provider, skip
  if (models.includes('*') || models.includes(model)) return;
  if (models.includes('auto')) return;
  logger.warn(
    `Model '${model}' is not in the known list for provider '${provider}'. ` +
    `Known models: ${models.join(', ')}. Proceeding with validation skipped.`
  );
}

/**
 * Check that the required credential env var is set for a provider.
 * Does NOT log the key value.
 * @param {string} provider
 * @returns {{ ok: boolean, message: string }}
 */
function checkCredential(provider) {
  const prov = SUPPORTED_PROVIDERS[provider];
  if (!prov || !prov.requiresKey) return { ok: true, message: 'No credential required' };
  const key = process.env[prov.envKey];
  if (!key || key === `your-${prov.envKey.toLowerCase()}-here`) {
    return {
      ok: false,
      message: `Credential '${prov.envKey}' is not set. Copy .env.example to .env and fill in your key.`,
    };
  }
  return { ok: true, message: `Credential '${prov.envKey}' is configured` };
}

/**
 * Show the current inference configuration for a sandbox.
 * @param {object} opts
 */
async function get(opts = {}) {
  const sb = state.getSandbox(opts.sandbox || null);
  if (!sb) {
    logger.error('No active sandbox found. Run nemoclaw list to see registered sandboxes.');
    process.exitCode = 1;
    return;
  }

  const provider = sb.provider || 'nvidia';
  const model = sb.model || 'N/A';
  const prov = SUPPORTED_PROVIDERS[provider];

  console.log(chalk.bold('\n  Inference Configuration\n'));
  console.log(`  Sandbox:  ${chalk.cyan(sb.name)}`);
  console.log(`  Provider: ${chalk.cyan(provider)} - ${prov?.label || 'Unknown'}`);
  console.log(`  Model:    ${chalk.cyan(model)}`);
  console.log(`  Base URL: ${chalk.gray(prov?.baseUrl || 'N/A')}`);

  const cred = checkCredential(provider);
  const credSymbol = cred.ok ? chalk.green('✓') : chalk.red('✗');
  console.log(`  Credential: ${credSymbol} ${cred.message}`);
  console.log('');
}

/**
 * Update inference provider / model for a sandbox.
 * @param {object} opts
 */
async function set(opts = {}) {
  const sandboxName = opts.sandbox;
  const registry = state.getSandboxes();

  let sb = state.getSandbox(sandboxName || null);
  if (!sb) {
    logger.error('No active sandbox found. Run nemoclaw list.');
    process.exitCode = 1;
    return;
  }

  const newProvider = opts.provider || sb.provider || 'nvidia';
  const newModel = opts.model || sb.model || 'nvidia/llama-3.1-nemotron-70b-instruct';

  validateProvider(newProvider);
  state.validateProviderName(newProvider);
  validateModel(newProvider, newModel);

  const cred = checkCredential(newProvider);
  if (!cred.ok) {
    logger.error(cred.message);
    process.exitCode = 1;
    return;
  }

  // Update sandbox entry in registry
  const idx = registry.sandboxes.findIndex((s) => s.name === sb.name);
  if (idx >= 0) {
    registry.sandboxes[idx].provider = newProvider;
    registry.sandboxes[idx].model = newModel;
    registry.sandboxes[idx].updatedAt = new Date().toISOString();
    state.saveSandboxes(registry);
  }

  logger.info(`Updated inference: provider=${newProvider}, model=${newModel}`);
  console.log(chalk.green(`\n  ✓ Inference updated for sandbox '${sb.name}'`));
  console.log(`  Provider: ${newProvider}`);
  console.log(`  Model:    ${newModel}\n`);
}

/**
 * Check if an inference route is ready for the given provider and model.
 * Used by the resume flow.
 * @param {string} provider
 * @param {string} model
 * @returns {boolean}
 */
function isInferenceRouteReady(provider, model) {
  try {
    validateProvider(provider);
    validateModel(provider, model);
    const cred = checkCredential(provider);
    return cred.ok;
  } catch (_) {
    return false;
  }
}

module.exports = {
  get,
  set,
  validateProvider,
  validateModel,
  checkCredential,
  isInferenceRouteReady,
  SUPPORTED_PROVIDERS,
  KNOWN_MODELS,
};
