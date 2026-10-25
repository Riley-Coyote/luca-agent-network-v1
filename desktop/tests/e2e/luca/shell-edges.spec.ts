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
  await page.goto(`${origin}/?e2e=mock${route}`);
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

test("the companion's halo is concentric and its badge stands below the lip", async ({
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
  const badge = await box(page, '[data-testid="app-control-badge"]');
  const lip = await box(page, '[data-testid="shell-lip"]');
  const name = await box(page, '[data-testid="shell-lip-name"]');
  checks.halo = {
    measured: halo,
    expected: { inset: 3, radius: "13px", window_radius: 16 },
    ok:
      halo?.radius === "13px" &&
      halo.inset.every((value) => value === 3) &&
      halo.pointer === "none",
  };
  const lipBottom = lip ? lip.y + lip.h : null;
  checks.badge = {
    measured: {
      top: badge?.y,
      lip_bottom: lipBottom,
      below_lip_by: badge && lipBottom !== null ? badge.y - lipBottom : null,
      clear_of_the_name: badge && name ? badge.y >= name.y + name.h : null,
      centred:
        badge !== null
          ? Math.abs(badge.x + badge.w / 2 - 1440 / 2) <= 0.5
          : null,
    },
    expected: { top: 42, below_lip_by: 6 },
    ok: badge?.y === 42 && lipBottom === 36,
  };
  await shot(page, "01-halo-window");
  await shot(page, "01-halo-corner", {
    clip: { x: 0, y: 0, width: 120, height: 90 },
  });
  await shot(page, "01-halo-badge", {
    clip: { x: 520, y: 0, width: 400, height: 90 },
  });
  // At a narrow window the badge stays below the lip too.
  await page.setViewportSize({ width: 740, height: 600 });
  const narrow = await box(page, '[data-testid="app-control-badge"]');
  (checks.badge as Record<string, unknown>).narrow_740_top = narrow?.y;
  await releaseCompanion(page);
  verdict("halo", "badge");
});

// ── 2. the Canvas in focus ───────────────────────────────────────────

async function openCanvas(page: Page) {
  const opener = page
    .locator(".artifact-library-row__main")
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
    const expectedLeft = railClosed ? 44 : 268;
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
  const steps: Array<[string, string, string]> = [
    // [place, its route, the drift expected moving to it]
    ["open-new-conversation", "/messages/new", "up"],
    ["open-artifacts-view", "/artifacts", "down"],
    ["open-agents-view", "/agents", "down"],
    ["open-activity-view", "/pulse", "down"],
    ["open-brain-setup", "/brain", "down"],
    ["open-settings-view", "/settings", "down"],
    ["open-activity-view", "/pulse", "up"],
    ["open-artifacts-view", "/artifacts", "up"],
  ];
  const seen: Array<{ to: string; motion: string | null; drift?: string }> = [];
  for (const [place, route] of steps) {
    const before = (await driftTrace(page)).length;
    await page.getByTestId(place).click();
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
  const places: string[] = [];
  for (const [id, label] of [
    ["open-new-conversation", "New conversation"],
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
  return { lip: titles, places };
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

test("without native lights the toggle sits at 16 and tooltips say Ctrl", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    reducedMotion: true,
  });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  const positions = await lipPositions(page);
  const tips = await tooltips(page);
  await shot(page, "05-lip-no-lights", {
    clip: { x: 0, y: 0, width: 520, height: 80 },
  });
  checks.no_lights_toggle = {
    measured: positions,
    expected: { toggle: 16, toggle_y: 10, back: 274 },
    ok:
      positions.toggle === 16 &&
      positions.toggle_y === 10 &&
      positions.back === 274,
  };
  checks.ctrl_tooltips = {
    browser: tips,
    ok:
      tips.lip[0]?.endsWith("(Ctrl+S)") === true &&
      tips.lip[1] === "Go back (Ctrl+[)" &&
      tips.lip[2] === "Go forward (Ctrl+])" &&
      tips.places[0] === "New conversation Ctrl+N" &&
      tips.places[1] === "Settings Ctrl+,",
  };
  verdict("no_lights_toggle");
});

test("with the Mac's lights the toggle sits past them, and in full screen where the first one was", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openApp(page, {
    route: `#/channels/${GENERAL_CHANNEL_ID}`,
    reducedMotion: true,
    before: fakeTauri,
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
    .toBe(16);
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
  const ctrl = checks.ctrl_tooltips as { ok?: boolean } | undefined;
  const nativeTipsOk =
    tips.lip[0]?.endsWith("(⌘S)") === true &&
    tips.lip[1] === "Go back (⌘[)" &&
    tips.places[0] === "New conversation ⌘N" &&
    tips.places[1] === "Settings ⌘,";
  checks.ctrl_tooltips = {
    ...(ctrl ?? {}),
    native_mac_window: { platform, ...tips },
    ok: Boolean(ctrl?.ok) && nativeTipsOk,
  };
  checks.fullscreen_toggle = {
    platform,
    windowed,
    full_screen: full,
    windowed_again: again,
    ok:
      windowed.toggle === 78 &&
      full.toggle === 16 &&
      again.toggle === 78 &&
      full.back === windowed.back &&
      full.forward === windowed.forward &&
      full.name === windowed.name,
  };
  verdict("fullscreen_toggle", "ctrl_tooltips");
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
  await openApp(page, { origin, route: "#/workflows" });
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

  checks.first_mark_swells = {
    page: "#/workflows (no place) → Agents",
    ours: trace,
    // The base build at SHELL_BASE_URL predates the frame, so the before is
    // the marks' unit test (firstMarkAfterAPageWithout_swellsFromAPoint),
    // which fails on the engine as it was.
    before: "see marks.test.mjs",
    ok:
      trace.marks_before === 0 &&
      trace.first_shown !== null &&
      trace.first_shown.w < 28 &&
      trace.widths.length > 2 &&
      trace.last?.w === 28 &&
      trace.last?.h === 28,
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
