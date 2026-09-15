/**
 * A component that throws on purpose, once, so the crash boundary can be
 * tested against a real React render error rather than a simulated one.
 *
 * Armed only under the mock bridge (`?e2e=mock&crashProbe=1`, or
 * `__BUZZ_E2E__.crashProbe`), and only in a dev or `e2e` build — `DEV` and
 * `MODE` are compile-time constants, so a production bundle keeps nothing but
 * an immediate `return null`.
 *
 * It disarms itself after throwing. That is what makes "Reload this screen"
 * meaningful in the spec: resetting the boundary has to recover the real app,
 * not loop straight back into the same error.
 */

let fired = false;

export function E2eCrashProbe() {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) {
    return null;
  }
  if (fired || typeof window === "undefined") {
    return null;
  }

  const armedByFixture = (
    window as Window & { __BUZZ_E2E__?: { crashProbe?: boolean } }
  ).__BUZZ_E2E__?.crashProbe;
  const armedByUrl =
    new URL(window.location.href).searchParams.get("crashProbe") === "1";
  if (!(armedByFixture || armedByUrl)) {
    return null;
  }

  fired = true;
  throw new Error("E2E crash probe: this render was supposed to fail");
}
