import * as React from "react";

import {
  CONVERSATION_APPEARANCE_VERSION,
  DEFAULT_CONVERSATION_APPEARANCE,
  type ConversationAppearancePreferenceV2,
} from "@/features/messages/conversationAppearanceTypes";

const STORAGE_PREFIX = "luca.conversation-appearance.v2";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

const agentNamesByOwner = new Map<string, boolean>();
const listenersByOwner = new Map<string, Set<() => void>>();

function normalizedOwnerPubkey(ownerPubkey?: string | null): string | null {
  const normalized = ownerPubkey?.trim().toLowerCase() ?? "";
  return OWNER_PUBKEY_PATTERN.test(normalized) ? normalized : null;
}

export function conversationAppearanceStorageKey(
  ownerPubkey: string,
): string | null {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  return owner ? `${STORAGE_PREFIX}:${owner}` : null;
}

function parsePreference(
  rawValue: string | null | undefined,
): ConversationAppearancePreferenceV2 {
  if (!rawValue) return DEFAULT_CONVERSATION_APPEARANCE;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !==
        CONVERSATION_APPEARANCE_VERSION ||
      typeof (parsed as { agentNamesInMessages?: unknown })
        .agentNamesInMessages !== "boolean"
    ) {
      return DEFAULT_CONVERSATION_APPEARANCE;
    }
    return {
      version: CONVERSATION_APPEARANCE_VERSION,
      agentNamesInMessages: (parsed as { agentNamesInMessages: boolean })
        .agentNamesInMessages,
    };
  } catch {
    return DEFAULT_CONVERSATION_APPEARANCE;
  }
}

function readStoredAgentNames(owner: string): boolean {
  const key = conversationAppearanceStorageKey(owner);
  if (!key) return DEFAULT_CONVERSATION_APPEARANCE.agentNamesInMessages;
  try {
    return parsePreference(globalThis.localStorage?.getItem(key))
      .agentNamesInMessages;
  } catch {
    return DEFAULT_CONVERSATION_APPEARANCE.agentNamesInMessages;
  }
}

function getAgentNamesSnapshot(ownerPubkey?: string | null): boolean {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  if (!owner) return DEFAULT_CONVERSATION_APPEARANCE.agentNamesInMessages;
  const existing = agentNamesByOwner.get(owner);
  if (existing !== undefined) return existing;
  const stored = readStoredAgentNames(owner);
  agentNamesByOwner.set(owner, stored);
  return stored;
}

function subscribeToOwner(
  ownerPubkey: string | null | undefined,
  listener: () => void,
): () => void {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  if (!owner) return () => {};
  const listeners = listenersByOwner.get(owner) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByOwner.set(owner, listeners);
  // Detached windows share storage, but not this module's in-memory cache.
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== conversationAppearanceStorageKey(owner)
    )
      return;
    const value = readStoredAgentNames(owner);
    if (agentNamesByOwner.get(owner) === value) return;
    agentNamesByOwner.set(owner, value);
    for (const notify of listenersByOwner.get(owner) ?? []) notify();
  };
  globalThis.window?.addEventListener("storage", onStorage);
  return () => {
    globalThis.window?.removeEventListener("storage", onStorage);
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(owner);
  };
}

/** Read the current device-local preference outside React. */
export function getAgentNamesInMessages(ownerPubkey?: string | null): boolean {
  return getAgentNamesSnapshot(ownerPubkey);
}

/** Persist and immediately publish the agent-name preference. */
export function setAgentNamesInMessages(
  ownerPubkey: string | null | undefined,
  enabled: boolean,
): void {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  if (!owner) return;
  if (getAgentNamesSnapshot(owner) === enabled) return;

  agentNamesByOwner.set(owner, enabled);
  const key = conversationAppearanceStorageKey(owner);
  if (key) {
    try {
      globalThis.localStorage?.setItem(
        key,
        JSON.stringify({
          version: CONVERSATION_APPEARANCE_VERSION,
          agentNamesInMessages: enabled,
        } satisfies ConversationAppearancePreferenceV2),
      );
    } catch {
      // Persistence is best-effort; the live preference remains authoritative.
    }
  }

  for (const listener of listenersByOwner.get(owner) ?? []) listener();
}

/** Reactively read the current owner's conversation agent-name choice. */
export function useAgentNamesInMessages(ownerPubkey?: string | null): boolean {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeToOwner(ownerPubkey, listener),
    [ownerPubkey],
  );
  const getSnapshot = React.useCallback(
    () => getAgentNamesSnapshot(ownerPubkey),
    [ownerPubkey],
  );

  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_CONVERSATION_APPEARANCE.agentNamesInMessages,
  );
}
