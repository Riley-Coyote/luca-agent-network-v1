import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-08g, the window's corners and the frame's edges (docs/luca/rail-system/
 * SHELL_BUILD.md): the companion's halo and its badge, the Canvas in focus,
 * the content's drift between places, the loading gates and the boot paint,
 * the lip without native lights and in full screen, and the marks' three
 * small items; the flag off identical to the base build by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks-edges.json go (else
 * test-results/shell-edges). SHELL_BASE_URL: the base build (default
 * http://127.0.0.1:4300), for the flag-off hashes.
 */

const SHOTS = process.env.SHELL_SHOTS ?? "test-results/shell-edges";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const LUCA = TEST_IDENTITIES.bob.pubkey;
const LUCA_AGENT = {
  name: "Luca",
  pubkey: "a".repeat(64),
  personaId: "builtin:fizz",
  status: "running" as const,
};
const PLACES_MARK = '[data-testid="shell-places-marks"] > .luca-mark';
const CONVERSATION_SURFACE = "[data-buzz-content-surface]";

test.use({ deviceScaleFactor: 2 });

type Box = { x: number; y: number; w: number; h: number };

/** The checks and the screenshots, kept on disk as each test ends, so a
 *  failing test (which restarts the worker) loses none of the others'.
 *  Delete checks-edges.json before a full run. */
const checks: Record<string, unknown> = {};
const files: string[] = [];

const checksFile = () => path.join(shotsDir(), "checks-edges.json");

function saved(): { checks: Record<string, unknown>; files: string[] } {
  try {
    const read = JSON.parse(readFileSync(checksFile(), "utf8"));
    return { checks: read.checks ?? {}, files: read.files ?? [] };
  } catch {
    return { checks: {}, files: [] };
  }
}

/** Each check holds `ok`; a failing one fails its test, softly. */
function verdict(...keys: string[]) {
  const kept = saved();
  const merged = { ...kept.checks, ...checks };
  const allFiles = [...new Set([...kept.files, ...files])];
  const hashes = allFiles.map((file) => sha(file));
  merged.unique_hashes = new Set(hashes).size === hashes.length;
  writeFileSync(
    checksFile(),
    `${JSON.stringify({ checks: merged, files: allFiles }, null, 2)}\n`,
  );
  for (const key of keys) {
    const value = checks[key] as { ok?: boolean } | undefined;
    expect.soft(value?.ok, key).toBe(true);
  }
}

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
  options: {
    clip?: { x: number; y: number; width: number; height: number };
    omitBackground?: boolean;
    keep?: boolean;
  } = {},
) {
  await settle(page);
  const file = path.join(shotsDir(), `${name}.png`);
  await page.screenshot({
    clip: options.clip,
    omitBackground: options.omitBackground,
    path: file,
  });
  if (options.keep !== false) files.push(file);
  return file;
}

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

type OpenOptions = {
  frame?: boolean;
  light?: boolean;
  size?: { width: number; height: number };
  route?: string;
  origin?: string;
  reducedMotion?: boolean;
  contrast?: boolean;
  /** Runs before the bridge: a fake Tauri window, the native glass, … */
  before?: (page: Page) => Promise<void>;
  bridge?: Parameters<typeof installMockBridge>[1];
  bridgeFlags?: Parameters<typeof installMockBridge>[2];
  /** Wait for the frame's lip (or the flag-off chrome); false for a gate. */
  waitForShell?: boolean;
};

async function openApp(page: Page, options: OpenOptions = {}) {
  const {
    frame = true,
    light = false,
    size = { width: 1440, height: 900 },
    route = "#/pulse",
    origin = "",
    reducedMotion = false,
    contrast = false,
    waitForShell = true,
  } = options;
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await page.setViewportSize(size);
  await page.emulateMedia({
    colorScheme: light ? "light" : "dark",
    contrast: contrast ? "more" : "no-preference",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await page.addInitScript(
    ({ key, on, light }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) localStorage.setItem("buzz-theme", "paper");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame, light },
  );
  await options.before?.(page);
  await installMockBridge(page, options.bridge, options.bridgeFlags);
  // No query of the page's own: with one, the hash router glues it onto the
  // last value on Back (WP-10's finding), which the app's window never has.
  // The fixture alone turns the mock bridge on.
  await page.goto(`${origin}/${route}`);
  if (!waitForShell) return;
  // Generous: on a busy machine the first boot can take a while.
  await expect(
    page.getByTestId(frame ? "shell-lip" : "app-top-chrome"),
  ).toBeVisible({ timeout: 20_000 });
}

/** The page believes it is the app's own window (`isTauri`). */
async function fakeTauri(page: Page) {
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
}

/** Stands in for PolyphonicGlass.swift: announces itself; the Frame
 *  setting is Glass. */
async function fakeNativeGlass(page: Page) {
  await page.addInitScript(() => {
    const glass = window as typeof window & {
      __POLYPHONIC_NATIVE_GLASS__?: number;
      webkit?: unknown;
    };
    glass.webkit = {
      messageHandlers: { polyphonicGlass: { postMessage: () => {} } },
    };
    glass.__POLYPHONIC_NATIVE_GLASS__ = 1;
    localStorage.setItem("polyphonic-frame", "glass");
  });
}

/** Records the first background `<html>` is painted with by index.html's
 *  boot script, before the app's own code runs. */
async function recordBootPaint(page: Page) {
  await page.addInitScript(() => {
    const record = window as typeof window & {
      __BOOT_PAINT__?: { background: string; glass: string | null } | null;
    };
    record.__BOOT_PAINT__ = null;
    const observer = new MutationObserver(() => {
      const root = document.documentElement;
      if (!root || record.__BOOT_PAINT__) return;
      if (!root.style.backgroundColor) return;
      record.__BOOT_PAINT__ = {
        background: root.style.backgroundColor,
        glass: root.getAttribute("data-luca-frame-glass"),
      };
      observer.disconnect();
    });
    observer.observe(document, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
  });
}

const rgb = (value: string) => value.replace(/\s+/g, "");

// ── 1. the companion's halo and its badge ────────────────────────────

async function holdCompanion(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown>;
      };
      releaseControl: (() => void) | null;
    };
    state.releaseControl = null;
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command !== "resolve_polyphonic_app_control")
        return invoke(command, args, options);
      const input = args as { action: string };
      if (input.action === "begin") {
        await new Promise<void>((done) => {
          state.releaseControl = done;
        });
        return "running";
      }
      return { complete: "completed", stop: "stopped", failed: "failed" }[
        input.action
      ];
    };
  });
  await page.evaluate(
    ({ agent, channel, id }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
        "polyphonic-native-surface-request",
        {
          agentPubkey: agent,
          observerChannelId: channel,
          controlRequestId: id,
          request: {
            type: "polyphonic_surface_request",
            requestId: id,
            channelId: channel,
            surface: "appearance",
          },
        },
      );
    },
    {
      agent: LUCA,
      channel: GENERAL_CHANNEL_ID,
      id: "daaa5f62-adfa-46c0-83b0-6812b643a2e5",
    },
  );
  await expect(page.getByTestId("app-control-badge")).toContainText(
    "Luca is using Polyphonic",
    { timeout: 20_000 },
  );
}

async function releaseCompanion(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as { releaseControl: (() => void) | null }
    ).releaseControl?.();
  });
}

const companionAgent = {
  pubkey: LUCA,
  name: "Luca",
  status: "running" as const,
  channelNames: ["general"],
};

test("the companion's halo is concentric and its badge stands below the lip, on the card's axis", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    route: "#/agents",
    reducedMotion: true,
    bridge: { managedAgents: [companionAgent] },
  });
  await holdCompanion(page);
  const halo = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>(
      '[data-testid="app-control-halo"]',
    );
    if (!element) return null;
    const r = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      inset: [
        r.x,
        r.y,
        window.innerWidth - r.right,
        window.innerHeight - r.bottom,
      ],
      radius: style.borderTopLeftRadius,
      pointer: style.pointerEvents,
    };
  });
  const lip = await box(page, '[data-testid="shell-lip"]');
  checks.halo = {
    measured: halo,
    expected: { inset: 3, radius: "13px", window_radius: 16 },
    ok:
      halo?.radius === "13px" &&
      halo.inset.every((value) => value === 3) &&
      halo.pointer === "none",
  };
  const lipBottom = lip ? lip.y + lip.h : null;
  /** The badge against the name: both on the conversation card's axis. */
  const onAxis = async () => {
    await settle(page);
    const badge = await box(page, '[data-testid="app-control-badge"]');
    const name = await box(page, '[data-testid="shell-lip-name"]');
    const card = await box(page, '[data-testid="shell-lip"] .luca-lip-card');
    const centre = (b: Box | null) =>
      b ? Math.round((b.x + b.w / 2) * 100) / 100 : null;
    return {
      top: badge?.y ?? null,
      badge_axis: centre(badge),
      name_axis: centre(name),
      badge_span: badge ? [badge.x, badge.x + badge.w] : null,
      card_span: card ? [card.x, card.x + card.w] : null,
      clear_of_the_name: badge && name ? badge.y >= name.y + name.h : null,
    };
  };
  const good = (m: Awaited<ReturnType<typeof onAxis>>) =>
    m.top === 42 &&
    m.badge_axis !== null &&
    m.name_axis !== null &&
    Math.abs(m.badge_axis - m.name_axis) <= 0.5 &&
    m.badge_span !== null &&
    m.card_span !== null &&
    m.badge_span[0] >= m.card_span[0] + 15.5 &&
    m.badge_span[1] <= m.card_span[1] - 15.5;
  const open1440 = await onAxis();
  await shot(page, "01-halo-window");
  await shot(page, "01-halo-corner", {
    clip: { x: 0, y: 0, width: 120, height: 90 },
  });
  await shot(page, "01-halo-badge", {
    clip: { x: 600, y: 0, width: 500, height: 90 },
  });
  await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("shell-lip-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const closed1440 = await onAxis();
  await shot(page, "01-badge-rail-closed", {
    clip: { x: 500, y: 0, width: 500, height: 90 },
  });
  await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("shell-lip-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.setViewportSize({ width: 800, height: 500 });
  const open800 = await onAxis();
  await shot(page, "01-badge-800x500");
  checks.badge = {
    measured: {
      lip_bottom: lipBottom,
      rail_open_1440: open1440,
      rail_closed_1440: closed1440,
      rail_open_800x500: open800,
    },
    expected: {
      top: 42,
      below_lip_by: 6,
      axis: "the name's (the conversation card's)",
      within_the_card_less: 16,
    },
    ok: lipBottom === 36 && good(open1440) && good(closed1440) && good(open800),
  };
  // At a narrow window the badge stays below the lip too.
  await page.setViewportSize({ width: 740, height: 600 });
  const narrow = await box(page, '[data-testid="app-control-badge"]');
  (checks.badge as Record<string, unknown>).narrow_740_top = narrow?.y;
  await releaseCompanion(page);
  verdict("halo", "badge");
});

// ── 2. the Canvas in focus ───────────────────────────────────────────

async function openCanvas(page: Page) {
  // Under the frame the Library card lists the place page's flat rows
  // (WP-10); with it off, today's library rows.
  const opener = page
    .locator(".luca-place-row-open, .artifact-library-row__main")
    .filter({ hasText: "threshold-study.html" });
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await opener.click();
  await expect(page.getByTestId("artifact-canvas")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.move(899, 699);
  await page.waitForTimeout(700);
  await settle(page);
}

test("the Canvas in focus fills the content area, flush with the lip", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const W = 900;
  const H = 700;
  await openApp(page, { size: { width: W, height: H }, route: "#/artifacts" });
  const measures: Record<string, unknown> = {};
  let ok = true;
  for (const railClosed of [false, true]) {
    if (railClosed) {
      await page.getByRole("button", { name: "Close Canvas" }).click();
      await expect(page.getByTestId("artifact-canvas")).toBeHidden();
      await page.getByTestId("shell-lip-toggle").click();
      await page.waitForTimeout(700);
    }
    await openCanvas(page);
    const measured = await page.evaluate(() => {
      const card = document.querySelector(".artifact-canvas-card");
      const slot = document.querySelector<HTMLElement>(
        "[data-luca-right-cards]",
      );
      const area = slot?.offsetParent ?? null;
      const rect = (element: Element | null | undefined) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        mode: document.documentElement.dataset.artifactCanvasMode,
        canvas: rect(card),
        content_area: rect(area),
        rail_card: rect(
          document.querySelector(
            '[data-testid="app-sidebar"] [data-sidebar="sidebar"]',
          ),
        ),
        radius: card ? getComputedStyle(card).borderTopLeftRadius : null,
      };
    });
    const canvas = measured.canvas;
    const area = measured.content_area;
    const fills =
      canvas && area
        ? canvas.left === area.left &&
          canvas.top === area.top &&
          canvas.right === area.right &&
          canvas.bottom === area.bottom
        : false;
    const expectedLeft = railClosed ? 44 : 264;
    const good =
      measured.mode === "focus" &&
      canvas?.top === 36 &&
      W - (canvas?.right ?? 0) === 6 &&
      H - (canvas?.bottom ?? 0) === 6 &&
      canvas?.left === expectedLeft &&
      fills;
    ok &&= Boolean(good);
    measures[railClosed ? "rail_closed" : "rail_open"] = {
      ...measured,
      top: canvas?.top,
      right_from_window: canvas ? W - canvas.right : null,
      bottom_from_window: canvas ? H - canvas.bottom : null,
      left: canvas?.left,
      fills_the_content_area: fills,
      expected: { top: 36, right: 6, bottom: 6, left: expectedLeft },
    };
    await shot(
      page,
      `02-canvas-focus-${railClosed ? "rail-closed" : "rail-open"}`,
    );
  }
  // The brief's words read against the slot's own box instead (6 inside the
  // conversation card on three sides): drawn for comparison only.
  await page.addStyleTag({
    content:
      ':root[data-luca-frame][data-artifact-canvas-mode="focus"] [data-luca-right-cards] { inset: 0 6px 6px 6px !important; }',
  });
  await settle(page);
  await shot(page, "02-canvas-focus-literal-reading-for-comparison");
  checks.canvas_focus = { ...measures, ok };
  verdict("canvas_focus");
});

// ── 3. the content's drift follows the places ────────────────────────

async function traceDrift(page: Page) {
  await page.evaluate(() => {
    const trace: Array<{ motion: string; drift: string; path: string }> = [];
    (window as unknown as { __DRIFT__: typeof trace }).__DRIFT__ = trace;
    const root = document.documentElement;
    new MutationObserver(() => {
      const motion = root.dataset.navMotion;
      if (!motion) return;
      trace.push({
        motion,
        drift: getComputedStyle(root).getPropertyValue("--luca-nav-drift"),
        path: location.hash,
      });
    }).observe(root, { attributeFilter: ["data-nav-motion"] });
  });
}

const driftTrace = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __DRIFT__: Array<{ motion: string; drift: string }>;
        }
      ).__DRIFT__,
  );

test("the content's drift follows the places' order", async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page, { route: "#/artifacts" });
  await expect(page.getByTestId("artifact-library-screen")).toBeVisible({
    timeout: 20_000,
  });
  await traceDrift(page);
  // The six places (NAVIGATION.md, 2026-10-25): Chats (with New
  // conversation in it), Agents, Activity, Library, then Settings. New
  // conversation and Brain left the column, so New conversation is reached
  // by its key (⌘N), from Agents below it.
  const steps: Array<[string, string, string]> = [
    // [place (or "key:" and its key), its route, the drift expected]
    ["open-agents-view", "/agents", "up"],
    ["open-activity-view", "/pulse", "down"],
    ["open-artifacts-view", "/artifacts", "down"],
    ["open-settings-view", "/settings", "down"],
    ["open-activity-view", "/pulse", "up"],
    ["open-agents-view", "/agents", "up"],
    ["key:ControlOrMeta+n", "/messages/new", "up"],
    ["open-artifacts-view", "/artifacts", "down"],
  ];
  const seen: Array<{ to: string; motion: string | null; drift?: string }> = [];
  for (const [place, route] of steps) {
    const before = (await driftTrace(page)).length;
    if (place.startsWith("key:")) {
      await page.keyboard.press(place.slice(4));
    } else {
      await page.getByTestId(place).click();
    }
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 20_000 })
      .toContain(route);
    await expect
      .poll(async () => (await driftTrace(page)).length, { timeout: 5_000 })
      .toBeGreaterThan(before);
    const first = (await driftTrace(page))[before];
    seen.push({
      to: route,
      motion: first?.motion ?? null,
      drift: first?.drift,
    });
    await page.waitForTimeout(800);
  }
  const expected = steps.map(([, , motion]) => motion);
  const ok = seen.every((step, index) => step.motion === expected[index]);
  // The same two moves with the flag off keep the rail's old order, where
  // Library sits above New conversation.
  const off = await page.context().browser()?.newContext({
    deviceScaleFactor: 2,
  });
  const offSeen: Array<string | null> = [];
  if (off) {
    const offPage = await off.newPage();
    await openApp(offPage, { frame: false, route: "#/artifacts" });
    await traceDrift(offPage);
    for (const route of ["/messages/new", "/artifacts"]) {
      const before = (await driftTrace(offPage)).length;
      await offPage.evaluate((r) => {
        location.hash = `#${r}`;
      }, route);
      await expect
        .poll(async () => (await driftTrace(offPage)).length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(before);
      offSeen.push((await driftTrace(offPage))[before]?.motion ?? null);
      await offPage.waitForTimeout(800);
    }
    await off.close();
  }
  checks.drift_order = {
    trace: seen,
    expected,
    view_transitions: await page.evaluate(
      () => "startViewTransition" in document,
    ),
    flag_off_same_moves: { seen: offSeen, expected: ["down", "up"] },
    ok: ok && offSeen.join(",") === "down,up",
  };
  verdict("drift_order");
});

// ── 4. the loading gates and the boot paint ──────────────────────────

/** The gate held: the community's config is slow to apply on a cold boot. */
async function openOnGate(page: Page, options: OpenOptions) {
  await openApp(page, {
    ...options,
    route: "",
    waitForShell: false,
    bridge: { ...(options.bridge ?? {}), applyCommunityDelayMs: 6_000 },
  });
  await expect(page.getByTestId("app-loading-gate")).toBeVisible({
    timeout: 20_000,
  });
  // A first launch paints before its palette has loaded; measure the gate
  // once the palette is on the page (it is cached from then on).
  await expect
    .poll(
      () =>
        page.evaluate(() => Boolean(localStorage.getItem("buzz-theme-cache"))),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.waitForTimeout(300);
}

async function gateFloor(page: Page) {
  return page.evaluate(() => {
    const gate = document.querySelector<HTMLElement>(
      '[data-testid="app-loading-gate"]',
    );
    const css = (element: Element | null) =>
      element ? getComputedStyle(element).backgroundColor : null;
    return {
      marked: gate?.hasAttribute("data-luca-frame-gate") ?? false,
      gate: css(gate),
      html: css(document.documentElement),
      body: css(document.body),
      glass: document.documentElement.getAttribute("data-luca-frame-glass"),
      dark: document.documentElement.classList.contains("dark"),
    };
  });
}

/** Whether a press at (x, y) asks the window to start dragging. */
async function drags(page: Page, x: number, y: number) {
  const before = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__?.length ?? 0,
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  return page.evaluate(
    (from) =>
      (
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []) as unknown as Array<{
          command?: string;
        }>
      )
        .slice(from)
        .some((entry) => entry.command === "plugin:window|start_dragging"),
    before,
  );
}

test("the loading gates paint the frame's floor, or stay clear on the glass", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const result: Record<string, unknown> = {};
  let ok = true;
  const cases: Array<{ name: string; options: OpenOptions; expect: string }> = [
    { name: "dark", options: {}, expect: "rgb(0,0,0)" },
    { name: "light", options: { light: true }, expect: "rgb(236,234,230)" },
    {
      name: "glass",
      options: {
        before: async (page) => {
          await fakeTauri(page);
          await fakeNativeGlass(page);
        },
      },
      expect: "rgba(0,0,0,0)",
    },
  ];
  for (const item of cases) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await openOnGate(page, { ...item.options, reducedMotion: true });
    const floor = await gateFloor(page);
    const file = await shot(page, `04-gate-${item.name}`, {
      omitBackground: item.name === "glass",
    });
    const band = {
      press_at_y40_drags: await drags(page, 700, 40),
      press_at_y60_drags: await drags(page, 700, 60),
    };
    const good =
      floor.marked &&
      rgb(floor.gate ?? "") === item.expect &&
      (item.name !== "glass" ||
        (floor.glass === "liquid" &&
          rgb(floor.html ?? "") === "rgba(0,0,0,0)" &&
          rgb(floor.body ?? "") === "rgba(0,0,0,0)")) &&
      band.press_at_y40_drags &&
      !band.press_at_y60_drags;
    ok &&= good;
    result[item.name] = {
      ...floor,
      expected_gate: item.expect,
      drag_band: band,
      shot: file,
      ok: good,
    };
    await context.close();
  }

  // The flag off: the gate keeps its own canvas (the app's background).
  {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await openOnGate(page, { frame: false, reducedMotion: true });
    const floor = await gateFloor(page);
    const good = !floor.marked && rgb(floor.gate ?? "") === "rgb(6,6,6)";
    ok &&= good;
    result.flag_off = { ...floor, ok: good };
    await context.close();
  }

  // The boot splash overlay is the same gate over the mounted app.
  {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await openApp(page, { waitForShell: false, reducedMotion: true });
    // Registered after the bridge (whose config it extends), then reloaded.
    await page.addInitScript(() => {
      const testWindow = window as Window & {
        __BUZZ_E2E__?: { bootSplashHoldMs?: number };
      };
      testWindow.__BUZZ_E2E__ = {
        ...(testWindow.__BUZZ_E2E__ ?? {}),
        bootSplashHoldMs: 8_000,
      };
    });
    await page.reload();
    const overlay = page.getByTestId("boot-splash-overlay");
    const shown = await overlay
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      const gate = await overlay
        .getByTestId("app-loading-gate")
        .evaluate((element) => ({
          marked: element.hasAttribute("data-luca-frame-gate"),
          gate: getComputedStyle(element).backgroundColor,
        }));
      await shot(page, "04-gate-boot-splash-dark");
      const good = gate.marked && rgb(gate.gate) === "rgb(0,0,0)";
      result.boot_splash = { ...gate, ok: good };
      ok &&= good;
    } else {
      result.boot_splash = "not run: the boot splash overlay did not show";
    }
    await context.close();
  }

  // The community switch's quiet gate.
  {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: "ws-a",
            name: "Alpha",
            relayUrl: "ws://localhost:3000",
            addedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "ws-b",
            name: "Bravo",
            relayUrl: "ws://localhost:3001",
            addedAt: "2026-01-02T00:00:00.000Z",
          },
        ]),
      );
      localStorage.setItem("buzz-active-community-id", "ws-a");
    });
    await openApp(page, {
      reducedMotion: true,
      bridge: { applyCommunityDelayMs: 1_500 },
      bridgeFlags: { skipCommunitySeed: true },
    });
    let switched = "";
    const railButton = page.getByTestId("community-rail-button-ws-b");
    if (await railButton.isVisible().catch(() => false)) {
      await railButton.click();
      switched = "community rail";
    } else {
      await page.locator(".luca-shell-avatar").first().click();
      const item = page.getByRole("menuitem", { name: /Bravo/ }).first();
      if (await item.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await item.click();
        switched = "avatar menu";
      }
    }
    const gate = page.getByTestId("community-switch-gate");
    const shown = switched
      ? await gate
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false)
      : false;
    if (shown) {
      const floor = await gate.evaluate((element) => ({
        marked: element.hasAttribute("data-luca-frame-gate"),
        gate: getComputedStyle(element).backgroundColor,
      }));
      await shot(page, "04-gate-community-switch-dark");
      const good = floor.marked && rgb(floor.gate) === "rgb(0,0,0)";
      ok &&= good;
      result.community_switch = { switched_by: switched, ...floor, ok: good };
    } else {
      result.community_switch = `not run: no community switch was reachable under the frame (${switched || "no switch control found"})`;
    }
    await context.close();
  }
  checks.gates_floor = { ...result, ok };

  // index.html's boot paint, on a second launch (the theme is cached).
  const boot: Record<string, unknown> = {};
  let bootOk = true;
  const bootCases: Array<{
    name: string;
    options: OpenOptions;
    expect: string;
    glass: string | null;
  }> = [
    { name: "dark", options: {}, expect: "rgb(0, 0, 0)", glass: null },
    {
      name: "light",
      options: { light: true },
      expect: "rgb(236, 234, 230)",
      glass: null,
    },
    {
      name: "glass",
      options: {
        before: async (page) => {
          await fakeTauri(page);
          await fakeNativeGlass(page);
        },
      },
      expect: "transparent",
      glass: "liquid",
    },
    {
      // As on the base: the cache holds no `--background` for the default
      // palette, so the static rule's #000 stands and nothing is written.
      name: "flag_off",
      options: { frame: false },
      expect: "none",
      glass: null,
    },
  ];
  for (const item of bootCases) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await openApp(page, item.options);
    await recordBootPaint(page);
    await page.reload();
    await expect(
      page.getByTestId(
        item.options.frame === false ? "app-top-chrome" : "shell-lip",
      ),
    ).toBeVisible({ timeout: 20_000 });
    const painted = await page.evaluate(
      () =>
        (
          window as unknown as {
            __BOOT_PAINT__: { background: string; glass: string | null };
          }
        ).__BOOT_PAINT__,
    );
    const good =
      item.expect === "none"
        ? painted === null
        : painted?.background === item.expect && painted.glass === item.glass;
    bootOk &&= good;
    boot[item.name] = { painted, expected: item.expect, ok: good };
    await context.close();
  }
  checks.boot_paint = { ...boot, ok: bootOk };
  verdict("gates_floor", "boot_paint");
});

// ── 5. the lip without native lights, and in full screen ─────────────

async function lipPositions(page: Page) {
  const toggle = await box(page, '[data-testid="shell-lip-toggle"]');
  const back = await box(page, '[data-testid="global-back"]');
  const forward = await box(page, '[data-testid="global-forward"]');
  const name = await box(page, '[data-testid="shell-lip-name"]');
  return {
    toggle: toggle?.x,
    toggle_y: toggle?.y,
    back: back?.x,
    forward: forward?.x,
    name: name ? Math.round((name.x + name.w / 2) * 100) / 100 : null,
  };
}

async function tooltips(page: Page) {
  const titles = await page.evaluate(() =>
    ["shell-lip-toggle", "global-back", "global-forward"].map(
      (id) =>
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.getAttribute("title") ?? null,
    ),
  );
  // The places that have keys are Search and Settings (NAVIGATION.md,
  // 2026-10-25). New conversation left the column for the Chats rail's +,
  // which names its key in its title.
  const places: string[] = [];
  for (const [id, label] of [
    ["shell-place-search", "Search"],
    ["open-settings-view", "Settings"],
  ]) {
    const tip = page.getByRole("tooltip").filter({ hasText: label }).first();
    // A tooltip just closed can swallow the next hover: leave and come back.
    await expect(async () => {
      await page.mouse.move(900, 600);
      await page.waitForTimeout(300);
      await page.getByTestId(id).hover();
      await expect(tip).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    places.push((await tip.innerText()).replace(/\s+/g, " ").trim());
  }
  const newConversation = (
    (await page.getByTestId("rail-new-conversation").getAttribute("title")) ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
  return { lip: titles, places, newConversation };
}

/** A full screen the page can be told about: `is_fullscreen` answers what
 *  the test says, and a resize event asks the page to look again. */
async function fakeFullscreen(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown>;
      };
      __FULLSCREEN__: boolean;
    };
    state.__FULLSCREEN__ = false;
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) =>
      command === "plugin:window|is_fullscreen"
        ? state.__FULLSCREEN__
        : invoke(command, args, options);
  });
}

async function setFullscreen(page: Page, on: boolean) {
  await page.evaluate((value) => {
    (window as unknown as { __FULLSCREEN__: boolean }).__FULLSCREEN__ = value;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("tauri://resize", {
      width: 1440,
      height: 900,
    });
  }, on);
}

/** The page believes it runs on `platform` (navigator.platform), as the
 *  shortcuts' handlers and the tooltips read it. */
function fakePlatform(platform: string) {
  return async (page: Page) => {
    await page.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, "platform", {
        configurable: true,
        get: () => value,
      });
    }, platform);
  };
}

/** Whether the keys toggle the rail, goes back and goes forward,
 *  from a place's page (nothing editable focused), after two places. */
async function shortcutsThatWork(
  page: Page,
  keys: { rail: string; back: string; forward: string },
) {
  const toggle = page.getByTestId("shell-lip-toggle");
  const expanded = () => toggle.getAttribute("aria-expanded");
  const hash = () => page.evaluate(() => window.location.hash);
  await page.getByTestId("open-artifacts-view").click();
  await expect.poll(hash).toContain("artifacts");
  await page.getByTestId("open-agents-view").click();
  await expect.poll(hash).toContain("agents");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const rail0 = await expanded();
  await page.keyboard.press(keys.rail);
  await page.waitForTimeout(400);
  const rail1 = await expanded();
  await page.keyboard.press(keys.rail);
  await page.waitForTimeout(400);
  const at = await hash();
  await page.keyboard.press(keys.back);
  await page.waitForTimeout(400);
  const back = await hash();
  await page.keyboard.press(keys.forward);
  await page.waitForTimeout(400);
  const forward = await hash();
  return {
    keys,
    rail: { before: rail0, after: rail1, ok: rail0 !== rail1 },
    back: { from: at, to: back, ok: back !== at && back.includes("artifacts") },
    forward: { to: forward, ok: forward === at },
  };
}

/** The avatar menu's Settings key, read from the menu itself. */
async function avatarSettingsKey(page: Page) {
  await page.getByTestId("shell-profile-avatar-button").click();
  const kbd = page
    .getByRole("menuitem", { name: /^Settings/ })
    .locator("kbd")
    .first();
  await expect(kbd).toBeVisible({ timeout: 10_000 });
  const text = (await kbd.innerText()).trim();
  await page.keyboard.press("Escape");
  return text;
}

test("without native lights the toggle heads the places' column and the tooltips name keys that work", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const results: Record<string, unknown> = {};
  let positions: Awaited<ReturnType<typeof lipPositions>> | null = null;
  let tipsOk = true;
  for (const run of [
    {
      name: "mac_browser",
      platform: "MacIntel",
      keys: {
        rail: "Meta+s",
        back: "Meta+BracketLeft",
        forward: "Meta+BracketRight",
      },
      dead: "Control+s",
      expect: {
        rail: "(⌘S)",
        back: "Go back (⌘[)",
        forward: "Go forward (⌘])",
        search: "Search ⌘K",
        newConversation: "New conversation ⌘N",
        settings: "Settings ⌘,",
        avatar: "⌘,",
      },
    },
    {
      name: "windows",
      platform: "Win32",
      keys: {
        rail: "Control+s",
        back: "Alt+ArrowLeft",
        forward: "Alt+ArrowRight",
      },
      dead: "Meta+s",
      expect: {
        rail: "(Ctrl+S)",
        back: "Go back (Alt+←)",
        forward: "Go forward (Alt+→)",
        search: "Search Ctrl+K",
        newConversation: "New conversation Ctrl+N",
        settings: "Settings Ctrl+,",
        avatar: "Ctrl+,",
      },
    },
  ]) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await openApp(page, {
      route: `#/channels/${GENERAL_CHANNEL_ID}`,
      reducedMotion: true,
      before: fakePlatform(run.platform),
    });
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 20_000,
    });
    const platform = await page.evaluate(() => navigator.platform);
    if (run.name === "mac_browser") {
      positions = await lipPositions(page);
      await shot(page, "05-lip-no-lights", {
        clip: { x: 0, y: 0, width: 520, height: 80 },
      });
      await shot(page, "05-toggle-heads-the-places", {
        clip: { x: 0, y: 0, width: 60, height: 140 },
      });
    }
    const tips = await tooltips(page);
    const avatar = await avatarSettingsKey(page);
    const work = await shortcutsThatWork(page, run.keys);
    // The key the tooltip does not name does nothing.
    const toggle = page.getByTestId("shell-lip-toggle");
    const before = await toggle.getAttribute("aria-expanded");
    await page.keyboard.press(run.dead);
    await page.waitForTimeout(400);
    const deadOk = (await toggle.getAttribute("aria-expanded")) === before;
    const named =
      tips.lip[0]?.endsWith(run.expect.rail) === true &&
      tips.lip[1] === run.expect.back &&
      tips.lip[2] === run.expect.forward &&
      tips.places[0] === run.expect.search &&
      tips.newConversation === run.expect.newConversation &&
      tips.places[1] === run.expect.settings &&
      avatar === run.expect.avatar;
    const ok =
      named && work.rail.ok && work.back.ok && work.forward.ok && deadOk;
    tipsOk &&= ok;
    results[run.name] = {
      platform,
      tips,
      avatar_menu_settings: avatar,
      pressed: work,
      [`${run.dead}_does_nothing`]: deadOk,
      ok,
    };
    await context.close();
  }
  checks.no_lights_toggle = {
    measured: positions,
    expected: { toggle: 10, toggle_centre: 22, toggle_y: 10, back: 270 },
    ok:
      positions?.toggle === 10 &&
      positions.toggle_y === 10 &&
      positions.back === 270,
  };
  checks.ctrl_tooltips = { browser: results, ok: tipsOk };
  verdict("no_lights_toggle", "ctrl_tooltips");
});

test("with the Mac's lights the toggle sits past them, and in full screen where the first one was", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    reducedMotion: true,
    before: async (page) => {
      await fakePlatform("MacIntel")(page);
      await fakeTauri(page);
    },
  });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  const platform = await page.evaluate(() => navigator.platform);
  await fakeFullscreen(page);
  const windowed = await lipPositions(page);
  const tips = await tooltips(page);
  await shot(page, "05-lip-native-lights", {
    clip: { x: 0, y: 0, width: 520, height: 80 },
  });
  await setFullscreen(page, true);
  await expect
    .poll(async () => (await lipPositions(page)).toggle, { timeout: 5_000 })
    .toBe(10);
  const full = await lipPositions(page);
  // The same toggle position as without lights, by design; shown across
  // the whole lip, back, forward and the name in their places.
  await shot(page, "05-lip-full-screen", {
    clip: { x: 0, y: 0, width: 1440, height: 48 },
  });
  await setFullscreen(page, false);
  await expect
    .poll(async () => (await lipPositions(page)).toggle, { timeout: 5_000 })
    .toBe(78);
  const again = await lipPositions(page);
  const nativeTipsOk =
    tips.lip[0]?.endsWith("(⌘S)") === true &&
    tips.lip[1] === "Go back (⌘[)" &&
    tips.lip[2] === "Go forward (⌘])" &&
    tips.places[0] === "Search ⌘K" &&
    tips.newConversation === "New conversation ⌘N" &&
    tips.places[1] === "Settings ⌘,";
  checks.tooltips_native_mac_window = {
    platform,
    ...tips,
    ok: nativeTipsOk,
  };
  checks.fullscreen_toggle = {
    platform,
    windowed,
    full_screen: full,
    windowed_again: again,
    ok:
      windowed.toggle === 78 &&
      full.toggle === 10 &&
      again.toggle === 78 &&
      full.back === windowed.back &&
      full.forward === windowed.forward &&
      full.name === windowed.name,
  };
  verdict("fullscreen_toggle", "tooltips_native_mac_window");
});

// ── 6. the marks ─────────────────────────────────────────────────────

/** The places' newest mark, each frame for `frames` frames after `act`. */
async function sampleMark(page: Page, act: () => Promise<void>, frames = 40) {
  await page.evaluate((count) => {
    const samples: Array<{ w: number; h: number; shown: boolean }> = [];
    const host = window as unknown as {
      __MARK__: typeof samples;
      __START_MARK__: () => void;
    };
    host.__MARK__ = samples;
    const look = () => {
      const mark = document.querySelector<HTMLElement>(
        '[data-testid="shell-places-marks"] > .luca-mark:last-child',
      );
      samples.push(
        mark
          ? {
              w: Number.parseFloat(mark.style.width) || 0,
              h: Number.parseFloat(mark.style.height) || 0,
              shown: mark.style.visibility === "visible",
            }
          : { w: 0, h: 0, shown: false },
      );
      if (samples.length < count) requestAnimationFrame(look);
    };
    host.__START_MARK__ = () => requestAnimationFrame(look);
  }, frames);
  await page.evaluate(() =>
    (window as unknown as { __START_MARK__: () => void }).__START_MARK__(),
  );
  await act();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __MARK__: unknown[] }).__MARK__.length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(frames);
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __MARK__: Array<{ w: number; h: number; shown: boolean }>;
        }
      ).__MARK__,
  );
}

async function firstMarkTrace(page: Page, origin: string) {
  // A page with no place: workflows are Chats' now (SHELL_BUILD.md WP-10,
  // Decided 2), and the Inbox, with its flag on, is the one view that
  // belongs to no place (ShellPlaces.tsx, placeOfView).
  await openApp(page, {
    origin,
    route: "#/inbox",
    before: async (p) => {
      await p.addInitScript((key) => {
        const raw = window.localStorage.getItem(key);
        const overrides = raw
          ? (JSON.parse(raw) as Record<string, boolean>)
          : {};
        overrides.inbox = true;
        window.localStorage.setItem(key, JSON.stringify(overrides));
      }, FEATURE_OVERRIDES_STORAGE_KEY);
    },
  });
  await page.waitForTimeout(1_500);
  const before = await page.locator(PLACES_MARK).count();
  const samples = await sampleMark(page, () =>
    page.getByTestId("open-agents-view").click(),
  );
  const visible = samples.filter((sample) => sample.shown);
  return {
    marks_before: before,
    first_shown: visible[0] ?? null,
    last: samples.at(-1),
    widths: visible.slice(0, 12).map((sample) => sample.w),
  };
}

type MarkFrame = { t: number; w: number; h: number };

/** Records the rail's newest mark on every frame from the page's very
 *  start; `restartRailTrace` starts the record over (an action to come). */
async function recordRailMark(page: Page) {
  await page.addInitScript(() => {
    const host = window as unknown as {
      __RAIL_MARK__: MarkFrame[];
      __RAIL_TRACE__: () => void;
    };
    let run = 0;
    host.__RAIL_TRACE__ = () => {
      const mine = ++run;
      host.__RAIL_MARK__ = [];
      const look = () => {
        if (mine !== run) return;
        const mark = document.querySelector<HTMLElement>(
          '[data-testid="shell-rail-marks"] > .luca-mark:last-child',
        );
        if (mark && mark.style.visibility === "visible") {
          host.__RAIL_MARK__.push({
            t: Math.round(performance.now()),
            w: Number.parseFloat(mark.style.width) || 0,
            h: Number.parseFloat(mark.style.height) || 0,
          });
        }
        if (host.__RAIL_MARK__.length < 40) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    };
    host.__RAIL_TRACE__();
  });
}

async function restartRailTrace(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __RAIL_TRACE__: () => void }).__RAIL_TRACE__(),
  );
}

/** The rail mark's visible frames so far: its first and its last. */
async function railMarkFrames(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __RAIL_MARK__: MarkFrame[] }).__RAIL_MARK__
              .length,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(30);
  const frames = await page.evaluate(
    () => (window as unknown as { __RAIL_MARK__: MarkFrame[] }).__RAIL_MARK__,
  );
  const first = frames[0] ?? null;
  const last = frames.at(-1) ?? null;
  return {
    first,
    last,
    widths: frames.slice(0, 8).map((frame) => frame.w),
    // Simply there: its first visible frame is already its settled size.
    still:
      first !== null &&
      last !== null &&
      Math.abs(first.w - last.w) < 1 &&
      Math.abs(first.h - last.h) < 1,
  };
}

/** The rail's mark where the rail's layer shows its first page: at launch
 *  on a conversation, back from Settings, and as the narrow sheet opens.
 *  And, against them, a mark after a first page without one: the rail
 *  opened after launching closed. */
async function railFirstPages(page: Page) {
  await recordRailMark(page);
  await openApp(page, {
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    bridge: { managedAgents: [LUCA_AGENT] },
  });
  const launch = await railMarkFrames(page);
  await shot(page, "06-rail-mark-at-launch", {
    clip: { x: 0, y: 36, width: 280, height: 600 },
  });

  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("shell-rail-marks")).toHaveCount(0, {
    timeout: 10_000,
  });
  await restartRailTrace(page);
  await page.getByTestId("global-back").click();
  const fromSettings = await railMarkFrames(page);

  // The rail closed, then opened: its first page (closed) had no mark, so
  // the mark that comes with opening swells in.
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(900);
  await restartRailTrace(page);
  await page.getByTestId("shell-lip-toggle").click();
  const reopened = await railMarkFrames(page);

  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(900);
  await restartRailTrace(page);
  await page.getByTestId("shell-lip-toggle").click();
  await expect(page.locator('[data-mobile="true"]')).toBeVisible();
  const sheet = await railMarkFrames(page);
  return { launch, fromSettings, reopened, sheet };
}

test("the first mark after the page appears swells from a point", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ours = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ours.newPage();
  const trace = await firstMarkTrace(page, "");
  await shot(page, "06-first-mark-settled", {
    clip: { x: 0, y: 36, width: 60, height: 360 },
  });
  await ours.close();
  const railContext = await browser.newContext({ deviceScaleFactor: 2 });
  const rail = await railFirstPages(await railContext.newPage());
  await railContext.close();

  checks.first_mark_swells = {
    page: "#/inbox, its flag on (no place) → Agents",
    ours: trace,
    // The base build at SHELL_BASE_URL predates the frame, so the before is
    // the marks' unit test (firstMarkAfterAPageWithout_swellsFromAPoint),
    // which fails on the engine as it was.
    before: "see marks.test.mjs",
    // A mark on a layer's first page is simply there: the rail's at launch,
    // back from Settings and as the narrow sheet opens; the rail opened
    // after a first page without one swells.
    rail,
    ok:
      trace.marks_before === 0 &&
      trace.first_shown !== null &&
      trace.first_shown.w < 28 &&
      trace.widths.length > 2 &&
      trace.last?.w === 28 &&
      trace.last?.h === 28 &&
      rail.launch.still &&
      rail.fromSettings.still &&
      rail.sheet.still &&
      !rail.reopened.still,
  };
  verdict("first_mark_swells");
});

test("under Increase Contrast a plate mark carries a 1-point outline at ink 50%", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    contrast: true,
    bridge: { managedAgents: [LUCA_AGENT] },
  });
  await expect(page.locator(PLACES_MARK)).toHaveCount(1, { timeout: 20_000 });
  await page.mouse.move(900, 600);
  await page.waitForTimeout(600);
  await settle(page);
  const marks = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.luca-marks[data-mark-material="plate"] > .luca-mark',
      ),
    ].map((mark) => ({
      layer: mark.parentElement?.getAttribute("data-testid"),
      shadow: getComputedStyle(mark).boxShadow,
      contrast: matchMedia("(prefers-contrast: more)").matches,
    })),
  );
  await shot(page, "06-contrast-places", {
    clip: { x: 0, y: 36, width: 60, height: 300 },
  });
  await shot(page, "06-contrast-rail", {
    clip: { x: 44, y: 36, width: 224, height: 400 },
  });
  // And the same marks without it: the plate's own lit top.
  await page.emulateMedia({ contrast: "no-preference" });
  await settle(page);
  const plain = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector<HTMLElement>(
          '[data-testid="shell-places-marks"] > .luca-mark',
        ) as HTMLElement,
      ).boxShadow,
  );
  await shot(page, "06-contrast-off-places", {
    clip: { x: 0, y: 36, width: 60, height: 300 },
  });
  const outline = (shadow: string) =>
    /inset/.test(shadow) &&
    /0px 0px 0px 1px/.test(shadow) &&
    /\/ 0\.5\)|, 0\.5\)/.test(shadow);
  checks.contrast_outline = {
    marks,
    without_contrast: plain,
    ok:
      marks.length >= 2 &&
      marks.every((mark) => mark.contrast && outline(mark.shadow)) &&
      !outline(plain),
  };
  verdict("contrast_outline");
});

test("in the narrow sheet only the mark marks: focus shows for the keyboard alone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    size: { width: 700, height: 500 },
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    bridge: { managedAgents: [LUCA_AGENT] },
  });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  // Opened by the lip's toggle; the pointer rests where it pressed, over
  // the sheet's first row.
  await page.getByTestId("shell-lip-toggle").click();
  const sheet = page.locator('[data-mobile="true"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(900);
  const lit = () =>
    page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-mobile="true"] .luca-rail-row',
        ),
      ];
      const active = document.activeElement as HTMLElement | null;
      return {
        lit_rows: rows
          .filter(
            (row) =>
              getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)",
          )
          .map((row) => row.getAttribute("data-testid")),
        marks: document.querySelectorAll(
          '[data-mobile="true"] [data-testid="shell-rail-marks"] > .luca-mark',
        ).length,
        focused: active?.getAttribute("aria-label") ?? active?.tagName,
        focus_visible: active?.matches(":focus-visible") ?? false,
        focused_outline: active ? getComputedStyle(active).outlineStyle : null,
      };
    });
  const opened = await lit();
  await shot(page, "06-sheet-opened-pointer-still");
  // The pointer moves on the row: it lights, as a hover does.
  const pointer = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-mobile="true"] [data-testid="rail-home-luca"]',
    );
    const r = row?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (pointer) await page.mouse.move(pointer.x + 2, pointer.y);
  await page.waitForTimeout(200);
  const hovered = await lit();
  await shot(page, "06-sheet-pointer-moved");
  // The keyboard: Tab to the next stop shows its focus.
  await page.mouse.move(690, 490);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(200);
  const keyboard = await lit();
  await shot(page, "06-sheet-keyboard-focus");
  checks.sheet_focus = {
    opened,
    pointer_moved: hovered,
    keyboard,
    ok:
      opened.lit_rows.length === 0 &&
      opened.marks === 1 &&
      !opened.focus_visible &&
      opened.focused_outline === "none" &&
      hovered.lit_rows.includes("rail-home-luca") &&
      keyboard.focus_visible &&
      keyboard.focused_outline === "solid",
  };
  verdict("sheet_focus");
});

// ── the flag off ─────────────────────────────────────────────────────

test("flag off draws the base build exactly", async ({ browser }) => {
  test.setTimeout(300_000);
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable) {
    checks.flag_off_identical = `not run: base build not reachable at ${BASE_URL}`;
    test.skip(true, `base build not reachable at ${BASE_URL}`);
  }
  const fresh = async (): Promise<[BrowserContext, Page]> => {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    await context.clock.install({ time: new Date("2026-10-25T09:30:00") });
    return [context, await context.newPage()];
  };
  const capture = async (origin: string, label: string) => {
    const shots: Record<string, string> = {};
    const take = async (page: Page, name: string) => {
      await page.mouse.move(899, 1);
      await page.waitForTimeout(600);
      shots[name] = await shot(page, `09-flag-off-${name}${label}`, {
        keep: label === "",
      });
    };
    {
      const [context, page] = await fresh();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await openApp(page, {
          frame: false,
          origin,
          reducedMotion: true,
          route: `#/channels/${GENERAL_CHANNEL_ID}`,
        });
        const shown = await page
          .locator(CONVERSATION_SURFACE)
          .first()
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (shown) break;
      }
      await take(page, "conversation");
      await page.evaluate(() => {
        location.hash = "#/agents";
      });
      await page.waitForTimeout(1_200);
      await take(page, "agents");
      await context.close();
    }
    {
      const [context, page] = await fresh();
      await openApp(page, {
        frame: false,
        origin,
        reducedMotion: true,
        size: { width: 900, height: 700 },
        route: "#/artifacts",
      });
      await openCanvas(page);
      await take(page, "canvas-focus");
      await context.close();
    }
    {
      const [context, page] = await fresh();
      await openApp(page, {
        frame: false,
        origin,
        reducedMotion: true,
        route: "#/agents",
        bridge: { managedAgents: [companionAgent] },
      });
      await page.waitForTimeout(1_000);
      await holdCompanion(page);
      await take(page, "halo");
      await releaseCompanion(page);
      await context.close();
    }
    return shots;
  };
  const ours = await capture("", "");
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
  }
  checks.flag_off_identical = { ...result, ok: identical };
  verdict("flag_off_identical");
});
