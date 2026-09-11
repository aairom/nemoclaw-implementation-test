// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { NemoclawCommandHandler } from './nemoclaw-command.js';
import type { NemoclawConfig } from '../types.js';

const TEST_CONFIG: NemoclawConfig = {
  sandboxName: 'test-sandbox',
  agent: 'openclaw',
  provider: 'nvidia',
  model: 'nvidia/llama-3.1-nemotron-70b-instruct',
  gatewayPort: 10000,
  version: '0.1.0',
};

describe('NemoclawCommandHandler', () => {
  let handler: NemoclawCommandHandler;

  beforeEach(() => {
    handler = new NemoclawCommandHandler(TEST_CONFIG);
  });

  describe('handle()', () => {
    it('should return help for empty subcommand', async () => {
      const res = await handler.handle('');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('/nemoclaw Commands');
    });

    it('should return help for "help" subcommand', async () => {
      const res = await handler.handle('help');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('/nemoclaw status');
    });

    it('should return status with sandbox info', async () => {
      const res = await handler.handle('status');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('test-sandbox');
      expect(res.output).toContain('openclaw');
      expect(res.output).toContain('nvidia');
    });

    it('should return shields redirect message', async () => {
      const res = await handler.handle('shields');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('host');
      expect(res.output).toContain('nemoclaw shields');
    });

    it('should return onboard info with config', async () => {
      const res = await handler.handle('onboard');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('openclaw');
      expect(res.output).toContain('nvidia');
    });

    it('should return eject instructions', async () => {
      const res = await handler.handle('eject');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('destroy');
      expect(res.output).toContain('uninstall');
    });

    it('should handle unknown subcommand as help', async () => {
      const res = await handler.handle('unknown' as any);
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('/nemoclaw');
    });
  });
});
