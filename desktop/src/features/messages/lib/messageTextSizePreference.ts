import * as React from "react";

/**
 * How large message copy reads, apart from the ⌘+/− text scale that resizes
 * the whole shell. Device-local and not owner-scoped, like the text scale it
 * pairs with: it describes this machine's screen, and reading it before an
 * identity loads keeps the conversation from resizing after launch.
 *
 * The choice moves one token — `--type-body-size`, the reading step — through
 * a root attribute (see typography.css). Message bodies, the composer and the
 * other reading copy follow it; the rail and the rest of the chrome sit on
 * their own steps and do not.
 */
export const MESSAGE_TEXT_SIZES = ["small", "default", "large"] as const;
export type MessageTextSize = (typeof MESSAGE_TEXT_SIZES)[number];
export const DEFAULT_MESSAGE_TEXT_SIZE: MessageTextSize = "default";

const STORAGE_KEY = "luca.message-text-size.v1";
const ROOT_ATTRIBUTE = "data-message-text";

const listeners = new Set<() => void>();
let current: MessageTextSize | null = null;

function isMessageTextSize(value: unknown): value is MessageTextSize {
  return MESSAGE_TEXT_SIZES.includes(value as MessageTextSize);
}

function readStored(): MessageTextSize {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MESSAGE_TEXT_SIZE;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return DEFAULT_MESSAGE_TEXT_SIZE;
    }
    const parsed = value as { version?: unknown; size?: unknown };
    if (parsed.version !== 1 || !isMessageTextSize(parsed.size)) {
      return DEFAULT_MESSAGE_TEXT_SIZE;
    }
    return parsed.size;
  } catch {
    return DEFAULT_MESSAGE_TEXT_SIZE;
  }
}

function snapshot(): MessageTextSize {
  current ??= readStored();
  return current;
}

function publish(next: MessageTextSize) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyToRoot(size: MessageTextSize) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (size === DEFAULT_MESSAGE_TEXT_SIZE) root.removeAttribute(ROOT_ATTRIBUTE);
  else root.setAttribute(ROOT_ATTRIBUTE, size);
}

/** Read the current device-local choice outside React. */
export function getMessageTextSize(): MessageTextSize {
  return snapshot();
}

/** Persist and immediately publish the message-text choice. */
export function setMessageTextSize(size: MessageTextSize): void {
  if (snapshot() === size) return;
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, size }),
    );
  } catch {
    // The live choice still works when device storage is unavailable.
  }
  publish(size);
}

/** Reactively read the message-text choice. */
export function useMessageTextSize(): MessageTextSize {
  return React.useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_MESSAGE_TEXT_SIZE,
  );
}

/**
 * Keep this window's root attribute in step with the choice. Mounted once per
 * webview shell; detached windows share storage but not this module's cache,
 * so a change made in one reaches the others through the storage event.
 */
export function useMessageTextSizeRoot(): void {
  const size = useMessageTextSize();

  React.useLayoutEffect(() => {
    applyToRoot(size);
  }, [size]);

  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      publish(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
