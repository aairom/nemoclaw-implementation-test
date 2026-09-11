// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/types.ts
 * Shared TypeScript type definitions for the NemoClaw plugin.
 */

// ─── Configuration ────────────────────────────────────────────────────────────

export interface NemoclawConfig {
  sandboxName: string;
  agent: AgentType;
  provider: InferenceProvider;
  model: string;
  gatewayPort: number;
  version: string;
}

export type AgentType = 'openclaw' | 'hermes' | 'langchain-deepagents-code';

export type InferenceProvider = 'nvidia' | 'ollama' | 'openai-compatible' | 'model-router';

// ─── Blueprint ────────────────────────────────────────────────────────────────

export interface Blueprint {
  version: string;
  agent?: AgentType;
  components: BlueprintComponents;
  digest?: string;
}

export interface BlueprintComponents {
  sandbox: SandboxComponent;
  inference: InferenceComponent;
}

export interface SandboxComponent {
  name: string;
  image: string;
  securityProfile?: SecurityProfile;
}

export interface SecurityProfile {
  landlock: boolean;
  seccomp: boolean;
  netns: boolean;
  capabilityDrops: string[];
  processLimit: number;
}

export interface InferenceComponent {
  profiles: Record<string, InferenceProfile>;
}

export interface InferenceProfile {
  provider_name: string;
  model: string;
  baseUrl?: string;
}

// ─── Network Policy ───────────────────────────────────────────────────────────

export interface NetworkPolicy {
  version: string;
  egress: EgressRule[];
  deny: DenyRule[];
}

export interface EgressRule {
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'tcp' | 'udp' | 'any';
  comment?: string;
}

export interface DenyRule {
  host: string;
  port: number;
  protocol: string;
  reason?: string;
}

// ─── Sandbox State ────────────────────────────────────────────────────────────

export interface SandboxState {
  name: string;
  agent: AgentType;
  provider: InferenceProvider;
  model: string;
  gatewayPort: number;
  blueprintVersion: string;
  registeredAt: string;
  updatedAt?: string;
  rotatedAt?: string;
}

export interface SandboxRegistry {
  sandboxes: SandboxState[];
  default: string | null;
}

// ─── Runner Operations ────────────────────────────────────────────────────────

export type OperationType =
  | 'gateway.create'
  | 'provider.register'
  | 'sandbox.create'
  | 'sandbox.update'
  | 'inference.route'
  | 'policy.apply';

export interface Operation {
  type: OperationType;
  [key: string]: unknown;
}

export interface Plan {
  operations: Operation[];
}

// ─── Runtime Context ──────────────────────────────────────────────────────────

export interface RuntimeContextData {
  sandboxName: string;
  agent: AgentType;
  provider: InferenceProvider;
  model: string;
  capabilities: string[];
  restrictions: string[];
  policyHints: string[];
}

// ─── SSRF Validation ──────────────────────────────────────────────────────────

export interface SsrfValidationResult {
  safe: boolean;
  reason?: string;
  host: string;
  resolvedIp?: string;
}
