// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/index.ts
 * NemoClaw plugin entry point for OpenClaw integration.
 * Registers the managed inference provider, the /nemoclaw slash command,
 * and runtime context hooks.
 */

export { NemoclawPlugin } from './plugin.js';
export { RuntimeContext } from './runtime-context.js';
export * from './blueprint/index.js';
export * from './commands/index.js';
export * from './onboard/index.js';
