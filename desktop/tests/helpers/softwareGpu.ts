import type { Page } from "@playwright/test";

/**
 * Headless Chromium here draws WebGL on a software GPU (SwiftShader). The
 * empty-chat film (FirstMessageSurface) then holds the page to a frame or two
 * a second, even under Reduce Motion, where it grows its settled moment a
 * share a frame (measured: 20 s and still not settled). Every click waits on
 * a frame, so a spec about something else in an empty chat runs out of time.
 *
 * Such specs take the app's own path for a Mac without WebGL 2: no film, the
 * plain ground. The film itself is not checked here; it needs a real GPU.
 * Call before the page loads.
 */
export async function withoutWebGL2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === "webgl2") return null;
      return (getContext as (...args: unknown[]) => unknown).call(
        this,
        type,
        ...rest,
      );
    } as typeof getContext;
  });
}
