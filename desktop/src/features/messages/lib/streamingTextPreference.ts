import * as React from "react";

import {
  DEFAULT_STREAMING_TEXT_EFFECT,
  STREAMING_TEXT_EFFECTS,
  type StreamingTextEffect,
} from "@/shared/ui/markdownStreamingText";

/**
 * How a streamed reply's words arrive, held per owner beside the other
 * conversation-appearance choices. Device-local, like its neighbours: it
 * describes this machine's screen, not the identity's account.
 */
const STORAGE_PREFIX = "luca.streaming-text.v1";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

const effects = new Map<string, StreamingTextEffect>();
const listeners = new Map<string, Set<() => void>>();

function ownerKey(ownerPubkey?: string | null): string | null {
  const owner = ownerPubkey?.trim().toLowerCase() ?? "";
  return OWNER_PUBKEY_PATTERN.test(owner) ? owner : null;
}

export function streamingTextStorageKey(ownerPubkey: string): string | null {
  const owner = ownerKey(ownerPubkey);
  return owner ? `${STORAGE_PREFIX}:${owner}` : null;
}

function isStreamingTextEffect(value: unknown): value is StreamingTextEffect {
  return STREAMING_TEXT_EFFECTS.includes(value as StreamingTextEffect);
}

function readStored(owner: string): StreamingTextEffect {
  try {
    const raw = globalThis.localStorage?.getItem(`${STORAGE_PREFIX}:${owner}`);
    if (!raw) return DEFAULT_STREAMING_TEXT_EFFECT;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return DEFAULT_STREAMING_TEXT_EFFECT;
    }
    const parsed = value as { version?: unknown; effect?: unknown };
    if (parsed.version !== 1 || !isStreamingTextEffect(parsed.effect)) {
      return DEFAULT_STREAMING_TEXT_EFFECT;
    }
    return parsed.effect;
  } catch {
    return DEFAULT_STREAMING_TEXT_EFFECT;
  }
}

function snapshotFor(ownerPubkey?: string | null): StreamingTextEffect {
  const owner = ownerKey(ownerPubkey);
  if (!owner) return DEFAULT_STREAMING_TEXT_EFFECT;
  const cached = effects.get(owner);
  if (cached) return cached;
  const stored = readStored(owner);
  effects.set(owner, stored);
  return stored;
}

function publish(owner: string, next: StreamingTextEffect) {
  if (effects.get(owner) === next) return;
  effects.set(owner, next);
  for (const listener of listeners.get(owner) ?? []) listener();
}

function subscribe(
  ownerPubkey: string | null | undefined,
  listener: () => void,
) {
  const owner = ownerKey(ownerPubkey);
  if (!owner) return () => {};
  const ownerListeners = listeners.get(owner) ?? new Set<() => void>();
  ownerListeners.add(listener);
  listeners.set(owner, ownerListeners);
  // Detached windows share storage, but not this module's in-memory cache.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== `${STORAGE_PREFIX}:${owner}`)
      return;
    publish(owner, readStored(owner));
  };
  globalThis.window?.addEventListener("storage", onStorage);
  return () => {
    globalThis.window?.removeEventListener("storage", onStorage);
    ownerListeners.delete(listener);
    if (ownerListeners.size === 0) listeners.delete(owner);
  };
}

/** Read the current device-local choice outside React. */
export function getStreamingTextEffect(
  ownerPubkey?: string | null,
): StreamingTextEffect {
  return snapshotFor(ownerPubkey);
}

/** Persist and immediately publish the streaming-text choice. */
export function setStreamingTextEffect(
  ownerPubkey: string | null | undefined,
  effect: StreamingTextEffect,
): void {
  const owner = ownerKey(ownerPubkey);
  if (!owner) return;
  if (snapshotFor(owner) === effect) return;
  try {
    globalThis.localStorage?.setItem(
      `${STORAGE_PREFIX}:${owner}`,
      JSON.stringify({ version: 1, effect }),
    );
  } catch {
    // The live choice still works when device storage is unavailable.
  }
  publish(owner, effect);
}

/** Reactively read the current owner's streaming-text choice. */
export function useStreamingTextEffect(
  ownerPubkey?: string | null,
): StreamingTextEffect {
  const subscribeToOwner = React.useCallback(
    (listener: () => void) => subscribe(ownerPubkey, listener),
    [ownerPubkey],
  );
  const getSnapshot = React.useCallback(
    () => snapshotFor(ownerPubkey),
    [ownerPubkey],
  );
  return React.useSyncExternalStore(
    subscribeToOwner,
    getSnapshot,
    () => DEFAULT_STREAMING_TEXT_EFFECT,
  );
}
