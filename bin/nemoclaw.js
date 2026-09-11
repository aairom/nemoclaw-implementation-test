#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw.js – NemoClaw CLI entry point (CommonJS)
 *
 * This is the primary host-side interface for managing NemoClaw sandboxes.
 * It routes sub-commands to the appropriate lib modules under bin/lib/.
 * Runs on Node.js 22.16+ without a build step.
 */

'use strict';

require('dotenv').config();

const { Command } = require('commander');
const chalk = require('chalk');
const { version } = require('../package.json');

// Lib modules (CommonJS)
const onboard = require('./lib/onboard');
const credentials = require('./lib/credentials');
const inference = require('./lib/inference');
const policies = require('./lib/policies');
const preflight = require('./lib/preflight');
const runner = require('./lib/runner');
const sandbox = require('./lib/sandbox');
const logger = require('./lib/logger');

const program = new Command();

// ─── Global options ──────────────────────────────────────────────────────────
program
  .name('nemoclaw')
  .description('NVIDIA NemoClaw: Sandboxed AI Agent Management CLI')
  .version(version, '-v, --version', 'Print the NemoClaw CLI version')
  .option('--debug', 'Enable debug logging', false)
  .option('--gateway-port <port>', 'Override OpenShell gateway port', process.env.NEMOCLAW_GATEWAY_PORT || '10000')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) {
      logger.setLevel('debug');
    }
    logger.debug(`Running command: ${thisCommand.name()} ${process.argv.slice(2).join(' ')}`);
  });

// ─── help / version ──────────────────────────────────────────────────────────
program
  .command('help')
  .description('Show help and command groups')
  .action(() => {
    program.help();
  });

// ─── host probe ──────────────────────────────────────────────────────────────
program
  .command('host')
  .description('Host-side readiness and diagnostics')
  .addCommand(
    new Command('probe')
      .description('Run read-only host readiness probe before onboarding')
      .option('--json', 'Output probe results as JSON')
      .action(async (opts) => {
        await preflight.probe(opts);
      })
  );

// ─── agents list ─────────────────────────────────────────────────────────────
program
  .command('agents')
  .description('Manage supported agent runtimes')
  .addCommand(
    new Command('list')
      .description('List installed and available agent runtimes')
      .action(async () => {
        await sandbox.listAgents();
      })
  )
  .addCommand(
    new Command('add')
      .description('Register an additional agent runtime')
      .argument('<agent-name>', 'Agent name to register')
      .option('--version <ver>', 'Specific agent version')
      .action(async (agentName, opts) => {
        await sandbox.addAgent(agentName, opts);
      })
  )
  .addCommand(
    new Command('delete')
      .description('Remove a registered agent runtime')
      .argument('<agent-name>', 'Agent name to remove')
      .action(async (agentName) => {
        await sandbox.deleteAgent(agentName);
      })
  );

// ─── onboard ─────────────────────────────────────────────────────────────────
program
  .command('onboard')
  .description('Onboard a new NemoClaw sandbox (primary operator entry point)')
  .option('--agent <agent>', 'Agent runtime to use (openclaw|hermes|langchain-deepagents-code)', process.env.NEMOCLAW_AGENT || 'openclaw')
  .option('--name <name>', 'Sandbox name (1-63 lowercase chars)', process.env.NEMOCLAW_SANDBOX_NAME || 'nemoclaw-sandbox')
  .option('--provider <provider>', 'Inference provider (nvidia|ollama|openai-compatible|model-router)', 'nvidia')
  .option('--model <model>', 'Model to use', process.env.NEMOCLAW_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct')
  .option('--resume', 'Resume an interrupted onboarding')
  .option('--fresh', 'Force fresh onboarding, ignoring resume state')
  .option('--from <blueprint>', 'Use a specific blueprint version or path')
  .option('--events=jsonl', 'Emit structured JSONL lifecycle events to stdout')
  .option('--tool-disclosure <mode>', 'Tool disclosure mode (progressive|direct)', 'progressive')
  .action(async (opts) => {
    await onboard.run(opts);
  });

// ─── list ─────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List registered NemoClaw sandboxes')
  .action(async () => {
    await sandbox.list();
  });

// ─── use ─────────────────────────────────────────────────────────────────────
program
  .command('use <sandbox>')
  .description('Select a sandbox as the active default')
  .action(async (sandboxName) => {
    await sandbox.use(sandboxName);
  });

// ─── connect ─────────────────────────────────────────────────────────────────
program
  .command('connect')
  .description('Connect to the active sandbox dashboard')
  .option('--sandbox <name>', 'Target sandbox name')
  .action(async (opts) => {
    await sandbox.connect(opts);
  });

// ─── status ──────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show sandbox and inference status')
  .option('--sandbox <name>', 'Target sandbox name')
  .option('--json', 'Output status as JSON')
  .action(async (opts) => {
    await sandbox.status(opts);
  });

// ─── start / stop ─────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start a stopped sandbox')
  .option('--sandbox <name>', 'Target sandbox name')
  .action(async (opts) => {
    await sandbox.start(opts);
  });

program
  .command('stop')
  .description('Stop a running sandbox gracefully')
  .option('--sandbox <name>', 'Target sandbox name')
  .action(async (opts) => {
    await sandbox.stop(opts);
  });

// ─── logs ─────────────────────────────────────────────────────────────────────
program
  .command('logs')
  .description('Show logs from the active sandbox')
  .option('--sandbox <name>', 'Target sandbox name')
  .option('--follow', 'Follow log output', false)
  .option('--lines <n>', 'Number of recent lines to show', '50')
  .action(async (opts) => {
    await sandbox.logs(opts);
  });

// ─── exec ─────────────────────────────────────────────────────────────────────
program
  .command('exec <command...>')
  .description('Execute a command inside the sandbox')
  .option('--sandbox <name>', 'Target sandbox name')
  .action(async (cmd, opts) => {
    await sandbox.exec(cmd.join(' '), opts);
  });

// ─── rebuild ─────────────────────────────────────────────────────────────────
program
  .command('rebuild')
  .description('Recreate the sandbox from recorded configuration')
  .option('--sandbox <name>', 'Target sandbox name')
  .option('--yes', 'Skip confirmation prompt', false)
  .action(async (opts) => {
    await sandbox.rebuild(opts);
  });

// ─── destroy ─────────────────────────────────────────────────────────────────
program
  .command('destroy')
  .description('Destroy the sandbox and remove its registration')
  .option('--sandbox <name>', 'Target sandbox name')
  .option('--yes', 'Skip confirmation prompt', false)
  .option('--keep-data', 'Keep sandbox data volumes', false)
  .action(async (opts) => {
    await sandbox.destroy(opts);
  });

// ─── inference ───────────────────────────────────────────────────────────────
program
  .command('inference')
  .description('Manage inference provider configuration')
  .addCommand(
    new Command('get')
      .description('Show current inference provider and model')
      .option('--sandbox <name>', 'Target sandbox name')
      .action(async (opts) => {
        await inference.get(opts);
      })
  )
  .addCommand(
    new Command('set')
      .description('Update inference provider and model')
      .option('--provider <provider>', 'Inference provider')
      .option('--model <model>', 'Model name')
      .option('--sandbox <name>', 'Target sandbox name')
      .action(async (opts) => {
        await inference.set(opts);
      })
  );

// ─── policy ──────────────────────────────────────────────────────────────────
program
  .command('policy')
  .description('Manage network egress policies')
  .addCommand(
    new Command('get')
      .description('Show current network policy')
      .option('--sandbox <name>', 'Target sandbox')
      .action(async (opts) => {
        await policies.get(opts);
      })
  )
  .addCommand(
    new Command('add')
      .description('Add an egress rule')
      .argument('<rule>', 'Rule specification (host[:port][/protocol])')
      .option('--sandbox <name>', 'Target sandbox')
      .action(async (rule, opts) => {
        await policies.add(rule, opts);
      })
  )
  .addCommand(
    new Command('list')
      .description('List all policy rules')
      .option('--sandbox <name>', 'Target sandbox')
      .action(async (opts) => {
        await policies.list(opts);
      })
  )
  .addCommand(
    new Command('remove')
      .description('Remove an egress rule')
      .argument('<rule>', 'Rule to remove')
      .option('--sandbox <name>', 'Target sandbox')
      .action(async (rule, opts) => {
        await policies.remove(rule, opts);
      })
  )
  .addCommand(
    new Command('explain')
      .description('Explain what a policy rule does')
      .argument('<rule>', 'Rule to explain')
      .action(async (rule) => {
        await policies.explain(rule);
      })
  );

// ─── credentials ─────────────────────────────────────────────────────────────
program
  .command('credentials')
  .description('Manage provider credentials stored in the OpenShell gateway')
  .addCommand(
    new Command('list')
      .description('List registered credential names (no values shown)')
      .action(async () => {
        await credentials.list();
      })
  )
  .addCommand(
    new Command('add')
      .description('Register a new credential')
      .argument('<name>', 'Credential name')
      .option('--provider <provider>', 'Provider type')
      .action(async (name, opts) => {
        await credentials.add(name, opts);
      })
  )
  .addCommand(
    new Command('reset')
      .description('Rotate a credential value')
      .argument('<name>', 'Credential name to rotate')
      .action(async (name) => {
        await credentials.reset(name);
      })
  );

// ─── shields ─────────────────────────────────────────────────────────────────
program
  .command('shields')
  .description('Manage sandbox security shields posture')
  .addCommand(new Command('status').description('Show shields status').action(async () => { await sandbox.shieldsStatus(); }))
  .addCommand(new Command('up').description('Enable all security shields').action(async () => { await sandbox.shieldsUp(); }))
  .addCommand(new Command('down').description('Disable shields (requires confirmation)').option('--yes').action(async (opts) => { await sandbox.shieldsDown(opts); }));

// ─── recover ─────────────────────────────────────────────────────────────────
program
  .command('recover')
  .description('Repair a stopped or degraded agent runtime')
  .option('--sandbox <name>', 'Target sandbox')
  .action(async (opts) => {
    await sandbox.recover(opts);
  });

// ─── doctor ──────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check sandbox and host health')
  .option('--sandbox <name>', 'Target sandbox')
  .action(async (opts) => {
    await preflight.doctor(opts);
  });

// ─── snapshot ─────────────────────────────────────────────────────────────────
program
  .command('snapshot')
  .description('Manage sandbox snapshots')
  .addCommand(
    new Command('create').description('Create a snapshot').option('--sandbox <name>').action(async (opts) => { await sandbox.snapshotCreate(opts); })
  )
  .addCommand(
    new Command('list').description('List snapshots').option('--sandbox <name>').action(async (opts) => { await sandbox.snapshotList(opts); })
  )
  .addCommand(
    new Command('restore')
      .description('Restore a snapshot')
      .argument('[selector]', 'Snapshot name or ID')
      .option('--sandbox <name>')
      .option('--to <target>', 'Target sandbox')
      .option('--force', 'Force restore')
      .option('--yes', 'Skip confirmation')
      .action(async (selector, opts) => { await sandbox.snapshotRestore(selector, opts); })
  );

// ─── mcp ─────────────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Manage MCP (Model Context Protocol) server integrations')
  .addCommand(new Command('list').description('List MCP servers').option('--sandbox <name>').action(async (opts) => { await sandbox.mcpList(opts); }))
  .addCommand(new Command('add').argument('<server>').description('Add an MCP server').option('--credential <name>').option('--sandbox <name>').action(async (server, opts) => { await sandbox.mcpAdd(server, opts); }))
  .addCommand(new Command('status').description('Show MCP server status').option('--sandbox <name>').action(async (opts) => { await sandbox.mcpStatus(opts); }))
  .addCommand(new Command('restart').argument('[server]').description('Restart MCP server').option('--sandbox <name>').action(async (server, opts) => { await sandbox.mcpRestart(server, opts); }))
  .addCommand(new Command('remove').argument('<server>').description('Remove an MCP server').option('--sandbox <name>').action(async (server, opts) => { await sandbox.mcpRemove(server, opts); }));

// ─── update ──────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Update NemoClaw CLI to latest version')
  .option('--check-only', 'Only check for updates, do not install')
  .action(async (opts) => {
    await runner.update(opts);
  });

// ─── uninstall ────────────────────────────────────────────────────────────────
program
  .command('uninstall')
  .description('Uninstall NemoClaw CLI and optionally remove state')
  .option('--keep-data', 'Keep ~/.nemoclaw state directory', false)
  .option('--yes', 'Skip confirmation', false)
  .action(async (opts) => {
    await runner.uninstall(opts);
  });

// ─── dashboard-url ────────────────────────────────────────────────────────────
program
  .command('dashboard-url')
  .description('Print the URL for the sandbox OpenClaw dashboard')
  .option('--sandbox <name>', 'Target sandbox')
  .action(async (opts) => {
    await sandbox.dashboardUrl(opts);
  });

// ─── gateway-token ────────────────────────────────────────────────────────────
program
  .command('gateway-token')
  .description('Print an ephemeral gateway access token')
  .option('--sandbox <name>', 'Target sandbox')
  .action(async (opts) => {
    await sandbox.gatewayToken(opts);
  });

// ─── resources ────────────────────────────────────────────────────────────────
program
  .command('resources')
  .description('Show NemoClaw documentation and community links')
  .action(() => {
    console.log(chalk.bold('\n📚 NemoClaw Resources\n'));
    console.log(`  Documentation : ${chalk.cyan('https://docs.nvidia.com/nemoclaw/latest/')}`);
    console.log(`  GitHub        : ${chalk.cyan('https://github.com/NVIDIA/NemoClaw')}`);
    console.log(`  Discord       : ${chalk.cyan('https://discord.gg/XFpfPv9Uvx')}`);
    console.log(`  Discussions   : ${chalk.cyan('https://github.com/NVIDIA/NemoClaw/discussions')}`);
    console.log(`  Security      : ${chalk.cyan('https://github.com/NVIDIA/NemoClaw/blob/main/SECURITY.md')}`);
    console.log('');
  });

// ─── completion ──────────────────────────────────────────────────────────────
program
  .command('completion [shell]')
  .description('Generate shell completion script (bash|zsh|fish)')
  .action((shell) => {
    const shellName = shell || (process.env.SHELL || 'bash').split('/').pop();
    const completionModule = require('./lib/completion');
    completionModule.generate(shellName, program);
  });

// ─── gc ──────────────────────────────────────────────────────────────────────
program
  .command('gc')
  .description('Garbage-collect stale NemoClaw state and unused resources')
  .option('--dry-run', 'Show what would be removed without deleting', false)
  .action(async (opts) => {
    await runner.gc(opts);
  });

// ─── Error handling ──────────────────────────────────────────────────────────
program.exitOverride();

try {
  program.parse(process.argv);
} catch (err) {
  if (err.code === 'commander.unknownCommand') {
    logger.error(`Unknown command: ${err.message}`);
    console.error(chalk.red(`\nUnknown command. Run ${chalk.bold('nemoclaw help')} to see available commands.\n`));
    process.exit(1);
  } else if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  } else {
    logger.error(`CLI error: ${err.message}`);
    process.exit(1);
  }
}
