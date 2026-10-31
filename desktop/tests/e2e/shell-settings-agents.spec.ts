import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-24, Settings > Agents points to each mind's own space
 * (docs/luca/rail-system/SHELL_BUILD.md; NAVIGATION.md, "A mind's own
 * space"): under `shell-frame` the section lists every mind as the Agents
 * rail does (mark, name, the shared state word), a row opens that mind's
 * space on Settings, what is for all agents stays (Add agent, the connected
 * apps and their readiness), the second roster and its detail go, and every
 * control the detail had works in the mind's own Settings tab. Shots in
 * WP24_SHOTS, measures in WP24_SHOTS/measures; the base build at
 * WP24_BASE_URL.
 */

const SHOTS = process.env.WP24_SHOTS ?? "test-results/shell-settings-agents";
const BASE_URL = process.env.WP24_BASE_URL ?? "http://127.0.0.1:4330";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const X_OPEN = "1".repeat(64);
const ROOT_OPEN = "e4".repeat(32);

const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();
const secs = (minutesAgo: number) =>
  Math.floor((NOW - minutesAgo * 60_000) / 1000);

type Mode = "dark" | "light";

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
  { name: "Wren", pubkey: WREN, status: "running" },
] as const;

/** Luca at work with Claude Code, Atlas in a side conversation with Luca:
 *  three different words for the three minds. */
const SEEDS = {
  exchanges: [
    {
      bucket: 3,
      channelName: "general",
      deadline: secs(-30),
      exchangeId: X_OPEN,
      members: [LUCA, ATLAS],
      openedBy: LUCA,
      rootEventId: ROOT_OPEN,
      spent: 1,
    },
  ],
  runtimeTasks: [
    {
      channelName: "design",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code" as const,
      startedAt: iso(10),
      state: "active" as const,
      summary: "Rail glass plates",
      taskId: "task-glass",
      updatedAt: iso(2),
    },
  ],
};

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A shot, its hash, and how many colours it has (a blank proves nothing). */
async function shot(page: Page, name: string, still = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    path,
    ...(still
      ? {
          animations: "disabled" as const,
          mask: [page.locator("[data-flagoff-mask]")],
        }
      : {}),
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test.use({ trace: "off", video: "off" });
test.describe.configure({ timeout: 300_000 });

async function boot(
  page: Page,
  {
    hash,
    mode = "dark",
    origin,
    shell = true,
  }: { hash: string; mode?: Mode; origin?: string; shell?: boolean },
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await page.emulateMedia({ colorScheme: mode });
  if (shell)
    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    }, FEATURE_OVERRIDES_STORAGE_KEY);
  if (mode === "light")
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-theme", "paper");
      window.localStorage.setItem("buzz-follow-system", "false");
    });
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    ...SEEDS,
  });
  await expect(async () => {
    await page.goto(`${origin ?? ""}/#${hash}`);
    // Settings draws its own section list in the rail's place.
    await expect(
      page.locator(
        "[data-testid='app-sidebar'], [data-testid='settings-view']",
      ),
    ).not.toHaveCount(0, { timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
}

async function minds(page: Page) {
  const list = page.getByTestId("settings-agents-minds");
  await expect(list.locator("li").first()).toBeVisible({ timeout: 20_000 });
  return list.locator("li").evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector(".luca-place-row-title")?.textContent ?? "",
      main: row.hasAttribute("data-main"),
      detail: row.querySelector(".luca-place-row-detail")?.textContent ?? "",
      word: row.querySelector("[data-mind-state]")?.textContent ?? "",
      markBox: (() => {
        // Every mind wears the agent mark (BETA14_RELEASE.md WP-33,
        // Decided 7), drawn in its 20 face column.
        const body = row.querySelector(".luca-place-row-face");
        const title = row.querySelector(".luca-place-row-title");
        if (!body || !title) return null;
        const a = body.getBoundingClientRect();
        const b = title.getBoundingClientRect();
        return {
          body: { x: a.x, y: a.y, w: a.width, h: a.height },
          centreDy: a.y + a.height / 2 - (b.y + b.height / 2),
          gap: b.x - (a.x + a.width),
        };
      })(),
      mark: row.querySelector(".luca-place-row-face [data-agent-mark]")
        ? "agent-mark"
        : "none",
      box: (() => {
        const box = row.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
      })(),
    })),
  );
}

// ── d1–d5: the page, at both sizes, in both modes ───────────────────────
for (const mode of ["dark", "light"] as const) {
  for (const [width, height] of [
    [1440, 900],
    [800, 500],
  ] as const) {
    test(`the page lists every mind (${mode}, ${width})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width, height },
      });
      const page = await context.newPage();
      await boot(page, { hash: "/settings?section=agents", mode });
      const rows = await minds(page);
      await expect(page.getByTestId("settings-mind-state").first()).toHaveText(
        /\w/,
      );
      // Wait for the words to settle on the live signals.
      await expect
        .poll(
          async () =>
            (await minds(page)).find((row) => row.name === "Atlas")?.word,
        )
        .toBe("talking");
      const settled = await minds(page);
      const page_ = page.getByTestId("settings-agents");
      const removed = {
        search: await page.getByPlaceholder("Search agents").count(),
        filters: await page_
          .getByRole("button", { name: /^(Running|Attention)$/ })
          .count(),
        tabs: await page
          .locator("[data-testid^='settings-agent-tab-']")
          .count(),
        openInLibrary: await page.getByText("Open in Agent Library").count(),
        roster: await page
          .locator("[data-testid='agent-library-roster']")
          .count(),
      };
      const eyebrow = await page
        .getByTestId("settings-agents-connected")
        .locator("h2")
        .evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            text: node.textContent,
            fontFamily: style.fontFamily,
            textTransform: style.textTransform,
            fontSize: style.fontSize,
            letterSpacing: style.letterSpacing,
            className: node.className,
          };
        });
      const connected = await page
        .getByTestId("settings-agents-connected")
        .locator("li")
        .evaluateAll((items) =>
          items.map((item) => ({
            name: item.querySelector(".luca-place-row-title")?.textContent,
            readiness: item.querySelector(".luca-place-row-note")?.textContent,
          })),
        );
      // Small capital labels anywhere on the page: every one is the mono.
      const caps = await page.getByTestId("settings-agents").evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")]
          .filter(
            (node) =>
              node.childElementCount === 0 &&
              (node.textContent ?? "").trim().length > 0 &&
              getComputedStyle(node).textTransform === "uppercase",
          )
          .map((node) => ({
            text: node.textContent,
            fontFamily: getComputedStyle(node).fontFamily,
          })),
      );
      const overflow = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(
          "[data-luca-settings-page]",
        );
        return {
          page: scroller
            ? scroller.scrollWidth - scroller.clientWidth
            : "no page",
          window: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const hash = await shot(page, `page-${mode}-${width}`);
      measure(`page-${mode}-${width}`, {
        rows: settled,
        firstRows: rows.length,
        removed,
        eyebrow,
        caps,
        connected,
        overflow,
        hash,
      });
      expect(settled.length).toBeGreaterThanOrEqual(3);
      expect(settled[0]?.name).toBe("Luca");
      expect(settled[0]?.main).toBe(true);
      expect(settled.every((row) => row.mark === "agent-mark")).toBe(true);
      expect(Object.values(removed).every((count) => count === 0)).toBe(true);
      // A section's label is sentence case, never the mono capitals
      // (WP-33, Decided 2).
      expect(eyebrow.text).toBe("Apps");
      expect(eyebrow.fontFamily).not.toMatch(/Fragment Mono/);
      expect(eyebrow.textTransform).toBe("none");
      expect(eyebrow.fontSize).toBe("12.5px");
      for (const each of caps) expect(each.fontFamily).toMatch(/Fragment Mono/);
      expect(connected.length).toBeGreaterThan(0);
      await expect(page.getByTestId("settings-agents-add")).toBeVisible();
      await context.close();
    });
  }
}

// ── d1: the words agree with the Agents rail, and a row opens Settings ───
test("d1: the rail's words, and a row opens the mind's Settings", async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await boot(page, { hash: "/settings?section=agents" });
  await expect
    .poll(
      async () => (await minds(page)).find((row) => row.name === "Atlas")?.word,
    )
    .toBe("talking");
  const here = await minds(page);
  await page.goto("/#/agents");
  await expect(page.getByTestId("place-rail-agents")).toBeVisible();
  const rail = await page
    .getByTestId("place-rail-agents")
    .locator(".luca-rail-row")
    .evaluateAll((rows) =>
      rows.map((row) => ({
        name: row.querySelector(".luca-rail-row-name")?.textContent ?? "",
        word: row.querySelector(".luca-rail-note")?.textContent ?? "",
        home: row.getAttribute("data-home") ?? "",
      })),
    );
  const minds_ = rail.filter(
    (row) =>
      row.home.startsWith("agents:mind:") ||
      row.home.startsWith("agents:persona:"),
  );
  const agree = here.map((row) => ({
    name: row.name,
    settings: row.word,
    rail: minds_.find((each) => each.name === row.name)?.word ?? null,
  }));
  await page.goto("/#/settings?section=agents");
  await page.getByTestId(`settings-mind-${ATLAS}`).locator("button").click();
  await expect(page.getByTestId("mind-space")).toBeVisible();
  // Their Settings is its own page now (WP-43): its title, back to them.
  await expect(page.getByTestId("mind-settings-title")).toHaveText("Settings");
  await expect(page.getByTestId("mind-back")).toHaveText("Atlas");
  const url = decodeURIComponent(page.url());
  const head = await page.getByTestId("agent-settings").innerText();
  const hash = await shot(page, "d1-row-opens-atlas-settings");
  measure("d1", { agree, rail: minds_, url, head, hash });
  expect(url).toContain(`profile=${ATLAS}`);
  expect(url).toContain("page=settings");
  for (const each of agree) expect(each.settings).toBe(each.rail);
  await context.close();
});

// ── d2: what is for all agents ──────────────────────────────────────────
test("d2: Add agent and a connected app open their homes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await boot(page, { hash: "/settings?section=agents" });
  await minds(page);
  await page.getByTestId("settings-agents-add").click();
  await expect(page).toHaveURL(/#\/agents/);
  const addUrl = page.url();
  await expect(
    page.getByRole("dialog", { name: "Add an agent" }),
  ).toBeVisible();
  const dialog = await page.getByRole("dialog").count();
  const addHash = await shot(page, "d2-add-agent");
  await page.goto("/#/settings?section=agents");
  const first = page
    .getByTestId("settings-agents-connected")
    .locator("li button")
    .first();
  const name = await first.innerText();
  await first.click();
  // The app's card is in Chats, under Apps, since WP-34.
  await expect(page).toHaveURL(/#\/apps\//);
  const connectedUrl = page.url();
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  const card = await page.getByTestId("connected-app-card").count();
  measure("d2", { addUrl, dialog, addHash, name, connectedUrl, card });
  expect(dialog).toBeGreaterThan(0);
  await context.close();
});

// ── d4: every moved control, used once in a mind's space ─────────────────
for (const mode of ["dark", "light"] as const) {
  test(`d4: the detail's controls work in Atlas's Settings (${mode})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await boot(page, {
      hash: `/agents?profile=${ATLAS}&section=settings`,
      mode,
    });
    await expect(page.getByTestId("agent-settings")).toBeVisible({
      timeout: 20_000,
    });
    const used: Record<string, unknown> = {};
    const commands = () =>
      page.evaluate(() => [
        ...((window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
          .__BUZZ_E2E_COMMANDS__ ?? []),
      ]);

    // Every control is one row or one pane away (BETA14_RELEASE.md WP-43,
    // Decided 11 and 12).
    // Instructions: Atlas has a folder, so its Instructions row is its own
    // instructions.md (Decided 13, shown once); none written says "Not set"
    // (WP-43, round 3).
    const instructions = page.getByTestId("mind-row-instructions");
    await expect(instructions).toContainText("Not set");
    used.instructions = await instructions.innerText();
    // Runtime configuration: Advanced › {Harness} settings.
    await page.getByTestId("mind-row-config").click();
    const config = page.getByTestId("mind-config");
    await expect(config).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Loading .* settings…$/)).toHaveCount(0, {
      timeout: 10_000,
    });
    used.runtimeConfig = (await config.innerText()).slice(0, 400);
    await page.getByTestId("mind-back").click();
    // Recheck: the Harness pane.
    await page.getByTestId("mind-row-harness").click();
    const before = (await commands()).filter(
      (each) => each === "list_managed_agents",
    ).length;
    await page.getByTestId("mind-setting-recheck").click();
    await expect
      .poll(
        async () =>
          (await commands()).filter((each) => each === "list_managed_agents")
            .length,
      )
      .toBeGreaterThan(before);
    used.recheck = { before, after: (await commands()).length };
    const runtimeHash = await shot(page, `d4-runtime-${mode}`);
    await page.getByTestId("mind-back").click();

    // Permissions: Canvas tools, boundary, continuity, Manage MCP access.
    await page.getByTestId("mind-row-permissions").click();
    const canvas = page.getByTestId("agent-artifact-mcp-capability");
    await expect(canvas).toBeVisible();
    used.canvas = {
      text: await canvas.innerText(),
      state: await canvas.getAttribute("data-capability-state"),
    };
    expect(used.canvas.state).toBeTruthy();
    const permissions = page.getByTestId("mind-pane-permissions");
    await expect(permissions.getByText("Fail closed")).toBeVisible();
    await expect(
      permissions.getByText("Private continuity jobs never receive MCP tools."),
    ).toBeVisible();
    await expect(page.getByTestId("resident-access-control")).toBeVisible();
    const permissionsHash = await shot(page, `d4-permissions-${mode}`);
    await page.getByTestId("mind-back").click();

    // Identity: kind and authority, in Advanced › Network identity.
    await page.getByTestId("mind-row-identity").click();
    const identity = page.getByTestId("mind-pane-identity");
    await expect(identity.getByText("Kind")).toBeVisible();
    await expect(identity.getByText("Authority")).toBeVisible();
    used.identity = await identity.innerText();
    await page.getByTestId("mind-back").click();
    await expect(page.getByTestId("agent-settings")).toBeVisible();

    // Wakes with the app and its restart switch (already there) still work.
    await page.getByRole("switch", { name: "Wakes with the app" }).click();
    await page.getByTestId("agent-settings-auto-restart").click();
    await expect
      .poll(async () => {
        const all = await commands();
        return (
          all.includes("set_managed_agent_start_on_app_launch") &&
          all.includes("set_managed_agent_auto_restart")
        );
      })
      .toBe(true);
    used.switches = true;

    await page.getByTestId("mind-row-permissions").click();
    await page.getByTestId("mind-setting-manage-mcp").click();
    await expect(page).toHaveURL(/section=connections/);
    used.manageMcp = page.url();
    measure(`d4-${mode}`, { used, runtimeHash, permissionsHash });
    await context.close();
  });
}

// ── d4: a way in that names a mind lands in its Settings ─────────────────
test("d4: an agent's request for its runtime lands in its own Settings", async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 500 },
  });
  const page = await context.newPage();
  await boot(page, {
    hash: `/settings?section=agents&settingsAgent=${ATLAS}&settingsAgentTab=runtime`,
  });
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  // Its runtime is Settings › Harness now (WP-43, Decided 3).
  await expect(page.getByTestId("mind-pane-harness")).toBeVisible();
  await expect(page.getByTestId("mind-back")).toHaveText("Settings");
  const url = decodeURIComponent(page.url());
  const hash = await shot(page, "d4-way-in-800");
  measure("d4-way-in", { url, hash });
  expect(url).toContain(`profile=${ATLAS}`);
  expect(url).toContain("page=settings/harness");
  await context.close();
});

// ── the flag off: the same as the base build ────────────────────────────
test("flag off: Settings > Agents the same as the base build", async ({
  browser,
}) => {
  const result: Record<string, unknown> = {};
  // With one port to serve on (WP-43), the base and this build are shot in
  // two runs: FLAG_OFF_PHASE=base against the base build (twice, to prove it
  // steady), then FLAG_OFF_PHASE=here against this one, which compares.
  const phase = process.env.FLAG_OFF_PHASE;
  const prior: Record<string, { base: string; baseAgain: string }> =
    phase === "here"
      ? JSON.parse(readFileSync(`${SHOTS}/measures/flag_off-base.json`, "utf8"))
      : {};
  for (const [name, hash] of [
    ["agents", "/settings?section=agents"],
    [
      "agents-capabilities",
      `/settings?section=agents&settingsAgent=${ATLAS}&settingsAgentTab=capabilities`,
    ],
    [
      "agents-advanced-640",
      `/settings?section=agents&settingsAgent=${ATLAS}&settingsAgentTab=advanced`,
    ],
  ] as const) {
    const hashes: string[] = [];
    const colours: number[] = [];
    const runs = (
      [
        ["here", ""],
        ["base", BASE_URL],
        ["base-again", BASE_URL],
      ] as const
    ).filter(
      ([label]) =>
        !phase || (phase === "here" ? label === "here" : label !== "here"),
    );
    for (const [label, origin] of runs) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport:
          name === "agents-advanced-640"
            ? { width: 1180, height: 760 }
            : { width: 1440, height: 900 },
      });
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false });
      await expect(page.getByTestId("settings-agents")).toBeVisible({
        timeout: 20_000,
      });
      await page.clock.runFor(2_000);
      await page.waitForTimeout(1500);
      // Only small animated marks are masked: the residents' eyes.
      await page.evaluate(() => {
        for (const node of document.querySelectorAll<HTMLElement>(
          "canvas, [data-resident-mark], .agent-identity-specimen",
        )) {
          const box = node.getBoundingClientRect();
          if (box.width < 200 && box.height < 200)
            node.setAttribute("data-flagoff-mask", "");
        }
      });
      hashes.push(await shot(page, `flagoff-${name}-${label}`, true));
      colours.push(await page.evaluate(() => document.body.innerText.length));
      await context.close();
    }
    if (phase === "base") {
      result[name] = {
        base: hashes[0],
        baseAgain: hashes[1],
        baseStable: hashes[0] === hashes[1],
        textLength: colours,
      };
      continue;
    }
    const here = hashes[0];
    const base = phase === "here" ? prior[name]?.base : hashes[1];
    const baseAgain = phase === "here" ? prior[name]?.baseAgain : hashes[2];
    result[name] = {
      here,
      base,
      baseAgain,
      same: here === base,
      baseStable: base === baseAgain,
      textLength: colours,
    };
  }
  if (phase === "base") {
    measure("flag_off-base", result);
    return;
  }
  measure("flag_off", result);
  for (const each of Object.values(result) as { same: boolean }[])
    expect(each.same).toBe(true);
});
