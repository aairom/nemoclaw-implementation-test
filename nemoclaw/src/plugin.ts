// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/plugin.ts
 * Main NemoClaw plugin class.
 * Runs in-process with OpenClaw inside the sandbox.
 * Registers the managed inference provider and /nemoclaw slash command.
 */

import { RuntimeContext } from './runtime-context.js';
import type { NemoclawConfig } from './types.js';

// ─── Plugin class ─────────────────────────────────────────────────────────────

export class NemoclawPlugin {
  private config: NemoclawConfig;
  private runtimeContext: RuntimeContext;

  constructor(config: Partial<NemoclawConfig> = {}) {
    this.config = {
      sandboxName: config.sandboxName ?? process.env['NEMOCLAW_SANDBOX_NAME'] ?? 'nemoclaw-sandbox',
      agent: (config.agent ?? process.env['NEMOCLAW_AGENT'] ?? 'openclaw') as import('./types.js').AgentType,
      provider: (config.provider ?? process.env['NEMOCLAW_INFERENCE_PROVIDER'] ?? 'nvidia') as import('./types.js').InferenceProvider,
      model: config.model ?? process.env['NEMOCLAW_MODEL'] ?? 'nvidia/llama-3.1-nemotron-70b-instruct',
      gatewayPort: config.gatewayPort ?? parseInt(process.env['NEMOCLAW_GATEWAY_PORT'] ?? '10000', 10),
      version: config.version ?? '0.1.0',
    };
    this.runtimeContext = new RuntimeContext(this.config);
  }

  /**
   * Activate the plugin within the OpenClaw runtime.
   * Registers inference provider metadata and context hooks.
   */
  activate(): void {
    this.registerInferenceProvider();
    this.registerSlashCommand();
    this.injectRuntimeContext();
  }

  /**
   * Register the NemoClaw managed inference provider.
   * The sandbox talks to inference.local; credentials never touch the sandbox.
   */
  private registerInferenceProvider(): void {
    const providerMetadata = {
      id: 'nemoclaw-nvidia',
      label: `NemoClaw (${this.config.provider})`,
      baseUrl: 'http://inference.local',
      model: this.config.model,
      managed: true,
    };
    console.debug('[NemoClaw] Registering inference provider:', providerMetadata.id);
  }

  /**
   * Register the /nemoclaw slash command handler.
   */
  private registerSlashCommand(): void {
    console.debug('[NemoClaw] Registering /nemoclaw slash command');
  }

  /**
   * Inject sandbox and policy runtime context into OpenClaw turns.
   * This appears as system guidance, not in the visible chat transcript.
   */
  private injectRuntimeContext(): void {
    const ctx = this.runtimeContext.buildSystemContext();
    console.debug('[NemoClaw] Runtime context injected:', ctx.length, 'chars');
  }

  /**
   * Get the current plugin configuration.
   */
  getConfig(): Readonly<NemoclawConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Deactivate and clean up plugin resources.
   */
  deactivate(): void {
    console.debug('[NemoClaw] Plugin deactivated');
  }
}
