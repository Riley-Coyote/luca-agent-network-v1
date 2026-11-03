import * as React from "react";

const CHANGE = "polyphonic-agent-chat-picture";
const KEY = /^[0-9a-f]{64}$/;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const pictures = new Map<string, string | null>();

/** Chat-only picture, scoped to the owner and resident on this device. */
export function agentChatPictureKey(
  owner?: string | null,
  resident?: string | null,
) {
  const o = owner?.trim().toLowerCase() ?? "";
  const r = resident?.trim().toLowerCase() ?? "";
  return KEY.test(o) && KEY.test(r)
    ? `polyphonic.chat-picture.v1:${o}:${r}`
    : null;
}

export function readAgentChatPicture(key: string | null): string | null {
  if (!key) return null;
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value && value.length <= 350_000 && IMAGE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist only a small, locally decoded raster image; never a remote URL. */
export function saveAgentChatPicture(key: string, image: string | null) {
  if (image && (image.length > 350_000 || !IMAGE.test(image))) {
    throw new Error("Choose a smaller PNG, JPG, or WebP picture.");
  }
  if (image) globalThis.localStorage.setItem(key, image);
  else globalThis.localStorage.removeItem(key);
  pictures.set(key, image);
  globalThis.window?.dispatchEvent(new Event(CHANGE));
}

export function useAgentChatPicture(
  owner?: string | null,
  resident?: string | null,
) {
  const key = agentChatPictureKey(owner, resident);
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const storage = (event: StorageEvent) => {
        if (event.key === null || event.key === key) {
          if (key) pictures.delete(key);
          notify();
        }
      };
      window.addEventListener(CHANGE, notify);
      window.addEventListener("storage", storage);
      return () => {
        window.removeEventListener(CHANGE, notify);
        window.removeEventListener("storage", storage);
      };
    },
    [key],
  );
  const snapshot = React.useCallback(() => {
    if (!key) return null;
    if (!pictures.has(key)) pictures.set(key, readAgentChatPicture(key));
    return pictures.get(key) ?? null;
  }, [key]);
  return React.useSyncExternalStore(subscribe, snapshot, () => null);
}
