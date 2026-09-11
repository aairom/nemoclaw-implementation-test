// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/onboard/config.ts
 * Onboarding configuration schema and validation.
 */

import type { NemoclawConfig, AgentType, InferenceProvider } from '../types.js';

// ─── Onboard config ───────────────────────────────────────────────────────────

export interface OnboardConfig extends NemoclawConfig {
  resume: boolean;
  fresh: boolean;
  toolDisclosure: 'progressive' | 'direct';
}

// ─── Validator ────────────────────────────────────────────────────────────────

const VALID_AGENTS: AgentType[] = ['openclaw', 'hermes', 'langchain-deepagents-code'];
const VALID_PROVIDERS: InferenceProvider[] = ['nvidia', 'ollama', 'openai-compatible', 'model-router'];
const SANDBOX_NAME_RE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$/;
const PROVIDER_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/;

export class OnboardValidator {
  /**
   * Validate onboard configuration.
   * Throws a descriptive error on first validation failure.
   */
  static validate(config: Partial<OnboardConfig>): void {
    OnboardValidator.validateSandboxName(config.sandboxName ?? '');
    OnboardValidator.validateAgent(config.agent ?? 'openclaw');
    OnboardValidator.validateProvider(config.provider ?? 'nvidia');
    OnboardValidator.validateProviderName(config.provider ?? 'nvidia');
    OnboardValidator.validateModel(config.model ?? '');
  }

  static validateSandboxName(name: string): void {
    if (!name || !SANDBOX_NAME_RE.test(name)) {
      throw new Error(
        `Invalid sandbox name '${name}'. ` +
        `Use 1-63 lowercase letters, numbers, or internal hyphens, ` +
        `starting with a letter and ending with a letter or number.`
      );
    }
  }

  static validateAgent(agent: string): void {
    if (!VALID_AGENTS.includes(agent as AgentType)) {
      throw new Error(
        `Invalid agent '${agent}'. Supported agents: ${VALID_AGENTS.join(', ')}`
      );
    }
  }

  static validateProvider(provider: string): void {
    if (!VALID_PROVIDERS.includes(provider as InferenceProvider)) {
      throw new Error(
        `Invalid provider '${provider}'. Supported: ${VALID_PROVIDERS.join(', ')}`
      );
    }
  }

  static validateProviderName(name: string): void {
    if (!PROVIDER_NAME_RE.test(name)) {
      throw new Error(
        `Invalid provider name '${name}'. ` +
        `Use 1-128 letters, numbers, dots, underscores, or hyphens, starting with a letter.`
      );
    }
  }

  static validateModel(model: string): void {
    if (!model || model.trim() === '') {
      throw new Error('Model name cannot be empty');
    }
  }
}
