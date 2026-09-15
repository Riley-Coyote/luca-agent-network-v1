import * as React from "react";

import type { DiscoveredResidentCandidate } from "@/shared/api/types";

/**
 * The agents the owner ticked during setup are brought in AFTER the card has
 * become the application. Nothing about the first conversation waits on them:
 * the queue is started and never awaited, it runs one agent at a time (the
 * native creation lock serialises them anyway), and a failure is kept on that
 * one row instead of stopping the rest or opening a dialog.
 *
 * While an agent is being brought in it is a row in the rail in the state the
 * rail already has for a resident that exists but is not up yet — "Waking…" —
 * and a failed one keeps the rail's "Needs attention" with the reason. No new
 * visual is invented for this.
 */
/** Marks a rail row that has no resident record behind it yet. */
export const PENDING_NATIVE_IMPORT_PREFIX = "pending-native-import:";

export type PendingNativeImport = {
  semanticId: string;
  displayName: string;
  /** Set once the import failed. The row stays, saying what went wrong. */
  error: string | null;
};

export type NativeImportRunner = (
  candidate: DiscoveredResidentCandidate,
  options: { residentMemory: boolean },
) => Promise<void>;

export type StartOnboardingImportsOptions = {
  /** Injected by the unit tests; production uses the native import path. */
  importAgent?: NativeImportRunner;
  /** Called after every attempt so the rail can pick the new record up. */
  onResidentsChanged?: () => void;
};

let staged: DiscoveredResidentCandidate[] = [];
let stagedResidentMemory = true;
let pending: readonly PendingNativeImport[] = [];
let running = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** What the agents chapter decided, held until the waking step starts it. */
export function stageOnboardingAgentImports(
  candidates: readonly DiscoveredResidentCandidate[],
  options: { residentMemory: boolean } = { residentMemory: true },
) {
  staged = [...candidates];
  stagedResidentMemory = options.residentMemory;
}

export function readStagedOnboardingAgentImports(): readonly DiscoveredResidentCandidate[] {
  return staged;
}

/**
 * The real import: the same native path the Agents page uses. The resident
 * record is written first and the process is not spawned, so the agent is in
 * the rail from the moment it exists and wakes on its first message like
 * every other resident.
 */
const importNativeAgent: NativeImportRunner = async (
  candidate,
  { residentMemory },
) => {
  const { createManagedAgent } = await import("@/shared/api/tauri");
  const created = await createManagedAgent({
    name: candidate.displayName,
    agentCommand: candidate.bindingPreview.executablePath,
    agentArgs: ["acp"],
    harnessOverride: true,
    parallelism: 1,
    nativeRuntimeBinding: candidate.bindingPreview,
    spawnAfterCreate: false,
    startOnAppLaunch: false,
  });
  try {
    const { setResidentContinuityEnabled } = await import(
      "@/shared/api/tauriContinuity"
    );
    await setResidentContinuityEnabled(created.agent.pubkey, residentMemory);
  } catch (cause) {
    // The agent is here either way. Memory it could not be given is a thing
    // to fix on its own page, not a reason to call the import a failure.
    console.warn(
      `Polyphonic could not set memory for ${candidate.displayName}`,
      cause,
    );
  }
  const failure = created.spawnError ?? created.profileSyncError;
  if (failure) throw new Error(failure);
};

/**
 * Start what the agents chapter staged. Safe to call more than once: the
 * staged list is taken exactly once, so a re-render or a retried preparation
 * can never import the same agent twice.
 */
export function startStagedOnboardingAgentImports(
  options: StartOnboardingImportsOptions = {},
) {
  if (running) return;
  const queue = staged;
  staged = [];
  if (queue.length === 0) return;

  running = true;
  const residentMemory = stagedResidentMemory;
  const importAgent = options.importAgent ?? importNativeAgent;
  pending = queue.map((candidate) => ({
    semanticId: candidate.semanticId,
    displayName: candidate.displayName,
    error: null,
  }));
  emit();

  void (async () => {
    for (const candidate of queue) {
      try {
        await importAgent(candidate, { residentMemory });
        pending = pending.filter(
          (entry) => entry.semanticId !== candidate.semanticId,
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : String(cause) || "";
        pending = pending.map((entry) =>
          entry.semanticId === candidate.semanticId
            ? { ...entry, error: message || "Needs attention" }
            : entry,
        );
      }
      emit();
      options.onResidentsChanged?.();
    }
    running = false;
  })();
}

export function pendingNativeImports(): readonly PendingNativeImport[] {
  return pending;
}

export function subscribeToPendingNativeImports(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The rows the rail shows while setup's agents are still coming in. */
export function usePendingNativeImports(): readonly PendingNativeImport[] {
  return React.useSyncExternalStore(
    subscribeToPendingNativeImports,
    pendingNativeImports,
    pendingNativeImports,
  );
}

/** Tests and the dev lab's fresh-onboarding reset. */
export function resetOnboardingBackgroundImports() {
  staged = [];
  stagedResidentMemory = true;
  pending = [];
  running = false;
  emit();
}
