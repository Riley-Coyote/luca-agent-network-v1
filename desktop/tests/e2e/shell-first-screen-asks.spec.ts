import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-16, the first screen and one ask everywhere
 * (docs/luca/rail-system/SHELL_BUILD.md): under `shell-frame` Luca's empty
 * conversation lies on the one card in every frame and mode, its name
 * readable; a permission, a question and a proposal are drawn the same in a
 * room's pending stack, in Needs you and in a mind's Notebook, their answers
 * under their words at every width, as the study's tinted answers; the
 * new-messages pill centres on the conversation's own column. With the flag
 * off, the room's cards and the first screen match the base build by hash.
 * Shots land in WP16_SHOTS, measurements in WP16_SHOTS/measures; the base
 * build is at WP16_BASE_URL.
 */

const SHOTS = process.env.WP16_SHOTS ?? "test-results/shell-first-screen-asks";
const BASE_URL = process.env.WP16_BASE_URL ?? "http://127.0.0.1:4320";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

type Mode = "dark" | "light";
type Frame = "black" | "liquid";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A shot, its hash, and whether it is one colour (a shot that is one colour
 *  proves nothing when compared). */
async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  const png = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path,
    ...(clip ? { clip } : {}),
  });
  const colours = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length && seen.size < 64; i += 4 * 97)
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, png.toString("base64"));
  return {
    colours,
    hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    path,
  };
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 300_000 });

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
  { name: "Wren", pubkey: WREN, status: "running" },
] as const;

const PERMISSION = {
  pendingId: "permission-release",
  request: {
    acp_request_id: "acp-permission-release",
    action_preview: "./scripts/release.sh --dry-run",
    conversation_id: GENERAL,
    options: [
      { kind: "allow_once", name: "Allow once", option_id: "allow" },
      { kind: "reject_once", name: "Reject", option_id: "reject" },
    ],
    protocol: "luca.managed.permission.v1" as const,
    resident_pubkey: ATLAS,
    session_epoch: 1,
    title: "Run the release script",
    turn_id: "turn-permission-release",
  },
};

const QUESTION = {
  channelName: "general",
  pendingId: "question-word",
  request: {
    fields: [
      {
        description: null,
        key: "word",
        kind: "single" as const,
        label: "Which word",
        options: [
          { description: null, label: "Preview", value: "preview" },
          { description: null, label: "Beta", value: "beta" },
        ],
        required: true,
      },
    ],
    message: "Should the Tidepool page say preview or beta?",
    resident_pubkey: LUCA,
  },
};

const PROPOSAL = {
  channelName: "general",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  proposalId: "proposal-notes",
  residentPubkey: LUCA,
  runtimeFamily: "claude_code" as const,
  summary: "Update the release notes for beta 7.",
};

/** The study's skies behind the clear page (as the review drew them), so
 *  Liquid Glass shows what lies behind its cards. */
const SKIES = `
:root:root[data-luca-frame-glass].dark {
  background: linear-gradient(180deg, #16223f 0%, #2d3561 38%, #8c5a74 68%, #e19a6b 100%) !important;
}
:root:root[data-luca-frame-glass]:not(.dark) {
  background: linear-gradient(180deg, #8fb3d9 0%, #b9cfe6 40%, #e3dccf 75%, #f0d6b8 100%) !important;
}`;

async function boot(
  page: Page,
  {
    asks = true,
    baseURL,
    flag = true,
    frame = "black",
    hash = "/",
    log = [],
    mode = "dark",
  }: {
    asks?: boolean;
    baseURL?: string;
    flag?: boolean;
    frame?: Frame;
    hash?: string;
    log?: string[];
    mode?: Mode;
  } = {},
) {
  page.on("pageerror", (error) => log.push(`PAGE ERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      log.push(`console ${message.text().slice(0, 300)}`);
  });
  await page.emulateMedia({ colorScheme: mode });
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      value: JSON.stringify({ "shell-frame": flag }),
    },
  );
  if (mode === "light")
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-theme", "paper");
      window.localStorage.setItem("buzz-follow-system", "false");
    });
  if (frame === "liquid")
    // Stands in for Tauri and PolyphonicGlass.swift (shell-one-card.spec.ts).
    await page.addInitScript(() => {
      const glass = window as typeof window & {
        __POLYPHONIC_NATIVE_GLASS__?: number;
        isTauri?: boolean;
        webkit?: unknown;
      };
      glass.isTauri = true;
      window.localStorage.setItem("polyphonic-frame", "glass");
      glass.webkit = {
        messageHandlers: { polyphonicGlass: { postMessage: () => {} } },
      };
      glass.__POLYPHONIC_NATIVE_GLASS__ = 1;
    });
  await installMockBridge(page, {
    managedAgents: [...AGENTS],
    managedInputs: asks ? [QUESTION] : [],
    managedPermissions: asks ? [PERMISSION] : [],
    runtimeTaskProposals: asks ? [PROPOSAL] : [],
  } as never);
  const at = `${baseURL ?? ""}/#${hash}`;
  await expect(async () => {
    await page.goto(at);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000 });
  if (frame === "liquid") {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-luca-frame-glass"),
          ),
        { timeout: 20_000 },
      )
      .toBe("liquid");
    await page.addStyleTag({ content: SKIES });
  }
}

/** The page's own pixels: a region's median colour, and every pixel's
 *  contrast against a text colour (WCAG). */
async function pixels(
  page: Page,
  regions: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >,
  text?: string,
) {
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  return page.evaluate(
    async ({ b64, regions, text }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
      g.drawImage(bmp, 0, 0);
      const scale = bmp.width / window.innerWidth;
      const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r: number, gg: number, b: number) =>
        0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      const ratio = (a: number, b: number) =>
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      let ink: number | null = null;
      if (text) {
        const m = text.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
        if (m) ink = lum(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      const out: Record<string, unknown> = {};
      for (const [name, r] of Object.entries(regions)) {
        const d = g.getImageData(
          Math.round(r.x * scale),
          Math.round(r.y * scale),
          Math.max(1, Math.round(r.width * scale)),
          Math.max(1, Math.round(r.height * scale)),
        ).data;
        const ch: number[][] = [[], [], []];
        const contrasts: number[] = [];
        for (let i = 0; i < d.length; i += 4) {
          ch[0].push(d[i]);
          ch[1].push(d[i + 1]);
          ch[2].push(d[i + 2]);
          if (ink !== null)
            contrasts.push(ratio(ink, lum(d[i], d[i + 1], d[i + 2])));
        }
        const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
        const pct = (a: number[], p: number) =>
          a.sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
        out[name] = {
          median: [med(ch[0]), med(ch[1]), med(ch[2])],
          ...(ink !== null
            ? {
                contrastMedian: Math.round(pct(contrasts, 0.5) * 100) / 100,
                contrastP05: Math.round(pct(contrasts, 0.05) * 100) / 100,
              }
            : {}),
        };
      }
      return out;
    },
    { b64: png.toString("base64"), regions, text },
  );
}

const near = (a: number[], b: number[], within = 3) =>
  a.every((v, i) => Math.abs(v - b[i]) <= within);

// ── d1 · the first screen sits on the card ─────────────────────────────
for (const frame of ["black", "liquid"] as Frame[]) {
  for (const mode of ["dark", "light"] as Mode[]) {
    test(`d1 first screen on the card: ${frame} ${mode}`, async ({ page }) => {
      const log: string[] = [];
      await boot(page, { asks: false, frame, log, mode });
      const name = page.locator(".luca-first-message-greeting__name");
      await expect(name).toBeVisible({ timeout: 20_000 });
      await expect(
        page.locator(".luca-first-message-surface canvas"),
      ).toHaveCount(1);
      await page.mouse.move(1430, 890);
      await page.waitForTimeout(600);
      const facts = await page.evaluate(() => {
        const card = document.querySelector("[data-luca-one-card]");
        const surface = document.querySelector(".luca-first-message-surface");
        const rail = document.querySelector('[data-testid="app-sidebar"]');
        const title = document.querySelector(
          ".luca-first-message-greeting__name",
        );
        const box = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r
            ? { x: r.x, y: r.y, width: r.width, height: r.height }
            : null;
        };
        return {
          card: card ? getComputedStyle(card).backgroundColor : null,
          rail: box(rail),
          surface: box(surface),
          title: box(title),
          titleColor: title ? getComputedStyle(title).color : null,
        };
      });
      if (!facts.surface || !facts.title || !facts.rail || !facts.titleColor)
        throw new Error("Expected the first screen.");
      // The rail's empty foot, and the conversation's own corners away from
      // the drop and the composer: where only the ground shows.
      const s = facts.surface;
      const t = facts.title;
      // The title's own pixels: the name hidden, the ground behind it read.
      await name.evaluate((el) => {
        (el as HTMLElement).style.visibility = "hidden";
      });
      const behind = await pixels(
        page,
        { behindTitle: { x: t.x, y: t.y, width: t.width, height: t.height } },
        facts.titleColor,
      );
      await name.evaluate((el) => {
        (el as HTMLElement).style.visibility = "";
      });
      const px = await pixels(page, {
        conversation: {
          x: s.x + s.width * 0.5 - 60,
          y: s.y + s.height - 70,
          width: 120,
          height: 40,
        },
        conversationTop: {
          x: s.x + s.width - 160,
          y: s.y + 40,
          width: 120,
          height: 40,
        },
        rail: {
          x: facts.rail.x + 40,
          y: facts.rail.y + facts.rail.height - 140,
          width: 120,
          height: 20,
        },
      });
      const file = await shot(page, `d1-first-screen-${frame}-${mode}`);
      const card = (facts.card?.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const result = { ...facts, behind, card, file, log, px };
      measure(`d1-${frame}-${mode}`, result);
      const conv = (px.conversation as { median: number[] }).median;
      const top = (px.conversationTop as { median: number[] }).median;
      const rail = (px.rail as { median: number[] }).median;
      expect(near(conv, card, 4), `conversation ${conv} vs card ${card}`).toBe(
        true,
      );
      expect(near(top, card, 4), `top ${top} vs card ${card}`).toBe(true);
      expect(near(rail, conv, 4), `rail ${rail} vs conversation ${conv}`).toBe(
        true,
      );
      expect(
        (behind.behindTitle as { contrastMedian: number }).contrastMedian,
      ).toBeGreaterThanOrEqual(4.5);
      expect(log).toEqual([]);
    });
  }
}

// ── d2 · one ask, one drawing ──────────────────────────────────────────
/** Every ask on the page, read the same way wherever it is drawn: its words,
 *  its answers and where they sit, and the answers' material. */
async function readAsks(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("li.luca-ask")).map(
      (node) => {
        const what = node.querySelector(".luca-place-row-what");
        const answers = node.querySelector(".luca-ask-answers");
        const box = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r
            ? {
                x: Math.round(r.x * 10) / 10,
                y: Math.round(r.y * 10) / 10,
                width: Math.round(r.width * 10) / 10,
                height: Math.round(r.height * 10) / 10,
              }
            : null;
        };
        const buttons = Array.from(
          node.querySelectorAll<HTMLElement>(".luca-ask-answers button"),
        );
        return {
          testId: node.getAttribute("data-testid"),
          title:
            node.querySelector(".luca-place-row-title")?.textContent ?? null,
          summary:
            node.querySelector(".luca-place-row-summary")?.textContent ?? null,
          extra: node.querySelector(".luca-ask-extra")?.textContent ?? null,
          what: box(what),
          answersBox: box(answers),
          answers: buttons.map((button) => ({
            label: button.textContent,
            box: box(button),
            fill: getComputedStyle(button).backgroundColor,
            border: getComputedStyle(button).borderTopWidth,
            radius: getComputedStyle(button).borderTopLeftRadius,
            fontSize: getComputedStyle(button).fontSize,
          })),
        };
      },
    ),
  );
}

type Ask = Awaited<ReturnType<typeof readAsks>>[number];

/** The ask's own words, wherever it is: what is asked, and the answers. */
const words = (ask: Ask) => ({
  title: ask.title,
  answers: ask.answers.map((each) => each.label),
});

function underText(ask: Ask) {
  const what = ask.what;
  const first = ask.answers[0]?.box;
  if (!what || !first) return false;
  // Every answer starts below the ask's words, on their left axis.
  return (
    ask.answers.every(
      (each) => each.box !== null && each.box.y >= what.y + what.height - 0.5,
    ) && Math.abs(first.x - what.x) <= 1
  );
}

function tinted(ask: Ask) {
  return ask.answers.every(
    (each) =>
      each.border === "0px" &&
      /rgba\(\d+, \d+, \d+, 0\.08\)/.test(each.fill) &&
      each.radius === "8px",
  );
}

async function openRoomStack(page: Page) {
  await expect(page.getByTestId("runtime-task-proposal-row")).toBeAttached({
    timeout: 20_000,
  });
  // The room's stack folds where 40% of the conversation can't hold one ask
  // (WP-23): Show opens it.
  if (await page.getByTestId("pending-held").isVisible())
    await page.getByTestId("pending-held").click();
  // The fold: open it when it is closed.
  if (
    (await page.getByTestId("managed-permission-card").count()) === 0 &&
    (await page.locator(".luca-work-tray__permission-trigger").count()) > 0
  )
    await page.locator(".luca-work-tray__permission-trigger").click();
  await expect(page.getByTestId("managed-permission-card")).toBeVisible({
    timeout: 20_000,
  });
}

for (const [width, height, mode] of [
  [1440, 900, "dark"],
  [1440, 900, "light"],
  [800, 500, "dark"],
] as const) {
  test(`d2 one ask everywhere at ${width} ${mode}`, async ({ page }) => {
    const log: string[] = [];
    await page.setViewportSize({ width, height });
    await boot(page, { hash: `/channels/${GENERAL}`, log, mode });
    await openRoomStack(page);
    await page.mouse.move(width - 10, height - 10);
    const room = await readAsks(page);
    const roomShot = await shot(page, `d2-room-${width}-${mode}`);
    // Details on request: the preview opens under the room's row.
    const permission = page.getByTestId("managed-permission-card");
    await permission.getByRole("button", { name: "Details" }).click();
    const roomDetails = await permission
      .getByTestId("needs-you-details")
      .innerText();
    await permission.getByRole("button", { name: "Hide details" }).click();
    // The proposal's long form, opened under its row: its Run is quiet.
    const proposal = page.getByTestId("runtime-task-proposal-row");
    await proposal.getByTestId("needs-you-proposal-change").click();
    const run = page.getByTestId("runtime-task-confirm");
    await expect(run).toBeVisible();
    const runStyle = await run.evaluate((el) => ({
      fill: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderTopWidth,
      text: el.textContent,
    }));
    const formShot =
      width === 1440 && mode === "dark"
        ? await shot(page, `d2-room-change-${width}-${mode}`)
        : null;
    await proposal.getByTestId("needs-you-proposal-change").click();

    await page.evaluate(() => {
      window.location.hash = "#/needs-you";
    });
    await expect(page.getByTestId("needs-you-card")).toBeVisible({
      timeout: 20_000,
    });
    await page.mouse.move(width - 10, height - 10);
    const needs = await readAsks(page);
    const needsShot = await shot(page, `d2-needs-you-${width}-${mode}`);

    await page.evaluate((luca) => {
      window.location.hash = `#/agents?profile=${luca}`;
    }, LUCA);
    await expect(page.getByTestId("mind-asks")).toBeVisible({
      timeout: 20_000,
    });
    await page.mouse.move(width - 10, height - 10);
    const notebook = await readAsks(page);
    const notebookShot =
      width === 1440 ? await shot(page, `d2-notebook-${width}-${mode}`) : null;

    measure(`d2-${width}-${mode}`, {
      log,
      needs,
      needsShot,
      notebook,
      notebookShot,
      room,
      roomDetails,
      roomShot,
      formShot,
      runStyle,
    });

    const byTitle = (list: Ask[], title: string) =>
      list.find((each) => each.title === title);
    for (const title of [
      "Run the release script",
      "Should the Tidepool page say preview or beta?",
      "Update the release notes for beta 7.",
    ]) {
      const inRoom = byTitle(room, title);
      const inNeeds = byTitle(needs, title);
      expect(inRoom, `room: ${title}`).toBeTruthy();
      expect(inNeeds, `needs you: ${title}`).toBeTruthy();
      if (!inRoom || !inNeeds) continue;
      expect(words(inRoom)).toEqual(words(inNeeds));
      expect(underText(inRoom), `room answers under: ${title}`).toBe(true);
      expect(underText(inNeeds), `needs answers under: ${title}`).toBe(true);
      expect(tinted(inRoom), `room tint: ${title}`).toBe(true);
      expect(tinted(inNeeds), `needs tint: ${title}`).toBe(true);
    }
    const question = byTitle(
      notebook,
      "Should the Tidepool page say preview or beta?",
    );
    expect(question, "the notebook's question").toBeTruthy();
    if (question) {
      expect(words(question)).toEqual(
        words(
          byTitle(
            needs,
            "Should the Tidepool page say preview or beta?",
          ) as Ask,
        ),
      );
      expect(underText(question)).toBe(true);
      expect(tinted(question)).toBe(true);
    }
    expect(roomDetails).toContain("./scripts/release.sh --dry-run");
    expect(runStyle.border).toBe("0px");
    expect(runStyle.fill).toMatch(/rgba\(\d+, \d+, \d+, 0\.08\)/);
    expect(log).toEqual([]);
  });
}

// ── d3 · the new-messages pill centres on the conversation's column ────
/** Words in the room, then the timeline scrolled up and more arriving, so
 *  the conversation's own pill shows. */
async function raisePill(page: Page) {
  await page.evaluate(() => {
    const emit = (
      window as unknown as {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (message: unknown) => void;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!emit) throw new Error("Expected the mock bridge.");
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 40; i++)
      emit({
        channelName: "general",
        content: `Line ${i} of the release notes, read aloud.`,
        createdAt: now + i,
        kind: 9,
        pubkey: "c".repeat(64),
      });
  });
  await page.waitForTimeout(1200);
  // Read back up the conversation, as a person would.
  const column = await page.getByTestId("channel-drop-zone").boundingBox();
  if (!column) throw new Error("Expected the conversation's column.");
  await page.mouse.move(
    column.x + column.width / 2,
    column.y + column.height * 0.4,
  );
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const emit = (
      window as unknown as {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (message: unknown) => void;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 3; i++)
      emit({
        channelName: "general",
        content: `A late word ${i}.`,
        createdAt: now + 60 + i,
        kind: 9,
        pubkey: "b".repeat(64),
      });
  });
  await page.waitForTimeout(900);
}

async function readPill(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0
        ? { x: Math.round(r.x * 10) / 10, width: Math.round(r.width * 10) / 10 }
        : null;
    };
    const pill = box(
      document.querySelector('[data-testid="message-scroll-to-latest"]'),
    );
    const column = box(
      document.querySelector('[data-testid="channel-drop-zone"]'),
    );
    const rail = box(document.querySelector('[data-testid="app-sidebar"]'));
    const railPill = box(
      document.querySelector('[data-testid="sidebar-more-unread-below"]'),
    );
    const centre = (b: { x: number; width: number } | null) =>
      b ? Math.round((b.x + b.width / 2) * 10) / 10 : null;
    return {
      column,
      columnCentre: centre(column),
      pill,
      pillCentre: centre(pill),
      pillLabel:
        document.querySelector('[data-testid="message-scroll-to-latest"]')
          ?.textContent ?? null,
      rail,
      railPill,
      railPillCentre: centre(railPill),
      railCentre: centre(rail),
      windowCentre: window.innerWidth / 2,
    };
  });
}

for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  test(`d3 the pill on the conversation's column at ${width}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await page.setViewportSize({ width, height });
    await boot(page, { asks: false, hash: `/channels/${GENERAL}`, log });
    await page.waitForTimeout(1200);
    await raisePill(page);
    await expect(page.getByTestId("message-scroll-to-latest")).toBeVisible({
      timeout: 10_000,
    });
    const plain = await readPill(page);
    const plainShot = await shot(page, `d3-pill-${width}`);
    await page.getByTestId("shell-lip-details").dispatchEvent("click");
    await page.waitForTimeout(1200);
    const withCard = await readPill(page);
    const cardShot =
      width === 800 ? await shot(page, `d3-pill-${width}-details`) : null;
    measure(`d3-${width}`, { cardShot, log, plain, plainShot, withCard });

    const onColumn = (read: typeof plain) =>
      read.pill !== null &&
      read.column !== null &&
      read.pillCentre !== null &&
      read.columnCentre !== null &&
      Math.abs(read.pillCentre - read.columnCentre) <= 1 &&
      read.pill.x >= read.column.x &&
      read.pill.x + read.pill.width <= read.column.x + read.column.width;
    expect(onColumn(plain), JSON.stringify(plain)).toBe(true);
    if (withCard.column)
      // A right card beside the conversation: still its column's centre.
      expect(onColumn(withCard), JSON.stringify(withCard)).toBe(true);
    else expect(withCard.pill).toBeNull();
    // What sits on the rail is the rail's own (more unread below), centred
    // on the rail, never the conversation's.
    for (const read of [plain, withCard])
      if (read.railPill && read.railCentre !== null)
        expect(
          Math.abs((read.railPillCentre ?? 0) - read.railCentre),
        ).toBeLessThanOrEqual(1);
    expect(log).toEqual([]);
  });
}

// ── flag off: the room's cards and the first screen, as the base ───────
test("flag off matches the base", async ({ page }) => {
  const out: Record<string, unknown> = {};
  const roomAt = async (origin: string | undefined, width: number) => {
    await page.setViewportSize({ width, height: width === 800 ? 500 : 900 });
    await boot(page, {
      baseURL: origin,
      flag: false,
      hash: `/channels/${GENERAL}`,
    });
    await expect(page.getByTestId("runtime-task-confirmation")).toBeVisible({
      timeout: 20_000,
    });
    if (
      (await page.getByTestId("managed-permission-card").count()) === 0 &&
      (await page.locator(".luca-work-tray__permission-trigger").count()) > 0
    )
      await page.locator(".luca-work-tray__permission-trigger").click();
    await expect(page.getByTestId("managed-permission-card")).toBeVisible();
    await page.mouse.move(width - 10, 10);
    await page.waitForTimeout(1200);
  };
  /** Small animated canvases (the eyes) are masked; anything that fills
   *  the window never is. */
  const still = async (name: string) => {
    await waitForAnimations(page);
    await page.waitForTimeout(300);
    const masks = [];
    for (const canvas of await page.locator("canvas").all()) {
      const box = await canvas.boundingBox();
      if (box && box.width < 200 && box.height < 200) masks.push(canvas);
    }
    mkdirSync(SHOTS, { recursive: true });
    const path = `${SHOTS}/${name}.png`;
    const png = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      mask: masks,
      path,
    });
    const distinct = await page.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length && seen.size < 64; i += 4 * 97)
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    }, png.toString("base64"));
    return {
      colours: distinct,
      hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
      masked: masks.length,
    };
  };
  for (const width of [1440, 800]) {
    await roomAt(BASE_URL, width);
    const base = await still(`flagoff-room-${width}-base`);
    await roomAt(undefined, width);
    const mine = await still(`flagoff-room-${width}`);
    out[`room-${width}`] = { base, mine };
  }
  // The first screen: its ground read where only the ground shows, in both
  // builds, with motion (the film moves, the ground does not).
  const ground = async (origin: string | undefined) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, { asks: false, baseURL: origin, flag: false });
    // Without the frame the app opens on a new conversation: Luca's is a
    // row of the sidebar.
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Luca", exact: true })
      .first()
      .click();
    await expect(page.locator(".luca-first-message-surface")).toBeVisible({
      timeout: 20_000,
    });
    await page.mouse.move(1430, 890);
    await page.waitForTimeout(2500);
    const surface = await page
      .locator(".luca-first-message-surface")
      .boundingBox();
    if (!surface) return { surface: null };
    return {
      surface,
      ...(await pixels(page, {
        corner: {
          x: surface.x + surface.width - 160,
          y: surface.y + 40,
          width: 120,
          height: 40,
        },
        foot: {
          x: surface.x + surface.width * 0.5 - 60,
          y: surface.y + surface.height - 70,
          width: 120,
          height: 40,
        },
      })),
    };
  };
  out.groundBase = await ground(BASE_URL);
  out.groundMine = await ground(undefined);
  measure("flag-off", out);
  for (const width of [1440, 800]) {
    const each = out[`room-${width}`] as {
      base: { hash: string; colours: number };
      mine: { hash: string; colours: number };
    };
    expect(each.mine.colours).toBeGreaterThan(8);
    expect(each.mine.hash).toBe(each.base.hash);
  }
  expect(out.groundMine).toEqual(out.groundBase);
});

// ── d4 · the join banner clear of the Quick Chat button ────────────────
for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  test(`d4 the join banner clear of Quick Chat at ${width}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await page.setViewportSize({ width, height });
    await boot(page, { asks: false, hash: `/channels/${GENERAL}`, log });
    // A room you haven't joined, found the way a person would.
    await page.evaluate(() => {
      const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "KeyK",
          ctrlKey: !isMac,
          key: "k",
          metaKey: isMac,
        }),
      );
    });
    await page.getByTestId("search-dialog-input").fill("critique");
    await page
      .getByTestId("search-results")
      .getByText("Design critique notes for the browse flow.")
      .click();
    const banner = page.getByTestId("join-banner");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await page.mouse.move(10, height / 2);
    await page.waitForTimeout(600);
    const read = await page.evaluate(() => {
      const box = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r
          ? {
              left: Math.round(r.left * 10) / 10,
              right: Math.round(r.right * 10) / 10,
              top: Math.round(r.top * 10) / 10,
              bottom: Math.round(r.bottom * 10) / 10,
            }
          : null;
      };
      const banner = document.querySelector('[data-testid="join-banner"]');
      const join = banner?.querySelector("button") ?? null;
      return {
        banner: box(banner),
        join: box(join),
        joinText: join?.textContent ?? null,
        launcher: box(document.querySelector(".qc-launcher")),
        paddingRight: banner ? getComputedStyle(banner).paddingRight : null,
      };
    });
    const file = await shot(page, `d4-join-${width}`);
    measure(`d4-${width}`, { file, log, read });
    expect(read.join && read.launcher).toBeTruthy();
    if (read.join && read.launcher) {
      const overlaps =
        read.join.right > read.launcher.left &&
        read.join.left < read.launcher.right &&
        read.join.bottom > read.launcher.top &&
        read.join.top < read.launcher.bottom;
      expect(overlaps, JSON.stringify(read)).toBe(false);
      // 8 short of the launcher, as the composer keeps.
      expect(read.launcher.left - read.join.right).toBeGreaterThanOrEqual(7.5);
    }
    expect(log).toEqual([]);
  });
}
