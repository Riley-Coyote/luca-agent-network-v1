import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-20, Reduce Motion's freeze and the history keys from the composer
 * (docs/luca/rail-system/SHELL_BUILD.md). Under Reduce Motion the first-
 * message film grew its settled moment in one go, thousands of steps queued
 * at once, and the page stopped answering for half a minute; it now grows a
 * share a frame. ⌘[ and ⌘] were dropped whenever focus was in a text field;
 * they now work from the composer, which keeps its own keys. Every
 * measurement runs this build and the base (WP20_BASE_URL) in the same test,
 * so both see the Mac's load alike. Screenshots and measures land in
 * WP20_SHOTS.
 */

const SHOTS = process.env.WP20_SHOTS ?? "test-results/shell-motion-keys";
const BASE_URL = process.env.WP20_BASE_URL ?? "http://127.0.0.1:4300";
/** The settled film's base: a build with WP-16's ground, where the film
 *  takes its ground from the one card (rgb(6, 6, 6) in Black) and not the
 *  floor (rgb(0, 0, 0) on the builds before it, :4300 among them). The
 *  expected picture is re-derived on the finished app (WP-28, Decided 5). */
const FILM_BASE_URL = process.env.WP20_FILM_BASE_URL ?? "http://127.0.0.1:4334";
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const AGENTS = [
  {
    name: "Luca",
    pubkey: "a".repeat(64),
    personaId: "builtin:fizz",
    status: "running",
  },
  { name: "Atlas", pubkey: "b".repeat(64), status: "running" },
] as const;

const BUILDS = [
  { name: "base", origin: BASE_URL },
  { name: "this", origin: "" },
] as const;

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 400_000 });

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A screenshot's hash, and whether it is more than one colour (a shot of
 *  one colour would match anything). Only small canvases are masked. */
async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  const small = page.locator("xpath=//canvas[@width < 400 and @height < 400]");
  const buffer = await page.screenshot({
    animations: "disabled",
    mask: [small],
    path,
  });
  const colours = await page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0, 64, 64);
    const data = context.getImageData(0, 0, 64, 64).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4)
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, buffer.toString("base64"));
  return {
    colours,
    hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    path,
  };
}

/** Pages whose errors are already being written down. */
const listening = new WeakSet<Page>();

/** The page with the mock bridge, the shell on or off, Reduce Motion on or
 *  off, and every WebGL draw counted. Resolves when the page shows. */
async function boot(
  page: Page,
  {
    hash,
    origin,
    reduce = false,
    shell = true,
  }: { hash: string; origin: string; reduce?: boolean; shell?: boolean },
) {
  if (!listening.has(page)) {
    listening.add(page);
    page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.log("BROWSER ERROR", message.text());
    });
  }
  await page.emulateMedia({ reducedMotion: reduce ? "reduce" : null });
  await page.addInitScript(
    ({ key, shell }) => {
      // The blank page between runs has no storage of its own.
      if (location.protocol === "about:") return;
      if (shell) {
        const raw = window.localStorage.getItem(key);
        const overrides = raw
          ? (JSON.parse(raw) as Record<string, boolean>)
          : {};
        overrides["shell-frame"] = true;
        window.localStorage.setItem(key, JSON.stringify(overrides));
      }
      const counted = window as unknown as { __wp20Draws: number[] };
      counted.__wp20Draws = [];
      const prototype = WebGL2RenderingContext.prototype;
      const draw = prototype.drawArrays;
      prototype.drawArrays = function (...args) {
        counted.__wp20Draws.push(performance.now());
        return draw.apply(this, args);
      };
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, shell },
  );
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
  });
  // No query of the page's own, so Back reads the address as the app does.
  await expect(async () => {
    await page.goto(`${origin}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

const draws = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __wp20Draws: number[] }).__wp20Draws.length,
  );

/** Until the page has drawn no WebGL for 1.5 s: the film is still. */
async function untilStill(page: Page) {
  let count = -1;
  for (let i = 0; i < 240; i++) {
    const now = await draws(page);
    if (now === count) return now;
    count = now;
    await page.waitForTimeout(1500);
  }
  return count;
}

const PLACES = {
  chats: { hash: "/", next: "open-agents-view" },
  agents: { hash: "/agents", next: "open-activity-view" },
  activity: { hash: "/pulse", next: "shell-place-conversations" },
} as const;

for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const [place, { hash, next }] of Object.entries(PLACES)) {
    test(`WP-20: the shell answers at once in ${place} at ${width}x${height}, Reduce Motion on and off`, async ({
      browser,
    }) => {
      const results: Record<string, unknown>[] = [];
      for (const build of BUILDS) {
        for (const reduce of [false, true]) {
          const context = await browser.newContext({
            deviceScaleFactor: 2,
            viewport: { width, height },
          });
          const page = await context.newPage();
          await boot(page, { hash, origin: build.origin, reduce });
          const shownAt = Date.now();
          // The conversation's film, where there is one, is up before the
          // first press: the freeze came with it.
          const field = await page
            .locator(".luca-first-message-surface canvas")
            .waitFor({ state: "attached", timeout: 8000 })
            .then(() => true)
            .catch(() => false);
          const pressedAt = Date.now();
          await page.getByTestId(next).first().dispatchEvent("click");
          await expect(
            page.locator(`.luca-place[data-testid="${next}"]`),
          ).toHaveAttribute("data-current", "true", { timeout: 120_000 });
          const answeredAt = Date.now();
          // The worst answer over the next 3 s.
          let worst = 0;
          for (let i = 0; i < 12; i++) {
            const at = Date.now();
            await page.evaluate(() => 1);
            worst = Math.max(worst, Date.now() - at);
            await page.waitForTimeout(250);
          }
          results.push({
            build: build.name,
            field,
            first_interaction_ms: answeredAt - pressedAt,
            shown_to_answer_ms: answeredAt - shownAt,
            reduce,
            worst_answer_next_3s_ms: worst,
          });
          await context.close();
        }
      }
      measure(`responsive-${place}-${width}`, results);
      // Under Reduce Motion this build answers within 1 s, or, when the
      // Mac is too loaded for even motion to manage that, as fast as motion.
      const ours = (reduce: boolean) =>
        results.find((r) => r.build === "this" && r.reduce === reduce)
          ?.first_interaction_ms as number;
      expect(ours(true)).toBeLessThan(Math.max(1000, ours(false) * 1.5));
    });
  }
}

test("WP-20: under Reduce Motion the film settles to the base's moment, and the marks land at once", async ({
  browser,
}) => {
  test.setTimeout(400_000);
  // A fresh window for each look, so no page carries another's scripts.
  const fresh = async () =>
    await browser
      .newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      })
      .then((context) => context.newPage());
  const settled: Record<string, unknown> = {};
  for (const build of [
    { name: "base", origin: FILM_BASE_URL },
    { name: "this", origin: "" },
  ] as const) {
    const page = await fresh();
    await boot(page, { hash: "/", origin: build.origin, reduce: true });
    // The base's film holds the page while it grows: wait it out.
    await page
      .locator(".luca-first-message-surface canvas")
      .waitFor({ state: "attached", timeout: 180_000 });
    const at = Date.now();
    const count = await untilStill(page);
    const still = Date.now() - at;
    const picture = await shot(page, `${build.name}-reduce-settled-film`);
    settled[build.name] = {
      ...picture,
      draws: count,
      origin: build.origin || "this build",
      still_after_ms: still,
    };
    await page.context().close();
  }
  measure("settled", settled);

  // The marks: on the first frame after a pick, the place's mark is on its
  // tile, Reduce Motion on; with it off the same frame is mid-slide.
  const marks: Record<string, unknown> = {};
  for (const reduce of [true, false]) {
    const page = await fresh();
    await boot(page, { hash: "/agents", origin: "", reduce });
    await page.waitForTimeout(1200);
    const offsets = [];
    for (const next of ["open-activity-view", "open-agents-view"]) {
      offsets.push(
        await page.evaluate(async (testId) => {
          const tile = document.querySelector<HTMLElement>(
            `.luca-place[data-testid="${testId}"]`,
          );
          tile?.click();
          await new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          );
          const mark = document.querySelector<HTMLElement>(
            '[data-testid="shell-places-marks"] .luca-mark--place',
          );
          if (!tile || !mark) return null;
          const a = tile.getBoundingClientRect();
          const b = mark.getBoundingClientRect();
          return Math.max(
            Math.abs(a.left - b.left),
            Math.abs(a.top - b.top),
            Math.abs(a.width - b.width),
            Math.abs(a.height - b.height),
          );
        }, next),
      );
      await page.waitForTimeout(900);
    }
    marks[reduce ? "reduce" : "motion"] = offsets;
    await page.context().close();
  }
  measure("settled-and-marks", { marks, settled });
  const ours = settled.this as { colours: number; hash: string };
  const theirs = settled.base as { hash: string };
  expect(ours.colours).toBeGreaterThan(1);
  expect(ours.hash).toBe(theirs.hash);
  for (const offset of marks.reduce as (number | null)[])
    expect(offset).not.toBeNull();
  for (const offset of marks.reduce as number[])
    expect(offset).toBeLessThan(0.6);
});

for (const shell of [true, false]) {
  test(`WP-20: ⌘[ and ⌘] from the composer, ${shell ? "the shell" : "the old layout"}`, async ({
    page,
  }) => {
    const composer = page.locator(
      '[data-testid="message-composer"] [contenteditable="true"]',
    );
    const location = () =>
      page.evaluate(() => ({
        hash: location.hash.split("?")[0],
        index:
          (history.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0,
      }));
    const inComposer = () =>
      page.evaluate(
        () =>
          document.activeElement?.closest(
            '[data-testid="message-composer"]',
          ) !== null,
      );
    /** The key pressed with focus in the composer; where it went. */
    const fromComposer = async (key: string) => {
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.click();
      const focused = await inComposer();
      const before = await location();
      await page.keyboard.press(key);
      await page.waitForTimeout(700);
      return { before, after: await location(), focused };
    };
    // Away from the conversation: the shell's Agents (no composer), or, in
    // the old layout, a second conversation (its Agents adds a second
    // entry of its own as it opens, an older quirk outside this package).
    const away = shell ? "open-agents-view" : "channel-random";
    /** Whether the address comes to `hash` within 3 s. */
    const reached = async (hash: string) => {
      for (let i = 0; i < 12; i++) {
        if ((await location()).hash === hash) return true;
        await page.waitForTimeout(250);
      }
      return false;
    };
    const runs: Record<string, unknown> = {};
    for (const build of BUILDS) {
      await boot(page, {
        hash: `/channels/${GENERAL}`,
        origin: build.origin,
        shell,
      });
      await expect(composer).toBeVisible({ timeout: 20_000 });
      const conversation = await location();
      await page.getByTestId(away).first().click();
      await expect
        .poll(async () => (await location()).hash)
        .not.toBe(conversation.hash);
      await page.waitForTimeout(700);
      const there = await location();
      // Back: from the composer where there is one.
      let firstBack = null;
      if (shell) await page.keyboard.press("Meta+[");
      else firstBack = await fromComposer("Meta+[");
      const run: Record<string, unknown> = {
        first_back: firstBack,
        first_back_worked: await reached(conversation.hash),
      };
      if (run.first_back_worked) {
        await composer.click();
        await page.keyboard.type("draft");
        const forward = await fromComposer("Meta+]");
        run.forward_from_composer = forward;
        run.forward_worked = forward.focused && (await reached(there.hash));
      }
      if (run.forward_worked) {
        // Back to the conversation, and its composer keeps its own keys:
        // ⌘B is still bold.
        if (!shell) await fromComposer("Meta+[");
        else await page.keyboard.press("Meta+[");
        await reached(conversation.hash);
        await composer.click();
        await page.keyboard.press("End");
        await page.keyboard.press("Meta+b");
        await page.keyboard.type("x");
        run.bold = await composer.evaluate(
          (node) => node.querySelector("strong")?.textContent ?? null,
        );
        await page.keyboard.press("Meta+]");
        await reached(there.hash);
        // In the shell, a conversation one step on, for Back from inside
        // its composer; in the old layout this one has a composer.
        if (shell) {
          await page.getByTestId("shell-place-conversations").first().click();
          await page.waitForTimeout(700);
        }
        const back = await fromComposer("Meta+[");
        run.back_from_composer = back;
        run.back_worked =
          back.focused && back.after.index === back.before.index - 1;
      }
      runs[build.name] = run;
    }
    measure(`history-keys-${shell ? "shell" : "old"}`, runs);
    const ours = runs.this as Record<string, unknown>;
    expect(ours.first_back_worked).toBe(true);
    expect(ours.forward_worked).toBe(true);
    expect(ours.back_worked).toBe(true);
    expect(ours.bold).toBe("x");
  });
}

test("WP-20: with the flag off the app is the base's, Reduce Motion on and off", async ({
  page,
}) => {
  const shots: Record<string, Record<string, unknown>> = {};
  for (const [name, hash, reduce] of [
    ["agents", "/agents", false],
    ["activity", "/pulse", false],
    ["general", `/channels/${GENERAL}`, false],
    ["general-reduce", `/channels/${GENERAL}`, true],
    ["new-reduce", "/", true],
  ] as const) {
    shots[name] = {};
    for (const build of BUILDS) {
      await boot(page, { hash, origin: build.origin, reduce, shell: false });
      await page.waitForTimeout(1500);
      shots[name][build.name] = await shot(
        page,
        `flagoff-${name}-${build.name}`,
      );
    }
  }
  measure("flag-off", shots);
  for (const pair of Object.values(shots)) {
    const ours = pair.this as { colours: number; hash: string };
    const theirs = pair.base as { hash: string };
    expect(ours.colours).toBeGreaterThan(1);
    expect(ours.hash).toBe(theirs.hash);
  }
});
