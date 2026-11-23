import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-44, an agent asks to start a project. A resident's `propose_project`
 * reaches the window as a card in the conversation it asked in: "Start a
 * project called “Ghost app”?", who asks, one faint line, Create · Not now.
 * Create runs the + button's own creation and leaves the owner where they
 * are, with one line and a way into the new chat; Not now creates nothing.
 * The card comes back after a reload while the host still waits, shows in
 * Needs you, warns about a name already in use, and works with the new look
 * off. The + button still opens what it makes. Shots land in WP44_SHOTS,
 * measurements in WP44_SHOTS/measures; when WP44_KEEP names a folder, every
 * shot is also copied there, out of reach of Playwright's own clean-up.
 */

const SHOTS = process.env.WP44_SHOTS ?? "test-results/wp44";
const KEEP = process.env.WP44_KEEP;
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PURPOSE = "A home for the Ghost companion app.";

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 240_000 });

type Seed = {
  requestId: string;
  conversationId?: string;
  channelName?: string;
  residentPubkey: string;
  projectName: string;
  purpose: string;
  includeResidents?: string[];
  createdAt: string;
};

const ask = (overrides: Partial<Seed> = {}): Seed => ({
  channelName: "general",
  createdAt: new Date(Date.now() - 30_000).toISOString(),
  projectName: "Ghost app",
  purpose: PURPOSE,
  requestId: "project-request-ghost",
  residentPubkey: LUCA,
  ...overrides,
});

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** One scoped shot and its hash. */
async function shot(page: Page, target: Locator, name: string) {
  await page.mouse.move(1430, 890);
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await target.screenshot({ animations: "disabled", caret: "hide", path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  measure(`shot_${name}`, { hash, path });
  keep(path, name);
  return hash;
}

/** A copy of a shot where the next run cannot wipe it. */
function keep(path: string, name: string) {
  if (!KEEP) return;
  mkdirSync(KEEP, { recursive: true });
  copyFileSync(path, `${KEEP}/${name}.png`);
}

/** Console errors and warnings, page errors, minus the ResizeObserver note,
 *  headless Chrome's own GPU driver notes (counted in measures/driver) and
 *  the test harness's stale-listener note (counted in measures/stale_listener):
 *  Tauri's event mock never drops a listener on unlisten (it reads `id`, the
 *  call sends `eventId`), so an event sent after a card leaves the screen
 *  still knocks on the callback that card already let go. */
function watchConsole(page: Page) {
  const seen: string[] = [];
  let driver = 0;
  let stale = 0;
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (text.includes("ResizeObserver loop")) return;
    if (text.startsWith("[TAURI] Couldn't find callback id")) {
      stale += 1;
      measure("stale_listener", { notes: stale });
      return;
    }
    if (text.includes("GL Driver Message")) {
      driver += 1;
      measure("driver", { gpuDriverNotes: driver, last: text });
      return;
    }
    seen.push(`${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => seen.push(`pageerror: ${error.message}`));
  return seen;
}

async function boot(
  page: Page,
  {
    hash = `/channels/${GENERAL}`,
    light = false,
    mock = {},
    projects,
    proposals = [],
    shell = true,
  }: {
    hash?: string;
    light?: boolean;
    /** Mock failures: a chat that can't be made, residents who can't join,
     *  a hand-back that can't land. */
    mock?: {
      addChannelMembersErrors?: (string | null)[];
      createChannelErrors?: string[];
      finishProjectProposalErrors?: string[];
    };
    /** Projects already in the owner's store, by label. */
    projects?: string[];
    proposals?: Seed[];
    shell?: boolean;
  } = {},
) {
  const consoleSeen = watchConsole(page);
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
    projectProposals: proposals,
    ...mock,
  });
  await page.addInitScript(
    ({ key, light, on, labels }) => {
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
      if (!labels) return;
      const community = (
        JSON.parse(localStorage.getItem("buzz-communities") ?? "[]") as {
          pubkey: string;
          relayUrl: string;
        }[]
      )[0];
      if (!community) return;
      const scope = (value: string) =>
        encodeURIComponent(value.trim().toLowerCase());
      const storeKey = `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`;
      if (localStorage.getItem(storeKey)) return;
      localStorage.setItem(
        storeKey,
        JSON.stringify({
          version: 1,
          projects: labels.map((label) => ({
            id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            label,
          })),
          assignments: {},
        }),
      );
    },
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      labels: projects ?? null,
      light,
      on: shell,
    },
  );
  await expect(async () => {
    await page.goto(`/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
  return consoleSeen;
}

const card = (page: Page, requestId = "project-request-ghost") =>
  page.locator(`[data-project-request="${requestId}"]`).first();
const home = (page: Page, id: string) => page.getByTestId(`rail-home-${id}`);
const projectChats = (page: Page, id: string) =>
  page.locator(
    `[data-shell-rail] [data-home-group="${id}"] [data-rail-focus="session"][data-channel-id]`,
  );

function commandsOf(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).map((entry) => ({
      command: entry.command,
      payload: entry.payload,
    })),
  );
}

function answersOf(page: Page) {
  return page.evaluate(() => window.__BUZZ_E2E_PROJECT_ANSWERS__ ?? []);
}

async function expectCardWords(page: Page, names: string) {
  const row = card(page);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("Start a project called “Ghost app”?");
  await expect(row).toContainText("Luca asks");
  await expect(row.getByTestId("project-proposal-purpose")).toHaveText(PURPOSE);
  await expect(row.getByTestId("project-proposal-joins")).toHaveText(
    `${names} its first chat, general.`,
  );
  await expect(row.getByTestId("project-proposal-create")).toHaveText("Create");
  await expect(row.getByTestId("project-proposal-not-now")).toHaveText(
    "Not now",
  );
}

/** Luca's one chat, from the rail; its id. */
async function openLucaChat(page: Page) {
  await page
    .getByTestId("rail-home-luca")
    .locator('[data-rail-focus="home"]')
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .not.toContain(GENERAL);
  const lucaChat = (await page.evaluate(() => window.location.hash)).match(
    /channels\/([^/?]+)/,
  )?.[1];
  expect(lucaChat).toBeTruthy();
  return lucaChat ?? "";
}

/** The owner asks Luca for a project in its chat, and Luca says one line back. */
async function talkInLucaChat(page: Page, lucaChat: string) {
  await page.waitForTimeout(500);
  await page.evaluate(
    ({ id, luca }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Expected the mock bridge.");
      const now = Math.floor(Date.now() / 1000);
      emit({
        channelId: id,
        content: "Start a project for the Ghost app.",
        createdAt: now - 20,
        kind: 9,
      });
      emit({
        channelId: id,
        content:
          "Happy to. I've put a card here so you can make it with one click.",
        createdAt: now - 10,
        kind: 9,
        pubkey: luca,
      });
    },
    { id: lucaChat, luca: LUCA },
  );
  await expect(
    page.getByText("I've put a card here so you can make it"),
  ).toBeVisible({ timeout: 15_000 });
}

/** The card in its place: Luca's last line above it, the composer below. */
async function shotInPlace(page: Page, name: string) {
  await page.mouse.move(1430, 890);
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  const boxes = await Promise.all(
    [
      page.getByText("I've put a card here so you can make it"),
      card(page),
      page.getByTestId("message-composer").first(),
    ].map((target) => target.boundingBox()),
  );
  const present = boxes.filter((box) => box !== null);
  expect(present).toHaveLength(3);
  const pad = 32;
  const left = Math.min(...present.map((box) => box.x)) - pad;
  const top = Math.min(...present.map((box) => box.y)) - pad;
  const right = Math.max(...present.map((box) => box.x + box.width)) + pad;
  const bottom = Math.max(...present.map((box) => box.y + box.height)) + pad;
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    clip: {
      height: Math.min(900, bottom) - Math.max(0, top),
      width: Math.min(1440, right) - Math.max(0, left),
      x: Math.max(0, left),
      y: Math.max(0, top),
    },
    path,
  });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  measure(`shot_${name}`, { hash, path });
  keep(path, name);
  return hash;
}

test("(a) a request arrives, Create makes the project and the owner stays", async ({
  page,
}) => {
  const consoleSeen = await boot(page);
  const lucaChat = await openLucaChat(page);
  await talkInLucaChat(page, lucaChat);
  await expect(card(page)).toHaveCount(0);
  // Luca asks while the owner is in its chat.
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ channelName: undefined, conversationId: lucaChat }),
  );
  await expectCardWords(page, "Luca joins");
  await expect(
    card(page).getByTestId("project-proposal-duplicate"),
  ).toHaveCount(0);
  const hashes = [await shotInPlace(page, "01-card-dark")];

  await card(page).getByTestId("project-proposal-create").click();
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toBeVisible({ timeout: 15_000 });
  await expect(settled).toContainText("Ghost app is in your projects.");
  await expect(settled.getByTestId("project-proposal-open")).toHaveText(
    "Open Ghost app",
  );
  await expect(card(page)).toHaveCount(0);

  // The owner is still in Luca's chat.
  expect(await page.evaluate(() => window.location.hash)).toContain(
    `/channels/${lucaChat}`,
  );

  // The rail lists the project with its first chat.
  await expect(home(page, "project:ghost-app")).toBeVisible();
  await expect(projectChats(page, "project:ghost-app")).toHaveCount(1);
  await expect(projectChats(page, "project:ghost-app")).toContainText(
    "general",
  );
  const chatId = await projectChats(page, "project:ghost-app").getAttribute(
    "data-channel-id",
  );

  const commands = await commandsOf(page);
  const created = commands.filter(
    (entry) => entry.command === "create_channel",
  );
  const members = commands.filter(
    (entry) => entry.command === "add_channel_members",
  );
  const answers = await answersOf(page);
  measure("create_flow", { answers, chatId, created, members });
  expect(created).toHaveLength(1);
  expect(JSON.stringify(created[0]?.payload)).toContain(PURPOSE);
  expect(JSON.stringify(created[0]?.payload)).toContain('"private"');
  expect(members).toHaveLength(1);
  expect(members[0]?.payload).toMatchObject({
    channelId: chatId,
    pubkeys: [LUCA],
    role: "bot",
  });
  expect(answers).toEqual([
    {
      answer: { chatId, outcome: "created", projectId: "ghost-app" },
      requestId: "project-request-ghost",
    },
  ]);

  hashes.push(await shot(page, settled, "03-created-dark"));
  hashes.push(
    await shot(
      page,
      page.locator("[data-shell-rail]"),
      "04-rail-with-project-dark",
    ),
  );

  // "Open Ghost app" goes into the new chat.
  await settled.getByTestId("project-proposal-open").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(chatId ?? "missing");
  measure("console_a", consoleSeen);
  expect(consoleSeen).toEqual([]);
  measure("hashes_a", hashes);
});

test("(a, light) the card in the paper look", async ({ page }) => {
  const consoleSeen = await boot(page, { light: true });
  const lucaChat = await openLucaChat(page);
  await talkInLucaChat(page, lucaChat);
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ channelName: undefined, conversationId: lucaChat }),
  );
  await expectCardWords(page, "Luca joins");
  await shotInPlace(page, "02-card-light");
  measure("console_light", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(b) Not now creates nothing and the card clears", async ({ page }) => {
  const consoleSeen = await boot(page, { proposals: [ask()] });
  await expectCardWords(page, "Luca joins");
  await card(page).getByTestId("project-proposal-not-now").click();
  await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("project-proposal-settled")).toHaveCount(0);
  const commands = (await commandsOf(page)).map((entry) => entry.command);
  const answers = await answersOf(page);
  measure("not_now_flow", { answers, commands });
  expect(answers).toEqual([
    { answer: { outcome: "declined" }, requestId: "project-request-ghost" },
  ]);
  expect(commands).not.toContain("create_channel");
  expect(commands).not.toContain("add_channel_members");
  expect(commands).not.toContain("authorize_project_proposal");
  await expect(home(page, "project:ghost-app")).toHaveCount(0);
  measure("console_b", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(c) a waiting request comes back after a reload", async ({ page }) => {
  const consoleSeen = await boot(page, { proposals: [ask()] });
  await expectCardWords(page, "Luca joins");
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
  await expectCardWords(page, "Luca joins");
  const commands = (await commandsOf(page)).map((entry) => entry.command);
  measure("replay_after_reload", {
    listedAfterReload: commands.includes("list_project_proposals"),
  });
  expect(commands).toContain("list_project_proposals");
  measure("console_c", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(d) the same request in Needs you, answered there", async ({ page }) => {
  const consoleSeen = await boot(page, {
    hash: "/needs-you",
    proposals: [ask()],
  });
  await expect(page.getByTestId("needs-you-card")).toBeVisible({
    timeout: 20_000,
  });
  const item = page.getByTestId("needs-you-project:project-request-ghost");
  await expect(item).toBeVisible({ timeout: 20_000 });
  await expect(item).toContainText("Start a project called “Ghost app”?");
  await expect(item).toContainText("Luca asks");
  await expect(item.getByTestId("project-proposal-line")).toContainText(
    "Luca joins its first chat, general.",
  );
  await shot(page, item, "05-needs-you-dark");
  await item.getByTestId("project-proposal-create").click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  const answers = await answersOf(page);
  measure("needs_you", { answers });
  expect(answers).toHaveLength(1);
  expect(answers[0]?.answer).toMatchObject({
    outcome: "created",
    projectId: "ghost-app",
  });
  // Answering in Needs you does not move the owner.
  expect(await page.evaluate(() => window.location.hash)).toContain(
    "/needs-you",
  );
  measure("console_d", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(e) a name already in use: the card says so, Create still works", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    projects: ["Ghost app"],
    proposals: [ask({ includeResidents: [ATLAS] })],
  });
  await expectCardWords(page, "Luca and Atlas join");
  await expect(card(page).getByTestId("project-proposal-duplicate")).toHaveText(
    "You already have a project called Ghost app.",
  );
  await shot(page, card(page), "06-duplicate-name-dark");
  await card(page).getByTestId("project-proposal-create").click();
  await expect(page.getByTestId("project-proposal-settled")).toBeVisible({
    timeout: 15_000,
  });
  const commands = await commandsOf(page);
  const members = commands.filter(
    (entry) => entry.command === "add_channel_members",
  );
  const answers = await answersOf(page);
  measure("duplicate_name", { answers, members });
  expect(answers[0]?.answer).toMatchObject({
    outcome: "created",
    projectId: "ghost-app-2",
  });
  expect(members[0]?.payload).toMatchObject({
    pubkeys: [LUCA, ATLAS],
    role: "bot",
  });
  measure("console_e", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(f) the + button still creates and opens what it makes", async ({
  page,
}) => {
  const consoleSeen = await boot(page);
  await page
    .locator("[data-shell-rail]")
    .getByRole("button", { name: "New project" })
    .click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-project-name").fill("Plus check");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  const chat = projectChats(page, "project:plus-check");
  await expect(chat).toHaveCount(1);
  await expect(chat).toHaveAttribute("data-current", "true", {
    timeout: 15_000,
  });
  const chatId = await chat.getAttribute("data-channel-id");
  const hash = await page.evaluate(() => window.location.hash);
  const commands = await commandsOf(page);
  const created = commands.filter(
    (entry) => entry.command === "create_channel",
  );
  measure("plus_button_unchanged", { chatId, created, hash });
  expect(hash).toContain(chatId ?? "missing");
  expect(JSON.stringify(created[0]?.payload)).toContain(
    "Plus check project room",
  );
  expect(commands.map((entry) => entry.command)).not.toContain(
    "finish_project_proposal",
  );
  measure("console_f", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(g) with the new look off, the card shows and works", async ({
  page,
}) => {
  const consoleSeen = await boot(page, { proposals: [ask()], shell: false });
  await expect(page.locator("[data-shell-rail]")).toHaveCount(0);
  await expectCardWords(page, "Luca joins");
  await shot(page, card(page), "07-classic-card");
  await card(page).getByTestId("project-proposal-create").click();
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toBeVisible({ timeout: 15_000 });
  await expect(settled).toContainText("Ghost app is in your projects.");
  const answers = await answersOf(page);
  measure("classic_card", { answers });
  expect(answers[0]?.answer).toMatchObject({
    outcome: "created",
    projectId: "ghost-app",
  });
  expect(await page.evaluate(() => window.location.hash)).toContain(GENERAL);
  measure("console_g", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(h) in an empty chat, an ask takes the welcome picture's place", async ({
  page,
}) => {
  const consoleSeen = await boot(page);
  const lucaChat = await openLucaChat(page);
  const greeting = page.locator(".luca-first-message-greeting");
  await expect(greeting).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ channelName: undefined, conversationId: lucaChat }),
  );
  await expectCardWords(page, "Luca joins");
  await expect(greeting).toHaveCount(0);
  // Nothing of the welcome lies under the card.
  const box = await card(page).boundingBox();
  const under = await page.evaluate((rect) => {
    if (!rect) return ["no card"];
    const hits = new Set<string>();
    for (let x = rect.x + 8; x < rect.x + rect.width; x += 24)
      for (let y = rect.y + 8; y < rect.y + rect.height; y += 12)
        for (const node of document.elementsFromPoint(x, y))
          if (node.closest(".luca-first-message-greeting"))
            hits.add(node.className.toString());
    return [...hits];
  }, box);
  measure("empty_chat_ask", { card: box, greetingUnderCard: under });
  expect(under).toEqual([]);
  await shot(
    page,
    page.getByTestId("channel-drop-zone"),
    "08-empty-chat-ask-dark",
  );
  // When the ask is answered, the welcome comes back.
  await card(page).getByTestId("project-proposal-not-now").click();
  await expect(card(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(greeting).toBeVisible({ timeout: 15_000 });
  measure("console_h", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

/** Every text box of a card against the card and the window: what runs past
 *  the card's right edge, how many lines the title and purpose take, whether
 *  who-joins shows whole, and whether the title and "Luca asks" touch. */
async function cardGeometry(row: Locator) {
  return row.evaluate((li) => {
    const card = li.getBoundingClientRect();
    const lines = (el: Element | null) => {
      if (!el) return 0;
      const style = getComputedStyle(el);
      const height = el.getBoundingClientRect().height;
      return Math.round(height / Number.parseFloat(style.lineHeight));
    };
    const pick = (selector: string) => li.querySelector(selector);
    const title = pick(".luca-place-row-title");
    const summary = pick(".luca-place-row-summary");
    const purpose = pick('[data-testid="project-proposal-purpose"]');
    const joins = pick('[data-testid="project-proposal-joins"]');
    const overflow = [
      ...li.querySelectorAll<HTMLElement>(
        ".luca-place-row-title, .luca-place-row-summary, .luca-ask-extra, [data-testid^='project-proposal-'], .luca-project-ask-notes p, button",
      ),
    ]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.right > card.right + 0.5 ||
          box.left < card.left - 0.5 ||
          el.scrollWidth > el.clientWidth + 1
        );
      })
      .map((el) => el.dataset.testid ?? el.className);
    const a = title?.getBoundingClientRect();
    const b = summary?.getBoundingClientRect();
    const touch =
      a && b
        ? a.bottom > b.top + 0.5 &&
          a.top < b.bottom - 0.5 &&
          a.right > b.left &&
          a.left < b.right
        : true;
    return {
      card: { left: card.left, right: card.right, width: card.width },
      cardInWindow: card.right <= window.innerWidth + 0.5,
      joinsWhole:
        joins !== null &&
        joins.scrollHeight <= joins.clientHeight + 1 &&
        joins.scrollWidth <= joins.clientWidth + 1,
      overflow,
      purposeClipped:
        purpose !== null && purpose.scrollHeight > purpose.clientHeight + 1,
      purposeLines: lines(purpose),
      titleClipped:
        title !== null && title.scrollHeight > title.clientHeight + 1,
      titleLines: lines(title),
      titleTouchesSummary: touch,
    };
  });
}

const LONG_PURPOSE =
  "A home for the Ghost companion app: the notch eyes, the panel, the voice, the screen marks, the iPhone build, the website words, and every small note about how Ghost should feel when it wakes up.";

test("(i) a long purpose wraps inside the card, three lines at most", async ({
  page,
}) => {
  expect(LONG_PURPOSE.length).toBeGreaterThanOrEqual(190);
  expect(LONG_PURPOSE.length).toBeLessThanOrEqual(200);
  const consoleSeen = await boot(page);
  const lucaChat = await openLucaChat(page);
  await talkInLucaChat(page, lucaChat);
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({
      channelName: undefined,
      conversationId: lucaChat,
      purpose: LONG_PURPOSE,
    }),
  );
  const shapes: Record<string, unknown> = {};
  for (const [width, place] of [
    [1440, "chat"],
    [900, "chat"],
    [1440, "needs-you"],
    [900, "needs-you"],
  ] as const) {
    await page.setViewportSize({ height: 900, width });
    if (place === "needs-you") {
      await page.evaluate(() => {
        window.location.hash = "#/needs-you";
      });
    }
    if (place === "chat") await showFoldedAsks(page);
    const row =
      place === "chat"
        ? card(page)
        : page.getByTestId("needs-you-project:project-request-ghost");
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId("project-proposal-joins")).toHaveText(
      "Luca joins its first chat, general.",
    );
    await waitForAnimations(page);
    const shape = await cardGeometry(row);
    shapes[`${place}-${width}`] = shape;
    expect(shape.overflow, `${place} ${width}`).toEqual([]);
    expect(shape.cardInWindow, `${place} ${width}`).toBe(true);
    expect(shape.purposeLines).toBeLessThanOrEqual(3);
    expect(shape.purposeLines).toBeGreaterThanOrEqual(2);
    expect(shape.joinsWhole).toBe(true);
    if (width === 1440 && place === "chat")
      await shotInPlace(page, "09-long-purpose-dark");
    if (width === 1440 && place === "needs-you")
      await shot(page, row, "10-long-purpose-needs-you-dark");
  }
  measure("long_purpose", shapes);
  measure("console_i", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

const NAME_NO_SPACES = "A".repeat(120);
const NAME_WITH_SPACES =
  "WOMBAT MEADOW WORKSHOP WOMBAT MEADOW WORKSHOP WOMBAT MEADOW WORKSHOP WOMBAT MEADOW WORKSHOP WOMBAT MEADOW WORKSHOP WOMBA";

test("(ii) a long name wraps to two lines at most, clear of who asks", async ({
  page,
}) => {
  expect(new TextEncoder().encode(NAME_NO_SPACES).length).toBe(120);
  expect(new TextEncoder().encode(NAME_WITH_SPACES).length).toBeLessThanOrEqual(
    120,
  );
  const consoleSeen = await boot(page);
  const lucaChat = await openLucaChat(page);
  await talkInLucaChat(page, lucaChat);
  const shapes: Record<string, unknown> = {};
  for (const [name, label] of [
    [NAME_NO_SPACES, "no-spaces"],
    [NAME_WITH_SPACES, "with-spaces"],
  ] as const) {
    const requestId = `project-request-${label}`;
    await page.evaluate(
      (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
      ask({
        channelName: undefined,
        conversationId: lucaChat,
        projectName: name,
        requestId,
      }),
    );
    for (const [width, place] of [
      [1440, "chat"],
      [900, "chat"],
      [1440, "needs-you"],
      [900, "needs-you"],
    ] as const) {
      await page.setViewportSize({ height: 900, width });
      await page.evaluate(
        (hash) => {
          if (window.location.hash !== hash) window.location.hash = hash;
        },
        place === "chat" ? `#/channels/${lucaChat}` : "#/needs-you",
      );
      if (place === "chat") await showFoldedAsks(page);
      const row =
        place === "chat"
          ? card(page, requestId)
          : page.getByTestId(`needs-you-project:${requestId}`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await waitForAnimations(page);
      const shape = await cardGeometry(row);
      const at = `${label} ${place} ${width}`;
      shapes[`${label}-${place}-${width}`] = shape;
      expect(shape.titleLines, at).toBeLessThanOrEqual(2);
      // Both names need three lines or more in the conversation's card at
      // either width: there the title is cut at its end.
      if (place === "chat") expect(shape.titleClipped, at).toBe(true);
      expect(shape.titleTouchesSummary, at).toBe(false);
      expect(shape.overflow, at).toEqual([]);
      expect(shape.cardInWindow, at).toBe(true);
      if (label === "no-spaces" && place === "chat" && width === 1440)
        await shot(page, row, "11-long-name-dark");
    }
    await page.setViewportSize({ height: 900, width: 1440 });
    // Clear it, so the next name is the conversation's one ask.
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/channels/${lucaChat}`);
    await card(page, requestId).getByTestId("project-proposal-not-now").click();
    await expect(card(page, requestId)).toHaveCount(0, { timeout: 15_000 });
  }
  measure("long_name", shapes);
  measure("console_ii", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

/** Coming back to a conversation, its asks may wait folded to one line, by the
 *  stack's own rule; the owner opens them with one click. */
async function showFoldedAsks(page: Page) {
  const held = page.getByTestId("pending-held");
  await page.waitForTimeout(600);
  if (await held.isVisible()) {
    measure("folded_on_return", { folded: true });
    await held.click();
  }
}

const composerFocused = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.closest('[data-testid="message-composer"]') !==
      null,
  );

/** The card's boxes top to bottom once a Create stopped: the question, who
 *  asks, what exists, then the two answers; the purpose and who joins gone. */
async function stoppedOrder(row: Locator) {
  const shape = await row.evaluate((li) => {
    const box = (selector: string) => {
      const found = li.querySelector(selector)?.getBoundingClientRect();
      return found ? { bottom: found.bottom, top: found.top } : null;
    };
    return {
      leave: box('[data-testid="project-proposal-not-now"]'),
      problem: box('[data-testid="project-proposal-problem"]'),
      purpose: box('[data-testid="project-proposal-purpose"]'),
      joins: box('[data-testid="project-proposal-joins"]'),
      summary: box(".luca-place-row-summary"),
      title: box(".luca-place-row-title"),
      tryAgain: box('[data-testid="project-proposal-create"]'),
    };
  });
  const { leave, problem, summary, title, tryAgain } = shape;
  expect(shape.purpose).toBeNull();
  expect(shape.joins).toBeNull();
  if (!title || !summary || !problem || !tryAgain || !leave)
    throw new Error(`a box is missing: ${JSON.stringify(shape)}`);
  expect(title.bottom).toBeLessThanOrEqual(summary.top + 0.5);
  expect(summary.bottom).toBeLessThanOrEqual(problem.top + 0.5);
  expect(problem.bottom).toBeLessThanOrEqual(tryAgain.top + 0.5);
  expect(problem.bottom).toBeLessThanOrEqual(leave.top + 0.5);
  return shape;
}

test("(iii) a Create that stopped part-way: one sentence, Try again or Leave it", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    mock: { addChannelMembersErrors: ["mock: members write refused"] },
  });
  const lucaChat = await openLucaChat(page);
  await talkInLucaChat(page, lucaChat);
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ channelName: undefined, conversationId: lucaChat }),
  );
  await expectCardWords(page, "Luca joins");
  await card(page).getByTestId("project-proposal-create").click();
  const problem = card(page).getByTestId("project-proposal-problem");
  await expect(problem).toHaveText(
    "Ghost app and its chat were made, but Luca couldn't be added.",
    { timeout: 15_000 },
  );
  // Its own half-made project is not "one you already have"; no raw error.
  await expect(
    card(page).getByTestId("project-proposal-duplicate"),
  ).toHaveCount(0);
  await expect(card(page)).not.toContainText("mock:");
  await expect(card(page).getByTestId("project-proposal-create")).toHaveText(
    "Try again",
  );
  await expect(card(page).getByTestId("project-proposal-not-now")).toHaveText(
    "Leave it",
  );
  measure("partly_order_chat", await stoppedOrder(card(page)));
  await shotInPlace(page, "12-partly-made-dark");

  await card(page).getByTestId("project-proposal-not-now").click();
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toBeVisible({ timeout: 15_000 });
  await expect(settled).toContainText(
    "Ghost app is in your projects, without Luca in it yet.",
  );
  await expect(settled.getByTestId("project-proposal-open")).toHaveText(
    "Open Ghost app",
  );
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => composerFocused(page)).toBe(true);
  // Nothing was deleted: the project and its chat stay in the rail.
  await expect(projectChats(page, "project:ghost-app")).toHaveCount(1);
  const chatId = await projectChats(page, "project:ghost-app").getAttribute(
    "data-channel-id",
  );
  const answers = await answersOf(page);
  measure("left_it", { answers });
  expect(answers).toEqual([
    {
      answer: {
        chatId,
        outcome: "partial",
        problem:
          "Ghost app and its chat were made, but Luca couldn't be added.",
        projectId: "ghost-app",
      },
      requestId: "project-request-ghost",
    },
  ]);
  await shot(page, settled, "13-left-it-dark");
  measure("console_iii", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(iii, try again) a chat that couldn't be made, then made on Try again", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    mock: { createChannelErrors: ["mock: create_channel failed"] },
    proposals: [ask()],
  });
  await expectCardWords(page, "Luca joins");
  await card(page).getByTestId("project-proposal-create").click();
  await expect(card(page).getByTestId("project-proposal-problem")).toHaveText(
    "The project was made, but its first chat wasn't.",
    { timeout: 15_000 },
  );
  await expect(card(page)).not.toContainText("mock:");
  await expect(card(page)).not.toContainText("already have");
  await card(page).getByTestId("project-proposal-create").click();
  await expect(page.getByTestId("project-proposal-settled")).toContainText(
    "Ghost app is in your projects.",
    { timeout: 15_000 },
  );
  const answers = await answersOf(page);
  measure("try_again", { answers });
  // The same project, finished: never a second one.
  expect(answers[0]?.answer).toMatchObject({
    outcome: "created",
    projectId: "ghost-app",
  });
  await expect(home(page, "project:ghost-app-2")).toHaveCount(0);
  measure("console_iii_try", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(iv) made in full but not handed back: the line alone, never Create again", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    mock: {
      finishProjectProposalErrors: ["mock: no", "mock: no", "mock: no"],
    },
    proposals: [ask()],
  });
  await expectCardWords(page, "Luca joins");
  await card(page).getByTestId("project-proposal-create").click();
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toContainText("Ghost app is in your projects.", {
    timeout: 15_000,
  });
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("project-proposal-create")).toHaveCount(0);
  await expect(page.getByText("mock:")).toHaveCount(0);
  // Three quiet tries to tell the resident, then the line simply stands.
  await expect
    .poll(
      async () =>
        (await commandsOf(page)).filter(
          (entry) => entry.command === "finish_project_proposal",
        ).length,
      { timeout: 10_000 },
    )
    .toBe(3);
  await page.waitForTimeout(1_500);
  await expect(card(page)).toHaveCount(0);
  // Needs you no longer counts it.
  await expect(
    page.locator('[data-testid="rail-needs-you"]').filter({ hasText: "1" }),
  ).toHaveCount(0);
  measure("console_iv", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(v) keyboard: after Create the way in, after Not now the message box", async ({
  page,
}) => {
  const consoleSeen = await boot(page, { proposals: [ask()] });
  await expectCardWords(page, "Luca joins");
  await card(page).getByTestId("project-proposal-create").focus();
  await page.keyboard.press("Enter");
  const open = page.getByTestId("project-proposal-open");
  await expect(open).toBeVisible({ timeout: 15_000 });
  await expect(open).toBeFocused();
  measure("keyboard_create", { focused: "project-proposal-open" });

  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ projectName: "Notes app", requestId: "project-request-notes" }),
  );
  const notes = card(page, "project-request-notes");
  await expect(notes).toBeVisible({ timeout: 15_000 });
  await notes.getByTestId("project-proposal-not-now").focus();
  await page.keyboard.press("Enter");
  await expect(notes).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => composerFocused(page)).toBe(true);
  measure("console_v", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

const NEEDS_YOU_ITEM = "needs-you-project:project-request-ghost";
const nothingCounted = (page: Page) =>
  page.locator('[data-testid="rail-needs-you"]').filter({ hasText: /\d/ });

test("(iii, needs you) stopped part-way in Needs you: what exists, then the answers", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    hash: "/needs-you",
    mock: { addChannelMembersErrors: ["mock: members write refused"] },
    proposals: [ask()],
  });
  const item = page.getByTestId(NEEDS_YOU_ITEM);
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.getByTestId("project-proposal-create").click();
  await expect(item.getByTestId("project-proposal-problem")).toHaveText(
    "Ghost app and its chat were made, but Luca couldn't be added.",
    { timeout: 15_000 },
  );
  await expect(item).not.toContainText("mock:");
  measure("partly_order_needs_you", await stoppedOrder(item));
  await shot(page, item, "12b-partly-made-needs-you-dark");

  await item.getByTestId("project-proposal-not-now").click();
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toContainText(
    "Ghost app is in your projects, without Luca in it yet.",
  );
  await expect(settled.getByTestId("project-proposal-open")).toBeFocused();
  await expect(page.getByTestId("needs-you-empty")).toBeVisible();
  await expect(nothingCounted(page)).toHaveCount(0);
  measure("console_iii_needs_you", consoleSeen);
  expect(consoleSeen).toEqual([]);
});

test("(vi) Create in Needs you leaves its line there, not counted, focus on the way in", async ({
  page,
}) => {
  const consoleSeen = await boot(page, {
    hash: "/needs-you",
    proposals: [
      ask(),
      ask({ projectName: "Notes app", requestId: "project-request-notes" }),
    ],
  });
  const item = page.getByTestId(NEEDS_YOU_ITEM);
  await expect(item).toBeVisible({ timeout: 20_000 });
  // Two wait, and the rail says so.
  await expect(nothingCounted(page)).toHaveCount(1);
  await item.getByTestId("project-proposal-create").focus();
  await page.keyboard.press("Enter");
  await expect(item).toHaveCount(0, { timeout: 15_000 });
  const settled = page.getByTestId("project-proposal-settled");
  await expect(settled).toHaveCount(1);
  await expect(settled).toContainText("Ghost app is in your projects.");
  const open = settled.getByTestId("project-proposal-open");
  await expect(open).toHaveText("Open Ghost app");
  await expect(open).toBeFocused();

  // The other ask still waits, and is the only one counted.
  const notes = page.getByTestId("needs-you-project:project-request-notes");
  await expect(notes.getByTestId("project-proposal-not-now")).toBeVisible();
  await notes.getByTestId("project-proposal-not-now").click();
  await expect(notes).toHaveCount(0, { timeout: 15_000 });
  // Not now made nothing, so it leaves no line; Ghost app's line stays.
  await expect(settled).toHaveCount(1);
  await expect(page.getByTestId("needs-you-empty")).toBeVisible();
  await expect(nothingCounted(page)).toHaveCount(0);
  const counted = await page
    .getByTestId("needs-you-card")
    .evaluate((card) => card.querySelectorAll("[data-needs-key]").length);
  measure("needs_you_settled", { counted, rail: "no count" });
  expect(counted).toBe(0);
  // The page's own column: its head, the line, and what waits.
  const axis = page
    .getByTestId("needs-you-card")
    .locator(".luca-place-page-axis");
  const lineBox = await settled.boundingBox();
  const headBox = await page
    .getByTestId("needs-you-card")
    .locator(".luca-place-page-head")
    .first()
    .boundingBox();
  const emptyBox = await page.getByTestId("needs-you-empty").boundingBox();
  measure("needs_you_settled_boxes", { emptyBox, headBox, lineBox });
  if (!lineBox || !headBox || !emptyBox) throw new Error("a box is missing");
  // On the page's axis with its other lines, clear of the head above and of
  // the empty line below.
  expect(Math.abs(lineBox.x - emptyBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(lineBox.x - headBox.x)).toBeLessThanOrEqual(1);
  expect(lineBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height);
  expect(emptyBox.y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height);
  await shot(page, axis, "14-needs-you-settled-dark");

  // The same dismiss closes it; it stays closed and the card stays answered.
  await settled.getByTestId("project-proposal-dismiss").click();
  await expect(settled).toHaveCount(0);
  await expect(item).toHaveCount(0);

  // Answered again here, then the owner leaves the page: the line goes too.
  await page.evaluate(
    (seed) => window.__BUZZ_E2E_PUSH_PROJECT_PROPOSAL__?.(seed),
    ask({ projectName: "Field notes", requestId: "project-request-field" }),
  );
  const field = page.getByTestId("needs-you-project:project-request-field");
  await expect(field).toBeVisible({ timeout: 15_000 });
  await field.getByTestId("project-proposal-create").click();
  await expect(settled).toContainText("Field notes is in your projects.", {
    timeout: 15_000,
  });
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/channels/${GENERAL}`);
  await expect(page.getByTestId("needs-you-card")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.evaluate(() => {
    window.location.hash = "#/needs-you";
  });
  await expect(page.getByTestId("needs-you-empty")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("project-proposal-settled")).toHaveCount(0);
  measure("console_vi", consoleSeen);
  expect(consoleSeen).toEqual([]);
});
