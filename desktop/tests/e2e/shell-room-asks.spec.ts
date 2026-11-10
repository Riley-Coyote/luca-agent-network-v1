import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-23, the room's asks in the page (docs/luca/rail-system/SHELL_BUILD.md):
 * under `shell-frame` a room's asks and its current work are one stack
 * between the timeline and the message box, every item a flat row under one
 * label; nothing of it lies over a message; at rest it takes at most 40% of
 * the conversation, folding to one line where that can't hold one ask; an
 * open form may take the whole height and shows whole at 1440 × 900; "Jump to
 * latest" sits above it. Every answer still works in place. With the flag
 * off, the room matches the base build by hash. Shots land in WP23_SHOTS,
 * measurements in WP23_SHOTS/measures; the base build is at WP23_BASE_URL.
 */

const SHOTS = process.env.WP23_SHOTS ?? "test-results/shell-room-asks";
const BASE_URL = process.env.WP23_BASE_URL ?? "http://127.0.0.1:4330";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

type Mode = "dark" | "light";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A shot, its hash, and how many colours it has (one colour proves nothing).
 *  Only small animated canvases (the eyes) are ever masked. */
async function shot(page: Page, name: string, maskEyes = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  const mask = [];
  if (maskEyes)
    for (const canvas of await page.locator("canvas").all()) {
      const box = await canvas.boundingBox();
      if (box && box.width < 200 && box.height < 200) mask.push(canvas);
    }
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  const png = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    mask,
    path,
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
    masked: mask.length,
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

const isoAgo = (seconds: number) =>
  new Date(Date.now() - seconds * 1000).toISOString();

const PERMISSION = {
  offer: { alwaysHere: true, deny: true, once: true, projectLabel: "studio" },
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

/** A question with more than one field: Answer opens its form. */
const LONG_QUESTION = {
  channelName: "general",
  pendingId: "question-launch",
  request: {
    fields: [
      {
        description: null,
        key: "day",
        kind: "text" as const,
        label: "Launch day",
        options: [],
        required: true,
      },
      {
        description: null,
        key: "who",
        kind: "text" as const,
        label: "Who tells the list",
        options: [],
        required: false,
      },
    ],
    message: "When should the beta 7 notes go out, and who sends them?",
    resident_pubkey: LUCA,
  },
};

const PROPOSAL = {
  channelName: "general",
  createdAt: isoAgo(300),
  proposalId: "proposal-notes",
  residentPubkey: LUCA,
  runtimeFamily: "claude_code" as const,
  summary: "Update the release notes for beta 7.",
};

const FINISHED = {
  channelName: "general",
  completedAt: isoAgo(160),
  residentPubkey: LUCA,
  runtimeFamily: "claude_code" as const,
  startedAt: isoAgo(180),
  state: "succeeded" as const,
  summary: "Fix the failing build",
  taskId: "task-build",
  workingFolder: "/synthetic/projects/studio",
};

const RUNNING = {
  channelName: "general",
  residentPubkey: LUCA,
  runtimeFamily: "codex" as const,
  startedAt: isoAgo(40),
  state: "active" as const,
  summary: "Check the release script",
  taskId: "task-check",
  updatedAt: isoAgo(2),
  workingFolder: "/synthetic/projects/studio",
};

async function boot(
  page: Page,
  {
    baseURL,
    flag = true,
    hash = `/channels/${GENERAL}`,
    log = [],
    longQuestion = false,
    mode = "dark",
    running = false,
  }: {
    baseURL?: string;
    flag?: boolean;
    hash?: string;
    log?: string[];
    longQuestion?: boolean;
    mode?: Mode;
    /** A task still running beside the finished one. */
    running?: boolean;
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
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: LUCA,
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
    ],
    managedInputs: longQuestion ? [QUESTION, LONG_QUESTION] : [QUESTION],
    managedPermissions: [PERMISSION],
    runtimeTaskProposals: [PROPOSAL],
    runtimeTasks: running ? [FINISHED, RUNNING] : [FINISHED],
  } as never);
  await expect(async () => {
    await page.goto(`${baseURL ?? ""}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000 });
}

/** The room's geometry: the stack against the card, the conversation, the
 *  messages and the pills. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const section = document.querySelector('[data-testid="channel-drop-zone"]');
    const stack = document.querySelector('[data-testid="room-stack"]');
    const composer = document.querySelector(
      '[data-testid="channel-composer-overlay"] [data-testid="message-composer"]',
    );
    const viewport = document.querySelector("[data-luca-timeline-viewport]");
    const s = stack?.getBoundingClientRect();
    const v = viewport?.getBoundingClientRect();
    // Every message row drawn in the timeline's viewport, and any part of
    // it under the stack.
    const rows = [
      ...document.querySelectorAll(
        '[data-luca-timeline-viewport] [data-testid="message-row"]',
      ),
    ]
      .map((row) => row.getBoundingClientRect())
      .filter((r) => v && r.bottom > v.top && r.top < v.bottom);
    const overlaps = s
      ? rows.filter(
          (r) =>
            r.left < s.right &&
            r.right > s.left &&
            r.top < s.bottom &&
            r.bottom > s.top,
        ).length
      : null;
    const newest = rows.reduce<DOMRect | null>(
      (last, r) => (!last || r.bottom > last.bottom ? r : last),
      null,
    );
    // Words inside the stack that some other element covers: a row cut by
    // something floating over it.
    const covered: string[] = [];
    if (stack) {
      const walker = document.createTreeWalker(stack, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? "").trim();
        if (!text || !n.parentElement) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || !s) continue;
        if (r.bottom < s.top || r.top > s.bottom) continue;
        const hit = document.elementFromPoint(
          r.left + Math.min(r.width, 12) / 2,
          r.top + r.height / 2,
        );
        if (hit && !stack.contains(hit)) covered.push(text.slice(0, 30));
      }
    }
    const paint = (el: Element | null) => {
      if (!el) return null;
      const st = getComputedStyle(el);
      return {
        background: st.backgroundColor,
        border: `${st.borderTopWidth} ${st.borderTopColor}`,
        radius: st.borderRadius,
        shadow: st.boxShadow,
      };
    };
    const label = stack?.querySelector(".luca-room-stack__head");
    const labelText = stack?.querySelector(
      ".luca-room-stack__head .type-eyebrow",
    );
    const sectionTop = section?.getBoundingClientRect().top ?? 0;
    const composerTop = composer?.getBoundingClientRect().top ?? 0;
    return {
      askRows: [...(stack?.querySelectorAll(".luca-ask-row") ?? [])].map(
        (row) => ({
          box: box(row),
          paint: paint(row),
          text: (row as HTMLElement).innerText
            .replace(/\s+/g, " ")
            .slice(0, 60),
        }),
      ),
      card: box(document.querySelector("[data-luca-one-card]")),
      composer: box(composer),
      conversation: composerTop - sectionTop,
      covered,
      folded: stack?.hasAttribute("data-folded") ?? null,
      fit: stack?.hasAttribute("data-fit") ?? null,
      label: label
        ? (label.textContent ?? "").replace(/\s+/g, " ").trim()
        : null,
      labelFont: labelText ? getComputedStyle(labelText).fontFamily : null,
      labels: [...(stack?.querySelectorAll(".type-eyebrow") ?? [])]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => (el.textContent ?? "").trim()),
      newest: newest ? { bottom: newest.bottom, top: newest.top } : null,
      overlaps,
      receipt: paint(
        stack?.querySelector('[data-testid="runtime-task-result-receipt"]') ??
          null,
      ),
      rows: rows.length,
      section: box(section),
      stack: box(stack),
      stackPaint: paint(stack ?? null),
      strays: [
        ...document.querySelectorAll(
          '[data-testid="conversation-work-tray-expanded"], .luca-ask-stack, .luca-work-tray__permission-trigger',
        ),
      ].length,
      viewport: box(viewport),
      whole: stack?.hasAttribute("data-whole") ?? null,
    };
  });
}

async function settle(page: Page, width: number) {
  await expect(page.getByTestId("room-stack")).toBeVisible({
    timeout: 20_000,
  });
  // A successful result belongs in chat/history, never beside the approvals.
  await expect(page.getByTestId("runtime-task-result-receipt")).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.mouse.move(width - 10, 10);
  await page.waitForTimeout(1200);
}

// ── d1 · d2 · d3 at rest: one stack in the page ─────────────────────────
for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const mode of ["dark", "light"] as Mode[]) {
    test(`at rest ${width} ${mode}`, async ({ page }) => {
      const log: string[] = [];
      await page.setViewportSize({ width, height });
      await boot(page, { log, mode });
      await settle(page, width);
      const rest = await geometry(page);
      const restShot = await shot(page, `rest-${width}-${mode}`);
      // Folded (it can't hold one ask, or the owner folded it), then shown.
      let folded = null;
      let shown = null;
      if (rest.folded) {
        folded = rest;
        await page.getByTestId("pending-held").click();
        await page.waitForTimeout(400);
        shown = await geometry(page);
        await shot(page, `shown-${width}-${mode}`);
      } else {
        await page.getByTestId("room-stack-hide").click();
        await page.waitForTimeout(400);
        folded = await geometry(page);
        await shot(page, `folded-${width}-${mode}`);
        await page.getByTestId("pending-held").click();
        await page.waitForTimeout(400);
        shown = await geometry(page);
      }
      measure(`rest-${width}-${mode}`, { folded, log, rest, restShot, shown });
      for (const each of [rest, folded, shown]) {
        if (!each?.stack || !each.section) throw new Error("no stack");
        // d1: nothing of the stack over a message; never above the card's
        // top; the newest message in view above it.
        expect(each.overlaps).toBe(0);
        expect(each.covered).toEqual([]);
        expect(each.stack.y).toBeGreaterThanOrEqual(each.section.y);
        expect(each.newest).not.toBeNull();
        expect(each.newest?.bottom ?? 0).toBeLessThanOrEqual(each.stack.y);
        expect(each.newest?.bottom ?? 0).toBeGreaterThan(each.section.y);
        // d2: no container left over from the floating tray and plate.
        expect(each.strays).toBe(0);
        expect(each.stackPaint?.shadow).toBe("none");
        expect(each.stackPaint?.background).toBe("rgba(0, 0, 0, 0)");
      }
      // d3: at rest at most 40% of the conversation.
      if (rest.stack && !rest.whole)
        expect(rest.stack.height).toBeLessThanOrEqual(
          rest.conversation * 0.4 + 1,
        );
      // Approved temporary surfaces: the waiting lip names the actual ask,
      // instead of making the owner reopen it just to remember the question.
      expect(folded?.label).toContain(PERMISSION.request.title);
      expect(folded?.label).toContain("Waiting · 3");
      expect(shown?.labels.map((each) => each.toLowerCase())).toEqual([
        "needs you",
      ]);
      // Shown where 40% can't hold an ask: just its label and that ask.
      if (rest.folded && shown?.stack) {
        expect(shown.fit).toBe(true);
        const first = shown.askRows[0]?.box;
        if (!first) throw new Error("no ask");
        expect(first.y + first.height).toBeLessThanOrEqual(
          shown.stack.y + shown.stack.height + 0.5,
        );
      } else if (shown?.stack)
        expect(shown.stack.height).toBeLessThanOrEqual(
          shown.conversation * 0.4 + 1,
        );
      expect(shown?.labelFont ?? "").toContain("Fragment Mono");
      for (const row of shown?.askRows ?? []) {
        expect(row.paint?.shadow).toBe("none");
        expect(row.paint?.background).toBe("rgba(0, 0, 0, 0)");
        expect(row.paint?.border.startsWith("0px")).toBe(true);
      }
      expect(shown?.receipt).toBeNull();
      expect(restShot.colours).toBeGreaterThan(8);
    });
  }
}

// ── d3 · an open form shows whole ───────────────────────────────────────
for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  test(`forms open whole at ${width}`, async ({ page }) => {
    const log: string[] = [];
    await page.setViewportSize({ width, height });
    await boot(page, { log, longQuestion: true });
    await settle(page, width);
    if (await page.getByTestId("pending-held").isVisible())
      await page.getByTestId("pending-held").click();
    const out: Record<string, unknown> = {};
    for (const [name, open, form] of [
      [
        "change",
        "needs-you-proposal-change",
        '[data-testid="runtime-task-confirmation"]',
      ],
      ["answer", "needs-you-question-answer", ".luca-ask-form"],
    ] as const) {
      await page.getByTestId(open).click();
      await page.waitForTimeout(600);
      const opened = await geometry(page);
      const formBox = await page.locator(form).boundingBox();
      const bodyBox = await page
        .locator(".luca-room-stack__body")
        .boundingBox();
      await shot(page, `form-${name}-${width}`);
      await page.getByTestId(open).click();
      await page.waitForTimeout(600);
      const closed = await geometry(page);
      out[name] = { bodyBox, closed, formBox, opened };
      if (!opened.stack || !opened.section || !formBox || !bodyBox)
        throw new Error("no form");
      expect(opened.whole).toBe(true);
      expect(opened.stack.y).toBeGreaterThanOrEqual(opened.section.y);
      expect(opened.overlaps).toBe(0);
      if (width === 1440) {
        // Whole: inside the stack's visible body, and on the screen.
        expect(formBox.y).toBeGreaterThanOrEqual(bodyBox.y - 0.5);
        expect(formBox.y + formBox.height).toBeLessThanOrEqual(
          bodyBox.y + bodyBox.height + 0.5,
        );
      } else {
        // Brought into view: its top inside the body.
        expect(formBox.y).toBeGreaterThanOrEqual(bodyBox.y - 0.5);
        expect(formBox.y).toBeLessThan(bodyBox.y + bodyBox.height);
      }
      expect(closed.whole).toBe(false);
      if (closed.stack && !closed.folded && !closed.fit)
        expect(closed.stack.height).toBeLessThanOrEqual(
          closed.conversation * 0.4 + 1,
        );
    }
    measure(`forms-${width}`, { log, ...out });
  });
}

// ── work in the page: a running task and its details, in the stack ──────
test("running work and its details lie in the stack", async ({ page }) => {
  const log: string[] = [];
  await boot(page, { log, running: true });
  await settle(page, 1440);
  const item = page.locator(".luca-room-stack .luca-runtime-task-item");
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.locator(".luca-activity-item__resident").click();
  const tray = page.getByTestId("conversation-work-tray-expanded");
  await expect(tray).toBeVisible();
  await page.mouse.move(1430, 10);
  await page.waitForTimeout(600);
  const read = await geometry(page);
  const trayPaint = await tray.evaluate((el) => {
    const st = getComputedStyle(el);
    return {
      background: st.backgroundColor,
      border: st.borderTopWidth,
      position: st.position,
      shadow: st.boxShadow,
    };
  });
  const trayBox = await tray.boundingBox();
  await shot(page, "work-open-1440");
  measure("work", { log, read, trayBox, trayPaint });
  expect(trayPaint).toEqual({
    background: "rgba(0, 0, 0, 0)",
    border: "0px",
    position: "static",
    shadow: "none",
  });
  expect(read.overlaps).toBe(0);
  if (!read.stack || !trayBox) throw new Error("no stack");
  expect(trayBox.y).toBeGreaterThanOrEqual(read.stack.y);
});

// ── d4 · "Jump to latest" above the stack ────────────────────────────────
async function fill(page: Page, count: number, parentEventId?: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) ?? false,
      ),
    )
    .toBe(true);
  return page.evaluate(
    ({ count, parentEventId }) => {
      let id = "";
      for (let i = 0; i < count; i++) {
        const event = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: `Release note line ${i + 1}: what changed, and why it matters to the people reading it.`,
          parentEventId: parentEventId ?? null,
        }) as { id: string } | undefined;
        if (i === 0 && event) id = event.id;
      }
      return id;
    },
    { count, parentEventId },
  );
}

async function pillAboveStack(page: Page, pill: string) {
  const viewport = await page
    .locator("[data-luca-timeline-viewport]")
    .boundingBox();
  if (!viewport) throw new Error("no timeline");
  await page.mouse.move(
    viewport.x + viewport.width / 2,
    viewport.y + viewport.height * 0.25,
  );
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(120);
  }
  await expect(page.getByTestId(pill)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const pillBox = await page.getByTestId(pill).boundingBox();
  const stackBox = await page.getByTestId("room-stack").boundingBox();
  return { pillBox, stackBox };
}

test("jump to latest above the stack, in the room and a thread", async ({
  page,
}) => {
  const log: string[] = [];
  await boot(page, { log });
  await settle(page, 1440);
  const root = await fill(page, 1);
  await fill(page, 24);
  await page.waitForTimeout(800);
  const room = await pillAboveStack(page, "message-scroll-to-latest");
  await shot(page, "pill-room-1440");
  // The thread: the first message's replies, opened as one exchange.
  await fill(page, 24, root);
  await page.waitForTimeout(600);
  await page.goto(`/#/channels/${GENERAL}?thread=${root}`);
  await expect(page.getByTestId("room-stack")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1200);
  const threadHeld = await pillAboveStack(page, "message-scroll-to-latest");
  await shot(page, "pill-thread-held-1440");
  await page.getByTestId("pending-held").click();
  await page.waitForTimeout(600);
  const threadShown = await pillAboveStack(page, "message-scroll-to-latest");
  await shot(page, "pill-thread-shown-1440");
  measure("pill", { log, room, threadHeld, threadShown });
  for (const each of [room, threadHeld, threadShown]) {
    if (!each.pillBox || !each.stackBox) throw new Error("no pill");
    expect(each.pillBox.y + each.pillBox.height).toBeLessThanOrEqual(
      each.stackBox.y,
    );
  }
});

// ── every answer still works in place ───────────────────────────────────
test("every answer works in place", async ({ browser, baseURL }) => {
  const log: string[] = [];
  const calls: string[] = [];
  /** A fresh window on the room, each answer's command logged as the bridge
   *  receives it. */
  const fresh = async () => {
    const context = await browser.newContext({
      baseURL,
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.text().startsWith("[wp23]")) calls.push(message.text());
    });
    await page.addInitScript(() => {
      const target = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = target.__TAURI_INTERNALS__ ?? {};
      target.__TAURI_INTERNALS__ = internals;
      let real: ((c: string, p?: unknown, o?: unknown) => unknown) | undefined;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke) => {
          real = invoke;
        },
        get: () => (command: string, payload?: unknown, options?: unknown) => {
          if (
            /^(resolve_managed_permission|resolve_managed_input|respond_runtime_task_proposal)$/.test(
              command,
            )
          )
            console.log(`[wp23] ${command} ${JSON.stringify(payload)}`);
          return real?.(command, payload, options);
        },
      });
    });
    await boot(page, { log, longQuestion: true });
    await settle(page, 1440);
    return { context, page };
  };
  const answer = async (testId: string, gone: string) => {
    const { context, page } = await fresh();
    await page.getByTestId(testId).click();
    await expect(page.locator(gone)).toHaveCount(0, { timeout: 10_000 });
    await context.close();
  };
  for (const key of ["deny", "once", "always"])
    await answer(
      `needs-you-permission-${key}`,
      '[data-testid="managed-permission-card"]',
    );
  await answer(
    "needs-you-proposal-not-now",
    '[data-testid="runtime-task-proposal-row"]',
  );
  await answer(
    "needs-you-question-skip",
    '[data-testid="managed-input-card"][data-pending-id="question-word"]',
  );
  const { context, page } = await fresh();
  // Run waits for a ready runtime and a folder; whether it could is reported.
  const runEnabled = await page
    .getByTestId("needs-you-proposal-run")
    .isEnabled();
  // Change… opens the card under the row, Run task in it.
  await page.getByTestId("needs-you-proposal-change").click();
  await expect(page.getByTestId("runtime-task-confirmation")).toBeVisible();
  await page.getByTestId("needs-you-proposal-change").click();
  // A question's choice, then Send.
  const word = page.locator(
    '[data-testid="managed-input-card"][data-pending-id="question-word"]',
  );
  await word.getByRole("button", { name: "Beta" }).click();
  await word.getByTestId("needs-you-question-send").click();
  await expect(word).toHaveCount(0, { timeout: 10_000 });
  // Answer opens the long question's form; its Send answers in place.
  await page.getByTestId("needs-you-question-answer").click();
  const form = page.locator(".luca-ask-form");
  await expect(form).toBeVisible();
  const fields = form.locator("input, textarea");
  await fields.first().fill("Thursday");
  await form.getByRole("button", { name: /send/i }).click();
  await expect(
    page.locator(
      '[data-testid="managed-input-card"][data-pending-id="question-launch"]',
    ),
  ).toHaveCount(0, { timeout: 10_000 });
  await context.close();
  measure("answers", { calls, log, runEnabled });
  for (const command of [
    '"tense":"deny"',
    '"tense":"once"',
    '"tense":"always_here"',
    '"approved":false',
    '"action":"declined"',
    '"action":"answered"',
  ])
    expect(calls.some((call) => call.includes(command))).toBe(true);
});

// ── flag off: the room as the base draws it ─────────────────────────────
test("flag off matches the base", async ({ page }) => {
  const out: Record<string, unknown> = {};
  // Both builds are drawn from one fixed time, so a minute turning between
  // the two captures can't change a time drawn behind the ask stack. Each
  // page load starts its clock at the same whole minute and lets it run.
  // Only the date moves: Playwright's clock.install (luca/shell-status.spec.ts)
  // also fakes the timers and frames, and here that left the rail's selected
  // row drawn differently in every capture.
  const pinned = Math.ceil(Date.now() / 60_000) * 60_000;
  await page.addInitScript((pinned) => {
    const RealDate = Date;
    const offset = pinned - RealDate.now();
    class PinnedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...(args as [number]));
      }
      static now() {
        return RealDate.now() + offset;
      }
    }
    window.Date = PinnedDate as DateConstructor;
  }, pinned);
  const roomAt = async (origin: string | undefined, width: number) => {
    await page.setViewportSize({ width, height: width === 800 ? 500 : 900 });
    await boot(page, { baseURL: origin, flag: false });
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
  for (const width of [1440, 800]) {
    await roomAt(BASE_URL, width);
    const base = await shot(page, `flagoff-room-${width}-base`, true);
    await roomAt(undefined, width);
    const mine = await shot(page, `flagoff-room-${width}`, true);
    out[`room-${width}`] = { base, mine };
  }
  // The room scrolled up, its "Jump to latest" where the base puts it.
  const pillAt = async (origin: string | undefined) => {
    await roomAt(origin, 1440);
    await fill(page, 24);
    await page.waitForTimeout(600);
    const viewport = await page
      .locator("[data-luca-timeline-viewport]")
      .boundingBox();
    if (!viewport) throw new Error("no timeline");
    // Wheel over the timeline beside the column: flag off, the tray and the
    // proposal's card fill the column itself.
    await page.mouse.move(viewport.x + 40, viewport.y + 120);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -1200);
      await page.waitForTimeout(120);
    }
    await expect(page.getByTestId("message-scroll-to-latest")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
    return page.getByTestId("message-scroll-to-latest").boundingBox();
  };
  out.pillBase = await pillAt(BASE_URL);
  out.pillMine = await pillAt(undefined);
  measure("flag-off", out);
  for (const width of [1440, 800]) {
    const each = out[`room-${width}`] as {
      base: { hash: string; colours: number };
      mine: { hash: string; colours: number };
    };
    expect(each.mine.colours).toBeGreaterThan(8);
    expect(each.mine.hash).toBe(each.base.hash);
  }
  expect(out.pillMine).toEqual(out.pillBase);
});
