import * as React from "react";

/**
 * The classic layout (docs/luca/BETA14_RELEASE.md, WP-31): for one release,
 * where the shell is on by default (a build made with
 * `VITE_LUCA_SHELL_FRAME=1`), Settings → Appearance → "Classic layout" turns
 * it off and keeps it off. Read only there (`resolveShellFrameEnabled`).
 * `index.html`'s pre-paint script reads the same key.
 */
export const CLASSIC_LAYOUT_KEY = "polyphonic-classic-layout";
const CHANGED_EVENT = "polyphonic:classic-layout-changed";

export function readClassicLayout(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  try {
    return storage?.getItem(CLASSIC_LAYOUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setClassicLayout(on: boolean) {
  try {
    if (on) globalThis.localStorage?.setItem(CLASSIC_LAYOUT_KEY, "1");
    else globalThis.localStorage?.removeItem(CLASSIC_LAYOUT_KEY);
  } catch {
    // Storage refused: nothing to switch to or remember.
  }
  globalThis.dispatchEvent?.(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CLASSIC_LAYOUT_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive: whether the classic layout is chosen. */
export function useClassicLayout(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => readClassicLayout(),
    () => false,
  );
}
