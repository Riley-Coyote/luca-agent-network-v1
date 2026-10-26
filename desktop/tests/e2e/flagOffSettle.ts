import type { Page } from "@playwright/test";

/**
 * The flag-off rail's glass pill (`RailGlass.tsx`) glides to the selected
 * row on its own animation frames, which no CSS animation reports. On the
 * page's installed clock those frames can stall part way (measured: a pill
 * caught as a thin line, still for 400 ms), so the clock is run on two
 * seconds, which plays every frame due, and the pill must then hold still
 * for two polls: both builds are photographed at rest (WP-21, 3).
 */
export async function railGlassAtRest(page: Page) {
  await page.clock.runFor(2_000);
  await page.waitForFunction(
    () => {
      const win = window as Window & {
        __wp21RailGlass?: { at: string; still: number };
      };
      const at = [...document.querySelectorAll(".luca-rail-glass")]
        .map((pill) => {
          const box = pill.getBoundingClientRect();
          return [
            box.x,
            box.y,
            box.width,
            box.height,
            getComputedStyle(pill).opacity,
          ].join(",");
        })
        .join("|");
      const before = win.__wp21RailGlass;
      const still = before?.at === at ? before.still + 1 : 0;
      win.__wp21RailGlass = { at, still };
      return still >= 2;
    },
    undefined,
    { polling: 200, timeout: 15_000 },
  );
}
