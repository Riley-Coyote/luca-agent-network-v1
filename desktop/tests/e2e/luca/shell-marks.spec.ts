import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { chooseRailAgents } from "../../helpers/railAgents";

/**
 * WP-03, where you are: the solid marks (docs/luca/rail-system/
 * SHELL_BUILD.md). The places' mark and the rail's mark under the
 * `shell-frame` flag, measured against the shell study and SHELL_SPEC.md's
 * "Where you are"; today's pill and native pour retired under the flag; the
 * flag off identical to the base build by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks-marks.json go (else
 * test-results/shell-marks). SHELL_STUDY_URL: the study, built and served
 * (default http://127.0.0.1:4333/scripts/shell-lab.template.html); when it
 * is unreachable the comparison with it is reported as not run.
 * SHELL_BASE_URL: the base build for the flag-off hashes (default
 * http://127.0.0.1:4300).
 */

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-marks")
  : undefined;

const SHOTS = SHELL_SHOTS ?? "test-results/shell-marks";
const STUDY_URL =
  process.env.SHELL_STUDY_URL ??
  "http://127.0.0.1:4333/scripts/shell-lab.template.html";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
/** The mock's #general. */
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const CODEX = "d".repeat(64);

const ROOM = {
  landing: "0e6a0000-0000-4000-8000-000000000001",
  chapter: "0e6a0000-0000-4000-8000-000000000002",
  hero: "0e6a0000-0000-4000-8000-000000000003",
  monday: "0e6a0000-0000-4000-8000-000000000004",
  tides: "0e6a0000-0000-4000-8000-000000000005",
  review: "0e6a0000-0000-4000-8000-000000000006",
  palette: "0e6a0000-0000-4000-8000-000000000007",
  weekly: "0e6a0000-0000-4000-8000-000000000008",
};

const PLACES_MARK = '[data-testid="shell-places-marks"] > .luca-mark';
const RAIL_MARK = '[data-testid="shell-rail-marks"] > .luca-mark';
const RAIL_CARD = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';
const RAIL_SCROLL = '[data-testid="app-sidebar"] [data-sidebar="content"]';

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };
type Sample = { t: number; marks: Box[] };

const checks: Record<string, unknown> = {};

/** Each check holds `ok`; a failing one fails its test, softly. */
function verdict(...keys: string[]) {
  for (const key of keys) {
    const value = checks[key] as { ok?: boolean } | undefined;
    expect.soft(value?.ok, key).toBe(true);
  }
}
const files: string[] = [];

function shotsDir() {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await settle(page);
  const file = path.join(shotsDir(), `${name}.png`);
  await page.screenshot({ path: file, clip });
  files.push(file);
  return file;
}

async function boot(
  page: Page,
  {
    shell = true,
    size = { width: 1440, height: 900 },
    nativeGlass = false,
  }: {
    shell?: boolean;
    size?: { width: number; height: number };
    nativeGlass?: boolean;
  } = {},
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.clock.install();
  if (nativeGlass) {
    // A native test build announces Apple's glass and takes the page's
    // reports on a message handler; here every report is only counted.
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      const host = window as unknown as Record<string, unknown>;
      host.__POUR_CALLS__ = calls;
      host.__POLYPHONIC_NATIVE_GLASS__ = 1;
      host.webkit = {
        messageHandlers: {
          polyphonicGlass: { postMessage: (m: unknown) => calls.push(m) },
        },
      };
    });
  }
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
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: shell },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
      { name: "Wren", pubkey: WREN, status: "running" },
      { name: "Codex", pubkey: CODEX, status: "running" },
    ],
  });
  await chooseRailAgents(page);
  // Boot on a conversation, so the rail is Chats' (/pulse is Activity's
  // place now: NAVIGATION.md). Alice's 1:1 stays in the scene; the bare
  // /#/ route keeps Back clean.
  await page.goto("/#/channels/f48efb06-0c93-5025-aac9-2e646bb6bfa8");
  // Generous: on a busy machine the first boot can take a while.
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
  await seedScene(page);
  if (shell) {
    await expect(page.locator('[data-testid="rail-home-luca"]')).toBeVisible({
      timeout: 20_000,
    });
  }
}

/** The study's scene (as the rail's spec seeds it): Luca, agents with
 *  sessions, projects with rooms, rooms (Fleets retired). */
async function seedScene(page: Page) {
  await page.evaluate(
    async ({ ids, luca, atlas, wren }) => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!invoke || !emit) throw new Error("Expected the mock bridge.");
      const owner = "deadbeef".repeat(8);
      const rows = (await invoke("get_channels")) as Array<{
        id: string;
        name: string;
        is_member: boolean;
      }>;
      for (const row of rows) {
        if (!row.is_member || row.name === "alice-tyler") continue;
        window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
          channelId: row.id,
          removeMemberPubkey: owner,
        });
      }
      const now = Math.floor(Date.now() / 1000);
      let minutes = 400;
      const say = (channelId: string, pubkey: string, content: string) => {
        minutes -= 7;
        emit({ channelId, content, createdAt: now - minutes * 60, pubkey });
      };
      const pinned = async (uuid: string, run: () => Promise<unknown>) => {
        const real = crypto.randomUUID.bind(crypto);
        let spent = false;
        Object.defineProperty(crypto, "randomUUID", {
          configurable: true,
          writable: true,
          value: () => {
            if (spent) return real();
            spent = true;
            return uuid;
          },
        });
        try {
          return await run();
        } finally {
          Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            writable: true,
            value: real,
          });
        }
      };
      const room = async (id: string, name: string, members: string[]) => {
        await pinned(id, () =>
          invoke("create_channel", {
            channelType: "stream",
            description: "",
            name,
            visibility: "private",
          }),
        );
        await invoke("add_channel_members", {
          channelId: id,
          pubkeys: members,
          role: "bot",
        });
        say(id, owner, `${name}: first notes.`);
      };
      const dm = async (pubkeys: string[], text: string) => {
        const channel = (await invoke("open_dm", { pubkeys })) as {
          id: string;
        };
        say(channel.id, owner, text);
        return channel.id;
      };

      await room(ids.landing, "Landing page copy", [wren]);
      await room(ids.chapter, "Chapter nine", [atlas]);
      await room(ids.review, "Design review", [atlas, wren]);
      await room(ids.palette, "Palette", [atlas, wren]);
      await room(ids.weekly, "Weekly review", [luca]);
      await dm([atlas], "The release notes are drafted.");
      await room(ids.monday, "Monday plan", [wren]);
      await room(ids.tides, "The tide tables", [wren]);
      await dm([wren], "Morning. The tide tables are in.");
      await dm([luca, wren], "Wren and I looked at the plan.");
      await room(ids.hero, "Hero image", [atlas]);
      await dm([luca], "Morning. Three things came in overnight.");
      say(ids.hero, atlas, "A new hero image is ready.");

      const community = (
        JSON.parse(window.localStorage.getItem("buzz-communities") ?? "[]") as {
          pubkey: string;
          relayUrl: string;
        }[]
      )[0];
      if (!community) throw new Error("Expected the seeded community.");
      const scope = (value: string) =>
        encodeURIComponent(value.trim().toLowerCase());
      window.localStorage.setItem(
        `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
        JSON.stringify({
          version: 1,
          projects: [
            { id: "tidepool", label: "Tidepool" },
            { id: "studio-site", label: "Studio site" },
            { id: "field-guide", label: "Field guide" },
          ],
          assignments: {
            [ids.landing]: "tidepool",
            [ids.chapter]: "tidepool",
            [ids.hero]: "studio-site",
          },
        }),
      );
      window.dispatchEvent(new Event("luca:room-projects-changed"));
      await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
    },
    { ids: ROOM, luca: LUCA, atlas: ATLAS, wren: WREN },
  );
}

const homeHit = (id: string) =>
  `[data-testid="rail-home-${id}"] [data-rail-focus="home"]`;

/** Six seconds of the marks' frames at once: every mark has landed and
 *  its light dried. */
async function marksAtRest(page: Page) {
  await pauseClock(page);
  await page.clock.runFor(6000);
  await page.clock.resume();
  const wet = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".luca-mark")].map((el) =>
      el.style.getPropertyValue("--wet"),
    ),
  );
  expect(wet.every((value) => value === "0.000" || value === "")).toBe(true);
}

/** The marks drawn on a layer now (visible ones only). */
async function marksOf(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate(
    (s) =>
      [...document.querySelectorAll<HTMLElement>(s)]
        .filter((el) => getComputedStyle(el).visibility === "visible")
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    selector,
  );
}

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

async function styleOf(page: Page, selector: string) {
  return page.evaluate((s) => {
    const el = [...document.querySelectorAll<HTMLElement>(s)].find(
      (each) => getComputedStyle(each).visibility === "visible",
    );
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      radius: cs.borderTopLeftRadius,
      background: cs.backgroundColor,
      shadow: cs.boxShadow,
      layer: el.parentElement?.getAttribute("data-mark-material") ?? null,
      aria: el.getAttribute("aria-hidden"),
    };
  }, selector);
}

/** The page's clock, paused, then stepped 1/60 s at a time: the marks' own
 *  frames, whatever the machine's load (a busy machine draws a headless page
 *  at a handful of frames a second, and the engine never steps more than
 *  1/30 s a frame). */
const FRAME = 1000 / 60;

async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1500);
}

async function readMarks(page: Page, marks: string) {
  return page.evaluate(
    (s) =>
      [...document.querySelectorAll<HTMLElement>(s)]
        .filter((el) => el.style.visibility === "visible")
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    marks,
  );
}

/** Press `click` (a selector) and note the layer's marks every frame. */
async function trace(
  page: Page,
  { click, marks, ms }: { click: string | null; marks: string; ms: number },
): Promise<Sample[]> {
  await pauseClock(page);
  if (click) {
    await page.evaluate(
      (s) => (document.querySelector(s) as HTMLElement).click(),
      click,
    );
  }
  const samples: Sample[] = [];
  for (let frame = 0; frame * FRAME <= ms; frame += 1) {
    await page.clock.runFor(FRAME);
    samples.push({
      t: (frame + 1) * FRAME,
      marks: await readMarks(page, marks),
    });
  }
  await page.clock.resume();
  return samples;
}

/** A slide's shape: how far the mark stretched along the move, when it
 *  landed, and whether every frame after landing sat on whole device
 *  pixels and held still. */
function motionOf(samples: Sample[], rest: Box, to: Box) {
  const boxes = samples.map((sample) => sample.marks[0]).filter(Boolean);
  const along = (b: Box) => (Math.abs(to.y - rest.y) > 1 ? b.h : b.w);
  const restSize = along(to);
  const maxStretch = Math.max(...boxes.map(along)) - restSize;
  const same = (a: Box, b: Box) =>
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01;
  const landedAt = samples.findIndex(
    (sample, index) =>
      sample.marks.length === 1 &&
      samples.slice(index).every((later) => same(later.marks[0] ?? rest, to)),
  );
  const tail = landedAt >= 0 ? samples.slice(landedAt) : [];
  const whole = (value: number) =>
    Number.isInteger(Math.round(value * 2e3) / 1e3);
  return {
    frames: samples.length,
    moving_frames: boxes.filter((b) => !same(b, rest) && !same(b, to)).length,
    max_stretch: Math.round(maxStretch * 100) / 100,
    landed_ms: landedAt >= 0 ? Math.round(samples[landedAt].t) : null,
    rests_on_whole_pixels:
      tail.length > 0 &&
      tail.every(({ marks }) =>
        marks.every((b) => [b.x, b.y, b.w, b.h].every(whole)),
      ),
    settled_box: landedAt >= 0 ? samples[landedAt].marks[0] : null,
  };
}

/** Mean RGB of a 3 x 3 device-pixel patch at each point (CSS points). */
async function colours(page: Page, points: [number, number][]) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      return points.map(([x, y]) => {
        const d = context.getImageData(
          Math.round(x * scale) - 1,
          Math.round(y * scale) - 1,
          3,
          3,
        ).data;
        const mean = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          mean[0] += d[i] / 9;
          mean[1] += d[i + 1] / 9;
          mean[2] += d[i + 2] / 9;
        }
        return mean.map((v) => Math.round(v));
      });
    },
    { b64: png.toString("base64"), points },
  );
}

const close = (a: number[] | undefined, b: number[] | undefined, by = 2) =>
  !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= by);

/** The study's marks, measured the same way (Black, dark). */
async function studyMarks(browser: Browser) {
  const reachable = await fetch(STUDY_URL)
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable) return null;
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${STUDY_URL}?experience=shell&mode=dark&frame=solid`);
  await page.waitForSelector(".shell-mark--place", {
    state: "attached",
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  await page.mouse.move(1400, 880);
  await settle(page);
  const place = (await marksOf(page, ".shell-marks > .shell-mark"))[0];
  const row = (await marksOf(page, ".shell-rail-marks > .shell-mark"))[0];
  const placeStyle = await styleOf(page, ".shell-marks > .shell-mark");
  const rowStyle = await styleOf(page, ".shell-rail-marks > .shell-mark");
  const pixels = await colours(page, [
    [place.x + 3, place.y + 14],
    [row.x + row.w - 50, row.y + 15],
  ]);
  await shot(page, "study-marks", { x: 0, y: 0, width: 300, height: 320 });
  // The study's own motion, for the same moves.
  const placeTrace = await trace(page, {
    click: '[data-place="library"]',
    marks: ".shell-marks > .shell-mark",
    ms: 1200,
  });
  const library = (await marksOf(page, ".shell-marks > .shell-mark"))[0];
  await page.click('[data-place="conversations"]');
  await pauseClock(page);
  await page.clock.runFor(6000);
  await page.clock.resume();
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("[data-rail-row]")].map((el) =>
      el.getAttribute("data-home"),
    ),
  );
  const far = rows.at(-1);
  const railTrace = await trace(page, {
    click: `[data-rail-row][data-home="${far}"] [data-rail-focus="home"]`,
    marks: ".shell-rail-marks > .shell-mark",
    ms: 1200,
  });
  const farRow = (await marksOf(page, ".shell-rail-marks > .shell-mark"))[0];
  await context.close();
  return {
    place,
    row,
    placeStyle,
    rowStyle,
    pixels,
    placeMotion: motionOf(placeTrace, place, library),
    railMotion: motionOf(railTrace, row, farRow),
  };
}

let study: Awaited<ReturnType<typeof studyMarks>> = null;

test.describe("the solid marks, under the frame", () => {
  test("places-mark and rail-mark, against the study", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    study = await studyMarks(browser);
    await boot(page);
    await page.click(homeHit("luca"));
    await expect(
      page.locator('[data-testid="rail-home-luca"]'),
    ).toHaveAttribute("data-active", "true");
    await page.mouse.move(1400, 880);
    await marksAtRest(page);

    const tile = await box(page, '[data-testid="shell-place-conversations"]');
    const row = await box(page, '[data-testid="rail-home-luca"]');
    const placeMarks = await marksOf(page, PLACES_MARK);
    const railMarks = await marksOf(page, RAIL_MARK);
    const placeStyle = await styleOf(page, PLACES_MARK);
    const railStyle = await styleOf(page, RAIL_MARK);
    const place = placeMarks[0];
    const rail = railMarks[0];
    const pixels =
      place && rail
        ? await colours(page, [
            [place.x + 3, place.y + 14],
            [rail.x + rail.w - 50, rail.y + 15],
          ])
        : [];
    const sameBox = (a?: Box | null, b?: Box | null) =>
      !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    checks.places_mark = {
      mark: place ?? null,
      tile,
      study: study?.place ?? "study not reachable: not compared",
      style: placeStyle,
      study_style: study?.placeStyle ?? null,
      pixel: pixels[0] ?? null,
      study_pixel: study?.pixels[0] ?? null,
      ok:
        placeMarks.length === 1 &&
        sameBox(place, tile) &&
        placeStyle?.radius === "9px" &&
        placeStyle.layer === "plate" &&
        placeStyle.aria === "true" &&
        (!study ||
          (sameBox(place, study.place) &&
            placeStyle.background === study.placeStyle?.background &&
            placeStyle.shadow === study.placeStyle?.shadow &&
            close(pixels[0], study.pixels[0]))),
    };
    checks.rail_mark = {
      mark: rail ?? null,
      row,
      study: study?.row ?? "study not reachable: not compared",
      // The first row sits 6 below the card's top, as in the study (the
      // list's own padding, inside the scroll), so the mark's box is the
      // study's, top included.
      row_top_vs_study: study ? (row?.y ?? 0) - study.row.y : null,
      style: railStyle,
      study_style: study?.rowStyle ?? null,
      pixel: pixels[1] ?? null,
      study_pixel: study?.pixels[1] ?? null,
      ok:
        railMarks.length === 1 &&
        sameBox(rail, row) &&
        railStyle?.radius === "8px" &&
        railStyle.layer === "plate" &&
        (!study ||
          (rail.x === study.row.x &&
            rail.y === study.row.y &&
            rail.w === study.row.w &&
            rail.h === study.row.h &&
            railStyle.background === study.rowStyle?.background &&
            railStyle.shadow === study.rowStyle?.shadow &&
            close(pixels[1], study.pixels[1]))),
    };
    await shot(page, "places-mark", { x: 0, y: 0, width: 300, height: 320 });
    await shot(page, "rail-mark");

    // The minimum window, 800 x 500: the same marks, the same measures.
    await page.setViewportSize({ width: 800, height: 500 });
    await page.waitForTimeout(600);
    const smallTile = await box(
      page,
      '[data-testid="shell-place-conversations"]',
    );
    const smallRow = await box(page, '[data-testid="rail-home-luca"]');
    const smallPlace = (await marksOf(page, PLACES_MARK))[0];
    const smallRail = (await marksOf(page, RAIL_MARK))[0];
    checks.marks_800x500 = {
      place: smallPlace ?? null,
      rail: smallRail ?? null,
      ok: sameBox(smallPlace, smallTile) && sameBox(smallRail, smallRow),
    };
    await shot(page, "marks-800x500");
    verdict("places_mark", "rail_mark", "marks_800x500");
  });

  test("motion trace: between places, and between homes far apart", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.click(homeHit("luca"));
    await page.mouse.move(1400, 880);
    await marksAtRest(page);

    // Places: Chats to Library, three tiles down: the farthest move inside
    // the column's middle group (NAVIGATION.md's six places; Brain left).
    await page.hover('[data-testid="open-artifacts-view"]');
    await page.mouse.move(1400, 880);
    await page.waitForTimeout(400);
    const placeFrom = (await marksOf(page, PLACES_MARK))[0];
    const placeTrace = await trace(page, {
      click: '[data-testid="open-artifacts-view"]',
      marks: PLACES_MARK,
      ms: 1200,
    });
    const libraryTile = await box(page, '[data-testid="open-artifacts-view"]');
    const places = motionOf(placeTrace, placeFrom, libraryTile as Box);

    // The rail: Luca, at the top, to the last home, at the bottom.
    await page.click('[data-testid="shell-place-conversations"]');
    await page.waitForTimeout(400);
    await page.click(homeHit("luca"));
    await page.mouse.move(1400, 880);
    await marksAtRest(page);
    const lastHome = await page.evaluate(() =>
      [...document.querySelectorAll("[data-shell-rail] [data-home]")]
        .at(-1)
        ?.getAttribute("data-home"),
    );
    const railFrom = (await marksOf(page, RAIL_MARK))[0];
    const railTrace = await trace(page, {
      click: homeHit(lastHome ?? ""),
      marks: RAIL_MARK,
      ms: 1200,
    });
    const farRow = await box(page, `[data-testid="rail-home-${lastHome}"]`);
    const rail = motionOf(railTrace, railFrom, farRow as Box);

    const studyPlaces = study?.placeMotion ?? null;
    const studyRail = study?.railMotion ?? null;
    const like = (ours: typeof places, theirs: typeof places | null) =>
      !theirs ||
      (ours.max_stretch > 0.5 * theirs.max_stretch &&
        ours.max_stretch < 1.6 * theirs.max_stretch + 4);
    checks.motion_trace = {
      places: { ...places, from: placeFrom, to: libraryTile },
      rail: { ...rail, from: railFrom, to: farRow, home: lastHome },
      study_places: studyPlaces ?? "study not reachable: not compared",
      study_rail: studyRail ?? "study not reachable: not compared",
      ok:
        places.moving_frames >= 8 &&
        places.max_stretch > 4 &&
        places.landed_ms !== null &&
        places.landed_ms < 1000 &&
        rail.moving_frames >= 8 &&
        rail.max_stretch > 20 &&
        rail.landed_ms !== null &&
        rail.landed_ms < 1100 &&
        like(places, studyPlaces) &&
        like(rail, studyRail),
    };
    checks.whole_pixels = {
      places: places.rests_on_whole_pixels,
      rail: rail.rests_on_whole_pixels,
      places_box: places.settled_box,
      rail_box: rail.settled_box,
      ok: places.rests_on_whole_pixels && rail.rests_on_whole_pixels,
    };
    writeFileSync(
      path.join(shotsDir(), "motion-trace.json"),
      JSON.stringify({ placeTrace, railTrace }, null, 1),
    );
    await shot(page, "motion-landed");
    verdict("motion_trace", "whole_pixels");
  });

  test("rail-closing: closes to a point, and swells back", async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.click(homeHit("luca"));
    await page.mouse.move(1400, 880);
    await marksAtRest(page);
    const open = (await marksOf(page, RAIL_MARK))[0];
    const closing = await trace(page, {
      click: '[data-testid="shell-lip-toggle"]',
      marks: RAIL_MARK,
      ms: 800,
    });
    await page.mouse.move(1400, 880);
    const afterClose = await marksOf(page, RAIL_MARK);
    const layerChildren = await page.evaluate(
      (s) => document.querySelectorAll(s).length,
      RAIL_MARK,
    );
    await shot(page, "rail-closed");
    const middle = open
      ? { x: open.x + open.w / 2, y: open.y + open.h / 2 }
      : { x: 0, y: 0 };
    const shrinking = closing
      .map((s) => s.marks[0])
      .filter((b): b is Box => !!b);
    const centred = shrinking.every(
      (b) =>
        Math.abs(b.x + b.w / 2 - middle.x) < 0.6 &&
        Math.abs(b.y + b.h / 2 - middle.y) < 0.6,
    );
    const narrowing = shrinking.every(
      (b, i) => i === 0 || b.w <= shrinking[i - 1].w + 0.01,
    );

    const opening = await trace(page, {
      click: '[data-testid="shell-lip-toggle"]',
      marks: RAIL_MARK,
      ms: 1400,
    });
    await page.mouse.move(1400, 880);
    const firstShown = opening.find((s) => s.marks.length > 0);
    const swelling = opening
      .map((s) => s.marks[0])
      .filter((b): b is Box => !!b);
    const back = (await marksOf(page, RAIL_MARK))[0];
    await shot(page, "rail-reopened");
    checks.rail_closing = {
      open_box: open ?? null,
      closing_frames_drawn: shrinking.length,
      closing_widths: shrinking.map((b) => Math.round(b.w * 10) / 10),
      closed_to_middle: centred,
      only_narrows: narrowing,
      marks_after_close: afterClose.length,
      pieces_left_on_layer: layerChildren,
      reopen_first_shown_ms: firstShown ? Math.round(firstShown.t) : null,
      reopen_first_box: firstShown?.marks[0] ?? null,
      reopen_widths: swelling
        .slice(0, 12)
        .map((b) => Math.round(b.w * 10) / 10),
      back_box: back ?? null,
      ok:
        !!open &&
        shrinking.length >= 3 &&
        centred &&
        narrowing &&
        afterClose.length === 0 &&
        layerChildren === 0 &&
        !!firstShown &&
        firstShown.t >= 430 &&
        (firstShown.marks[0]?.w ?? 999) < open.w * 0.6 &&
        Math.abs(
          (firstShown.marks[0]?.x ?? 0) +
            (firstShown.marks[0]?.w ?? 0) / 2 -
            middle.x,
        ) < 0.6 &&
        !!back &&
        back.x === open.x &&
        back.y === open.y &&
        back.w === open.w &&
        back.h === open.h,
    };
    verdict("rail_closing");
  });

  test("reduce-motion: every mark is simply where it belongs", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.click(homeHit("luca"));
    await page.mouse.move(1400, 880);
    await marksAtRest(page);
    await page.hover('[data-testid="open-artifacts-view"]');
    await page.mouse.move(1400, 880);
    await page.waitForTimeout(300);
    const placeTrace = await trace(page, {
      click: '[data-testid="open-artifacts-view"]',
      marks: PLACES_MARK,
      ms: 400,
    });
    const libraryTile = await box(page, '[data-testid="open-artifacts-view"]');
    const placeShapes = new Set(
      placeTrace
        .map((s) => s.marks[0])
        .filter(Boolean)
        .map((b) => JSON.stringify(b)),
    );
    const placeAt = placeTrace.at(-1)?.marks[0];

    await page.click('[data-testid="shell-place-conversations"]');
    await marksAtRest(page);
    await page.click(homeHit("luca"));
    await marksAtRest(page);
    const lastHome = await page.evaluate(() =>
      [...document.querySelectorAll("[data-shell-rail] [data-home]")]
        .at(-1)
        ?.getAttribute("data-home"),
    );
    const railTrace = await trace(page, {
      click: homeHit(lastHome ?? ""),
      marks: RAIL_MARK,
      ms: 400,
    });
    const farRow = await box(page, `[data-testid="rail-home-${lastHome}"]`);
    const railShapes = new Set(
      railTrace
        .map((s) => s.marks[0])
        .filter(Boolean)
        .map((b) => JSON.stringify(b)),
    );
    const closing = await trace(page, {
      click: '[data-testid="shell-lip-toggle"]',
      marks: RAIL_MARK,
      ms: 200,
    });
    const opening = await trace(page, {
      click: '[data-testid="shell-lip-toggle"]',
      marks: RAIL_MARK,
      ms: 300,
    });
    const reopenedAt = opening.find((s) => s.marks.length > 0);
    await page.mouse.move(1400, 880);
    await shot(page, "reduce-motion");
    const sameBox = (a?: Box | null, b?: Box | null) =>
      !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    checks.reduce_motion = {
      places_distinct_boxes: placeShapes.size,
      places_final: placeAt ?? null,
      rail_distinct_boxes: railShapes.size,
      closed_frames_with_a_mark: closing.slice(2).filter((s) => s.marks.length)
        .length,
      reopened_ms: reopenedAt ? Math.round(reopenedAt.t) : null,
      reopened_box: reopenedAt?.marks[0] ?? null,
      ok:
        placeShapes.size <= 2 &&
        sameBox(placeAt, libraryTile) &&
        railShapes.size <= 2 &&
        sameBox(railTrace.at(-1)?.marks[0], farRow) &&
        closing.slice(2).every((s) => s.marks.length === 0) &&
        !!reopenedAt &&
        reopenedAt.t < 120 &&
        sameBox(reopenedAt.marks[0], farRow),
    };
    verdict("reduce_motion");
  });

  test("scrolled: the rail's mark scrolls with its row, clipped by the card", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page, { size: { width: 800, height: 500 } });
    await page.evaluate((s) => {
      (document.querySelector(s) as HTMLElement).click();
    }, homeHit("luca"));
    // Every home's sessions open, so the rows run well past the card.
    await page.evaluate(() => {
      for (const chevron of document.querySelectorAll<HTMLElement>(
        '[data-shell-rail] [data-chevron][aria-expanded="false"]',
      )) {
        chevron.click();
      }
    });
    await page.mouse.move(790, 490);
    await marksAtRest(page);
    const scroller = await box(page, RAIL_SCROLL);
    const card = await box(page, RAIL_CARD);
    const rowSel = '[data-testid="rail-home-luca"]';
    // Luca's row scrolled up past the card's top edge: 18 of its 30
    // under the edge, 12 still showing.
    const scrolled = await page.evaluate(
      ({ rowSel, cardSel, scrollSel }) => {
        const row = document.querySelector(rowSel) as HTMLElement;
        const card = document.querySelector(cardSel) as HTMLElement;
        const scroll = document.querySelector(scrollSel) as HTMLElement;
        const r = row.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        scroll.scrollTop += r.top - c.top + 18;
        return {
          scroll_top: scroll.scrollTop,
          range: scroll.scrollHeight - scroll.clientHeight,
        };
      },
      { rowSel, cardSel: RAIL_CARD, scrollSel: RAIL_SCROLL },
    );
    await marksAtRest(page);
    const row = await box(page, rowSel);
    const mark = (await marksOf(page, RAIL_MARK))[0];
    const moved =
      !!row &&
      !!mark &&
      mark.x === row.x &&
      Math.abs(mark.y - row.y) < 0.01 &&
      mark.w === row.w &&
      mark.h === row.h;
    let clip: Record<string, unknown> = { ok: false };
    if (row && scroller && card && mark) {
      // The card clips, not a line inside it: the scrolling area begins
      // at the card's own top, and the plate runs right up under its lit
      // edge (35.5), as in the study.
      const edge = card.y;
      const x = row.x + row.w - 40;
      const [under1, under3, under5, inside, past, beside] = await colours(
        page,
        [
          [x, edge + 1],
          [x, edge + 3],
          [x, edge + 5],
          [x, edge + 9],
          [x, edge - 3],
          [row.x - 3, edge - 3],
        ],
      );
      const grey = (c?: number[]) => (c ? (c[0] + c[1] + c[2]) / 3 : 0);
      const band = [under1, under3, under5].map(grey);
      clip = {
        card_top: edge,
        scroller_top: scroller.y,
        mark_top: mark.y,
        plate_under_the_edge: [under1, under3, under5],
        inside_mark: inside,
        mark_past_the_edge: past,
        card_past_the_edge: beside,
        ok:
          scroller.y === edge &&
          mark.y < edge - 8 &&
          // The plate (grey 21-27 on this card) shows from just under
          // the card's lit top: no empty band of bare card.
          band.every((g) => g >= 20) &&
          grey(inside) >= 20 &&
          // Past the card's edge none of it shows, only what is above
          // the card (its lit top and grain vary by a few).
          Math.abs(grey(past) - grey(beside)) <= 5,
      };
    }
    await shot(page, "scrolled", { x: 0, y: 0, width: 280, height: 500 });
    checks.scroll_clip = {
      ...scrolled,
      card,
      row,
      mark: mark ?? null,
      mark_moves_with_row: moved,
      clip,
      ok: moved && (clip as { ok: boolean }).ok,
    };
    verdict("scroll_clip");
  });

  test("session-open: the home row marked, the session lit, no second mark", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    const wren = `agent:${WREN}`;
    // Homes start open (WP-11); open Wren's only if it was closed.
    const chevron = page.locator(
      `[data-testid="rail-home-${wren}"] [data-chevron]`,
    );
    if ((await chevron.getAttribute("data-expanded")) === "false")
      await chevron.click();
    const session = page.getByTestId(`rail-session-${ROOM.monday}`);
    await expect(session).toBeVisible();
    await session.click();
    await expect(session).toHaveAttribute("data-current", "true");
    await expect(session).toHaveAttribute("aria-current", "page");
    await page.mouse.move(1400, 880);
    await marksAtRest(page);
    const homeRow = await box(page, `[data-testid="rail-home-${wren}"]`);
    const marks = await marksOf(page, RAIL_MARK);
    const look = await page.evaluate((id) => {
      const el = document.querySelector(
        `[data-testid="rail-session-${id}"]`,
      ) as HTMLElement;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const ink = getComputedStyle(document.documentElement)
        .getPropertyValue("--mn-ink")
        .trim();
      // The open row brightens its words and nothing else (WP-34,
      // Decided 4): its stretch of the thread is the thread's own.
      const other = document.querySelector(
        "[data-shell-rail] .luca-rail-session:not([data-current]):not(.luca-rail-session-more)",
      );
      return {
        colour: cs.color,
        background: cs.backgroundColor,
        thread: before.borderLeftColor,
        restThread: other
          ? getComputedStyle(other, "::before").borderLeftColor
          : null,
        ink,
        active_rows: document.querySelectorAll(
          '[data-shell-rail] [data-active="true"]',
        ).length,
        pill: document.querySelectorAll(".luca-rail-glass").length,
      };
    }, ROOM.monday);
    const sessionBox = await box(
      page,
      `[data-testid="rail-session-${ROOM.monday}"]`,
    );
    const [onSession] = sessionBox
      ? await colours(page, [
          // Clear of the title and of the time at the row's end (WP-11).
          [sessionBox.x + sessionBox.w - 40, sessionBox.y + 14],
        ])
      : [[0, 0, 0]];
    const [beside] = sessionBox
      ? await colours(page, [
          [sessionBox.x + sessionBox.w - 40, sessionBox.y + 40],
        ])
      : [[0, 0, 0]];
    await shot(page, "session-open");
    checks.session_lit_not_marked = {
      marks: marks.length,
      mark: marks[0] ?? null,
      home_row: homeRow,
      session: look,
      session_pixel: onSession,
      below_pixel: beside,
      ok:
        marks.length === 1 &&
        !!homeRow &&
        marks[0].y === homeRow.y &&
        marks[0].h === homeRow.h &&
        look.active_rows === 1 &&
        look.pill === 0 &&
        look.background === "rgba(0, 0, 0, 0)" &&
        look.thread === look.restThread &&
        look.colour !== look.thread &&
        close(onSession, beside, 3),
    };
    verdict("session_lit_not_marked");
  });

  test("pill and native pour retired under the flag", async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, { nativeGlass: true });
    await page.click(homeHit("luca"));
    await page.waitForTimeout(400);
    await page.click(homeHit(`agent:${WREN}`));
    await page.waitForTimeout(400);
    await page.click('[data-testid="shell-lip-toggle"]');
    await page.waitForTimeout(600);
    await page.click('[data-testid="shell-lip-toggle"]');
    await page.waitForTimeout(800);
    await page.evaluate((s) => {
      const scroll = document.querySelector(s) as HTMLElement;
      scroll.scrollTop = 60;
    }, RAIL_SCROLL);
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const host = window as unknown as {
        __POUR_CALLS__?: unknown[];
        __BUZZ_E2E_COMMANDS__?: string[];
      };
      return {
        pour_calls: host.__POUR_CALLS__?.length ?? -1,
        glass_commands: (host.__BUZZ_E2E_COMMANDS__ ?? []).filter((c) =>
          /glass|vibrancy/i.test(c),
        ),
        pills: document.querySelectorAll(".luca-rail-glass").length,
        native_root: document.documentElement.getAttribute(
          "data-luca-native-glass",
        ),
        marks_layer: document.querySelectorAll(
          '[data-testid="shell-rail-marks"]',
        ).length,
      };
    });
    checks.pill_retired = {
      pills: state.pills,
      marks_layer: state.marks_layer,
      ok: state.pills === 0 && state.marks_layer === 1,
    };
    checks.native_pour_calls = state.pour_calls;
    checks.native_pour = {
      ...state,
      ok:
        state.pour_calls === 0 &&
        state.glass_commands.length === 0 &&
        state.native_root === null,
    };
    verdict("pill_retired", "native_pour");
  });
});

// WP-32: Apple's glass belongs to the shell. Flag off (the classic layout),
// today's web pill still draws and the native pour never attaches.
test("flag off: today's pill draws, the native pour stays out", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page, { shell: false, nativeGlass: true });
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    pour_calls:
      (window as unknown as { __POUR_CALLS__?: unknown[] }).__POUR_CALLS__
        ?.length ?? -1,
    pills: document.querySelectorAll(".luca-rail-glass").length,
    marks: document.querySelectorAll(".luca-marks").length,
  }));
  checks.flag_off_control = {
    ...state,
    ok: state.pour_calls === 0 && state.pills >= 1 && state.marks === 0,
  };
  verdict("flag_off_control");
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable) {
    checks.flag_off_identical = `not run: base build not reachable at ${BASE_URL}`;
    test.skip(true, `base build not reachable at ${BASE_URL}`);
  }
  const capture = async (origin: string, label: string) => {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await installMockBridge(page);
    await chooseRailAgents(page);
    await page.addInitScript(
      ({ key }) => {
        let overrides: Record<string, boolean> = {};
        try {
          overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
        } catch {
          overrides = {};
        }
        overrides["shell-frame"] = false;
        localStorage.setItem(key, JSON.stringify(overrides));
      },
      { key: FEATURE_OVERRIDES_STORAGE_KEY },
    );
    // Opened by its route on both builds: on a busy machine the base
    // sometimes lands on another page first, where #general has no row id.
    // The base, under load, now and then boots onto Library instead: one
    // more go at the route, as the brief asks before calling anything broken.
    const card = page.locator(
      '[data-testid="conversation-workspace-grid"] [data-luca-card]',
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(`${origin}/?e2e=mock#/channels/${GENERAL_CHANNEL_ID}`);
      const shown = await card
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (shown) break;
      await page.goto("about:blank");
    }
    await expect(card).toBeVisible();
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(600);
    const shots: Record<string, string> = {};
    const take = async (name: string) => {
      await settle(page);
      const file = path.join(shotsDir(), `flag-off-${name}${label}.png`);
      await page.screenshot({ path: file });
      shots[name] = file;
    };
    await take("conversation");
    await page.evaluate(() => {
      location.hash = "#/pulse";
    });
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(1200);
    await take("activity");
    await page.getByTestId("open-artifacts-view").click();
    await expect(page.getByTestId("artifact-library-screen")).toBeVisible({
      timeout: 20_000,
    });
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(600);
    await take("library");
    await context.close();
    return shots;
  };
  const ours = await capture(info.project.use.baseURL ?? "", "");
  const base = await capture(BASE_URL, "-base");
  const result: Record<string, unknown> = {};
  let identical = true;
  for (const key of Object.keys(ours)) {
    const same = sha(ours[key]) === sha(base[key]);
    identical &&= same;
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: same,
    };
    files.push(ours[key]);
  }
  checks.flag_off_identical = { ...result, ok: identical };
  verdict("flag_off_identical");
});

test.afterAll(() => {
  const hashes = files.map((f) => ({ file: f, sha256: sha(f) }));
  const ours = hashes.filter((h) => !h.file.includes("-base"));
  checks.screenshots = hashes;
  checks.unique_hashes =
    new Set(ours.map((h) => h.sha256)).size === ours.length;
  writeFileSync(
    path.join(shotsDir(), "checks-marks.json"),
    JSON.stringify(checks, null, 2),
  );
});
