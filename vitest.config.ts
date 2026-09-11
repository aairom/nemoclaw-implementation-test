// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root-level tests: CLI integration tests (ESM)
    include: ['test/**/*.test.{js,ts}'],
    exclude: ['test/e2e/**', '**/node_modules/**'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['bin/lib/**/*.js'],
      exclude: ['**/*.test.ts', '**/*.test.js', '**/*.d.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
