import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-38, Brain its own place again (docs/luca/BETA14_RELEASE.md): under
 * `shell-frame` Brain is a place in the column, after Library; `/brain`
 * opens its page in the one card (its head, its body for the whole account,
 * its rail's two views); every way in lands there; and a mind's "What
 * {name} can read" row is that mind's own access, with "Open Brain".
 * Screenshots land in WP38_SHOTS, measurements in WP38_SHOTS/measures; the
 * base build for the flag-off comparison is read at WP38_BASE_URL.
 */

const SHOTS = process.env.WP38_SHOTS ?? "test-results/shell-brain";
const BASE_URL = process.env.WP38_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const AGENTS_CHANNEL = "94a444a4-c0a3-5966-ab05-530c6ddc2301";

type Mode = "dark" | "light";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 150_000 });

async function boot(
  page: Page,
  {
    hash = "/brain",
    mode = "dark",
    origin,
    query = "",
    shell = true,
  }: {
    hash?: string;
    mode?: Mode;
    origin?: string;
    /** The page's own query, before the hash (the demo projects). */
    query?: string;
    shell?: boolean;
  } = {},
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
      {
        name: "Atlas",
        pubkey: ATLAS,
        personaId: "persona-atlas",
        status: "running",
      },
    ],
    personas: [
      {
        id: "persona-atlas",
        displayName: "Atlas",
        systemPrompt: "Keeps the release honest.",
        runtime: "claude",
      },
    ],
  });
  // After the bridge's own seed, so this one decides the frame and palette.
  await page.addInitScript(
    ({ key, light, on }) => {
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
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light", on: shell },
  );
  await expect(async () => {
    await page.goto(`${origin ?? ""}/${query}#${hash}`);
    await expect(
      page
        .locator(
          "[data-testid='app-sidebar'], [data-testid='settings-content-scroll']",
        )
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
}

async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** How many colours a shot holds, sampled on a 120 x 75 grid: a blank or
 *  one-colour shot proves nothing. */
async function colorsOf(page: Page, path: string) {
  const data = readFileSync(path).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 75;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0, 120, 75);
    const pixels = context.getImageData(0, 0, 120, 75).data;
    const seen = new Set<number>();
    for (let index = 0; index < pixels.length; index += 4)
      seen.add(
        ((pixels[index] >> 3) << 10) |
          ((pixels[index + 1] >> 3) << 5) |
          (pixels[index + 2] >> 3),
      );
    return seen.size;
  }, data);
}

const hashOf = (page: Page) =>
  page.evaluate(() => decodeURIComponent(window.location.hash));

/** The place the column marks as current. */
const currentPlace = (page: Page) =>
  page
    .locator('[data-testid="shell-places"] .luca-place[data-current]')
    .getAttribute("data-testid");

async function landedOnBrain(page: Page) {
  await expect(page.getByTestId("brain-place")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("brain-card-repository")).toBeVisible({
    timeout: 20_000,
  });
  return {
    hash: await hashOf(page),
    lip: await page.getByTestId("shell-lip-name").innerText(),
    place: await currentPlace(page),
    view: await page.evaluate(() =>
      document.querySelector("[data-testid='brain-activity-list']")
        ? "activity"
        : document.querySelector("[data-testid^='brain-card-']")
          ? "connections"
          : null,
    ),
  };
}

/** The rail shows on the narrow window only when opened. */
async function openRail(page: Page) {
  if (!(await page.getByTestId("place-rail-brain").isVisible()))
    await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("place-rail-brain")).toBeVisible({
    timeout: 10_000,
  });
}

test("the column: Search; Chats, Agents, Activity, Library, Brain; Settings and the avatar", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await expect(page.getByTestId("open-brain-setup")).toBeVisible({
    timeout: 20_000,
  });
  const column = await page.getByTestId("shell-places").evaluate((nav) => {
    const tile = (el: Element | null) => {
      if (!el) return null;
      const svg = el.querySelector("svg");
      const box = el.getBoundingClientRect();
      const glyph = svg?.getBoundingClientRect();
      return {
        h: Math.round(box.height),
        icon: svg?.getAttribute("class"),
        iconH: glyph ? Math.round(glyph.height) : null,
        iconW: glyph ? Math.round(glyph.width) : null,
        label: el.getAttribute("aria-label"),
        stroke: svg ? getComputedStyle(svg).strokeWidth : null,
        w: Math.round(box.width),
        x: Math.round(box.left + box.width / 2),
        y: Math.round(box.top),
      };
    };
    return {
      groups: [...nav.querySelectorAll(".luca-places-group")].map((group) =>
        [
          ...group.querySelectorAll(
            ":scope > .luca-place, :scope > .luca-place-search, :scope > *:not(.luca-place):not(.luca-place-search)",
          ),
        ].map(
          (each) =>
            each.getAttribute("data-testid") ??
            each.getAttribute("aria-label") ??
            each.className,
        ),
      ),
      brain: tile(nav.querySelector("[data-testid='open-brain-setup']")),
      library: tile(nav.querySelector("[data-testid='open-artifacts-view']")),
    };
  });
  await page.getByTestId("open-brain-setup").hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  const tooltipText = (await tooltip.innerText()).trim();
  measure("places_column", { column, tooltip: tooltipText });
  expect(column.groups[1]).toEqual([
    "shell-place-conversations",
    "open-agents-view",
    "open-activity-view",
    "open-artifacts-view",
    "open-brain-setup",
  ]);
  expect(column.groups[2]?.[0]).toBe("open-settings-view");
  expect(column.brain?.icon).toContain("lucide-brain");
  expect(column.brain?.iconW).toBe(column.library?.iconW);
  expect(column.brain?.stroke).toBe(column.library?.stroke);
  expect(column.brain?.x).toBe(column.library?.x);
  expect(tooltipText).toBe("Brain");
  // The column, close up, with Brain lit.
  await page.mouse.move(700, 450);
  await page.getByTestId("open-brain-setup").click();
  await landedOnBrain(page);
  await page.mouse.move(700, 450);
  await waitForAnimations(page);
  await page.waitForTimeout(600);
  // From the lip's toggle to Brain's tile, beside the start of its rail.
  const brain = await page.getByTestId("open-brain-setup").boundingBox();
  mkdirSync(SHOTS, { recursive: true });
  if (brain)
    await page.screenshot({
      clip: { height: brain.y + brain.height + 28, width: 240, x: 0, y: 0 },
      path: `${SHOTS}/c-column-close-up.png`,
    });
});

for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const mode of ["dark", "light"] as const) {
    test(`Brain's page at ${width}x${height} (${mode}): its head, its body, its rail's two views`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await boot(page, { mode });
      const connections = await landedOnBrain(page);
      const head = await page.getByTestId("place-page-head").evaluate((h) => ({
        face: Boolean(h.querySelector("[data-testid='place-page-face'] svg")),
        faceIcon: h
          .querySelector("[data-testid='place-page-face'] svg")
          ?.getAttribute("class"),
        name: h.querySelector("h1")?.textContent,
        state: h.querySelector("[data-testid='place-page-state']")?.textContent,
        action: h.querySelector(".luca-place-page-action button")?.textContent,
      }));
      const body = await page.getByTestId("brain-place").evaluate((card) => ({
        cards: [...card.querySelectorAll("[data-testid^='brain-card-']")].map(
          (each) => each.getAttribute("data-testid"),
        ),
        // The body's own tab strip goes under the shell.
        tabStrips: card.querySelectorAll("[role=tablist]").length,
        filters: card.querySelectorAll(".luca-mind-filter").length,
        overflowX: card.scrollWidth - card.clientWidth,
        headers: [...card.querySelectorAll("h1")].map((h) => h.textContent),
      }));
      await openRail(page);
      const rail = await page.getByTestId("place-rail-brain").evaluate((nav) =>
        [...nav.querySelectorAll("[data-sidebar='menu-button']")].map(
          (row) => ({
            active: row.getAttribute("data-active"),
            title: row.textContent?.trim(),
          }),
        ),
      );
      const name = `brain-${width}-${mode}`;
      const connectionsShot = await shot(page, `${name}-connections`);
      await page
        .getByTestId("place-row-activity")
        .locator(".luca-rail-row-hit")
        .click();
      await expect(page.getByTestId("brain-activity-list")).toBeVisible({
        timeout: 10_000,
      });
      const activity = {
        hash: await hashOf(page),
        lip: await page.getByTestId("shell-lip-name").innerText(),
        place: await currentPlace(page),
      };
      if (width === 800) await openRail(page);
      const activityShot = await shot(page, `${name}-activity`);
      // Back steps to Connections: the pick is in the address.
      await page.goBack();
      await expect(page.getByTestId("brain-card-repository")).toBeVisible({
        timeout: 10_000,
      });
      const back = await hashOf(page);
      measure(name, {
        activity,
        activityShot,
        back,
        body,
        connections,
        connectionsShot,
        head,
        rail,
      });
      expect(head.face).toBe(true);
      expect(head.faceIcon).toContain("lucide-brain");
      expect(head.name).toBe("Brain");
      expect(head.state).toBe("1 repository · 1 file");
      expect(body.cards).toEqual([
        "brain-card-repository",
        "brain-card-codex_history",
        "brain-card-claude_history",
        "brain-card-files",
      ]);
      expect(body.tabStrips).toBe(0);
      expect(body.filters).toBe(0);
      expect(body.overflowX).toBeLessThanOrEqual(0);
      expect(body.headers).toEqual(["Brain"]);
      expect(rail.map((row) => row.title)).toEqual(["Connections", "Activity"]);
      expect(connections.hash).toContain("view=connections");
      expect(connections.lip).toBe("Brain");
      expect(connections.place).toBe("open-brain-setup");
      expect(activity.hash).toContain("view=activity");
      expect(activity.lip).toBe("Brain");
      expect(activity.place).toBe("open-brain-setup");
      expect(back).toContain("view=connections");
      expect(connectionsShot).not.toBe(activityShot);
    });
  }
}

test("every way into Brain opens the Brain place", async ({ page }) => {
  const ways: Record<string, unknown> = {};
  const fromRoom = async () => {
    await page.evaluate((id) => {
      window.location.hash = `#/channels/${id}`;
    }, GENERAL);
    await expect(page.getByTestId("brain-place")).toHaveCount(0, {
      timeout: 10_000,
    });
  };
  // The mock's demo projects, so a project row has its "Sources".
  await boot(page, { hash: `/channels/${GENERAL}`, query: "?projectDemo=1" });
  await expect(page.getByTestId("open-brain-setup")).toBeVisible({
    timeout: 20_000,
  });

  // goBrain, from the column.
  await page.getByTestId("open-brain-setup").click();
  ways.column = await landedOnBrain(page);

  // The address itself.
  await fromRoom();
  await page.evaluate(() => {
    window.location.hash = "#/brain";
  });
  ways.address = await landedOnBrain(page);

  // The project row's "Sources".
  await fromRoom();
  const project = page.locator("[data-home-kind='project']").first();
  await expect(project).toBeVisible({ timeout: 20_000 });
  await project.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sources" }).click();
  ways.projectSources = await landedOnBrain(page);

  // The runtime sessions' "Open Brain", on a connected app's card: the
  // mock lists Codex's sessions, so its read is made to fail, and the card
  // offers Brain, as it does when the sessions can't be read.
  await fromRoom();
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown>;
      };
    };
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === "list_connected_runtime_sessions")
        throw new Error("connected runtime sessions are unavailable");
      return invoke(command, args, options);
    };
  });
  await page
    .getByTestId("rail-home-app:codex")
    .locator('[data-rail-focus="home"]')
    .click({ timeout: 20_000 });
  await expect(page.getByTestId("connected-app-card")).toBeVisible();
  await page
    .getByTestId("connected-app-card")
    .getByRole("button", { name: "Open Brain" })
    .click({ timeout: 40_000 });
  ways.runtimeSessions = await landedOnBrain(page);

  // The surface navigation: a mind asks for Brain.
  await fromRoom();
  await page.evaluate(
    ({ agent, channel }) => {
      (
        window as unknown as {
          __BUZZ_E2E_EMIT_TAURI_EVENT__?: (
            name: string,
            payload: unknown,
          ) => void;
        }
      ).__BUZZ_E2E_EMIT_TAURI_EVENT__?.("polyphonic-native-surface-request", {
        agentPubkey: agent,
        observerChannelId: channel,
        request: {
          channelId: channel,
          requestId: "wp38-surface-brain",
          surface: "brain",
          type: "polyphonic_surface_request",
        },
      });
    },
    { agent: LUCA, channel: AGENTS_CHANNEL },
  );
  ways.surface = await landedOnBrain(page);

  measure("ways_in", ways);
  for (const [way, landed] of Object.entries(ways)) {
    const at = landed as { hash: string; lip: string; place: string };
    expect(at.hash, way).toMatch(/^#\/brain/);
    expect(at.lip, way).toBe("Brain");
    expect(at.place, way).toBe("open-brain-setup");
  }
});

test("an agent's brain-review request opens Brain with its Connections in front", async ({
  page,
}) => {
  await boot(page);
  await landedOnBrain(page);
  // Leave Brain on Activity, so the review has to bring Connections forward.
  await openRail(page);
  await page
    .getByTestId("place-row-activity")
    .locator(".luca-rail-row-hit")
    .click();
  await expect(page.getByTestId("brain-activity-list")).toBeVisible();
  await page.evaluate((id) => {
    window.location.hash = `#/channels/${id}`;
  }, AGENTS_CHANNEL);
  await expect(page.getByTestId("brain-place")).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.waitForFunction(
    () =>
      typeof (window as unknown as Record<string, unknown>)
        .__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
  );
  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      (
        window as unknown as {
          __BUZZ_E2E_SEED_OBSERVER_EVENTS__?: (input: unknown) => void;
        }
      ).__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "brain_review_request",
            agentIndex: 0,
            channelId,
            sessionId: null,
            turnId: null,
            payload: {
              type: "brain_review_request",
              requestId: "wp38-brain-review-1",
              channelId,
            },
          },
        ],
      });
    },
    { agentPubkey: LUCA, channelId: AGENTS_CHANNEL },
  );
  const landed = await landedOnBrain(page);
  const commands = await page.evaluate(
    () =>
      (window as unknown as { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  measure("brain_review", {
    landed,
    connectsWithoutAsking: commands.includes("connect_connected_brain_source"),
  });
  expect(landed.hash).toContain("view=connections");
  expect(landed.view).toBe("connections");
  expect(landed.place).toBe("open-brain-setup");
  expect(commands).not.toContain("connect_connected_brain_source");
});

// WP-43: What they can read is Settings › Can read, a pane of its own; a way
// in that names it (`at=read`) lands on it, back to Settings.
test("a mind's Can read pane is that mind's own access, with Open Brain to the place", async ({
  page,
}) => {
  await boot(page, {
    hash: `/agents?profile=${LUCA}&section=settings&at=read`,
  });
  const row = page.getByTestId("mind-pane-read");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mind-back")).toHaveText("Settings");
  expect(
    await page.evaluate(() => decodeURIComponent(location.hash)),
  ).toContain("page=settings/read");
  await expect(page.getByTestId("mind-brain-access")).toBeVisible();
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toBeVisible({ timeout: 20_000 });
  const read = (pubkey: string) =>
    page.getByTestId("mind-pane-read").evaluate(
      (li, pubkey) => ({
        pubkey,
        title: li.querySelector(".luca-mind-title")?.textContent,
        lede: li.querySelector(".luca-mind-lede")?.textContent,
        everything: li.querySelector(
          "[data-testid='mind-brain-access-everything']",
        )?.textContent,
        sources: [
          ...li.querySelectorAll("[data-testid^='mind-brain-source-']"),
        ].map((each) => ({
          id: each.getAttribute("data-testid"),
          state: each.getAttribute("data-state"),
          text: (each as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
          controls: [...each.querySelectorAll("button")].map((b) =>
            b.textContent?.trim(),
          ),
        })),
        // Brain's own body stays in Brain.
        brainCards: li.querySelectorAll("[data-testid^='brain-card-']").length,
        scan: li.querySelectorAll("[aria-label='Scan for Brain sources']")
          .length,
        openBrain: Boolean(li.querySelector("[data-testid='mind-open-brain']")),
      }),
      pubkey,
    );
  const luca = await read(LUCA);
  await row.evaluate((each) => each.scrollIntoView({ block: "start" }));
  const lucaShot = await shot(page, "b-luca-what-luca-can-read");
  // Its summary is the Settings row's value, one step back.
  await page.getByTestId("mind-back").click();
  const value = await page
    .getByTestId("mind-what-they-can-read")
    .locator(".luca-mind-prow-value")
    .textContent();
  await page.getByTestId("mind-what-they-can-read").click();
  await expect(page.getByTestId("mind-pane-read")).toBeVisible();

  // Exclude Luca from the repository, then restore: the row's own control.
  await page
    .getByTestId("mind-brain-source-connected-repository-luca")
    .getByRole("button", { name: "Exclude" })
    .click();
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toHaveAttribute("data-state", "revoked");
  const excluded = await read(LUCA);
  await page
    .getByTestId("mind-brain-source-connected-repository-luca")
    .getByRole("button", { name: "Restore resident access" })
    .click();
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toHaveAttribute("data-state", "active");
  const restored = await read(LUCA);

  // Atlas: the same sources, Atlas's own grants.
  await page.evaluate((atlas) => {
    window.location.hash = `#/agents?profile=${atlas}&section=settings&at=read`;
  }, ATLAS);
  await expect(page.getByTestId("mind-pane-read")).toContainText(
    "What Brain has connected that Atlas may read.",
    { timeout: 20_000 },
  );
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toBeVisible({ timeout: 20_000 });
  const atlas = await read(ATLAS);
  await page
    .getByTestId("mind-brain-source-connected-repository-luca")
    .getByRole("button", { name: "Reconfirm resident" })
    .click();
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toHaveAttribute("data-state", "active");
  const atlasReconfirmed = await read(ATLAS);

  // Open Brain arrives at the place.
  await page.getByTestId("mind-open-brain").click();
  const opened = await landedOnBrain(page);
  measure("agent_reads_row", {
    atlas,
    atlasReconfirmed,
    excluded,
    luca,
    lucaShot,
    value,
    opened,
    restored,
  });

  expect(luca.title).toBe("Can read");
  expect(luca.lede).toBe("What Brain has connected that Luca may read.");
  expect(value).toBe("1 repository · 1 file");
  expect(luca.everything).toBe("Luca reads everything Brain connects.");
  expect(luca.sources.map((each) => [each.id, each.state])).toEqual([
    ["mind-brain-source-connected-repository-luca", "active"],
    ["mind-brain-source-source-fixture", "active"],
  ]);
  expect(luca.brainCards).toBe(0);
  expect(luca.scan).toBe(0);
  expect(luca.openBrain).toBe(true);
  expect(excluded.everything).toBeUndefined();
  expect(restored.everything).toBe("Luca reads everything Brain connects.");
  expect(atlas.title).toBe("Can read");
  expect(atlas.lede).toBe("What Brain has connected that Atlas may read.");
  expect(atlas.everything).toBeUndefined();
  expect(atlas.sources.map((each) => [each.state, each.controls])).toEqual([
    ["stale", ["Reconfirm resident"]],
    ["stale", ["Revoke", "Reconfirm"]],
  ]);
  expect(atlasReconfirmed.sources[0]?.state).toBe("active");
  expect(opened.place).toBe("open-brain-setup");
  expect(opened.hash).toMatch(/^#\/brain/);
});

test("a mind's Open Brain lands on Connections, whichever view Brain was left on", async ({
  page,
}) => {
  await boot(page);
  await landedOnBrain(page);
  await openRail(page);
  await page
    .getByTestId("place-row-activity")
    .locator(".luca-rail-row-hit")
    .click();
  await expect(page.getByTestId("brain-activity-list")).toBeVisible();
  await page.evaluate((luca) => {
    window.location.hash = `#/agents?profile=${luca}&section=settings&at=read`;
  }, LUCA);
  await expect(page.getByTestId("mind-open-brain")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("mind-open-brain").click();
  const landed = await landedOnBrain(page);
  measure("open_brain_connections", landed);
  expect(landed.hash).toContain("view=connections");
  expect(landed.view).toBe("connections");
  await expect(page.getByTestId("brain-activity-list")).toHaveCount(0);
});

test("flag off: the classic Brain page, a conversation, Settings and the mind space match the base", async ({
  browser,
}) => {
  const views: [string, string][] = [
    ["brain", "/brain"],
    ["conversation", `/channels/${GENERAL}`],
    ["settings", "/settings?section=appearance"],
    ["mind-space", `/agents?profile=${LUCA}&section=settings`],
  ];
  const result: Record<string, { base: string; ours: string; colors: number }> =
    {};
  for (const [name, hash] of views) {
    const hashes: string[] = [];
    const colors: number[] = [];
    for (const origin of [BASE_URL, ""]) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        deviceScaleFactor: 2,
        // Still marks, so two builds' frames can match by hash.
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 900 },
      });
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false });
      await page.waitForTimeout(2500);
      const path = `${SHOTS}/flag-off-${name}-${origin ? "base" : "ours"}.png`;
      await waitForAnimations(page);
      mkdirSync(SHOTS, { recursive: true });
      // The marks that move never hold one frame: masked in both builds
      // alike (small boxes only), as shell-mind-space.spec.ts masks them.
      await page.screenshot({
        mask: [
          page.getByTestId("resident-notebook-growth-field"),
          page.locator(".agent-identity-specimen"),
          page.locator("time"),
        ],
        path,
      });
      hashes.push(
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      );
      colors.push(await colorsOf(page, path));
      await context.close();
    }
    result[name] = {
      base: hashes[0] ?? "",
      colors: Math.min(colors[0] ?? 0, colors[1] ?? 0),
      ours: hashes[1] ?? "",
    };
  }
  measure("classic_identical", result);
  for (const [name, pair] of Object.entries(result)) {
    expect(pair.ours, name).toBe(pair.base);
    expect(pair.colors, `${name} is not one colour`).toBeGreaterThan(24);
  }
  expect(new Set(Object.values(result).map((pair) => pair.ours)).size).toBe(
    views.length,
  );
});
