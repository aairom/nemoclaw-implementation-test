// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * test/cli.test.js
 * Integration tests for the NemoClaw CLI (ESM, Vitest project: cli)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require = createRequire(import.meta.url);

// ─── State module tests ───────────────────────────────────────────────────────

describe('State module', () => {
  let stateModule;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nemoclaw-test-'));
    process.env.NEMOCLAW_STATE_DIR = tmpDir;
    // Re-require to get fresh state with new env
    vi.resetModules();
    stateModule = require('../bin/lib/state.js');
  });

  afterEach(() => {
    delete process.env.NEMOCLAW_STATE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateSandboxName', () => {
    it('should accept valid single-char names', () => {
      expect(() => stateModule.validateSandboxName('a')).not.toThrow();
    });

    it('should accept valid multi-char names', () => {
      expect(() => stateModule.validateSandboxName('nemoclaw-sandbox')).not.toThrow();
      expect(() => stateModule.validateSandboxName('my-sandbox-1')).not.toThrow();
    });

    it('should reject names starting with a digit', () => {
      expect(() => stateModule.validateSandboxName('1sandbox')).toThrow();
    });

    it('should reject names with uppercase letters', () => {
      expect(() => stateModule.validateSandboxName('MySandbox')).toThrow();
    });

    it('should reject names longer than 63 chars', () => {
      const long = 'a'.repeat(64);
      expect(() => stateModule.validateSandboxName(long)).toThrow();
    });

    it('should reject names with leading hyphens', () => {
      expect(() => stateModule.validateSandboxName('-sandbox')).toThrow();
    });

    it('should reject names with trailing hyphens', () => {
      expect(() => stateModule.validateSandboxName('sandbox-')).toThrow();
    });

    it('should reject empty string', () => {
      expect(() => stateModule.validateSandboxName('')).toThrow();
    });
  });

  describe('validateProviderName', () => {
    it('should accept valid provider names', () => {
      expect(() => stateModule.validateProviderName('nvidia')).not.toThrow();
      expect(() => stateModule.validateProviderName('openai-compatible')).not.toThrow();
      expect(() => stateModule.validateProviderName('my.provider_v1')).not.toThrow();
    });

    it('should reject names starting with a digit', () => {
      expect(() => stateModule.validateProviderName('1nvidia')).toThrow();
    });

    it('should reject names longer than 128 chars', () => {
      const long = 'a' + 'b'.repeat(128);
      expect(() => stateModule.validateProviderName(long)).toThrow();
    });
  });

  describe('registerSandbox / getSandbox', () => {
    it('should register and retrieve a sandbox', () => {
      stateModule.registerSandbox({
        name: 'test-sb',
        agent: 'openclaw',
        provider: 'nvidia',
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
      });

      const sb = stateModule.getSandbox('test-sb');
      expect(sb).not.toBeNull();
      expect(sb.name).toBe('test-sb');
      expect(sb.agent).toBe('openclaw');
    });

    it('should return null for unknown sandbox', () => {
      const sb = stateModule.getSandbox('nonexistent');
      expect(sb).toBeNull();
    });

    it('should set first registered sandbox as default', () => {
      stateModule.registerSandbox({ name: 'first-sb', agent: 'openclaw', provider: 'nvidia', model: 'test' });
      const reg = stateModule.getSandboxes();
      expect(reg.default).toBe('first-sb');
    });

    it('should update existing sandbox on re-register', () => {
      stateModule.registerSandbox({ name: 'my-sb', agent: 'openclaw', provider: 'nvidia', model: 'model-a' });
      stateModule.registerSandbox({ name: 'my-sb', agent: 'hermes', provider: 'ollama', model: 'model-b' });
      const reg = stateModule.getSandboxes();
      const entries = reg.sandboxes.filter((s) => s.name === 'my-sb');
      expect(entries).toHaveLength(1);
      expect(entries[0].agent).toBe('hermes');
    });
  });

  describe('setDefaultSandbox', () => {
    it('should set the default sandbox', () => {
      stateModule.registerSandbox({ name: 'sb-a', agent: 'openclaw', provider: 'nvidia', model: 'test' });
      stateModule.registerSandbox({ name: 'sb-b', agent: 'hermes', provider: 'nvidia', model: 'test' });
      stateModule.setDefaultSandbox('sb-b');
      expect(stateModule.getSandboxes().default).toBe('sb-b');
    });

    it('should throw for unknown sandbox', () => {
      expect(() => stateModule.setDefaultSandbox('nonexistent')).toThrow();
    });
  });

  describe('unregisterSandbox', () => {
    it('should remove a registered sandbox', () => {
      stateModule.registerSandbox({ name: 'remove-me', agent: 'openclaw', provider: 'nvidia', model: 'test' });
      stateModule.unregisterSandbox('remove-me');
      expect(stateModule.getSandbox('remove-me')).toBeNull();
    });

    it('should reassign default when default is removed', () => {
      stateModule.registerSandbox({ name: 'sb-1', agent: 'openclaw', provider: 'nvidia', model: 'test' });
      stateModule.registerSandbox({ name: 'sb-2', agent: 'openclaw', provider: 'nvidia', model: 'test' });
      stateModule.setDefaultSandbox('sb-1');
      stateModule.unregisterSandbox('sb-1');
      const reg = stateModule.getSandboxes();
      expect(reg.default).toBe('sb-2');
    });
  });
});

// ─── Inference module tests ──────────────────────────────────────────────────

describe('Inference module', () => {
  let inferenceModule;

  beforeEach(() => {
    vi.resetModules();
    inferenceModule = require('../bin/lib/inference.js');
  });

  describe('validateProvider', () => {
    it('should accept supported providers', () => {
      expect(() => inferenceModule.validateProvider('nvidia')).not.toThrow();
      expect(() => inferenceModule.validateProvider('ollama')).not.toThrow();
      expect(() => inferenceModule.validateProvider('openai-compatible')).not.toThrow();
      expect(() => inferenceModule.validateProvider('model-router')).not.toThrow();
    });

    it('should reject unknown providers', () => {
      expect(() => inferenceModule.validateProvider('unknown-llm')).toThrow();
      expect(() => inferenceModule.validateProvider('')).toThrow();
    });
  });

  describe('isInferenceRouteReady', () => {
    it('should return false for provider without credential set', () => {
      const originalKey = process.env.NVIDIA_API_KEY;
      delete process.env.NVIDIA_API_KEY;
      const result = inferenceModule.isInferenceRouteReady('nvidia', 'nvidia/llama-3.1-nemotron-70b-instruct');
      expect(result).toBe(false);
      if (originalKey) process.env.NVIDIA_API_KEY = originalKey;
    });

    it('should return true for ollama (no credential required)', () => {
      const result = inferenceModule.isInferenceRouteReady('ollama', 'llama3.2');
      expect(result).toBe(true);
    });
  });

  describe('checkCredential', () => {
    it('should return ok for providers that do not require a key', () => {
      const result = inferenceModule.checkCredential('ollama');
      expect(result.ok).toBe(true);
    });

    it('should return not-ok when NVIDIA key is missing', () => {
      const originalKey = process.env.NVIDIA_API_KEY;
      delete process.env.NVIDIA_API_KEY;
      const result = inferenceModule.checkCredential('nvidia');
      expect(result.ok).toBe(false);
      if (originalKey) process.env.NVIDIA_API_KEY = originalKey;
    });
  });
});

// ─── Policies module tests ────────────────────────────────────────────────────

describe('Policies module', () => {
  let policiesModule;

  beforeEach(() => {
    vi.resetModules();
    policiesModule = require('../bin/lib/policies.js');
  });

  describe('parseRule', () => {
    it('should parse host-only rule with default https port', () => {
      const rule = policiesModule.parseRule('api.example.com');
      expect(rule.host).toBe('api.example.com');
      expect(rule.port).toBe(443);
      expect(rule.protocol).toBe('https');
    });

    it('should parse host:port rule', () => {
      const rule = policiesModule.parseRule('api.example.com:8080');
      expect(rule.host).toBe('api.example.com');
      expect(rule.port).toBe(8080);
    });

    it('should parse host:port/protocol rule', () => {
      const rule = policiesModule.parseRule('example.com:80/http');
      expect(rule.host).toBe('example.com');
      expect(rule.port).toBe(80);
      expect(rule.protocol).toBe('http');
    });

    it('should throw for invalid port', () => {
      expect(() => policiesModule.parseRule('host:99999')).toThrow();
    });

    it('should throw for invalid protocol', () => {
      expect(() => policiesModule.parseRule('host:443/ftp')).toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => policiesModule.parseRule('')).toThrow();
    });
  });

  describe('getBaseline', () => {
    it('should return baseline egress rules', () => {
      const rules = policiesModule.getBaseline();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);
      const hosts = rules.map((r) => r.host);
      expect(hosts).toContain('inference.local');
      expect(hosts).toContain('github.com');
    });
  });
});

// ─── Preflight module tests ───────────────────────────────────────────────────

describe('Preflight module', () => {
  let preflightModule;

  beforeEach(() => {
    vi.resetModules();
    preflightModule = require('../bin/lib/preflight.js');
  });

  describe('checkNode', () => {
    it('should return ok for the current Node version', () => {
      const result = preflightModule.checkNode();
      expect(typeof result.ok).toBe('boolean');
      expect(result.found).toMatch(/^v\d+/);
    });
  });

  describe('checkPort', () => {
    it('should return port info', () => {
      const result = preflightModule.checkPort(9999);
      expect(typeof result.ok).toBe('boolean');
      expect(result.port).toBe(9999);
    });
  });

  describe('checkRam', () => {
    it('should return total RAM', () => {
      const result = preflightModule.checkRam();
      expect(result.totalGB).toBeGreaterThan(0);
    });
  });
});
