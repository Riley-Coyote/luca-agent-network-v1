import * as React from "react";

import {
  CONVERSATION_APPEARANCE_VERSION,
  DEFAULT_CONVERSATION_APPEARANCE,
  type ConversationAppearancePreferenceV1,
} from "@/features/messages/conversationAppearanceTypes";

const STORAGE_PREFIX = "luca.conversation-appearance.v1";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

const residentMarksByOwner = new Map<string, boolean>();
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
): ConversationAppearancePreferenceV1 {
  if (!rawValue) return DEFAULT_CONVERSATION_APPEARANCE;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !==
        CONVERSATION_APPEARANCE_VERSION ||
      typeof (parsed as { residentMarksInMessages?: unknown })
        .residentMarksInMessages !== "boolean"
    ) {
      return DEFAULT_CONVERSATION_APPEARANCE;
    }
    return {
      version: CONVERSATION_APPEARANCE_VERSION,
      residentMarksInMessages: (parsed as { residentMarksInMessages: boolean })
        .residentMarksInMessages,
    };
  } catch {
    return DEFAULT_CONVERSATION_APPEARANCE;
  }
}

function readStoredResidentMarks(owner: string): boolean {
  const key = conversationAppearanceStorageKey(owner);
  if (!key) return DEFAULT_CONVERSATION_APPEARANCE.residentMarksInMessages;
  try {
    return parsePreference(globalThis.localStorage?.getItem(key))
      .residentMarksInMessages;
  } catch {
    return DEFAULT_CONVERSATION_APPEARANCE.residentMarksInMessages;
  }
}

function getResidentMarksSnapshot(ownerPubkey?: string | null): boolean {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  if (!owner) return DEFAULT_CONVERSATION_APPEARANCE.residentMarksInMessages;
  const existing = residentMarksByOwner.get(owner);
  if (existing !== undefined) return existing;
  const stored = readStoredResidentMarks(owner);
  residentMarksByOwner.set(owner, stored);
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
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(owner);
  };
}

/** Read the current device-local preference outside React. */
export function getResidentMarksInMessages(
  ownerPubkey?: string | null,
): boolean {
  return getResidentMarksSnapshot(ownerPubkey);
}

/** Persist and immediately publish the resident-mark preference. */
export function setResidentMarksInMessages(
  ownerPubkey: string | null | undefined,
  enabled: boolean,
): void {
  const owner = normalizedOwnerPubkey(ownerPubkey);
  if (!owner) return;
  if (getResidentMarksSnapshot(owner) === enabled) return;

  residentMarksByOwner.set(owner, enabled);
  const key = conversationAppearanceStorageKey(owner);
  if (key) {
    try {
      globalThis.localStorage?.setItem(
        key,
        JSON.stringify({
          version: CONVERSATION_APPEARANCE_VERSION,
          residentMarksInMessages: enabled,
        } satisfies ConversationAppearancePreferenceV1),
      );
    } catch {
      // Persistence is best-effort; the live preference remains authoritative.
    }
  }

  for (const listener of listenersByOwner.get(owner) ?? []) listener();
}

/** Reactively read the current owner's conversation identity-mark choice. */
export function useResidentMarksInMessages(
  ownerPubkey?: string | null,
): boolean {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeToOwner(ownerPubkey, listener),
    [ownerPubkey],
  );
  const getSnapshot = React.useCallback(
    () => getResidentMarksSnapshot(ownerPubkey),
    [ownerPubkey],
  );

  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_CONVERSATION_APPEARANCE.residentMarksInMessages,
  );
}
