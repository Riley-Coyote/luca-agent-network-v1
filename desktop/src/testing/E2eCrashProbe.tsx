/**
 * A component that throws on purpose, so the crash boundary can be tested
 * against a real React render error rather than a simulated one.
 *
 * Armed only under the mock bridge (`?crashProbe=1`, or `__BUZZ_E2E__
 * .crashProbe`), and only in a dev or `e2e` build — `DEV` and `MODE` are
 * compile-time constants, so a production bundle keeps nothing but an
 * immediate `return null`.
 *
 * It throws on **every** render until a spec disarms it through
 * `window.__BUZZ_E2E_DISARM_CRASH_PROBE__()`. That is not fussiness: React 19
 * retries a failed concurrent render synchronously before handing the error to
 * a boundary, so a probe that fires once lets the retry succeed and the error
 * is downgraded to a recoverable one — the boundary never latches, and the
 * spec sees a perfectly healthy app. Disarming explicitly is what makes
 * "Reload this screen" recover into the real app instead of the same error.
 */

declare global {
  interface Window {
    __BUZZ_E2E_DISARM_CRASH_PROBE__?: () => void;
  }
}

let armed: boolean | null = null;

function isArmed(): boolean {
  if (armed === null) {
    const fixture = (
      window as Window & { __BUZZ_E2E__?: { crashProbe?: boolean } }
    ).__BUZZ_E2E__?.crashProbe;
    const fromUrl =
      new URL(window.location.href).searchParams.get("crashProbe") === "1";
    armed = fixture === true || fromUrl;
    window.__BUZZ_E2E_DISARM_CRASH_PROBE__ = () => {
      armed = false;
    };
  }
  return armed;
}

export function E2eCrashProbe() {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) {
    return null;
  }
  if (typeof window === "undefined" || !isArmed()) {
    return null;
  }
  throw new Error("E2E crash probe: this render was supposed to fail");
}
