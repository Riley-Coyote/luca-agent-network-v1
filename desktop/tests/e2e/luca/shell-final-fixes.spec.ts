import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-22, the final fixes (docs/luca/rail-system/SHELL_BUILD.md). Flag on,
 * 1440 × 900 and 800 × 500, dark and light: Appearance's grid flows on the
 * page (d1), a group label that only repeats the page's title goes (d2),
 * the rail's more-unread pill says "N unread" (d4), the places column
 * survives Settings without a focus hand-over (d5), Defaults says
 * "Polyphonic runtime" (d6), a mind's Notebook holds its proposals (d7),
 * the details card keeps the Quick Chat column clear (d9), the default
 * runtime picker reads by day (d10). d3 and d8 moved to WP-24 and WP-23.
 * Flag off, the same views match the base build by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go. SHELL_BASE_URL: the
 * base build for the flag-off hashes (unreachable: "not run").
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4330";

test.use({
  deviceScaleFactor: 2,
  screenshot: "off",
  trace: "off",
  video: "off",
});
test.describe.configure({ mode: "default" });

type Mode = "dark" | "light";
type Size = { width: number; height: number };

const SIZES: Size[] = [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
];
const MODES: Mode[] = ["dark", "light"];

const SECTIONS = [
  ["profile", "Profile & identity"],
  ["security", "Security & backup"],
  ["appearance", "Appearance"],
  ["notifications", "Notifications"],
  ["mobile", "Mobile & devices"],
  ["shortcuts", "Shortcuts"],
  ["agents", "Agents"],
  ["connections", "Connections & MCP"],
  ["defaults", "Defaults & permissions"],
  ["diagnostics", "Diagnostics"],
  ["updates", "Updates"],
  ["about", "About"],
] as const;

// Three minds and their asks, as the final flows review seeded them
// (final-review-flows/lib.ts): Luca's proposal, Atlas's permission and
// Wren's question; a finished task under #general's stack.
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60000).toISOString();
const MINDS = {
  managedAgents: [
    {
      name: "Luca",
      pubkey: LUCA,
      personaId: "builtin:fizz",
      status: "running",
    },
    { name: "Atlas", pubkey: ATLAS, status: "running" },
    { name: "Wren", pubkey: WREN, status: "running" },
  ],
  managedInputs: [
    {
      channelName: "design",
      pendingId: "question-word",
      request: {
        fields: [
          {
            description: null,
            key: "word",
            kind: "single",
            label: "Which word",
            options: [
              { description: null, label: "Preview", value: "preview" },
              { description: null, label: "Beta", value: "beta" },
            ],
            required: true,
          },
        ],
        message: "Should the Tidepool page say preview or beta?",
        resident_pubkey: WREN,
      },
    },
  ],
  managedPermissions: [
    {
      pendingId: "permission-release",
      request: {
        acp_request_id: "acp-1",
        action_preview: "./scripts/release.sh --dry-run",
        conversation_id: GENERAL,
        options: [
          { kind: "allow_once", name: "Allow once", option_id: "allow" },
          { kind: "reject_once", name: "Reject", option_id: "reject" },
        ],
        protocol: "luca.managed.permission.v1",
        resident_pubkey: ATLAS,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
  ],
  runtimeTaskProposals: [
    {
      channelName: "general",
      createdAt: minutesAgo(5),
      proposalId: "proposal-notes",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code",
      summary: "Update the release notes for beta 7.",
    },
  ],
  runtimeTasks: [
    {
      channelName: "general",
      completedAt: minutesAgo(160),
      residentPubkey: LUCA,
      runtimeFamily: "claude_code",
      startedAt: minutesAgo(180),
      state: "succeeded",
      summary: "Fix the failing build",
      taskId: "task-build",
    },
  ],
};

const checks: Record<string, unknown> = {};

function shotsDir() {
  const dir =
    process.env.SHELL_SHOTS ?? test.info().project.outputDir ?? "test-results";
  mkdirSync(dir, { recursive: true });
  return dir;
}

function saveChecks() {
  const file = path.join(shotsDir(), "checks.json");
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    saved = {};
  }
  writeFileSync(file, `${JSON.stringify({ ...saved, ...checks }, null, 2)}\n`);
}

async function reachable(url: string) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function open(
  page: Page,
  {
    flag = true,
    minds = false,
    mode = "dark",
    origin = "",
    route = "/#/settings?section=appearance",
    size = SIZES[0],
  }: {
    flag?: boolean;
    /** Seed the three minds and their asks. */
    minds?: boolean;
    mode?: Mode;
    origin?: string;
    route?: string;
    size?: Size;
  } = {},
) {
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`[console] ${message.text()}`);
  });
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: mode });
  await installMockBridge(page, (minds ? MINDS : {}) as never);
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
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: flag, light: mode === "light" },
  );
  await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
}

async function fresh(browser: Browser) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  return { context, page: await context.newPage() };
}

async function showSection(page: Page, section: string) {
  await page.getByTestId(`settings-nav-${section}`).click();
  await expect(page.getByTestId(`settings-panel-${section}`)).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(400);
  await waitForAnimations(page);
}

async function shoot(
  page: Page,
  name: string,
  fullPage = false,
  maskLiving = false,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const file = path.join(shotsDir(), `${name}.png`);
  // The living marks (small animated canvases, under 200 × 200) breathe
  // between two shots: masked for a comparison, never a canvas that fills
  // the window (SHELL_BUILD.md, "A flag-off comparison must compare
  // something").
  let masked = 0;
  if (maskLiving) {
    masked = await page.evaluate(() => {
      let n = 0;
      for (const canvas of document.querySelectorAll("canvas")) {
        const r = canvas.getBoundingClientRect();
        if (r.width > 0 && r.width < 200 && r.height < 200) {
          canvas.setAttribute("data-wp22-living", "");
          n++;
        }
      }
      return n;
    });
  }
  const buffer = await page.screenshot({
    clip,
    fullPage,
    mask: masked ? [page.locator("[data-wp22-living]")] : [],
    path: file,
  });
  return {
    buffer,
    file,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}

/**
 * How many colours a screenshot holds, sampled on a 64 × 64 grid: a shot of
 * one colour proves nothing by its hash.
 */
async function colours(page: Page, buffer: Buffer) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const seen = new Set<string>();
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const px = context.getImageData(
          Math.floor(((x + 0.5) * image.width) / 64),
          Math.floor(((y + 0.5) * image.height) / 64),
          1,
          1,
        ).data;
        seen.add(`${px[0]},${px[1]},${px[2]}`);
      }
    return seen.size;
  }, buffer.toString("base64"));
}

// ── d1 · Appearance's theme grid flows on the page ─────────────────────
test("d1 every theme shows with its name, the page scrolls", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const out: Record<string, unknown> = {};
  for (const size of SIZES) {
    for (const mode of MODES) {
      for (const pick of ["system", "light", "dark"] as const) {
        const { context, page } = await fresh(browser);
        await open(page, { mode, size });
        await expect(page.getByTestId("settings-panel-appearance")).toBeVisible(
          { timeout: 20_000 },
        );
        await page.getByTestId(`appearance-mode-${pick}`).click();
        await page.waitForTimeout(400);
        await waitForAnimations(page);
        const reading = await page.evaluate(() => {
          const grid = document.querySelector<HTMLElement>(
            '[data-testid="appearance-theme-grid"]',
          );
          const tiles = Array.from(
            grid?.querySelectorAll<HTMLElement>("button") ?? [],
          );
          const clipped = tiles.filter((tile) => {
            const r = tile.getBoundingClientRect();
            const g = grid?.getBoundingClientRect();
            return !g || r.bottom > g.bottom + 0.5 || r.top < g.top - 0.5;
          }).length;
          const names = tiles.map((tile) => tile.textContent?.trim() ?? "");
          const fades = Array.from(
            grid?.parentElement?.querySelectorAll<HTMLElement>(
              '[aria-hidden="true"].pointer-events-none',
            ) ?? [],
          ).length;
          const style = grid ? getComputedStyle(grid) : null;
          const scroller = document.querySelector<HTMLElement>(
            '[data-testid="settings-content-scroll"]',
          );
          return {
            tiles: tiles.length,
            named: names.filter((n) => n.length > 0).length,
            clipped,
            fades,
            gridOverflowY: style?.overflowY ?? null,
            gridMaxHeight: style?.maxHeight ?? null,
            gridScrolls: grid
              ? grid.scrollHeight > grid.clientHeight + 1
              : null,
            pageScrolls: scroller
              ? scroller.scrollHeight > scroller.clientHeight + 1
              : null,
          };
        });
        out[`${size.width}-${mode}-${pick}`] = reading;
        expect(reading.tiles).toBeGreaterThan(0);
        expect(reading.named).toBe(reading.tiles);
        expect(reading.clipped).toBe(0);
        expect(reading.fades).toBe(0);
        expect(reading.gridOverflowY).toBe("visible");
        expect(reading.gridScrolls).toBe(false);
        if (pick === mode) {
          // The page scrolled to the grid's last row: every name on screen.
          await page
            .getByTestId("appearance-theme-grid")
            .locator("button")
            .last()
            .scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          const shot = await shoot(
            page,
            `d1-${size.width}-${mode}-appearance-grid-end`,
          );
          out[`${size.width}-${mode}-shot`] = shot.file;
        }
        await context.close();
      }
    }
  }
  checks.d1 = out;
  saveChecks();
});

// ── d2 · A group label that only repeats the title goes ────────────────
test("d2 every section's group labels against its title", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const out: Record<string, unknown> = {};
  for (const mode of MODES) {
    const { context, page } = await fresh(browser);
    await open(page, { mode, route: "/#/settings?section=profile" });
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible({
      timeout: 20_000,
    });
    for (const [section, title] of SECTIONS) {
      await showSection(page, section);
      const reading = await page.evaluate((section) => {
        const panel = document.querySelector(
          `[data-testid="settings-panel-${section}"]`,
        );
        const page = panel?.closest("[data-luca-settings-page]");
        const pageTitle =
          page?.querySelector("h1")?.textContent?.trim() ?? null;
        const heads = Array.from(
          panel?.querySelectorAll("[data-settings-group-head]") ?? [],
        ).map((head) => ({
          label: head.querySelector("h2")?.textContent?.trim() ?? null,
          line:
            head
              .querySelector(".luca-settings-group-line")
              ?.textContent?.trim() ?? null,
        }));
        // Every small label on the panel (eyebrows), whoever draws it.
        const eyebrows = Array.from(
          panel?.querySelectorAll<HTMLElement>(".type-eyebrow") ?? [],
        )
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => el.textContent?.trim() ?? "");
        // The first line under the page's title, when its label went.
        const title = page?.querySelector("h1")?.getBoundingClientRect();
        const firstLine = panel
          ?.querySelector('[data-settings-group-head="page-line"]')
          ?.querySelector(".luca-settings-group-line")
          ?.getBoundingClientRect();
        const titleToLine =
          title && firstLine ? Math.round(firstLine.top - title.bottom) : null;
        // Every kept line is drawn, not clipped by a box above it: the
        // point at its middle hits the line itself.
        const linesShown = Array.from(
          panel?.querySelectorAll<HTMLElement>(".luca-settings-group-line") ??
            [],
        ).every((line) => {
          const r = line.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return true;
          const hit = document.elementFromPoint(
            r.left + Math.min(20, r.width / 2),
            r.top + r.height / 2,
          );
          return hit === line || line.contains(hit);
        });
        return { pageTitle, heads, eyebrows, titleToLine, linesShown };
      }, section);
      const repeated = reading.eyebrows.filter(
        (label) => label.toLowerCase() === title.toLowerCase(),
      );
      out[`${mode}-${section}`] = { ...reading, repeated };
      expect(reading.pageTitle).toBe(title);
      expect(repeated).toEqual([]);
      expect(reading.linesShown).toBe(true);
      for (const head of reading.heads) {
        // Every head keeps its line, or its label when it says something.
        expect(head.label ?? head.line).not.toBeNull();
      }
      if (section === "appearance") {
        out[`${mode}-shot`] = (
          await shoot(page, `d2-1440-${mode}-appearance-head`)
        ).file;
      }
    }
    await context.close();
  }
  checks.d2 = out;
  saveChecks();
});

// ── d4 · The rail's more-unread pill says what it counts ───────────────
async function raiseRailPill(page: Page) {
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  // Every conversation the mock knows gets a word the owner hasn't read,
  // so the rows past the rail's fold are unread and out of view.
  await page.evaluate(() => {
    const emit = (
      window as unknown as {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (message: unknown) => void;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    const now = Math.floor(Date.now() / 1000);
    for (const name of [
      "random",
      "design",
      "sales",
      "engineering",
      "agents",
      "watercooler",
      "announcements",
      "alice-tyler",
      "bob-tyler",
    ])
      emit({
        channelName: name,
        content: `A word in ${name}.`,
        createdAt: now + 60,
        kind: 9,
        pubkey: "b".repeat(64),
      });
  });
  await page.waitForTimeout(900);
}

test("d4 the rail's pill reads N unread", async ({ browser }) => {
  test.setTimeout(120_000);
  const out: Record<string, unknown> = {};
  for (const mode of MODES) {
    const { context, page } = await fresh(browser);
    await open(page, {
      mode,
      route: "/#/",
      size: { width: 800, height: 500 },
    });
    await raiseRailPill(page);
    const pill = page.locator(
      '[data-testid="sidebar-more-unread-below"], [data-testid="sidebar-more-unread-above"]',
    );
    await expect(pill.first()).toBeVisible({ timeout: 10_000 });
    const reading = await pill.first().evaluate((el) => ({
      testId: el.getAttribute("data-testid"),
      text: el.textContent?.trim(),
      name: el.getAttribute("aria-label"),
      arrow: el.querySelector("svg")?.getAttribute("class") ?? null,
    }));
    out[mode] = reading;
    expect(reading.text).toMatch(/^\d+ unread$/);
    expect(reading.name).toMatch(
      reading.testId === "sidebar-more-unread-below"
        ? /^\d+ unread below$/
        : /^\d+ unread above$/,
    );
    out[`${mode}-shot`] = (await shoot(page, `d4-800-${mode}-rail-pill`)).file;
    await context.close();
  }
  checks.d4 = out;
  saveChecks();
});

// ── d5 · One places column: no hand-over needed ────────────────────────
test("d5 the places column stays through Settings, focus with it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page } = await fresh(browser);
  await open(page, { route: "/#/" });
  await page.waitForSelector('[data-testid="shell-places"]', {
    timeout: 20_000,
  });
  await page.evaluate(() => {
    (
      document.querySelector('[data-testid="shell-places"]') as HTMLElement & {
        __wp22?: boolean;
      }
    ).__wp22 = true;
  });
  // Keyboard into Settings, then back out by its tile.
  await page.getByTestId("open-settings-view").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-view")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  const inSettings = await page.evaluate(() => ({
    same:
      (
        document.querySelector('[data-testid="shell-places"]') as
          | (HTMLElement & { __wp22?: boolean })
          | null
      )?.__wp22 === true,
    focused:
      document.activeElement
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null,
  }));
  const conversations = page.getByTestId("shell-place-conversations");
  await conversations.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-view")).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({
    same:
      (
        document.querySelector('[data-testid="shell-places"]') as
          | (HTMLElement & { __wp22?: boolean })
          | null
      )?.__wp22 === true,
    focused:
      document.activeElement
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null,
  }));
  checks.d5 = { inSettings, back };
  saveChecks();
  expect(inSettings.same).toBe(true);
  expect(inSettings.focused).toBe("open-settings-view");
  expect(back.same).toBe(true);
  expect(back.focused).toBe("shell-place-conversations");
  await context.close();
});

// ── d6 · "Polyphonic runtime" in Defaults ──────────────────────────────
test("d6 Defaults names the runtime Polyphonic runtime", async ({
  browser,
}) => {
  const out: Record<string, unknown> = {};
  const { context, page } = await fresh(browser);
  await open(page, { route: "/#/settings?section=defaults" });
  await expect(page.getByTestId("settings-panel-defaults")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  const panel = page.getByTestId("settings-panel-defaults");
  out.text = await panel.evaluate((el) => ({
    lucaManaged: (el.textContent ?? "").includes("Luca managed"),
    polyphonicRuntime: (el.textContent ?? "").includes("Polyphonic runtime"),
  }));
  // Open the runtime picker, if it is closed, to read its options.
  const trigger = panel.getByRole("combobox").first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForTimeout(300);
    out.options = await page
      .getByRole("option")
      .allTextContents()
      .catch(() => []);
    out.shot = (await shoot(page, "d6-1440-dark-defaults-runtime")).file;
    await page.keyboard.press("Escape");
  }
  checks.d6 = out;
  saveChecks();
  expect(JSON.stringify(out)).toContain("Polyphonic runtime");
  expect(JSON.stringify(out)).not.toContain("Luca managed");
  await context.close();
});

// ── d7 · A mind's Notebook shows the proposals it asked ──────────────
test("d7 every mind's asks in its Notebook, Luca's proposal too", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const out: Record<string, unknown> = {};
  for (const mode of MODES) {
    for (const [name, pubkey, key] of [
      ["luca", LUCA, "proposal:proposal-notes"],
      ["atlas", ATLAS, "permission:permission-release"],
      ["wren", WREN, "question:question-word"],
    ] as const) {
      const { context, page } = await fresh(browser);
      await open(page, {
        minds: true,
        mode,
        route: `/#/agents?profile=${pubkey}&section=notebook`,
      });
      await expect(page.getByTestId("mind-notebook")).toBeVisible({
        timeout: 20_000,
      });
      const ask = page.getByTestId(`mind-ask-${key}`);
      await expect(ask).toBeVisible({ timeout: 20_000 });
      const reading = await ask.evaluate((el) => ({
        text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
        answers: Array.from(el.querySelectorAll("button"))
          .map((b) => b.textContent?.trim())
          .filter(Boolean),
      }));
      out[`${mode}-${name}`] = reading;
      if (name === "luca") {
        expect(reading.text).toContain("Update the release notes for beta 7");
        expect(reading.answers).toEqual(
          expect.arrayContaining(["Run", "Not now"]),
        );
        // Answered in place: Not now takes it away here and in Needs you.
        if (mode === "dark") {
          out[`${mode}-shot`] = (
            await shoot(page, `d7-1440-${mode}-luca-notebook-proposal`)
          ).file;
          await ask.getByRole("button", { name: "Not now" }).click();
          await expect(ask).toHaveCount(0, { timeout: 10_000 });
          out.answeredInPlace = true;
        }
      }
      await context.close();
    }
  }
  checks.d7 = out;
  saveChecks();
});

// ── d9 · Quick Chat never covers the details card ──────────────────────
test("d9 the details card keeps the launcher's column clear", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const out: Record<string, unknown> = {};
  for (const size of SIZES) {
    for (const mode of MODES) {
      const { context, page } = await fresh(browser);
      await open(page, { minds: true, mode, route: "/#/", size });
      await page.waitForSelector('[data-testid="shell-places"]', {
        timeout: 20_000,
      });
      await page.getByTestId("shell-place-conversations").click();
      await page.waitForTimeout(800);
      const panel = page.getByTestId("conversation-context-panel");
      if ((await panel.count()) === 0 || !(await panel.isVisible())) {
        await page.getByTestId("shell-lip-details").click();
      }
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(600);
      await waitForAnimations(page);
      const reading = await page.evaluate(() => {
        const launcher = document
          .querySelector(".qc-launcher")
          ?.getBoundingClientRect();
        const body = document.querySelector<HTMLElement>(
          "[data-luca-details-body]",
        );
        if (!launcher || !body) return null;
        // Everything drawn in the body: its text and its plates.
        const reach = Array.from(body.querySelectorAll<HTMLElement>("*"))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .reduce((max, r) => Math.max(max, r.right), 0);
        const b = body.getBoundingClientRect();
        return {
          launcherLeft: Math.round(launcher.left),
          bodyRight: Math.round(b.right),
          contentRight: Math.round(reach),
          clearance: Math.round(launcher.left - reach),
        };
      });
      out[`${size.width}-${mode}`] = reading;
      expect(reading).not.toBeNull();
      expect(reading?.clearance ?? -1).toBeGreaterThanOrEqual(8);
      if (mode === "dark" || size.width === 800) {
        out[`${size.width}-${mode}-shot`] = (
          await shoot(page, `d9-${size.width}-${mode}-details`)
        ).file;
      }
      await context.close();
    }
  }
  checks.d9 = out;
  saveChecks();
});

// ── d10 · The default runtime picker reads by day ─────────────────────
test("d10 the default runtime picker reads at 4.5:1 in both modes", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const out: Record<string, unknown> = {};
  for (const size of SIZES) {
    for (const mode of MODES) {
      const { context, page } = await fresh(browser);
      await open(page, { mode, size, route: "/#/settings?section=defaults" });
      const picker = page.getByTestId("default-runtime-picker");
      await expect(picker).toBeVisible({ timeout: 20_000 });
      await picker.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await waitForAnimations(page);
      const reading = await picker.evaluate((root) => {
        type C = { r: number; g: number; b: number; a: number };
        const parse = (value: string): C => {
          const m = value.match(/rgba?\(([^)]+)\)/);
          if (!m) return { r: 0, g: 0, b: 0, a: 0 };
          const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
          return { r: +r, g: +g, b: +b, a: +a };
        };
        const over = (top: C, under: C): C => ({
          r: top.r * top.a + under.r * (1 - top.a),
          g: top.g * top.a + under.g * (1 - top.a),
          b: top.b * top.a + under.b * (1 - top.a),
          a: 1,
        });
        // The ground under an element: every fill from the page down.
        const ground = (el: Element): C => {
          const chain: Element[] = [];
          for (let e: Element | null = el; e; e = e.parentElement)
            chain.push(e);
          let c: C = { r: 255, g: 255, b: 255, a: 1 };
          for (const e of chain.reverse()) {
            const fill = parse(getComputedStyle(e).backgroundColor);
            if (fill.a > 0) c = over(fill, c);
          }
          return c;
        };
        const lum = (c: C) => {
          const f = (v: number) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const ratio = (el: Element) => {
          const cs = getComputedStyle(el);
          let opacity = 1;
          for (let e: Element | null = el; e; e = e.parentElement)
            opacity *= +getComputedStyle(e).opacity;
          const back = ground(el);
          const ink = parse(cs.color);
          const fore = over({ ...ink, a: ink.a * opacity }, back);
          const [hi, lo] = [lum(fore), lum(back)].sort((a, b) => b - a);
          return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
        };
        const texts: { text: string; ratio: number; font?: string }[] = [];
        const legend = root.querySelector("legend");
        if (legend) texts.push({ text: "legend", ratio: ratio(legend) });
        for (const tile of root.querySelectorAll("button[aria-pressed]")) {
          for (const span of tile.querySelectorAll("span")) {
            const own = Array.from(span.childNodes)
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent?.trim())
              .join("");
            if (!own) continue;
            texts.push({
              text: own,
              ratio: ratio(span),
              font: getComputedStyle(span).fontFamily.split(",")[0],
            });
          }
        }
        const none = root.querySelector('[data-testid="default-runtime-none"]');
        if (none)
          texts.push({ text: "Use no default runtime", ratio: ratio(none) });
        const tile = root.querySelector("button[aria-pressed]");
        return {
          tiles: root.querySelectorAll("button[aria-pressed]").length,
          texts,
          tileBorder: tile ? getComputedStyle(tile).borderColor : null,
          tileFill: tile ? getComputedStyle(tile).backgroundColor : null,
          min: Math.min(...texts.map((t) => t.ratio)),
        };
      });
      out[`${size.width}-${mode}`] = reading;
      expect(reading.tiles).toBeGreaterThan(0);
      expect(reading.min).toBeGreaterThanOrEqual(4.5);
      const recommended = reading.texts.find((t) => t.text === "Recommended");
      if (recommended) expect(recommended.font).toContain("Fragment Mono");
      if (size.width === 1440 || mode === "light") {
        out[`${size.width}-${mode}-shot`] = (
          await shoot(page, `d10-${size.width}-${mode}-default-runtime`)
        ).file;
      }
      await context.close();
    }
  }
  checks.d10 = out;
  saveChecks();
});

// ── Flag off: the same views as the base build ─────────────────────────
test("flag off: Appearance, Agents, Defaults and the rail match the base", async ({
  browser,
}) => {
  test.setTimeout(480_000);
  const out: Record<string, unknown> = {};
  if (!(await reachable(BASE_URL))) {
    checks.flag_off_identical = "not run: base unreachable";
    saveChecks();
    return;
  }
  const views = [
    ["appearance", "/#/settings?section=appearance"],
    ["agents", "/#/settings?section=agents"],
    ["defaults", "/#/settings?section=defaults"],
    ["defaults-runtime", "/#/settings?section=defaults"],
    ["rail", "/#/"],
    ["details", `/#/channels/${GENERAL}`],
  ] as const;
  let identical = true;
  for (const mode of MODES) {
    for (const [name, route] of views) {
      const hashes: Record<string, string> = {};
      const tones: Record<string, number> = {};
      for (const [build, origin] of [
        // WP22_MINE_ORIGIN: point "mine" at the base too, to prove each
        // view is steady against itself.
        ["mine", process.env.WP22_MINE_ORIGIN ?? ""],
        ["base", BASE_URL],
      ] as const) {
        const { context, page } = await fresh(browser);
        await page.clock.setFixedTime(new Date("2026-10-26T09:00:00"));
        await open(page, {
          flag: false,
          minds: name === "details",
          mode,
          origin,
          route,
          // The details card opens beside the conversation at 1440.
          size:
            name === "details"
              ? { width: 1440, height: 900 }
              : { width: 800, height: 500 },
        });
        if (name === "rail") {
          await raiseRailPill(page);
        } else if (name === "defaults-runtime") {
          const legend = page.locator("legend", { hasText: "Default runtime" });
          await expect(legend).toBeVisible({ timeout: 20_000 });
          await legend.scrollIntoViewIfNeeded();
        } else if (name === "details") {
          await page.waitForSelector('[data-testid="channel-drop-zone"]', {
            timeout: 20_000,
          });
          await page.waitForTimeout(800);
          const panel = page.getByTestId("conversation-context-panel");
          if (!(await panel.isVisible().catch(() => false))) {
            await page
              .getByRole("button", { name: "Open conversation details" })
              .click({ timeout: 15_000 });
          }
          await expect(panel).toBeVisible({ timeout: 10_000 });
        } else {
          await expect(page.getByTestId(`settings-panel-${name}`)).toBeVisible({
            timeout: 20_000,
          });
        }
        await page.waitForTimeout(1200);
        await waitForAnimations(page);
        // The details card alone: the rail's selected row breathes between
        // two shots of the same build (base against base differs there).
        const clip =
          name === "details"
            ? ((await page
                .getByTestId("conversation-context-panel")
                .boundingBox()) ?? undefined)
            : undefined;
        const shot = await shoot(
          page,
          `off-${name === "details" ? 1440 : 800}-${mode}-${name}-${build}`,
          false,
          true,
          clip,
        );
        hashes[build] = shot.hash;
        tones[build] = await colours(page, shot.buffer);
        await context.close();
      }
      const match = hashes.mine === hashes.base;
      out[`${mode}-${name}`] = { ...hashes, colours: tones, match };
      // A match of one-colour shots compares nothing.
      if (!match || tones.mine < 8) identical = false;
    }
  }
  checks.flag_off_identical = { identical, views: out };
  saveChecks();
  expect(identical).toBe(true);
});
