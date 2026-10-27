import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The classic layout, for beta.14 only (docs/luca/BETA14_RELEASE.md, WP-31).
 *
 * CLASSIC_BETA_URL: an e2e build made with the beta's default, the shell on
 * (`VITE_LUCA_SHELL_FRAME=1`; default http://127.0.0.1:4343); unreachable,
 * the switch's checks are skipped. The default e2e build (this run's
 * baseURL) must never offer the row, and its flag-off views must match the
 * base build at SHELL_BASE_URL by hash. SHELL_SHOTS: where shots go.
 */

const BETA_URL = process.env.CLASSIC_BETA_URL ?? "http://127.0.0.1:4343";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const CLASSIC_KEY = "polyphonic-classic-layout";
const APPEARANCE = "/#/settings?section=appearance";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "beta14-classic-layout")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const reachable = (url: string) =>
  fetch(url)
    .then((response) => response.ok)
    .catch(() => false);

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
}

/** Loads a route. A busy static server can drop a burst of chunk requests
 *  and leave the app unbooted: load again. */
async function boot(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(url);
    const booted = await page
      .locator(
        "[data-luca-conversation-surface], [data-testid='settings-view']",
      )
      .first()
      .waitFor({ state: "attached", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (booted) return;
  }
}

async function newApp(
  browser: Browser,
  size: { width: number; height: number },
  frameOverride?: boolean,
) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
  const page = await context.newPage();
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("buzz-theme")) {
      localStorage.setItem("buzz-theme", "vitesse-black");
    }
  });
  await installMockBridge(page);
  if (frameOverride !== undefined) {
    await page.addInitScript(
      ({ key, on }) => {
        let overrides: Record<string, boolean> = {};
        try {
          overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
        } catch {
          overrides = {};
        }
        overrides["shell-frame"] = on;
        localStorage.setItem(key, JSON.stringify(overrides));
      },
      { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frameOverride },
    );
  }
  return { context, page };
}

/** What the page says about the layout, measured. */
async function layoutState(page: Page) {
  return page.evaluate((key) => {
    const root = document.documentElement;
    const toggle = document.querySelector(
      "[data-testid='appearance-classic-layout-toggle']",
    );
    const row = document.querySelector(
      "[data-testid='appearance-classic-layout']",
    );
    const box = row?.getBoundingClientRect();
    return {
      frame: root.getAttribute("data-luca-frame"),
      stored: localStorage.getItem(key),
      checked: toggle?.getAttribute("aria-checked") ?? null,
      row: box
        ? {
            x: Math.round(box.x),
            y: Math.round(box.y),
            w: Math.round(box.width),
            h: Math.round(box.height),
          }
        : null,
      dark: root.classList.contains("dark"),
    };
  }, CLASSIC_KEY);
}

async function openAppearance(page: Page, origin: string) {
  await boot(page, `${origin}${APPEARANCE}`);
  await expect(page.getByTestId("settings-panel-appearance")).toBeVisible({
    timeout: 60_000,
  });
}

test("the switch, both ways, remembered, in both layouts", async ({
  browser,
}, info) => {
  test.setTimeout(600_000);
  test.skip(!(await reachable(BETA_URL)), `beta build not at ${BETA_URL}`);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
  const roundTrips: string[] = [];
  const errors: string[] = [];

  for (const [sizeName, size] of [
    ["1440x900", { width: 1440, height: 900 }],
    ["800x500", { width: 800, height: 500 }],
  ] as const) {
    for (const scheme of ["dark", "light"] as const) {
      const run = `${sizeName}-${scheme}`;
      const { context, page } = await newApp(browser, size);
      page.on("console", (message) => {
        if (message.type() === "error")
          errors.push(`${run}: ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`${run}: ${error.message}`));
      await openAppearance(page, BETA_URL);
      if (scheme === "light") {
        await page.getByTestId("appearance-mode-light").click();
        await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      }
      const row = page.getByTestId("appearance-classic-layout");
      const toggle = page.getByTestId("appearance-classic-layout-toggle");
      const states: Record<string, unknown> = {};

      // 1. The beta opens in the shell, the row off.
      await expect(page.locator("html")).toHaveAttribute(
        "data-luca-frame",
        "solid",
      );
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await row.scrollIntoViewIfNeeded();
      await settle(page);
      states.shell = await layoutState(page);
      files.push(path.join(dir, `${run}-1-shell.png`));
      await page.screenshot({ path: files.at(-1) });

      // 2. On: the shell goes at once, the choice is kept, the row stays.
      await toggle.click();
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-luca-frame",
        /.*/,
      );
      await expect(page.getByTestId("settings-panel-appearance")).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await row.scrollIntoViewIfNeeded();
      await settle(page);
      states.classic = await layoutState(page);
      files.push(path.join(dir, `${run}-2-classic.png`));
      await page.screenshot({ path: files.at(-1) });

      // 3. Remembered across a reload, from the first paint: the
      // pre-paint script paints the classic floor (the palette's
      // background), not the shell's (its floor at night, recess by day).
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const norm = (value: string | undefined) => {
            if (!value) return null;
            const probe = document.createElement("div");
            probe.style.backgroundColor = `hsl(${value})`;
            return probe.style.backgroundColor;
          };
          let vars: Record<string, string> = {};
          let isDark = true;
          try {
            const cache = JSON.parse(
              localStorage.getItem("buzz-theme-cache") ?? "{}",
            );
            vars = cache.vars ?? {};
            isDark = cache.isDark !== false;
          } catch {
            vars = {};
          }
          (window as unknown as { __firstPaint?: unknown }).__firstPaint = {
            painted: document.documentElement.style.backgroundColor,
            shellFloor: norm(vars[isDark ? "--mn-floor" : "--mn-recess"]),
            classicFloor: norm(vars["--background"]),
          };
        });
      });
      const firstPaint = () =>
        page.evaluate(
          () =>
            (window as unknown as { __firstPaint?: unknown }).__firstPaint ??
            null,
        );
      await page.reload();
      await expect(page.getByTestId("settings-panel-appearance")).toBeVisible({
        timeout: 60_000,
      });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await settle(page);
      states.classicReloaded = {
        ...(await layoutState(page)),
        firstPaint: await firstPaint(),
      };

      // 4. Off: the shell comes back at once; the choice is forgotten.
      await toggle.click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-luca-frame",
        "solid",
      );
      await expect(page.getByTestId("settings-panel-appearance")).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await row.scrollIntoViewIfNeeded();
      await settle(page);
      states.shellAgain = await layoutState(page);
      const again = path.join(dir, `${run}-3-shell-again.png`);
      await page.screenshot({ path: again });
      states.shellAgainShotMatchesFirst =
        sha(again) === sha(files.at(-2) ?? "");
      roundTrips.push(again);

      // 5. And that is remembered too.
      await page.reload();
      await expect(page.getByTestId("settings-panel-appearance")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-luca-frame",
        "solid",
      );
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await settle(page);
      states.shellReloaded = {
        ...(await layoutState(page)),
        firstPaint: await firstPaint(),
      };
      checks[run] = states;
      await context.close();
    }
  }

  // The distinct states (the shell, the classic layout) each look their
  // own; the round trip's shots are kept beside them.
  const hashes = files.map(sha);
  writeFileSync(
    path.join(dir, "checks-switch.json"),
    `${JSON.stringify(
      {
        checks,
        files: [...files, ...roundTrips],
        unique_hashes: new Set(hashes).size === hashes.length,
        errors,
      },
      null,
      2,
    )}\n`,
  );
  expect(new Set(hashes).size).toBe(hashes.length);
  expect(errors).toEqual([]);
  for (const [run, states] of Object.entries(checks)) {
    type Paint = {
      painted: string;
      shellFloor: string | null;
      classicFloor: string | null;
    };
    const s = states as Record<
      string,
      {
        frame: string | null;
        stored: string | null;
        checked: string | null;
        firstPaint?: Paint;
        row: unknown;
      }
    >;
    expect(s.shell.frame, run).toBe("solid");
    expect(s.classic.frame, run).toBeNull();
    expect(s.classic.stored, run).toBe("1");
    expect(s.classicReloaded.frame, run).toBeNull();
    expect(s.classicReloaded.checked, run).toBe("true");
    // The classic branch of the pre-paint script: the palette's own
    // background (none in the cache, so the page's static floor), never the
    // shell's floor.
    expect(s.classicReloaded.firstPaint?.painted, run).toBe(
      s.classicReloaded.firstPaint?.classicFloor ?? "",
    );
    expect(s.classicReloaded.firstPaint?.painted, run).not.toBe(
      s.classicReloaded.firstPaint?.shellFloor,
    );
    expect(s.shellAgain.frame, run).toBe("solid");
    expect(s.shellAgain.stored, run).toBeNull();
    expect(s.shellReloaded.frame, run).toBe("solid");
    expect(s.shellReloaded.firstPaint?.painted, run).toBe(
      s.shellReloaded.firstPaint?.shellFloor,
    );
    for (const key of [
      "shell",
      "classic",
      "classicReloaded",
      "shellAgain",
      "shellReloaded",
    ]) {
      expect(s[key].row, `${run} ${key}`).not.toBeNull();
    }
    // Back in the shell the row sits where it first did.
    expect(s.shellReloaded.row, run).toEqual(s.shell.row);
  }
});

test("where the shell is off by default, the row is never offered", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const origin = info.project.use.baseURL ?? "";
  const out: Record<string, unknown> = {};
  for (const frame of [false, true]) {
    const { context, page } = await newApp(
      browser,
      { width: 1440, height: 900 },
      frame,
    );
    // Even a stored classic choice is not read there.
    await page.addInitScript(
      (key) => localStorage.setItem(key, "1"),
      CLASSIC_KEY,
    );
    await openAppearance(page, origin);
    await settle(page);
    out[frame ? "previewOn" : "previewOff"] = await layoutState(page);
    await expect(page.getByTestId("appearance-classic-layout")).toHaveCount(0);
    const state = await layoutState(page);
    expect(state.frame).toBe(frame ? "solid" : null);
    expect(state.stored).toBe("1");
    await context.close();
  }
  writeFileSync(
    path.join(shotsDir(info.outputPath()), "checks-not-offered.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(600_000);
  const dir = shotsDir(info.outputPath());
  const baseReachable = await reachable(BASE_URL);
  const views = [
    ["appearance-1440x900", APPEARANCE, { width: 1440, height: 900 }],
    ["appearance-800x500", APPEARANCE, { width: 800, height: 500 }],
    ["home-1440x900", "/#/", { width: 1440, height: 900 }],
  ] as const;

  const capture = async (origin: string, label: string) => {
    const out: Record<string, string> = {};
    for (const [name, route, size] of views) {
      for (let take = 0; take < 4; take += 1) {
        const { context, page } = await newApp(browser, size);
        let dropped = 0;
        page.on("requestfailed", () => {
          dropped += 1;
        });
        try {
          await boot(page, `${origin}${route}`);
          await expect(
            page
              .locator(
                route === APPEARANCE
                  ? "[data-testid='settings-panel-appearance']"
                  : "[data-luca-conversation-surface]",
              )
              .first(),
          ).toBeVisible({ timeout: 60_000 });
          await page.mouse.move(size.width - 1, size.height - 1);
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(800);
          await settle(page);
          const file = path.join(dir, `flag-off-${name}${label}.png`);
          await page.screenshot({ path: file });
          out[name] = file;
        } catch (error) {
          if (take === 3) throw error;
          dropped += 1;
        }
        await context.close();
        if (dropped === 0) break;
      }
    }
    return out;
  };

  const ours = await capture(info.project.use.baseURL ?? "", "");
  const base = baseReachable ? await capture(BASE_URL, "-base") : null;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    result[key] = {
      ours: sha(ours[key]),
      base: base ? sha(base[key]) : "not run",
      identical: base ? sha(ours[key]) === sha(base[key]) : "not run",
    };
  }
  writeFileSync(
    path.join(dir, "checks-flag-off.json"),
    `${JSON.stringify(
      {
        flag_off_identical: result,
        distinct_views: new Set(Object.values(ours).map(sha)).size,
        files: [...Object.values(ours), ...Object.values(base ?? {})],
      },
      null,
      2,
    )}\n`,
  );
  test.skip(!baseReachable, `base build not reachable at ${BASE_URL}`);
  expect(new Set(Object.values(ours).map(sha)).size).toBe(views.length);
  for (const key of Object.keys(ours)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});
