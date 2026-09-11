// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/onboard.js
 * NemoClaw onboarding orchestration.
 * Implements the 5-step blueprint lifecycle:
 *   1. Resolve  2. Verify  3. Plan  4. Apply  5. Status
 */

'use strict';

const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const logger = require('./logger');
const state = require('./state');
const inference = require('./inference');
const policies = require('./policies');
const preflight = require('./preflight');
const runner = require('./runner');
const credentials = require('./credentials');

// ─── Blueprint version ───────────────────────────────────────────────────────
const BLUEPRINT_VERSION = '0.1.0';

/**
 * Main onboard entry point.
 * @param {object} opts
 */
async function run(opts = {}) {
  const agent = opts.agent || process.env.NEMOCLAW_AGENT || 'openclaw';
  const sandboxName = opts.name || process.env.NEMOCLAW_SANDBOX_NAME || 'nemoclaw-sandbox';
  const provider = opts.provider || process.env.NEMOCLAW_INFERENCE_PROVIDER || 'nvidia';
  const model = opts.model || process.env.NEMOCLAW_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';
  const resume = opts.resume || false;
  const fresh = opts.fresh || false;
  const jsonlEvents = opts.events === 'jsonl' || process.env.NEMOCLAW_JSONL_EVENTS === '1';

  if (jsonlEvents) {
    process.env.NEMOCLAW_JSONL_EVENTS = '1';
  }

  logger.event('onboard.start', { agent, sandboxName, provider, model, resume, fresh });

  console.log(chalk.bold(`\n🚀 NemoClaw Onboarding\n`));
  console.log(`  Agent:    ${chalk.cyan(agent)}`);
  console.log(`  Sandbox:  ${chalk.cyan(sandboxName)}`);
  console.log(`  Provider: ${chalk.cyan(provider)}`);
  console.log(`  Model:    ${chalk.cyan(model)}\n`);

  // ─── Validate inputs ──────────────────────────────────────────────────────
  try {
    state.validateSandboxName(sandboxName);
    state.validateProviderName(provider);
    inference.validateProvider(provider);
    inference.validateModel(provider, model);
  } catch (err) {
    logger.error(`Validation failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // ─── Check credentials ────────────────────────────────────────────────────
  const cred = inference.checkCredential(provider);
  if (!cred.ok) {
    logger.error(cred.message);
    console.log(chalk.yellow('\n  Copy .env.example to .env and configure your credentials first.\n'));
    process.exitCode = 1;
    return;
  }

  // ─── Resume / fresh check ─────────────────────────────────────────────────
  const existingSb = state.getSandbox(sandboxName);
  if (existingSb && !fresh) {
    if (resume || opts.resume) {
      logger.info(`Resuming onboarding for sandbox '${sandboxName}'`);
    } else {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: `Sandbox '${sandboxName}' already exists. Recreate it?`,
        default: false,
      }]);
      if (!proceed) {
        logger.info('Onboarding cancelled.');
        return;
      }
    }
  }

  // ─── Host probe ───────────────────────────────────────────────────────────
  const spinner = ora('Running host readiness probe...').start();
  const nodeCheck = preflight.checkNode();
  const dockerCheck = preflight.checkDocker();

  if (!nodeCheck.ok) {
    spinner.fail(`Node.js ${nodeCheck.required} required, found ${nodeCheck.found}`);
    process.exitCode = 1;
    return;
  }
  if (!dockerCheck.ok) {
    spinner.fail('Docker or Podman is required but not found');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Host readiness probe passed');
  logger.event('onboard.probe.passed', { node: nodeCheck.found, docker: dockerCheck.found });

  // ─── Step 1: Resolve blueprint ─────────────────────────────────────────────
  spinner.start('Step 1/5: Resolving blueprint...');
  const blueprint = await runner.resolveBlueprint({ version: BLUEPRINT_VERSION, agent });
  spinner.succeed(`Step 1/5: Blueprint resolved (v${blueprint.version})`);
  logger.event('onboard.blueprint.resolved', { version: blueprint.version });

  // ─── Step 2: Verify blueprint digest ──────────────────────────────────────
  spinner.start('Step 2/5: Verifying blueprint digest...');
  const verified = await runner.verifyBlueprint(blueprint);
  if (!verified) {
    spinner.fail('Step 2/5: Blueprint digest verification failed');
    logger.error('Blueprint digest mismatch. Aborting for security.');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Step 2/5: Blueprint digest verified');
  logger.event('onboard.blueprint.verified');

  // ─── Step 3: Plan resources ────────────────────────────────────────────────
  spinner.start('Step 3/5: Planning OpenShell resources...');
  const plan = await runner.planResources({ sandboxName, agent, provider, model, blueprint });
  spinner.succeed(`Step 3/5: Plan created (${plan.operations.length} operations)`);
  logger.event('onboard.plan.created', { operations: plan.operations.length });

  // ─── Step 4: Apply plan ─────────────────────────────────────────────────────
  spinner.start('Step 4/5: Applying plan (creating sandbox)...');
  try {
    await runner.applyPlan(plan, { sandboxName, agent, provider, model });
  } catch (err) {
    spinner.fail(`Step 4/5: Apply failed: ${err.message}`);
    logger.error(`Onboarding failed at apply step: ${err.message}`);
    logger.info('Use --resume to retry or --fresh to start over.');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Step 4/5: Sandbox created and configured');
  logger.event('onboard.sandbox.created', { sandboxName });

  // ─── Register sandbox in state ─────────────────────────────────────────────
  state.registerSandbox({
    name: sandboxName,
    agent,
    provider,
    model,
    blueprintVersion: blueprint.version,
    gatewayPort: process.env.NEMOCLAW_GATEWAY_PORT || '10000',
    createdAt: new Date().toISOString(),
  });

  // ─── Auto-register credentials from .env ──────────────────────────────────
  const credCount = await credentials.autoRegisterFromEnv();
  if (credCount > 0) {
    logger.event('onboard.credentials.registered', { count: credCount });
  }

  // ─── Apply default network policy ──────────────────────────────────────────
  const defaultPolicy = { version: '1', egress: policies.getBaseline(), deny: [] };
  policies.savePolicy(sandboxName, defaultPolicy);

  // ─── Step 5: Status ─────────────────────────────────────────────────────────
  spinner.start('Step 5/5: Checking sandbox status...');
  const status = await runner.getStatus({ sandboxName });
  spinner.succeed(`Step 5/5: Sandbox is ${status.state}`);
  logger.event('onboard.complete', { sandboxName, state: status.state });

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(chalk.bold(`\n  ✓ Onboarding complete!\n`));
  console.log(`  Sandbox:    ${chalk.cyan(sandboxName)}`);
  console.log(`  Agent:      ${chalk.cyan(agent)}`);
  console.log(`  Inference:  ${chalk.cyan(provider)} / ${model}`);
  console.log(`  State:      ${chalk.green(status.state)}`);

  if (agent === 'openclaw') {
    const port = parseInt(process.env.NEMOCLAW_GATEWAY_PORT || '10000', 10);
    const dashboardPort = port + 1;
    console.log(`\n  Dashboard:  ${chalk.cyan(`http://localhost:${dashboardPort}`)}`);
    console.log(`  Connect:    ${chalk.bold('nemoclaw connect')}`);
  }
  console.log('');
}

module.exports = { run, BLUEPRINT_VERSION };
