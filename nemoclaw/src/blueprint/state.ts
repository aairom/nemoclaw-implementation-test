// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * nemoclaw/src/blueprint/state.ts
 * Persistent run state management for the blueprint runner.
 * Tracks onboarding progress to support resume on interruption.
 */

export type OnboardingStage =
  | 'idle'
  | 'resolving'
  | 'verifying'
  | 'planning'
  | 'applying'
  | 'status'
  | 'complete'
  | 'failed';

export interface RunState {
  sandboxName: string;
  stage: OnboardingStage;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  planHash?: string;
  operationsCompleted: number;
  totalOperations: number;
}

// In-memory state store (in production, persisted to ~/.nemoclaw/run-state.json)
const stateStore = new Map<string, RunState>();

/**
 * Initialize or reset run state for a sandbox.
 */
export function initState(sandboxName: string): RunState {
  const state: RunState = {
    sandboxName,
    stage: 'idle',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    operationsCompleted: 0,
    totalOperations: 0,
  };
  stateStore.set(sandboxName, state);
  return state;
}

/**
 * Update the stage for a sandbox's run state.
 */
export function updateStage(sandboxName: string, stage: OnboardingStage, extra: Partial<RunState> = {}): void {
  const existing = stateStore.get(sandboxName) ?? initState(sandboxName);
  const updated: RunState = {
    ...existing,
    ...extra,
    stage,
    updatedAt: new Date().toISOString(),
  };
  stateStore.set(sandboxName, updated);
}

/**
 * Get current run state for a sandbox.
 */
export function getRunState(sandboxName: string): RunState | null {
  return stateStore.get(sandboxName) ?? null;
}

/**
 * Mark state as complete.
 */
export function markComplete(sandboxName: string): void {
  updateStage(sandboxName, 'complete', { completedAt: new Date().toISOString() });
}

/**
 * Mark state as failed.
 */
export function markFailed(sandboxName: string, error: string): void {
  updateStage(sandboxName, 'failed', { error });
}

/**
 * Check if onboarding can be resumed.
 */
export function canResume(sandboxName: string): boolean {
  const state = stateStore.get(sandboxName);
  if (!state) return false;
  return state.stage !== 'complete' && state.stage !== 'idle';
}
