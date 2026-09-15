/**
 * A brand-new owner always opens in Vitesse Black.
 *
 * The app already ships Vitesse Black as {@link DEFAULT_THEME_NAME} with
 * follow-system off, and a genuinely empty store does open in it. The leak is
 * that the store is rarely empty: the webview keys localStorage by bundle id,
 * not by data directory, so a fresh `BUZZ_DESKTOP_DATA_DIR` — or a reinstall,
 * or a second profile on a Mac that already had one — inherits whatever theme
 * the previous owner last chose. The defaults never get a chance to apply.
 *
 * Native knows what storage cannot: whether any owner has completed onboarding
 * on this machine. It hands that fact to the webview two ways —
 * `window.__BUZZ_FIRST_RUN__`, set by an init script before the document is
 * parsed (early enough for the pre-paint seed in `index.html`), and the
 * `is_first_run` command, which reads the store fresh. The global decides what
 * gets painted; the command decides what gets written, and
 * {@link resetThemeForFirstRun} explains why the two are not interchangeable.
 *
 * Only the three appearance keys are touched. Everything else in the store is
 * owner-scoped or harmless, and clearing it wholesale would take onboarding
 * state and drafts with it. Once the owner finishes onboarding the answer goes
 * false and their later choices persist exactly as they do today.
 */

import { invokeTauri } from "@/shared/api/tauri";

import {
  DEFAULT_THEME_NAME,
  FOLLOW_SYSTEM_KEY,
  THEME_CACHE_KEY,
  THEME_STORAGE_KEY,
} from "./theme-loader";

/**
 * The init-script global, as native leaves it.
 *
 * `index.html` and `src-tauri/src/first_run.rs` spell `__BUZZ_FIRST_RUN__` out
 * as well — the inline seed runs before any module and can import nothing — so
 * the three have to be renamed together.
 */
type FirstRunWindow = Window & {
  __BUZZ_FIRST_RUN__?: unknown;
};

/** The native runtime, or the mock bridge standing in for it. */
function hasTauriBridge(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * The flag as the init script left it, or `undefined` when no init script ran
 * — an ordinary browser build, or a page the window builder never saw.
 */
function readFirstRunGlobal(): boolean | undefined {
  const seeded = (window as FirstRunWindow).__BUZZ_FIRST_RUN__;
  return typeof seeded === "boolean" ? seeded : undefined;
}

/** Put the appearance keys back to what the product ships with. */
function restoreShippedAppearance(): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME_NAME);
  window.localStorage.setItem(FOLLOW_SYSTEM_KEY, "false");
  // The cache is the pre-paint seed's fast path. Left behind it would repaint
  // the old owner's background for a frame before the reset above lands.
  window.localStorage.removeItem(THEME_CACHE_KEY);
}

/**
 * Restore the shipped appearance when native confirms this is a first run.
 *
 * The global alone is not enough to write storage on, because it is baked once
 * when the process starts and never updated: a page that loads later in the
 * same run — a pop-out window, a reload — still receives the value from launch.
 * Acting on that stale `true` would reset the theme an owner had just chosen
 * during onboarding, which is the one outcome this whole module exists to
 * prevent.
 *
 * What makes a cheap answer possible is that the underlying fact only moves one
 * way. "Any owner has completed onboarding" goes false → true and never back,
 * so first-run goes true → false and never back. A `false` global can therefore
 * be trusted outright — nothing could have made it true since — while a `true`
 * one is only a hint, and gets confirmed against the store by command before a
 * single key is written.
 *
 * Silent no-op everywhere the question does not apply: the browser build and
 * any page without a bridge, a returning owner, and a native half too old to
 * answer.
 */
export async function resetThemeForFirstRun(): Promise<void> {
  if (!hasTauriBridge()) {
    return;
  }

  // Monotonic, so never stale in the direction that matters — and this is the
  // common case, which keeps an ordinary boot free of an extra round trip.
  if (readFirstRunGlobal() === false) {
    return;
  }

  let firstRun: boolean;
  try {
    firstRun = await invokeTauri<boolean>("is_first_run");
  } catch {
    // An unanswerable question is not a yes. Leaving the owner's stored choice
    // alone is the safe half of this trade — the worst case is the old bug,
    // not a theme reset landing on someone who already chose one.
    return;
  }

  if (!firstRun) {
    return;
  }

  restoreShippedAppearance();
}
