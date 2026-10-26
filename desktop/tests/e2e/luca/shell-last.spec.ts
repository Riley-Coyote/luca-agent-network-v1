import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { installHuddleStage } from "./shell-huddle-stage";

/**
 * The last of the list (docs/luca/rail-system/SHELL_BUILD.md, WP-09b): one
 * measurement or screenshot per decision under the frame, at 1440 × 900 and
 * 800 × 500, and the views it touches compared by hash with the flag off
 * against the base build. Boots at `/#/…` without a page query, so Back and
 * the picks read the address as the app's own window does.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else
 * test-results/shell-last). SHELL_BASE_URL: the base build (default
 * http://127.0.0.1:4300).
 */

const SHOTS = process.env.SHELL_SHOTS ?? "test-results/shell-last";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
/** "design": an open channel the mock identity is not a member of. */
const DESIGN = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
const SELF = "deadbeef".repeat(8);
const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});
test.describe.configure({ timeout: 180_000 });

function dir() {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

function record(name: string, value: unknown) {
  writeFileSync(
    path.join(dir(), `checks-${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
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
  mask: string[] = [],
) {
  await settle(page);
  await page.waitForTimeout(250);
  const file = path.join(dir(), `${name}.png`);
  await page.screenshot({
    path: file,
    ...(clip ? { clip } : {}),
    ...(mask.length > 0
      ? {
          animations: "disabled" as const,
          mask: mask.map((selector) => page.locator(selector)),
        }
      : {}),
  });
  return file;
}

/** How many colours a shot holds, on a 120 × 75 grid: a blank or
 *  one-colour shot proves nothing. */
async function coloursOf(page: Page, file: string) {
  const data = readFileSync(file).toString("base64");
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

const seen: string[] = [];
function watchConsole(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      seen.push(`${message.type()}: ${message.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => seen.push(`pageerror: ${error.message}`));
}

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
] as const;

/** Luca asks a question and a permission in #general. */
const ASKS = {
  managedInputs: [
    {
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
        protocol: "luca.managed.permission.v1" as const,
        resident_pubkey: LUCA,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
  ],
};

/** Luca works with Claude Code in #general right now. */
const TASKS = {
  runtimeTasks: [
    {
      channelName: "general",
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

/** Luca's own words with a chosen piece (WP-13's place), served before the
 *  bridge's own invoke. */
async function seedPlace(page: Page) {
  await page.addInitScript((luca) => {
    type Invoke = (c: string, p?: unknown, o?: unknown) => Promise<unknown>;
    let real: Invoke | undefined;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    const place = {
      residentPubkey: luca,
      revision: 3,
      residentEditingEnabled: true,
      visibility: "private",
      content: {
        introduction: "I keep the days moving, and I draw the coast.",
        exploration: "How tide pools hold light after dark.",
        selectedWork: { artifactId: "luca-tide", version: 1 },
      },
      author: { kind: "resident", pubkey: luca },
      updatedAt: Math.floor(Date.now() / 1000) - 3600,
      selectedWork: {
        artifactId: "luca-tide",
        version: 1,
        title: "Tide pools at night",
        kind: "markdown",
        conversationId: null,
        availability: "available",
      },
    };
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        real = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          if (command === "get_resident_place") {
            const who = String(
              (payload as { residentPubkey?: string } | null)?.residentPubkey ??
                "",
            ).toLowerCase();
            if (who === luca) return structuredClone(place);
            throw new Error("resident-place-resident-unmanaged");
          }
          if (!real) throw new Error(`mock invoke not ready: ${command}`);
          return real(command, payload, options);
        },
    });
  }, LUCA);
}

async function boot(
  page: Page,
  {
    frame = true,
    hash,
    huddle = false,
    light = false,
    mock = {},
    origin = "",
    place = false,
    size = { width: 1440, height: 900 },
    platform,
    ready = "app-sidebar",
  }: {
    frame?: boolean;
    hash: string;
    huddle?: boolean;
    light?: boolean;
    mock?: Parameters<typeof installMockBridge>[1];
    origin?: string;
    place?: boolean;
    size?: { width: number; height: number };
    platform?: string;
    /** What shows once the app is up (under 768 the rail is a closed sheet). */
    ready?: string;
  },
) {
  watchConsole(page);
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: light ? "light" : "dark" });
  if (platform)
    await page.addInitScript((value) => {
      Object.defineProperty(Navigator.prototype, "platform", {
        configurable: true,
        get: () => value,
      });
    }, platform);
  if (place) await seedPlace(page);
  if (huddle) await installHuddleStage(page);
  await page.addInitScript(
    ({ key, on }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": on }));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  if (light)
    await page.addInitScript(() => localStorage.setItem("buzz-theme", "paper"));
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    ...mock,
  });
  await expect(async () => {
    await page.goto(`${origin}/#${hash}`);
    await expect(page.getByTestId(ready)).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

/** Open Luca's own space in Agents. */
async function openLuca(page: Page) {
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  const hash = () =>
    page.evaluate(() => decodeURIComponent(window.location.hash));
  if (!(await hash()).includes(`profile=${LUCA}`))
    await page
      .getByTestId(`place-row-mind:${LUCA}`)
      .locator(".luca-rail-row-hit")
      .click();
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
}

/** #general and #random as the rooms of one project, "Tidepool"; returns
 *  #random's id. */
async function seedProject(page: Page) {
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  return page.evaluate(async () => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const channels = (await internals.invoke("get_channels")) as {
      id: string;
      name: string;
    }[];
    const id = (name: string) =>
      channels.find((channel) => channel.name === name)?.id ?? "";
    const community = (
      JSON.parse(window.localStorage.getItem("buzz-communities") ?? "[]") as {
        pubkey: string;
        relayUrl: string;
      }[]
    )[0];
    if (!community || !id("random"))
      throw new Error("Expected the mock community.");
    const scope = (value: string) =>
      encodeURIComponent(value.trim().toLowerCase());
    window.localStorage.setItem(
      `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
      JSON.stringify({
        version: 1,
        projects: [{ id: "tidepool", label: "Tidepool" }],
        assignments: {
          [id("general")]: "tidepool",
          [id("random")]: "tidepool",
        },
      }),
    );
    window.dispatchEvent(new Event("luca:room-projects-changed"));
    return id("random");
  });
}

/** Open a conversation by its route, retried past a fresh page's redirect. */
async function openRoute(page: Page, id: string, name: string | RegExp) {
  await expect(async () => {
    await page.evaluate((target) => {
      window.location.hash = `#/channels/${target}`;
    }, id);
    await expect(page.getByTestId("shell-lip-name")).toHaveText(name, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 40_000 });
}

/** One ask row's look: its class, its two lines' type and its answers. */
function askLooks(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((rows) =>
    rows.map((row) => {
      const title = row.querySelector<HTMLElement>(".luca-place-row-title");
      const summary = row.querySelector<HTMLElement>(".luca-place-row-summary");
      const answers = [
        ...row.querySelectorAll<HTMLElement>(".luca-ask-answers button"),
      ];
      const type = (element: HTMLElement | null) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return [style.fontSize, style.fontWeight, style.color].join(" ");
      };
      return {
        row: row.className,
        kind: (row as HTMLElement).dataset.askKind ?? null,
        title: title?.textContent ?? null,
        summary: summary?.textContent ?? null,
        title_type: type(title),
        summary_type: type(summary),
        answers: answers.map((each) => each.textContent),
        answer_class: answers[0]?.className ?? null,
        answer_type: type(answers[0] ?? null),
        height: Math.round(row.getBoundingClientRect().height),
      };
    }),
  );
}

// ── 1. one ask row in Needs you and in a mind's Notebook ───────────────
test("1: one ask row, in Needs you and in a mind's Notebook", async ({
  page,
}) => {
  await boot(page, { hash: "/agents", mock: ASKS });
  await openLuca(page);
  const space = page.getByTestId("mind-asks");
  await expect(space.locator("li.luca-ask")).toHaveCount(2, {
    timeout: 20_000,
  });
  const inSpace = await askLooks(page, '[data-testid="mind-asks"] li.luca-ask');
  const spaceShot = await shot(page, "01-asks-in-luca-space");
  await page.getByTestId("open-activity-view").click();
  await expect(page.getByTestId("needs-you-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("[data-needs-kind]")).toHaveCount(2, {
    timeout: 20_000,
  });
  const inNeeds = await askLooks(page, "li[data-needs-kind]");
  // Answered in place, in the space: the question's choice and Send.
  await page.getByTestId("open-agents-view").click();
  await openLuca(page);
  const question = page.getByTestId("mind-ask-question:question-word");
  await question.getByRole("button", { name: "Preview", exact: true }).click();
  await question.getByTestId("needs-you-question-send").click();
  await expect(question).toHaveCount(0, { timeout: 10_000 });
  const left = await page.locator('[data-testid="mind-asks"] li').count();
  const same = inSpace.map((each, index) => {
    const other = inNeeds[index];
    return {
      title: each.title === other?.title,
      row: each.row === other?.row,
      type:
        each.title_type === other?.title_type &&
        each.summary_type === other?.summary_type &&
        each.answer_type === other?.answer_type,
      answers: JSON.stringify(each.answers) === JSON.stringify(other?.answers),
    };
  });
  const checks = {
    in_space: inSpace,
    in_needs_you: inNeeds,
    same,
    summaries_drop_the_name: inSpace.every(
      (each) => !each.summary?.includes("Luca"),
    ),
    answered_in_space_left: left,
    shot: spaceShot,
    ok:
      same.length === 2 &&
      same.every(
        (each) => each.title && each.row && each.type && each.answers,
      ) &&
      inSpace.every((each) => each.summary === "general") &&
      left === 1,
  };
  record("ask_row_shared", checks);
  expect.soft(checks.ok, "ask_row_shared").toBe(true);
});

// ── 2. a working mind says so everywhere ────────────────────────────────
test("2: a mind running a task reads working, in their space and in Now", async ({
  page,
}) => {
  await boot(page, { hash: "/agents", mock: TASKS });
  await openLuca(page);
  const now = page.getByTestId("mind-now");
  await expect(now).toContainText("Working", { timeout: 20_000 });
  const line = {
    text: await now.textContent(),
    working: await now.getAttribute("data-working"),
  };
  const spaceShot = await shot(page, "02-luca-working-head", {
    x: 300,
    y: 40,
    width: 900,
    height: 140,
  });
  await page.goto("/#/pulse?stream=now");
  await expect(page.getByTestId("owner-activity-list")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  const rows = await page
    .locator('[data-testid="owner-activity-list"] [data-activity-group]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          id: (node as HTMLElement).dataset.testid,
          group: (node as HTMLElement).dataset.activityGroup,
          state: (node as HTMLElement).dataset.activityState,
          title: node.querySelector(".luca-place-row-title")?.textContent,
          summary: node.querySelector(".luca-place-row-summary")?.textContent,
        }))
        // Luca's row, or the live side conversation that names Luca as the
        // one asking (WP-18, Decided 4: "Luca asked Claude Code").
        .filter(
          (row) => row.title === "Luca" || row.title?.startsWith("Luca asked"),
        ),
    );
  const nowShot = await shot(page, "02-now-luca-working");
  const checks = {
    space_line: line,
    now_luca_rows: rows,
    shots: [spaceShot, nowShot],
    ok:
      line.text === "Working with Claude Code · Rail glass plates" &&
      line.working === "true" &&
      rows.length === 1 &&
      rows.every(
        (row) =>
          row.group === "active" &&
          row.state === "working" &&
          !row.summary?.includes("Ready for a conversation"),
      ),
  };
  record("working_everywhere", checks);
  expect.soft(checks.ok, "working_everywhere").toBe(true);
});

// ── 3. a project room's lip names its project ───────────────────────────
test("3: a project room's lip names its project", async ({ page }) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await seedProject(page);
  await openRoute(page, GENERAL, /general/);
  await expect(page.getByTestId("shell-lip-name")).toHaveText(
    "Tidepool/general",
    { timeout: 10_000 },
  );
  const read = () =>
    page.evaluate(() => {
      const name = document.querySelector<HTMLElement>(
        '[data-testid="shell-lip-name"]',
      );
      const part = (selector: string) => {
        const element = name?.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent,
          color: style.color,
          weight: style.fontWeight,
          left: Math.round(box.left * 10) / 10,
          right: Math.round(box.right * 10) / 10,
        };
      };
      const text = name?.querySelector<HTMLElement>(".luca-lip-name__text");
      const box = name?.getBoundingClientRect();
      const card = document
        .querySelector('[data-testid="shell-lip"] .luca-lip-card')
        ?.getBoundingClientRect();
      return {
        text: name?.textContent,
        accessible: name?.innerText,
        name_color: text ? getComputedStyle(text).color : null,
        name_weight: text ? getComputedStyle(text).fontWeight : null,
        home: part(".luca-lip-home"),
        rule: part(".luca-lip-rule"),
        rule_hidden:
          name?.querySelector(".luca-lip-rule")?.getAttribute("aria-hidden") ??
          null,
        centre_offset:
          box && card
            ? Math.round(
                (box.left + box.width / 2 - (card.left + card.width / 2)) * 10,
              ) / 10
            : null,
      };
    });
  const inProject = await read();
  const projectShot = await shot(page, "03-lip-tidepool-general", {
    x: 300,
    y: 0,
    width: 900,
    height: 44,
  });
  await openRoute(page, DESIGN, "design");
  const outside = await read();
  const checks = {
    in_project: inProject,
    outside_project: outside,
    shot: projectShot,
    ok:
      inProject.text === "Tidepool/general" &&
      inProject.home?.weight === "450" &&
      inProject.rule?.weight === "400" &&
      inProject.rule_hidden === "true" &&
      inProject.home?.color !== inProject.name_color &&
      outside.text === "design" &&
      outside.home === null,
  };
  record("project_lip", checks);
  expect.soft(checks.ok, "project_lip").toBe(true);
});

// ── 4. the Quick Chat button never covers content ───────────────────────
/** What of the card's content lies under the launcher: every visible text
 *  run, control and image whose box meets the launcher's. */
function underLauncher(page: Page) {
  return page.evaluate(() => {
    const launcher = document
      .querySelector('[data-testid="quickchat-launcher"]')
      ?.getBoundingClientRect();
    if (!launcher) return { launcher: null, covered: [], columns: [] };
    const covered: string[] = [];
    const meets = (r: DOMRect) =>
      r.width > 0 &&
      r.height > 0 &&
      r.left < launcher.right &&
      r.right > launcher.left &&
      r.top < launcher.bottom &&
      r.bottom > launcher.top;
    const cards = document.querySelectorAll(
      "[data-buzz-content-surface], [data-buzz-content-plane], [data-luca-right-card], [data-testid='shell-huddle-band']",
    );
    for (const card of cards) {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest('[data-testid="quickchat-launcher"]'))
          continue;
        const style = getComputedStyle(parent);
        if (style.visibility === "hidden" || style.opacity === "0") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          // Clipped by a scroller: only what shows counts.
          const clip = parent.closest(
            "[data-radix-scroll-area-viewport], .overflow-y-auto, .luca-place-page",
          );
          const c = clip?.getBoundingClientRect();
          if (c && (rect.bottom <= c.top || rect.top >= c.bottom)) continue;
          if (meets(rect)) {
            covered.push(`text: ${node.textContent.trim().slice(0, 40)}`);
            break;
          }
        }
      }
      for (const control of card.querySelectorAll<HTMLElement>(
        "button, a, input, textarea, img, [role='button']",
      )) {
        const style = getComputedStyle(control);
        if (style.visibility === "hidden" || control.offsetParent === null)
          continue;
        if (meets(control.getBoundingClientRect()))
          covered.push(
            `${control.tagName.toLowerCase()}: ${control.getAttribute("aria-label") ?? control.getAttribute("data-testid") ?? control.textContent?.trim().slice(0, 30)}`,
          );
      }
    }
    // At any scroll position: the right edge of what scrolls past it (a
    // place's axis, the composer's column), against the launcher's left.
    const columns = [
      ...document.querySelectorAll<HTMLElement>(
        ".luca-place-page-axis, [data-testid='channel-composer-overlay'] footer.luca-measure",
      ),
    ]
      .filter((each) => each.offsetParent !== null)
      .map((each) => {
        const box = each.getBoundingClientRect();
        const right =
          box.right - Number.parseFloat(getComputedStyle(each).paddingRight);
        return {
          column: each.className.split(" ")[0],
          content_right: Math.round(right * 10) / 10,
          clear_by: Math.round((launcher.left - right) * 10) / 10,
          spans_launcher_rows:
            box.top < launcher.bottom && box.bottom > launcher.top,
        };
      });
    return {
      launcher: {
        x: launcher.x,
        y: launcher.y,
        w: launcher.width,
        h: launcher.height,
      },
      covered: [...new Set(covered)],
      columns,
    };
  });
}

/** The mind's column and the side feed scrolled to their ends, so the last
 *  rows pass the launcher if anything can. */
async function scrollEnds(page: Page) {
  await page.evaluate(() => {
    for (const scroller of document.querySelectorAll<HTMLElement>(
      ".luca-place-page, [data-testid='owner-activity-scroll'], [data-testid='message-timeline'] , [data-radix-scroll-area-viewport]",
    ))
      scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(300);
}

async function startHuddle(page: Page) {
  await page.evaluate(
    (who) => {
      if (window.__HUDDLE_STAGE__) {
        window.__HUDDLE_STAGE__.participantsOnJoin = who;
      }
    },
    [SELF, TEST_IDENTITIES.bob.pubkey],
  );
  const bobRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Bob says hello." })
    .first();
  if ((await bobRow.count()) === 0) {
    await page.evaluate(
      (pubkey) =>
        (
          window as unknown as {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: {
              channelName: string;
              content: string;
              pubkey: string;
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
          channelName: "general",
          content: "Bob says hello.",
          pubkey,
        }),
      TEST_IDENTITIES.bob.pubkey,
    );
  }
  await expect(bobRow).toBeVisible({ timeout: 10_000 });
  await bobRow.getByTestId("message-author").hover();
  const card = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card
    .getByTestId(`user-profile-popover-huddle-${TEST_IDENTITIES.bob.pubkey}`)
    .click();
  await expect(page.locator(".buzz-huddle-drawer.grid")).toBeVisible({
    timeout: 15_000,
  });
}

test("4a: the Quick Chat button never covers a place's content", async ({
  page,
}) => {
  const result: Record<string, unknown> = {};
  const shots: string[] = [];
  await boot(page, {
    hash: "/agents",
    mock: { ...TASKS, ...ASKS },
    place: true,
  });
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.goto("/#/agents");
    await openLuca(page);
    await page.waitForTimeout(800);
    await scrollEnds(page);
    result[`mind_${label}`] = await underLauncher(page);
    if (size.width === 800)
      shots.push(await shot(page, `04-quick-chat-clear-mind-${label}`));
    await page.goto("/#/pulse?stream=side");
    await expect(page.getByTestId("place-row-side")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(1200);
    await scrollEnds(page);
    result[`side_${label}`] = await underLauncher(page);
    if (size.width === 800)
      shots.push(await shot(page, `04-quick-chat-clear-side-${label}`));
    await page.goto("/#/artifacts");
    await expect(page.locator(".luca-place-page-axis").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(1000);
    result[`library_${label}`] = await underLauncher(page);
  }
  const ok = Object.values(result).every((each) => {
    const value = each as {
      launcher: unknown;
      covered: string[];
      columns: { clear_by: number; spans_launcher_rows: boolean }[];
    };
    return (
      value.launcher !== null &&
      value.covered.length === 0 &&
      value.columns.length > 0 &&
      value.columns.every(
        (column) => !column.spans_launcher_rows || column.clear_by >= 8,
      )
    );
  });
  record("quick_chat_clear_places", { ...result, shots, ok });
  expect.soft(ok, "quick_chat_clear places").toBe(true);
});

test("4b: the Quick Chat button never covers Send while a huddle is live", async ({
  page,
}) => {
  const result: Record<string, unknown> = {};
  const shots: string[] = [];
  await boot(page, { hash: `/channels/${GENERAL}`, huddle: true });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  await startHuddle(page);
  await page.mouse.move(700, 300);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.waitForTimeout(900);
    const send = await page.evaluate(() => {
      const launcher = document
        .querySelector('[data-testid="quickchat-launcher"]')
        ?.getBoundingClientRect();
      const button = document
        .querySelector(
          '[data-testid="send-message"], [aria-label="Send message"]',
        )
        ?.getBoundingClientRect();
      return {
        launcher: launcher
          ? [launcher.left, launcher.top, launcher.right, launcher.bottom]
          : null,
        send: button
          ? [button.left, button.top, button.right, button.bottom]
          : null,
        gap:
          launcher && button
            ? Math.round((launcher.left - button.right) * 10) / 10
            : null,
      };
    });
    result[`huddle_${label}`] = { ...(await underLauncher(page)), send };
    if (size.width === 800)
      shots.push(await shot(page, `04-quick-chat-clear-huddle-${label}`));
  }
  const ok = Object.values(result).every((each) => {
    const value = each as {
      launcher: unknown;
      covered: string[];
      columns: { clear_by: number; spans_launcher_rows: boolean }[];
    };
    return (
      value.launcher !== null &&
      value.covered.length === 0 &&
      value.columns.length > 0 &&
      value.columns.every(
        (column) => !column.spans_launcher_rows || column.clear_by >= 8,
      )
    );
  });
  record("quick_chat_clear_huddle", { ...result, shots, ok });
  expect.soft(ok, "quick_chat_clear huddle").toBe(true);
});

// ── 5. the chosen piece's thumbnail has a name ──────────────────────────
test("5 and 6: the chosen piece's name; the tiles fade on 120", async ({
  page,
}) => {
  await boot(page, { hash: "/agents", place: true });
  await openLuca(page);
  const piece = page.getByTestId("resident-place-selected-work");
  await expect(piece).toBeVisible({ timeout: 20_000 });
  const thumb = {
    aria_label: await piece.getAttribute("aria-label"),
    by_role: await page
      .getByRole("button", { name: "Open Tide pools at night", exact: true })
      .count(),
  };
  // The first Tab stop after the tabs is the piece: its name read there.
  await page.getByTestId("mind-tab-notebook").focus();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => ({
    testid: document.activeElement?.getAttribute("data-testid"),
    label: document.activeElement?.getAttribute("aria-label"),
  }));
  record("thumb_name", {
    thumb,
    first_tab_after_tabs: focused,
    ok: thumb.aria_label === "Open Tide pools at night" && thumb.by_role === 1,
  });
  expect.soft(thumb.by_role, "thumb_name").toBe(1);

  const tiles = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="shell-places"] .luca-place, [data-testid="shell-places"] .luca-place-search button',
      ),
    ].map((tile) => {
      const style = getComputedStyle(tile);
      return {
        tile: tile.getAttribute("data-testid"),
        property: style.transitionProperty,
        duration: style.transitionDuration,
      };
    }),
  );
  const lip = await page.evaluate(() => {
    const style = getComputedStyle(
      document.querySelector('[data-testid="global-back"]') as HTMLElement,
    );
    return {
      property: style.transitionProperty,
      duration: style.transitionDuration,
    };
  });
  const tilesOk =
    tiles.length >= 5 &&
    tiles.every((each) =>
      each.duration.split(",").every((d) => d.trim() === "0.12s"),
    );
  record("tiles_120", { tiles, lip_button: lip, ok: tilesOk });
  expect.soft(tilesOk, "tiles_120").toBe(true);
});

// ── 7 and 13. Back and Forward, from the lip's buttons and the keys ────
test("7 and 13: Back and Forward keep their way, keys and buttons alike", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  const hash = () => page.evaluate(() => window.location.hash);
  const forwardEnabled = () => page.getByTestId("global-forward").isEnabled();
  // 13: leave Library before its first pick reaches the address.
  await page.getByTestId("open-artifacts-view").click();
  await page.waitForTimeout(100);
  await page.getByTestId("open-agents-view").click();
  await expect.poll(hash).toContain("agents");
  await page.waitForTimeout(800);
  const atAgents = await hash();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Meta+BracketLeft");
  await page.waitForTimeout(800);
  const back = await hash();
  const forwardAfterBack = await forwardEnabled();
  await page.keyboard.press("Meta+BracketRight");
  await page.waitForTimeout(800);
  const forward = await hash();
  const firstPick = {
    at: atAgents,
    after_back: back,
    forward_enabled_after_back: forwardAfterBack,
    after_forward: forward,
    ok:
      back.includes("artifacts") &&
      forwardAfterBack &&
      forward.split("?")[0] === atAgents.split("?")[0],
  };
  record("first_pick_replace", firstPick);
  expect.soft(firstPick.ok, "first_pick_replace").toBe(true);

  // 7: a click on the lip's Back or Forward leaves focus on it; the keys
  // still work from there. Four places deep, so Forward stays enabled.
  await page.getByTestId("open-activity-view").click();
  await expect.poll(hash).toContain("pulse");
  await page.waitForTimeout(800);
  await page.getByTestId("global-back").click();
  await page.waitForTimeout(600);
  await page.getByTestId("global-back").click();
  await page.waitForTimeout(800);
  const afterBackClicks = {
    hash: await hash(),
    focus: await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
  };
  await page.keyboard.press("Meta+BracketRight");
  await page.waitForTimeout(800);
  const keyForward = await hash();
  await page.keyboard.press("Meta+BracketLeft");
  await page.waitForTimeout(800);
  const keyBack = await hash();
  await page.getByTestId("global-forward").click();
  await page.waitForTimeout(800);
  const afterForwardClick = {
    hash: await hash(),
    focus: await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    ),
  };
  await page.keyboard.press("Meta+BracketRight");
  await page.waitForTimeout(800);
  const keyForward2 = await hash();
  await page.keyboard.press("Meta+BracketLeft");
  await page.waitForTimeout(800);
  const keyBack2 = await hash();
  const keys = {
    after_two_back_clicks: afterBackClicks,
    key_forward_from_back_button: keyForward,
    key_back: keyBack,
    after_forward_click: afterForwardClick,
    key_forward_from_forward_button: keyForward2,
    key_back_after: keyBack2,
    ok:
      afterBackClicks.focus === "global-back" &&
      afterBackClicks.hash.includes("artifacts") &&
      keyForward.includes("agents") &&
      keyBack.includes("artifacts") &&
      afterForwardClick.focus === "global-forward" &&
      afterForwardClick.hash.includes("agents") &&
      keyForward2.includes("pulse") &&
      keyBack2.includes("agents"),
  };
  record("back_forward_keys", keys);
  expect.soft(keys.ok, "back_forward_keys").toBe(true);
});

// ── 8. under 768 the sheet's Escape returns focus to the toggle ────────
test("8: the rail's sheet, closed with Escape, hands focus back", async ({
  page,
}) => {
  await boot(page, {
    hash: `/channels/${GENERAL}`,
    ready: "shell-lip",
    size: { width: 700, height: 600 },
  });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 20_000,
  });
  const toggle = page.getByTestId("shell-lip-toggle");
  const runs: unknown[] = [];
  for (const how of ["click", "keyboard"] as const) {
    if (how === "click") await toggle.click();
    else {
      await toggle.focus();
      await page.keyboard.press("Enter");
    }
    const sheet = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    const inside = await page.evaluate(
      () => document.activeElement?.closest('[data-mobile="true"]') !== null,
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden({ timeout: 10_000 });
    await page.waitForTimeout(400);
    runs.push({
      how,
      focus_inside_while_open: inside,
      focus_after: await page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-testid") ??
          document.activeElement?.tagName,
      ),
    });
  }
  const shotFile = await shot(page, "08-sheet-escape-focus", {
    x: 0,
    y: 0,
    width: 400,
    height: 80,
  });
  const ok = runs.every(
    (run) =>
      (run as { focus_after: string }).focus_after === "shell-lip-toggle",
  );
  record("sheet_escape", { runs, shot: shotFile, ok });
  expect.soft(ok, "sheet_escape").toBe(true);
});

// ── 9. a room opened from Search shows its project open, the room lit ──
test("9: a project room opened from Search", async ({ page }) => {
  await boot(page, { hash: `/channels/${DESIGN}` });
  const random = await seedProject(page);
  await openRoute(page, DESIGN, "design");
  // Its project starts closed here: the rooms aren't in view.
  await page.getByTestId("open-search").click();
  await expect(page.getByTestId("search-results")).toBeVisible();
  await page.keyboard.type("random");
  const hit = page.getByTestId(`search-result-channel-${random}`);
  await expect(hit).toBeVisible({ timeout: 10_000 });
  await hit.click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText(
    "Tidepool/random",
    { timeout: 10_000 },
  );
  await page.waitForTimeout(900);
  const state = await page.evaluate((id) => {
    const session = document.querySelector<HTMLElement>(
      `[data-testid="rail-session-${id}"]`,
    );
    const home = document.querySelector<HTMLElement>(
      '[data-testid="rail-home-project:tidepool"], [data-project-id="tidepool"]',
    );
    const rail = document
      .querySelector('[data-sidebar="content"]')
      ?.getBoundingClientRect();
    const box = session?.getBoundingClientRect();
    return {
      home_expanded:
        home
          ?.querySelector(".luca-rail-row-hit")
          ?.getAttribute("aria-expanded") ?? null,
      session_current: session?.getAttribute("aria-current") ?? null,
      session_in_view:
        box && rail ? box.top >= rail.top && box.bottom <= rail.bottom : null,
    };
  }, random);
  const shotFile = await shot(page, "09-search-room-open", {
    x: 0,
    y: 0,
    width: 320,
    height: 520,
  });
  const ok =
    state.home_expanded === "true" &&
    state.session_current === "page" &&
    state.session_in_view === true;
  record("search_room_open", { random, ...state, shot: shotFile, ok });
  expect.soft(ok, "search_room_open").toBe(true);
});

// ── 10. the rail's mark on a first visit to a connected app ────────────
/** Every frame's position of the rail's mark while a row is picked. */
async function traceMark(page: Page, rowId: string) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __trace: { t: number; y: number; h: number; rows: number }[];
    };
    w.__trace = [];
    const start = performance.now();
    const sample = () => {
      const mark = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="shell-rail-marks"] .luca-mark--row',
        ),
      ].find((each) => Number.parseFloat(getComputedStyle(each).opacity) > 0.5);
      const row = document.querySelector<HTMLElement>(
        '[data-testid^="place-row-connected:"]',
      );
      w.__trace.push({
        t: Math.round(performance.now() - start),
        y: mark ? Math.round(mark.getBoundingClientRect().y * 10) / 10 : -1,
        h: mark
          ? Math.round(mark.getBoundingClientRect().height * 10) / 10
          : -1,
        rows: row ? Math.round(row.getBoundingClientRect().y * 10) / 10 : -1,
      });
      if (performance.now() - start < 900) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page
    .getByTestId(`place-row-${rowId}`)
    .locator("button")
    .first()
    .click();
  await page.waitForTimeout(1000);
  const trace = await page.evaluate(
    () =>
      (
        window as unknown as {
          __trace: { t: number; y: number; h: number; rows: number }[];
        }
      ).__trace,
  );
  const firstY = trace[0]?.y ?? 0;
  const firstMove = trace.findIndex((each) => each.y !== firstY);
  const steps = trace
    .slice(firstMove, firstMove + 5)
    .map(
      (each, index) =>
        Math.round((each.y - (trace[firstMove + index - 1]?.y ?? 0)) * 10) / 10,
    );
  return {
    firstMoveAt: trace[firstMove]?.t ?? null,
    firstSteps: steps,
    total: Math.round(((trace.at(-1)?.y ?? 0) - firstY) * 10) / 10,
    rowsMoved: trace.some((each) => each.rows !== trace[0]?.rows),
    frames: trace.slice(Math.max(0, firstMove - 4), firstMove + 6),
  };
}

test("10: the rail's mark on a first visit to a connected app", async ({
  page,
}) => {
  await boot(page, { hash: "/agents" });
  await openLuca(page);
  const connected = page.locator('[data-testid^="place-row-connected:"]');
  await expect(connected.first()).toBeVisible({ timeout: 20_000 });
  const ids = await connected.evaluateAll((rows) =>
    rows.map((row) =>
      (row.getAttribute("data-testid") ?? "").replace("place-row-", ""),
    ),
  );
  await page.waitForTimeout(800);
  const first = await traceMark(page, ids[0]);
  await page.waitForTimeout(600);
  const back = await traceMark(page, `mind:${LUCA}`);
  await page.waitForTimeout(600);
  const later = await traceMark(page, ids[0]);
  record("first_mark", { rows: ids, first, back_to_luca: back, later });
});

// ── 11. Paper's unread dot reaches 3:1 ──────────────────────────────────
test("11: Paper's unread dot reaches 3:1 on paper", async ({ page }) => {
  await boot(page, { hash: "/agents", light: true });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  // A message arrives in #random while you're elsewhere.
  await page.evaluate(() =>
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "random",
      content: "A new note.",
    }),
  );
  const dot = page.getByTestId("shell-place-conversations-unread");
  await expect(dot).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  const measured = await page.evaluate(() => {
    const parse = (value: string) => {
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return [0, 0, 0];
      probe.fillStyle = value;
      const hex = probe.fillStyle as string;
      if (hex.startsWith("#"))
        return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return (hex.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    };
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const dotEl = document.querySelector<HTMLElement>(
      '[data-testid="shell-place-conversations-unread"]',
    );
    const dotColour = dotEl ? getComputedStyle(dotEl).backgroundColor : "";
    // What it sits on: the first ancestor with a ground of its own.
    let ground = "";
    for (let at = dotEl?.parentElement ?? null; at; at = at.parentElement) {
      const bg = getComputedStyle(at).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        ground = bg;
        break;
      }
    }
    if (!ground) ground = getComputedStyle(document.body).backgroundColor;
    const probe = document.createElement("div");
    probe.style.background = "hsl(var(--mn-surface))";
    document.body.appendChild(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.style.background = "hsl(var(--mn-floor))";
    const floor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      dark: document.documentElement.classList.contains("dark"),
      dot: dotColour,
      ground,
      on_ground: ratio(parse(dotColour), parse(ground)),
      on_surface: ratio(parse(dotColour), parse(surface)),
      on_floor: ratio(parse(dotColour), parse(floor)),
      surface,
      floor,
    };
  });
  const shotFile = await shot(page, "11-paper-unread-dot", {
    x: 0,
    y: 30,
    width: 60,
    height: 160,
  });
  const ok =
    !measured.dark &&
    measured.on_ground >= 3 &&
    measured.on_surface >= 3 &&
    measured.on_floor >= 3;
  record("paper_dot", { ...measured, shot: shotFile, ok });
  expect.soft(ok, "paper_dot").toBe(true);
});

// ── 12. the rail's + names the key the platform takes ──────────────────
test("12: the Chats rail's + names its key on every platform", async ({
  browser,
}) => {
  const runs: Record<string, unknown> = {};
  for (const [name, platform, title, aria, key] of [
    ["mac", "MacIntel", "New conversation  ⌘N", "Meta+N", "Meta+n"],
    ["windows", "Win32", "New conversation  Ctrl+N", "Control+N", "Control+n"],
  ] as const) {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await boot(page, { hash: `/channels/${GENERAL}`, platform });
    const plus = page.getByTestId("rail-new-conversation");
    await expect(plus).toBeVisible({ timeout: 20_000 });
    const named = {
      title: await plus.getAttribute("title"),
      aria: await plus.getAttribute("aria-keyshortcuts"),
    };
    // The key it names does what it says.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const before = await page.evaluate(() => window.location.hash);
    await page.keyboard.press(key);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.location.hash);
    runs[name] = {
      ...named,
      pressed: key,
      before,
      after,
      ok: named.title === title && named.aria === aria && after !== before,
    };
    await context.close();
  }
  const ok = Object.values(runs).every((run) => (run as { ok: boolean }).ok);
  record("ctrl_new_tooltip", { ...runs, ok });
  expect.soft(ok, "ctrl_new_tooltip").toBe(true);
});

// ── flag off: the views this package touches, as on the base build ─────
test("flag off: the same as the base build", async ({ browser }) => {
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, "base build unreachable");
  const views = [
    {
      name: "conversation",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      size: { width: 1440, height: 900 },
    },
    {
      name: "conversation-800",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      size: { width: 800, height: 500 },
    },
    {
      name: "agents",
      hash: "/agents",
      ready: "app-sidebar",
      size: { width: 1440, height: 900 },
    },
    {
      name: "activity",
      hash: "/pulse",
      ready: "owner-activity-view",
      size: { width: 1440, height: 900 },
    },
    {
      name: "paper-conversation",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      size: { width: 1440, height: 900 },
      light: true,
    },
    {
      name: "sheet-700",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      size: { width: 700, height: 600 },
    },
  ];
  const result: Record<string, unknown> = {};
  for (const view of views) {
    const hashes: string[] = [];
    const colours: number[] = [];
    for (const origin of ["", BASE_URL]) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await boot(page, {
        frame: false,
        hash: view.hash,
        light: view.light,
        mock: { ...TASKS, ...ASKS },
        origin,
        ready: view.ready,
        size: view.size,
      });
      await expect(page.getByTestId(view.ready)).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1500);
      await page.mouse.move(0, 0);
      const file = await shot(
        page,
        `flagoff-${view.name}-${origin ? "base" : "here"}`,
        undefined,
        // Small moving marks only: a resident's specimen, a clock.
        [".agent-identity-specimen", "time"],
      );
      hashes.push(sha(file));
      colours.push(await coloursOf(page, file));
      await context.close();
    }
    result[view.name] = {
      here: hashes[0],
      base: hashes[1],
      colours,
      same: hashes[0] === hashes[1],
    };
  }
  const values = Object.values(result) as {
    here: string;
    same: boolean;
    colours: number[];
  }[];
  const ok =
    values.every((each) => each.same && each.colours.every((c) => c > 8)) &&
    new Set(values.map((each) => each.here)).size === values.length;
  record("flag_off_identical", { ...result, ok });
  expect.soft(ok, "flag_off_identical").toBe(true);
});

test.afterAll(() => {
  record("console", seen);
});
