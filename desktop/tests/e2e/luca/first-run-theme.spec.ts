import { expect, test } from "@playwright/test";

import { installMockBridge, seedFirstRunFlag } from "../../helpers/bridge";

/**
 * A brand-new owner always opens in Vitesse Black.
 *
 * The webview keys localStorage by bundle id rather than by data directory, so
 * a fresh profile on a Mac that already had one finds the previous owner's
 * `buzz-theme` sitting in the store and the shipped default never applies.
 * These specs seed exactly that — a store already saying Obsidian, follow-
 * system already on, and a light pre-paint cache to repaint from — then let
 * native's first-run answer decide.
 */

const PREVIOUS_OWNER_THEME = "obsidian";

type ProbeWindow = Window & { __PREPAINT_CLASSES__?: string[] };

/** What a second profile inherits today: someone else's appearance choice. */
async function seedPreviousOwnersAppearance(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript((theme) => {
    window.localStorage.setItem("buzz-theme", theme);
    window.localStorage.setItem("buzz-follow-system", "true");
    // ThemeProvider's pre-paint cache, which `index.html` replays before the
    // bundle loads. A light one, so replaying it is unmistakable.
    window.localStorage.setItem(
      "buzz-theme-cache",
      JSON.stringify({
        version: 2,
        themeName: "crystalline",
        vars: { "--background": "0 0% 100%" },
        isDark: false,
      }),
    );
  }, PREVIOUS_OWNER_THEME);
}

/**
 * Record what the `<head>` seed does to `<html>`, before React can correct it.
 *
 * Init scripts all run before any script the document includes, so an observer
 * installed here sees the inline seed's own `classList.add` as its first
 * record. Without this the assertions could only see the settled end state,
 * which ThemeProvider would have reached anyway — and the whole point of the
 * pre-paint branch is that it costs no frame.
 */
async function capturePrePaintClasses(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const probe = window as ProbeWindow;
    probe.__PREPAINT_CLASSES__ = [];
    // Observed on `document`, not on `documentElement`: an init script runs
    // before the parser has created `<html>`, so there is nothing else to
    // attach to yet.
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target === document.documentElement) {
          probe.__PREPAINT_CLASSES__?.push(document.documentElement.className);
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
  });
}

async function openDoor(page: import("@playwright/test").Page) {
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
}

test("a new owner's door opens in Vitesse Black over the previous owner's stored theme", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPreviousOwnersAppearance(page);
  await installMockBridge(
    page,
    { firstRun: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  // Registered after the bridge so it lands last, standing in for the native
  // init script that runs before the document is parsed.
  await seedFirstRunFlag(page, true);
  await capturePrePaintClasses(page);

  await openDoor(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    "vitesse-black",
  );

  // The pre-paint half of the contract: the very first class the seed wrote
  // was dark. The seeded light cache never reached the root.
  const firstPrePaintClass = await page.evaluate(
    () => (window as ProbeWindow).__PREPAINT_CLASSES__?.[0] ?? null,
  );
  expect(firstPrePaintClass).toContain("dark");
  expect(firstPrePaintClass).not.toContain("light");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const cache = localStorage.getItem("buzz-theme-cache");
        return {
          theme: localStorage.getItem("buzz-theme"),
          followSystem: localStorage.getItem("buzz-follow-system"),
          // Not `null`: the stale entry is dropped before ThemeProvider reads
          // it, and ThemeProvider then writes its own for the theme that
          // actually applied. What matters is whose it is now.
          cachedTheme: cache ? JSON.parse(cache).themeName : null,
          cachedIsDark: cache ? JSON.parse(cache).isDark : null,
        };
      }),
    )
    .toEqual({
      theme: "vitesse-black",
      followSystem: "false",
      cachedTheme: "vitesse-black",
      cachedIsDark: true,
    });

  await testInfo.attach("first-run door in Vitesse Black", {
    body: await page.screenshot({ animations: "allow" }),
    contentType: "image/png",
  });
});

test("a returning owner keeps the theme they chose", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Follow-system is on in the seeded store, so pin the OS scheme: the pair
  // this owner chose resolves to Obsidian itself only in dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await seedPreviousOwnersAppearance(page);
  await installMockBridge(
    page,
    { firstRun: false },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await seedFirstRunFlag(page, false);

  await openDoor(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    PREVIOUS_OWNER_THEME,
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        theme: localStorage.getItem("buzz-theme"),
        followSystem: localStorage.getItem("buzz-follow-system"),
      })),
    )
    .toEqual({ theme: PREVIOUS_OWNER_THEME, followSystem: "true" });

  await testInfo.attach("returning owner keeps Obsidian", {
    body: await page.screenshot({ animations: "allow" }),
    contentType: "image/png",
  });
});

/**
 * The regression the command exists to prevent.
 *
 * The init script's value is baked when the process starts, so a pop-out or a
 * reload later in the same run still receives the launch-time `true` — even
 * after the owner has finished onboarding and chosen a theme. Writing storage
 * on that stale flag would reset the very choice they just made. The global may
 * decide the paint; only the command may decide the write.
 */
test("a stale first-run flag cannot reset a theme chosen during onboarding", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await seedPreviousOwnersAppearance(page);
  // The store says onboarding is finished, so the command answers false...
  await installMockBridge(
    page,
    { firstRun: false },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  // ...while the launch-time global still says true.
  await seedFirstRunFlag(page, true);

  await openDoor(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    PREVIOUS_OWNER_THEME,
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        theme: localStorage.getItem("buzz-theme"),
        followSystem: localStorage.getItem("buzz-follow-system"),
      })),
    )
    .toEqual({ theme: PREVIOUS_OWNER_THEME, followSystem: "true" });
});

/**
 * The init script only reaches a page the window builder saw. A reload, or a
 * webview created later, finds no global and has to ask the command instead —
 * and must reach the same answer.
 */
test("the command answers for a page the init script never reached", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPreviousOwnersAppearance(page);
  await installMockBridge(
    page,
    { firstRun: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  // Deliberately no `seedFirstRunFlag`: the global is absent, as it is on a
  // page that loaded after the window was built.
  await openDoor(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-theme",
    "vitesse-black",
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-follow-system")))
    .toBe("false");
});
