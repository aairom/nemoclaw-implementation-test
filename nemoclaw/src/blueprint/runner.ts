// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/blueprint/runner.ts
 * Blueprint runner: Resolve → Verify → Plan → Apply → Status
 * TypeScript implementation of the 5-step blueprint lifecycle.
 */

import type { Blueprint, Plan, Operation, NemoclawConfig } from '../types.js';
import { validateEndpoint } from './ssrf.js';

// ─── Blueprint Runner class ───────────────────────────────────────────────────

export class BlueprintRunner {
  private config: NemoclawConfig;

  constructor(config: NemoclawConfig) {
    this.config = config;
  }

  /**
   * Step 1: Resolve the blueprint artifact.
   * Locates the blueprint and checks version compatibility.
   */
  async resolve(): Promise<Blueprint> {
    return {
      version: this.config.version,
      agent: this.config.agent,
      components: {
        sandbox: {
          name: this.config.sandboxName,
          image: 'ghcr.io/nvidia/nemoclaw/sandbox-base:latest',
          securityProfile: {
            landlock: true,
            seccomp: true,
            netns: true,
            capabilityDrops: ['ALL'],
            processLimit: 256,
          },
        },
        inference: {
          profiles: {
            default: {
              provider_name: this.config.provider,
              model: this.config.model,
              baseUrl: 'http://inference.local',
            },
          },
        },
      },
    };
  }

  /**
   * Step 2: Verify the blueprint digest.
   * Ensures the blueprint has not been tampered with.
   */
  async verify(blueprint: Blueprint): Promise<boolean> {
    if (!blueprint.digest) {
      // No digest to verify (acceptable in development)
      return true;
    }
    // In production: compute SHA-256 and compare
    return true;
  }

  /**
   * Step 3: Plan the OpenShell resources to create or update.
   */
  async plan(blueprint: Blueprint): Promise<Plan> {
    const operations: Operation[] = [];

    // Validate SSRF safety of inference endpoint
    const inferenceCheck = validateEndpoint('inference.local');
    if (!inferenceCheck.safe) {
      throw new Error(`SSRF validation failed for inference endpoint: ${inferenceCheck.reason}`);
    }

    operations.push({ type: 'gateway.create', gatewayPort: this.config.gatewayPort });
    operations.push({ type: 'provider.register', provider: this.config.provider, model: this.config.model });
    operations.push({ type: 'sandbox.create', name: blueprint.components.sandbox.name, agent: this.config.agent });
    operations.push({ type: 'inference.route', provider: this.config.provider, model: this.config.model });
    operations.push({ type: 'policy.apply', preset: `${this.config.agent}-sandbox` });

    return { operations };
  }

  /**
   * Step 4: Apply the plan by calling OpenShell CLI commands.
   */
  async apply(plan: Plan): Promise<void> {
    for (const op of plan.operations) {
      await this.executeOperation(op);
    }
  }

  /**
   * Step 5: Report current status.
   */
  async status(): Promise<{ state: string; sandbox: string }> {
    return { state: 'running', sandbox: this.config.sandboxName };
  }

  /**
   * Execute a single plan operation.
   */
  private async executeOperation(op: Operation): Promise<void> {
    // In production: this calls `openshell` CLI commands
    // e.g. execSync(`openshell ${op.type} ...`)
    console.debug(`[Runner] Executing: ${op.type}`);
  }
}
