// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/commands/nemoclaw-command.ts
 * /nemoclaw slash command handler (runs inside the OpenClaw sandbox).
 * Provides quick status, onboard info, shields status, and eject guidance.
 */

import type { NemoclawConfig } from '../types.js';

export type SlashSubcommand = 'status' | 'shields' | 'onboard' | 'eject' | 'help' | '';

export interface CommandResponse {
  output: string;
  exitCode: number;
}

// ─── Command handler ──────────────────────────────────────────────────────────

export class NemoclawCommandHandler {
  private config: NemoclawConfig;

  constructor(config: NemoclawConfig) {
    this.config = config;
  }

  /**
   * Handle a /nemoclaw slash command.
   * @param subcommand - Sub-command string
   * @param args - Additional arguments
   */
  async handle(subcommand: SlashSubcommand, _args: string[] = []): Promise<CommandResponse> {
    switch (subcommand) {
      case 'status':
        return this.handleStatus();
      case 'shields':
        return this.handleShields();
      case 'onboard':
        return this.handleOnboard();
      case 'eject':
        return this.handleEject();
      case 'help':
      case '':
      default:
        return this.handleHelp();
    }
  }

  /** Show sandbox and inference state */
  private handleStatus(): CommandResponse {
    const output = [
      `## NemoClaw Status`,
      ``,
      `**Sandbox:** ${this.config.sandboxName}`,
      `**Agent:** ${this.config.agent}`,
      `**Inference Provider:** ${this.config.provider}`,
      `**Model:** ${this.config.model}`,
      `**Gateway Port:** ${this.config.gatewayPort}`,
      ``,
      `Inference is routed through \`inference.local\`. Credentials are held by the host gateway.`,
    ].join('\n');
    return { output, exitCode: 0 };
  }

  /** Explain shields status (redirect to host CLI) */
  private handleShields(): CommandResponse {
    const output = [
      `## NemoClaw Shields`,
      ``,
      `Shields status is managed from the host, not inside the sandbox.`,
      ``,
      `Run on the host:`,
      `\`\`\``,
      `nemoclaw shields status`,
      `nemoclaw shields up`,
      `nemoclaw shields down`,
      `\`\`\``,
    ].join('\n');
    return { output, exitCode: 0 };
  }

  /** Show onboarding status and reconfiguration guidance */
  private handleOnboard(): CommandResponse {
    const output = [
      `## NemoClaw Onboarding`,
      ``,
      `This sandbox was onboarded with:`,
      `- Agent: **${this.config.agent}**`,
      `- Provider: **${this.config.provider}**`,
      `- Model: **${this.config.model}**`,
      ``,
      `To reconfigure, run on the host:`,
      `\`\`\``,
      `nemoclaw inference set --provider <provider> --model <model>`,
      `\`\`\``,
    ].join('\n');
    return { output, exitCode: 0 };
  }

  /** Show rollback instructions */
  private handleEject(): CommandResponse {
    const output = [
      `## NemoClaw Eject`,
      ``,
      `To return to a standard installation without NemoClaw:`,
      ``,
      `1. Run \`nemoclaw destroy\` from the host to remove the sandbox`,
      `2. Run \`nemoclaw uninstall\` to remove the CLI`,
      `3. Configure your agent runtime directly`,
      ``,
      `> ⚠️ This will destroy your sandbox state unless you create a snapshot first.`,
      `> Run \`nemoclaw snapshot create\` before ejecting.`,
    ].join('\n');
    return { output, exitCode: 0 };
  }

  /** Show help */
  private handleHelp(): CommandResponse {
    const output = [
      `## /nemoclaw Commands`,
      ``,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`/nemoclaw\` | Show this help |`,
      `| \`/nemoclaw status\` | Show sandbox and inference state |`,
      `| \`/nemoclaw shields\` | Shields status (host CLI required) |`,
      `| \`/nemoclaw onboard\` | Show onboarding status |`,
      `| \`/nemoclaw eject\` | Show rollback instructions |`,
      ``,
      `For full management, use the host CLI: \`nemoclaw help\``,
    ].join('\n');
    return { output, exitCode: 0 };
  }
}
