// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/runtime-context.ts
 * Builds runtime context guidance injected into OpenClaw turns.
 * Context is prepended as system guidance so sandbox/policy instructions
 * stay active without appearing in the visible chat transcript.
 */

import type { NemoclawConfig, RuntimeContextData } from './types.js';

// ─── Runtime context builder ──────────────────────────────────────────────────

export class RuntimeContext {
  private config: NemoclawConfig;

  constructor(config: NemoclawConfig) {
    this.config = config;
  }

  /**
   * Build the system context string injected into each agent turn.
   * Tells the agent what is allowed, what is restricted, and how to
   * report failures (policy denial, DNS, TLS, filesystem access).
   */
  buildSystemContext(): string {
    const data = this.buildContextData();
    return this.formatContextString(data);
  }

  /**
   * Build the structured context data.
   */
  buildContextData(): RuntimeContextData {
    return {
      sandboxName: this.config.sandboxName,
      agent: this.config.agent,
      provider: this.config.provider,
      model: this.config.model,
      capabilities: this.getCapabilities(),
      restrictions: this.getRestrictions(),
      policyHints: this.getPolicyHints(),
    };
  }

  /**
   * What the agent is allowed to do inside this sandbox.
   */
  private getCapabilities(): string[] {
    return [
      `Read and write files under /sandbox and /tmp`,
      `Make network requests to approved egress endpoints`,
      `Use inference via inference.local (routed by NemoClaw)`,
      `Install packages from approved package indexes`,
      `Execute shell commands within the sandbox`,
    ];
  }

  /**
   * What is restricted inside this sandbox.
   */
  private getRestrictions(): string[] {
    return [
      `Cannot access system paths outside /sandbox and /tmp (read-only)`,
      `Cannot escalate privileges or execute dangerous syscalls`,
      `Cannot make outbound connections to unapproved hosts`,
      `Cannot access raw inference provider credentials`,
      `Cannot modify network policy without operator approval`,
    ];
  }

  /**
   * Hints for reporting failures accurately.
   */
  private getPolicyHints(): string[] {
    return [
      `Try allowed network and filesystem actions first`,
      `If a network request fails, report whether the cause is policy denial, DNS failure, timeout, TLS error, or filesystem access`,
      `If an action is blocked by policy, surface the blocked host/path for operator approval`,
      `Do not retry blocked requests without explicit operator approval`,
    ];
  }

  /**
   * Format the context data into a system guidance string.
   */
  private formatContextString(data: RuntimeContextData): string {
    const lines: string[] = [
      `## NemoClaw Sandbox Context`,
      ``,
      `Sandbox: ${data.sandboxName} | Agent: ${data.agent} | Provider: ${data.provider} | Model: ${data.model}`,
      ``,
      `### Capabilities`,
      ...data.capabilities.map((c) => `- ${c}`),
      ``,
      `### Restrictions`,
      ...data.restrictions.map((r) => `- ${r}`),
      ``,
      `### Failure Reporting`,
      ...data.policyHints.map((h) => `- ${h}`),
    ];
    return lines.join('\n');
  }
}
