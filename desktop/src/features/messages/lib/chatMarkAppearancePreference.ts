import * as React from "react";

export type ChatMarkStyle = "sphere" | "pixel" | "glyph";

export type ChatMarkAppearance = {
  visible: boolean;
  style: ChatMarkStyle;
};

const STORAGE_PREFIX = "luca.chat-mark-appearance.v1";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_SNAPSHOT = "visible:sphere";
const snapshots = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function ownerKey(ownerPubkey?: string | null): string | null {
  const owner = ownerPubkey?.trim().toLowerCase() ?? "";
  return OWNER_PUBKEY_PATTERN.test(owner) ? owner : null;
}

function storageKey(owner: string) {
  return `${STORAGE_PREFIX}:${owner}`;
}

function decode(snapshot: string): ChatMarkAppearance {
  const [visibility, style] = snapshot.split(":");
  return {
    visible: visibility === "visible",
    style: style === "pixel" || style === "glyph" ? style : "sphere",
  };
}

function readStored(owner: string): string {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(owner));
    if (!raw) return DEFAULT_SNAPSHOT;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return DEFAULT_SNAPSHOT;
    }
    const parsed = value as {
      version?: unknown;
      visible?: unknown;
      style?: unknown;
    };
    if (
      parsed.version !== 1 ||
      typeof parsed.visible !== "boolean" ||
      (parsed.style !== "sphere" &&
        parsed.style !== "pixel" &&
        parsed.style !== "glyph")
    ) {
      return DEFAULT_SNAPSHOT;
    }
    return `${parsed.visible ? "visible" : "hidden"}:${parsed.style}`;
  } catch {
    return DEFAULT_SNAPSHOT;
  }
}

function snapshotFor(ownerPubkey?: string | null): string {
  const owner = ownerKey(ownerPubkey);
  if (!owner) return DEFAULT_SNAPSHOT;
  const cached = snapshots.get(owner);
  if (cached) return cached;
  const stored = readStored(owner);
  snapshots.set(owner, stored);
  return stored;
}

function publish(owner: string, next: string) {
  if (snapshots.get(owner) === next) return;
  snapshots.set(owner, next);
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
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey(owner)) return;
    publish(owner, readStored(owner));
  };
  globalThis.window?.addEventListener("storage", onStorage);
  return () => {
    globalThis.window?.removeEventListener("storage", onStorage);
    ownerListeners.delete(listener);
    if (ownerListeners.size === 0) listeners.delete(owner);
  };
}

export function setChatMarkAppearance(
  ownerPubkey: string | null | undefined,
  change: Partial<ChatMarkAppearance>,
) {
  const owner = ownerKey(ownerPubkey);
  if (!owner) return;
  const current = decode(snapshotFor(owner));
  const next = { ...current, ...change };
  const encoded = `${next.visible ? "visible" : "hidden"}:${next.style}`;
  if (encoded === snapshotFor(owner)) return;
  try {
    globalThis.localStorage?.setItem(
      storageKey(owner),
      JSON.stringify({ version: 1, ...next }),
    );
  } catch {
    // The live choice still works when device storage is unavailable.
  }
  publish(owner, encoded);
}

export function useChatMarkAppearance(
  ownerPubkey?: string | null,
): ChatMarkAppearance {
  const subscribeToOwner = React.useCallback(
    (listener: () => void) => subscribe(ownerPubkey, listener),
    [ownerPubkey],
  );
  const getSnapshot = React.useCallback(
    () => snapshotFor(ownerPubkey),
    [ownerPubkey],
  );
  const snapshot = React.useSyncExternalStore(
    subscribeToOwner,
    getSnapshot,
    () => DEFAULT_SNAPSHOT,
  );
  return React.useMemo(() => decode(snapshot), [snapshot]);
}
