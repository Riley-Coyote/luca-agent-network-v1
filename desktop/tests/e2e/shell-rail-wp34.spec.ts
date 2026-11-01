import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { railGlassAtRest } from "./flagOffSettle";

/**
 * WP-34, the rail (docs/luca/BETA14_RELEASE.md): what needs you tops Chats,
 * then Luca, then Projects (loose rooms after the projects; Browse rooms…
 * and Archived closing it), Agents and Apps. Only work hangs on the thread:
 * an agent's sessions and the exchanges it is asked into, an app's tasks,
 * under the face that hooks into the last row. Luca and a loose room nest
 * nothing; a project's rooms sit under it on no thread (Riley, 2026-10-27;
 * shell-project-rooms.spec.ts). The
 * rail's tone is a step toward the floor. Activity is the record: All
 * activity, then each mind's signed record. Agents loses Connected.
 * Classic layout (the flag off) is compared by hash with WP34_BASE_URL.
 * Screenshots land in WP34_SHOTS, measurements in WP34_SHOTS/measures.
 */

const SHOTS = process.env.WP34_SHOTS ?? "test-results/shell-rail-wp34";
const BASE_URL = process.env.WP34_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const X_OPEN = "1".repeat(64);
const X_PAUSED = "2".repeat(64);
const ROOT = { open: "e4".repeat(32), paused: "e5".repeat(32) };

const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();
const secs = (minutesAgo: number) =>
  Math.floor((NOW - minutesAgo * 60_000) / 1000);

type Mode = "dark" | "light";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

const shotHashes: Record<string, string> = {};

async function shot(
  page: Page,
  name: string,
  { still = false }: { still?: boolean } = {},
) {
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
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  shotHashes[name] = hash;
  return hash;
}

/** A shot's pixels, decoded in the page: how many colours it holds, and
 *  the raw sRGB value and perceived lightness (CIE L*) at the points asked,
 *  each the mean of a 3 × 3 block in device pixels. */
async function pixelsOf(
  page: Page,
  name: string,
  points: Array<{ x: number; y: number }> = [],
) {
  const data = readFileSync(`${SHOTS}/${name}.png`).toString("base64");
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) return { colors: 0, at: [] };
      context.drawImage(image, 0, 0);
      const small = document.createElement("canvas");
      small.width = 120;
      small.height = 75;
      small.getContext("2d")?.drawImage(image, 0, 0, 120, 75);
      const sample = small.getContext("2d")?.getImageData(0, 0, 120, 75).data;
      const seen = new Set<number>();
      for (let index = 0; sample && index < sample.length; index += 4)
        seen.add(
          ((sample[index] >> 3) << 10) |
            ((sample[index + 1] >> 3) << 5) |
            (sample[index + 2] >> 3),
        );
      const linear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const at = points.map(({ x, y }) => {
        const block = context.getImageData(
          Math.round(x * 2) - 1,
          Math.round(y * 2) - 1,
          3,
          3,
        ).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let index = 0; index < block.length; index += 4) {
          r += block[index];
          g += block[index + 1];
          b += block[index + 2];
        }
        const n = block.length / 4;
        const Y =
          0.2126 * linear(r / n) +
          0.7152 * linear(g / n) +
          0.0722 * linear(b / n);
        const f =
          Y > 216 / 24389 ? Math.cbrt(Y) : ((24389 / 27) * Y + 16) / 116;
        return {
          rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
          lightness: Math.round((116 * f - 16) * 100) / 100,
        };
      });
      return { colors: seen.size, at };
    },
    { data, points },
  );
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

/** Luca asks Atlas in general (talking) and Wren in design (paused for
 *  your word). */
const EXCHANGES = [
  {
    bucket: 3,
    channelName: "general",
    deadline: secs(-30),
    exchangeId: X_OPEN,
    members: [LUCA, ATLAS],
    openedBy: LUCA,
    rootEventId: ROOT.open,
    spent: 1,
  },
  {
    bucket: 3,
    channelName: "design",
    deadline: secs(-20),
    exchangeId: X_PAUSED,
    members: [LUCA, WREN],
    openedBy: LUCA,
    phase: "paused" as const,
    rootEventId: ROOT.paused,
    spent: 3,
  },
];

const WAITING = {
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
        resident_pubkey: ATLAS,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
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
        resident_pubkey: WREN,
      },
    },
  ],
  runtimeTaskProposals: [
    {
      channelName: "general",
      createdAt: iso(5),
      proposalId: "proposal-notes",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code" as const,
      summary: "Update the release notes for beta 7.",
    },
  ],
};

/** Two tasks for Claude Code (one working, one done) and one for Codex. */
const TASKS = [
  {
    channelName: "general",
    completedAt: iso(160),
    residentPubkey: LUCA,
    runtimeFamily: "claude_code" as const,
    startedAt: iso(180),
    state: "succeeded" as const,
    summary: "Fix the failing build",
    taskId: "task-build",
  },
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
  {
    channelName: "engineering",
    completedAt: iso(26 * 60),
    residentPubkey: ATLAS,
    runtimeFamily: "codex" as const,
    startedAt: iso(26 * 60 + 20),
    state: "succeeded" as const,
    summary: "Release script check",
    taskId: "task-release",
  },
];

async function boot(
  page: Page,
  {
    hash,
    mode = "dark",
    origin,
    shell = true,
    waiting = true,
    work = true,
  }: {
    hash: string;
    mode?: Mode;
    origin?: string;
    shell?: boolean;
    /** Something waits on you (a permission, a question, a proposal, a
     *  paused exchange). */
    waiting?: boolean;
    /** The exchanges and the apps' tasks. */
    work?: boolean;
  },
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    ...(work
      ? {
          exchanges: waiting ? EXCHANGES : EXCHANGES.slice(0, 1),
          runtimeTasks: TASKS,
        }
      : {}),
    ...(waiting ? WAITING : {}),
  });
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
    await page.goto(`${origin ?? ""}/#${hash}`);
    await expect(
      page
        .locator(
          "[data-testid='app-sidebar'], [data-testid='settings-content-scroll']",
        )
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
}

/** The owner's first message of each exchange and a turn in each. */
async function speak(page: Page) {
  await page.evaluate(
    ({ luca, wren, root, ids, at }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Expected the mock bridge.");
      emit({
        channelName: "general",
        content: "@Luca ask Atlas if the notes are ready.",
        createdAt: at.open,
        id: root.open,
        kind: 9,
      });
      emit({
        channelName: "general",
        content: "Atlas, are the release notes ready for Sam's read?",
        createdAt: at.open + 30,
        extraTags: [["exchange", ids.open, "1"]],
        kind: 9,
        pubkey: luca,
      });
      emit({
        channelName: "design",
        content: "@Luca check the walk-through time with Wren.",
        createdAt: at.paused,
        id: root.paused,
        kind: 9,
      });
      emit({
        channelName: "design",
        content: "Wren moved it to Thursday.",
        createdAt: at.paused + 120,
        extraTags: [["exchange", ids.paused, "3"]],
        kind: 9,
        pubkey: wren,
      });
    },
    {
      at: { open: secs(40), paused: secs(90) },
      ids: { open: X_OPEN, paused: X_PAUSED },
      luca: LUCA,
      root: ROOT,
      wren: WREN,
    },
  );
}

/** The rail's rows in order: sections and the homes in each. */
async function railOrder(page: Page) {
  return page
    .getByTestId("chat-list")
    .evaluate((rail) =>
      [
        ...rail.querySelectorAll<HTMLElement>(
          ".luca-rail-section-head > span:first-child, [data-home] .luca-rail-row-name, .luca-rail-tail",
        ),
      ].map((node) =>
        node.closest(".luca-rail-section-head")
          ? `§ ${node.textContent}`
          : node.textContent,
      ),
    );
}

/** The thread's hook under a home, measured: its x against the face's
 *  centre, where it starts against the face's foot, where it turns against
 *  the last row's middle, and where it ends against the words. */
async function hookOf(page: Page, homeId: string) {
  return page.getByTestId(`rail-home-${homeId}`).evaluate((row) => {
    const group = row.closest("[data-home-group]");
    const face = row.querySelector(".luca-rail-face")?.getBoundingClientRect();
    const sessions = [
      ...(group?.querySelectorAll<HTMLElement>(
        ".luca-rail-session:not(.luca-rail-session-more)",
      ) ?? []),
    ];
    const first = sessions[0];
    const last = sessions.find((each) => each.dataset.last === "true");
    if (!face || !first || !last) return null;
    const line = (element: HTMLElement) => {
      const style = getComputedStyle(element, "::before");
      const box = element.getBoundingClientRect();
      const left = box.left + Number.parseFloat(style.left);
      return {
        left,
        top: box.top + Number.parseFloat(style.top),
        bottom: box.bottom - Number.parseFloat(style.bottom),
        width: Number.parseFloat(style.width),
        color: style.borderLeftColor,
        radius: style.borderBottomLeftRadius,
        lineWidth: style.borderLeftWidth,
      };
    };
    const head = line(first);
    const tail = line(last);
    const lastBox = last.getBoundingClientRect();
    const words = last
      .querySelector(".luca-rail-session-title")
      ?.getBoundingClientRect();
    const more = group?.querySelector(".luca-rail-session-more");
    return {
      threadXMinusFaceCentre:
        Math.round((head.left + 0.5 - (face.left + face.width / 2)) * 100) /
        100,
      startMinusFaceFoot: Math.round((head.top - face.bottom) * 100) / 100,
      turnYMinusLastMiddle:
        Math.round(
          (tail.bottom - 0.5 - (lastBox.top + lastBox.height / 2)) * 100,
        ) / 100,
      endMinusWords: words
        ? Math.round((tail.left + tail.width - words.left) * 100) / 100
        : null,
      radius: tail.radius,
      lineWidth: head.lineWidth,
      color: head.color,
      moreLined: more
        ? getComputedStyle(more, "::before").content !== "none"
        : null,
      rows: sessions.length,
    };
  });
}

test("the Chats rail: what needs you, Luca, and only work nested", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await speak(page);
  const rail = page.getByTestId("chat-list");
  await expect(page.getByTestId("rail-needs-you")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("rail-needs-you-count")).toHaveText("4", {
    timeout: 20_000,
  });
  await expect(rail.getByTestId(`rail-side-task:task-glass`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(rail.getByTestId(`rail-side-exchange:${X_OPEN}`)).toBeVisible({
    timeout: 20_000,
  });

  // ── the order (Decided 1) ──
  const order = await railOrder(page);
  measure("order", order);
  const sections = order.filter((each) => each?.startsWith("§ "));
  expect(sections).toEqual(["§ Chats", "§ Projects", "§ Agents", "§ Apps"]);
  expect(order[1]).toBe("Needs you");
  expect(order[2]).toBe("Luca");
  const browse = order.indexOf("Browse rooms…");
  expect(order[browse + 1]).toBe("Archived");
  expect(order[browse + 2]).toBe("§ Agents");
  // Loose rooms follow the projects, as rows of their own.
  expect(order.slice(order.indexOf("§ Projects"), browse)).toContain("general");
  await expect(page.getByTestId("rail-section-person")).toHaveCount(0);
  await expect(page.getByTestId("rail-section-room")).toHaveCount(0);
  const apps = await rail
    .getByTestId("rail-section-app")
    .locator("[data-home] .luca-rail-row-name")
    .allTextContents();
  expect(apps.slice(0, 2)).toEqual(["Claude Code", "Codex"]);

  // ── what needs you (Decided 2) ──
  const needs = await page.getByTestId("rail-needs-you").evaluate((row) => {
    const name = row.querySelector(".luca-rail-row-name");
    const count = row.querySelector(".luca-rail-needs");
    const before = row.closest("[data-home-group]")?.nextElementSibling;
    return {
      above: before?.querySelector("[data-home]")?.getAttribute("data-home"),
      face: Boolean(row.querySelector(".luca-rail-face svg")),
      name: name ? getComputedStyle(name).color : null,
      nameWeight: name ? getComputedStyle(name).fontWeight : null,
      count: count?.textContent,
      countColor: count ? getComputedStyle(count).color : null,
      countWeight: count ? getComputedStyle(count).fontWeight : null,
      label: row.querySelector("button")?.getAttribute("aria-label"),
    };
  });
  const inkColor = await rail.evaluate((node) =>
    getComputedStyle(node).getPropertyValue("--rail-ink").trim(),
  );
  measure("needs_you_row", { ...needs, inkColor });
  expect(needs.above).toBe("luca");
  expect(needs.face).toBe(true);
  expect(needs.countWeight).toBe("600");
  expect(needs.label).toBe("Needs you, 4 waiting");
  // The count left Activity for Chats.
  await expect(page.getByTestId("shell-place-conversations-count")).toHaveText(
    "4",
  );
  await expect(page.getByTestId("open-activity-view-count")).toHaveCount(0);

  // ── only work on the thread (Decided 3, as Riley put it, 2026-10-27) ──
  const nesting = await rail.evaluate((node) =>
    Object.fromEntries(
      [...node.querySelectorAll<HTMLElement>("[data-home-group]")].map(
        (group) => [
          group.dataset.homeGroup,
          group.querySelectorAll("[data-rail-focus='session']").length,
        ],
      ),
    ),
  );
  measure("nesting", nesting);
  expect(nesting.luca).toBe(0);
  expect(nesting["needs-you"]).toBe(0);
  for (const [home, rows] of Object.entries(nesting))
    if (home.startsWith("room:")) expect(rows, home).toBe(0);
  expect(nesting[`agent:${ATLAS}`]).toBeGreaterThan(0);
  expect(nesting["app:claude"]).toBe(2);
  expect(nesting["app:codex"]).toBe(1);
  // Atlas carries Luca's question to it; Wren the paused one.
  await expect(rail.getByTestId(`rail-side-exchange:${X_OPEN}`)).toContainText(
    "Luca · general",
  );
  await expect(
    page
      .getByTestId(`rail-home-agent:${WREN}`)
      .locator("xpath=..")
      .getByTestId(`rail-side-exchange:${X_PAUSED}`),
  ).toBeVisible();
  const apps_tasks = await rail.evaluate((node) =>
    [
      ...node.querySelectorAll<HTMLElement>(
        "[data-home-group^='app:'] [data-side-id]",
      ),
    ].map((row) => ({
      home: row.closest<HTMLElement>("[data-home-group]")?.dataset.homeGroup,
      title: row.querySelector(".luca-rail-session-title")?.textContent,
      end: row.lastElementChild?.textContent,
    })),
  );
  measure("apps_tasks", apps_tasks);
  expect(apps_tasks).toContainEqual({
    end: "working",
    home: "app:claude",
    title: "Rail glass plates",
  });
  expect(
    apps_tasks.find((each) => each.title === "Fix the failing build")?.end,
  ).toMatch(/^\d+[mhdw]$/);

  // ── the thread (Decided 4) ──
  const atlasHook = await hookOf(page, `agent:${ATLAS}`);
  const appHook = await hookOf(page, "app:claude");
  measure("thread_geometry", { atlas: atlasHook, claude: appHook });
  for (const hook of [atlasHook, appHook]) {
    expect(hook).not.toBeNull();
    expect(hook?.threadXMinusFaceCentre).toBe(0);
    expect(hook?.startMinusFaceFoot).toBe(3);
    expect(hook?.turnYMinusLastMiddle).toBe(0);
    expect(hook?.endMinusWords).toBe(-6);
    expect(hook?.radius).toBe("7px");
    expect(hook?.lineWidth).toBe("1px");
  }

  // ── the + buttons (Decided 5) ──
  const plus = await rail.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>(".luca-rail-add")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  );
  measure("plus_buttons", plus);
  expect(plus[0]).toBe("Message Luca");
  expect(plus).toContain("New project");
  expect(plus).toContain("Connect an app");
  expect(plus).toContain("New conversation with Atlas");
  expect(plus).toContain("New conversation with Claude Code");
  expect(plus).toContain("New conversation with Codex");
  expect(plus.filter((each) => each?.startsWith("New room in ")).length).toBe(
    await rail.locator("[data-home-kind='project']").count(),
  );
  await expect(
    page.getByTestId("rail-home-luca").locator(".luca-rail-row-add"),
  ).toHaveCount(0);
  await expect(
    rail.locator("[data-home-kind='room'] .luca-rail-row-add"),
  ).toHaveCount(0);

  // ── faces (Decided 6, then WP-42's dendrites and AgentMark fallback) ──
  const faces = await rail.evaluate((node) =>
    Object.fromEntries(
      [...node.querySelectorAll<HTMLElement>("[data-home-kind]")].map((row) => {
        const face = row.querySelector<HTMLElement>(".luca-rail-face");
        const svg = face?.querySelector("svg");
        const dendrite = face?.querySelector<HTMLCanvasElement>(
          "[data-agent-dendrite]",
        );
        const box = (dendrite ?? svg)?.getBoundingClientRect();
        return [
          row.dataset.homeKind,
          {
            face: face?.dataset.face,
            agentMark: svg?.hasAttribute("data-agent-mark") ?? false,
            dendrite: Boolean(dendrite),
            backing: dendrite?.width,
            expectedBacking: Math.round(
              18 * Math.min(3, window.devicePixelRatio),
            ),
            icon: svg?.getAttribute("class") ?? "",
            size: box ? `${box.width}x${box.height}` : null,
          },
        ];
      }),
    ),
  );
  measure("faces", faces);
  for (const mind of [faces.luca, faces.agent]) {
    expect(mind.dendrite || mind.agentMark).toBe(true);
    expect(mind.size).toBe("18x18");
    if (mind.dendrite) expect(mind.backing).toBe(mind.expectedBacking);
  }
  expect(faces.app.face).toBe("app");
  expect(faces.room.icon).toContain("lucide-hash");
  if (faces.project) expect(faces.project.icon).toContain("lucide-folder");

  // ── section names (Decided 8) ──
  const heads = await rail.evaluate((node) =>
    [...node.querySelectorAll(".luca-rail-section-head")].map((head) => {
      const style = getComputedStyle(head);
      return {
        text: head.textContent,
        size: style.fontSize,
        weight: style.fontWeight,
        transform: style.textTransform,
        tracking: style.letterSpacing,
      };
    }),
  );
  measure("section_names", heads);
  // WP-40 (BETA14_RELEASE.md, Decided 1): the heads are the app's
  // micro-label again, the mono's capitals at 11, not WP-34's sentence case.
  for (const head of heads) {
    expect(head.size).toBe("11px");
    expect(head.weight).toBe("400");
    expect(head.transform).toBe("uppercase");
  }

  // ── the open row brightens its words and nothing else ──
  await rail.getByTestId(`rail-side-exchange:${X_OPEN}`).click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
    .toContain(ROOT.open);
  const lit = await rail
    .getByTestId(`rail-side-exchange:${X_OPEN}`)
    .evaluate((row) => ({
      current: row.getAttribute("data-current"),
      color: getComputedStyle(row).color,
      thread: getComputedStyle(row, "::before").borderLeftColor,
      background: getComputedStyle(row).backgroundColor,
      homeActive: row
        .closest("[data-home-group]")
        ?.querySelector("[data-home]")
        ?.getAttribute("data-active"),
    }));
  measure("open_row", { ...lit, inkColor });
  expect(lit.current).toBe("true");
  expect(lit.homeActive).toBe("true");
  expect(lit.background).toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("shell-lip")).toContainText("Atlas");
  await shot(page, "chats-agent-thread-open-night");
});

for (const mode of ["dark", "light"] as const) {
  const when = mode === "dark" ? "night" : "day";
  test(`the Chats rail by ${when}: waiting and not, the tone`, async ({
    page,
  }) => {
    await boot(page, { hash: `/channels/${GENERAL}`, mode });
    await speak(page);
    await expect(page.getByTestId("rail-needs-you-count")).toHaveText("4", {
      timeout: 20_000,
    });
    await expect(
      page.getByTestId("chat-list").getByTestId("rail-side-task:task-glass"),
    ).toBeVisible({ timeout: 20_000 });
    const name = `chats-waiting-${when}`;
    await shot(page, name);
    // The tone: the rail against the card, sampled on open ground: just
    // inside the rail's right edge in the gap above the Agents section, and
    // in the card beside it, at the same height.
    const ground = await page.evaluate(() => {
      const rail = document
        .querySelector("[data-testid='app-sidebar'] [data-sidebar='sidebar']")
        ?.getBoundingClientRect();
      const agents = document
        .querySelector("[data-testid='rail-section-agent']")
        ?.getBoundingClientRect();
      if (!rail || !agents) return null;
      const y = agents.top - 6;
      return {
        rail: { x: rail.right - 14, y },
        card: { x: rail.right + 40, y },
      };
    });
    expect(ground).not.toBeNull();
    const pixels = await pixelsOf(page, name, [
      ground?.rail ?? { x: 0, y: 0 },
      ground?.card ?? { x: 0, y: 0 },
    ]);
    const tone = await page.evaluate(() => {
      const rail = document.querySelector(
        "[data-testid='app-sidebar'] [data-sidebar='sidebar']",
      );
      return rail ? getComputedStyle(rail).backgroundColor : null;
    });
    const [rail, card] = pixels.at;
    measure(`rail_tone_${when}`, {
      ground,
      rail,
      card,
      lightnessStep: Math.round((card.lightness - rail.lightness) * 100) / 100,
      tone,
    });
    expect(rail.lightness).toBeLessThan(card.lightness);
    if (mode === "dark") expect(tone).toBe("rgba(0, 0, 0, 0.2)");
    else expect(tone).toMatch(/^rgba\(.*, 0\.15\)$/);
  });

  test(`nothing waiting by ${when}`, async ({ page }) => {
    await boot(page, {
      hash: `/channels/${GENERAL}`,
      mode,
      waiting: false,
    });
    await speak(page);
    await expect(
      page.getByTestId("chat-list").getByTestId("rail-side-task:task-glass"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("rail-needs-you")).toHaveCount(0);
    await expect(
      page.getByTestId("shell-place-conversations-count"),
    ).toHaveCount(0);
    expect((await railOrder(page))[1]).toBe("Luca");
    await shot(page, `chats-nothing-waiting-${when}`);
  });
}

test("Needs you opens from Chats, in the card, with no tab", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await speak(page);
  await page.getByTestId("rail-needs-you").getByRole("button").click();
  await expect(page.getByTestId("needs-you-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/needs-you");
  // Chats stays the place: its icon marked, its rail on screen, the row lit.
  await expect(page.getByTestId("shell-place-conversations")).toHaveAttribute(
    "data-current",
    "true",
  );
  await expect(page.getByTestId("chat-list")).toBeVisible();
  await expect(page.getByTestId("rail-needs-you")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.locator("[data-needs-kind]")).toHaveCount(4, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("shell-lip")).toContainText("Needs you");
  // Not a conversation: no tab opens for it.
  await expect(page.locator("[data-testid^='shell-tab-']")).toHaveCount(0);
  await shot(page, "needs-you-from-chats-night");
});

test("an app's row opens its page in Chats; its + starts a conversation", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  const claude = page.getByTestId("rail-home-app:claude");
  await expect(claude).toBeVisible({ timeout: 20_000 });
  await claude.getByRole("button", { name: /^Claude Code/ }).click();
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/apps/claude");
  await expect(claude).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("shell-place-conversations")).toHaveAttribute(
    "data-current",
    "true",
  );
  await expect(page.getByTestId("shell-lip")).toContainText("Claude Code");
  await shot(page, "app-page-claude-night");
  // A task row opens the task's page (WP-35), marked under its app.
  await page
    .getByTestId("chat-list")
    .getByTestId("rail-side-task:task-glass")
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/apps/claude/tasks/task-glass");
  await expect(page.getByTestId("app-task-card")).toBeVisible();
  await expect(
    page.getByTestId("chat-list").getByTestId("rail-side-task:task-glass"),
  ).toHaveAttribute("data-current", "true");
  await expect(claude).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("shell-lip")).toContainText("Claude Code");
  await page
    .getByTestId("chat-list")
    .getByTestId("rail-side-task:task-build")
    .evaluate((row) => row.scrollIntoView({ block: "end" }));
  await shot(page, "chats-app-thread-live-task-night");
  // The app's +: New conversation, found to the app.
  await claude.hover();
  await claude
    .getByRole("button", { name: "New conversation with Claude Code" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/messages/new?runtime=claude");
  // The heading's +: Luca's one chat.
  await page.getByTestId("rail-message-luca").click();
  await expect(page.getByTestId("rail-home-luca")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
});

test("Agents without Connected", async ({ page }) => {
  await boot(page, { hash: "/agents" });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("place-section-agents-luca")).toBeVisible();
  await expect(page.getByTestId("place-section-agents-agents")).toBeVisible();
  await expect(page.getByTestId("place-section-agents-groups")).toBeVisible();
  await expect(page.getByTestId("place-section-agents-connected")).toHaveCount(
    0,
  );
  await expect(
    page.locator("[data-testid^='place-row-connected:']"),
  ).toHaveCount(0);
  const heads = await page
    .getByTestId("place-rail-agents")
    .locator(".luca-rail-section-head")
    .evaluateAll((nodes) =>
      nodes.map((head) => ({
        text: head.textContent,
        size: getComputedStyle(head).fontSize,
        transform: getComputedStyle(head).textTransform,
      })),
    );
  measure("agents_place", heads);
  // WP-40, Decided 1: mono capitals at 11 in every place's rail.
  for (const head of heads) {
    expect(head.size).toBe("11px");
    expect(head.transform).toBe("uppercase");
  }
  await shot(page, "agents-without-connected-night");
});

/** Signed messages through the mock relay, from Luca and Atlas, so the
 *  record holds both minds. */
async function signRecords(page: Page) {
  await page.evaluate(
    ({ luca, atlas, at }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      emit?.({
        channelName: "general",
        content: "The release notes are drafted.",
        createdAt: at[0],
        kind: 9,
        pubkey: luca,
      });
      emit?.({
        channelName: "engineering",
        content: "Checked every claim in the landing copy.",
        createdAt: at[1],
        kind: 9,
        pubkey: atlas,
      });
    },
    { atlas: ATLAS, at: [secs(30), secs(50)], luca: LUCA },
  );
}

test("Activity is the record: All activity, then each signed record", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await signRecords(page);
  await page.getByTestId("open-activity-view").click();
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("stream=all");
  await expect(
    page.locator("[data-activity-kind='record']").first(),
  ).toBeVisible({ timeout: 20_000 });
  const rows = page.getByTestId("all-activity-card").locator(".luca-place-row");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const rail = await page
    .getByTestId("place-rail-activity")
    .locator("[data-home] .luca-rail-row-name")
    .allTextContents();
  const record = await page
    .getByTestId("all-activity-card")
    .evaluate((card) => ({
      head: card.querySelector(".luca-place-page-name")?.textContent,
      thread: card
        .querySelector(".luca-place-plate")
        ?.getAttribute("data-thread"),
      rows: [...card.querySelectorAll<HTMLElement>(".luca-place-row")].map(
        (row) => ({
          kind: row.dataset.activityKind,
          title: row.querySelector(".luca-place-row-title")?.textContent,
          summary: row.querySelector(".luca-place-row-summary")?.textContent,
          note: row.querySelector(".luca-place-row-note")?.textContent,
        }),
      ),
    }));
  measure("activity_record", { rail, record });
  expect(rail[0]).toBe("All activity");
  expect(rail).not.toContain("Needs you");
  expect(rail).not.toContain("Now");
  expect(rail).not.toContain("Side conversations");
  expect(rail).toEqual(expect.arrayContaining(["Luca", "Atlas", "Wren"]));
  expect(record.thread).toBe("true");
  const kinds = new Set(record.rows.map((row) => row.kind));
  expect(kinds.has("task")).toBe(true);
  expect(kinds.has("record")).toBe(true);
  expect(record.rows.map((row) => row.title)).toContain(
    "Luca posted a message",
  );
  // Newest first, from real data: the tasks' own summaries.
  expect(record.rows.map((row) => row.title)).toContain(
    "Claude Code · Rail glass plates",
  );
  await shot(page, "activity-all-night");
  // One mind's signed record, as before.
  await page
    .getByTestId(`place-row-record:${LUCA}`)
    .getByRole("button")
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`record=${LUCA}`);
  await expect(page.getByTestId("provenance-end-note")).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, "activity-signed-record-luca-night");
  // An old address to a retired stream lands on All activity.
  await page.goto("/#/pulse?stream=needs-you");
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
});

test("by day: Needs you, the threads, Activity and Agents", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}`, mode: "light" });
  await speak(page);
  await signRecords(page);
  const rail = page.getByTestId("chat-list");
  await expect(rail.getByTestId("rail-side-task:task-glass")).toBeVisible({
    timeout: 20_000,
  });
  await rail.getByTestId(`rail-side-exchange:${X_OPEN}`).click();
  await expect(
    rail.getByTestId(`rail-side-exchange:${X_OPEN}`),
  ).toHaveAttribute("data-current", "true", { timeout: 20_000 });
  await shot(page, "chats-agent-thread-open-day");
  await rail.getByTestId("rail-side-task:task-glass").click();
  await expect(rail.getByTestId("rail-side-task:task-glass")).toHaveAttribute(
    "data-current",
    "true",
    { timeout: 20_000 },
  );
  await rail
    .getByTestId("rail-side-task:task-build")
    .evaluate((row) => row.scrollIntoView({ block: "end" }));
  await shot(page, "chats-app-thread-live-task-day");
  await page.getByTestId("rail-needs-you").getByRole("button").click();
  await expect(page.locator("[data-needs-kind]")).toHaveCount(4, {
    timeout: 20_000,
  });
  await shot(page, "needs-you-from-chats-day");
  await page.getByTestId("open-activity-view").click();
  await expect(
    page.locator("[data-activity-kind='record']").first(),
  ).toBeVisible({ timeout: 20_000 });
  await shot(page, "activity-all-day");
  await page
    .getByTestId(`place-row-record:${LUCA}`)
    .getByRole("button")
    .click();
  await expect(page.getByTestId("provenance-end-note")).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, "activity-signed-record-luca-day");
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("place-section-agents-connected")).toHaveCount(
    0,
  );
  await shot(page, "agents-without-connected-day");
});

test("Project rooms is a setting again; the Apps' words", async ({ page }) => {
  await boot(page, { hash: "/settings?section=appearance" });
  await expect(page.getByTestId("settings-content-scroll")).toBeVisible({
    timeout: 20_000,
  });
  // WP-34 retired it, reading Riley's note on the line as "projects never
  // nest"; his rooms sit under the project again, or in a column by this
  // setting (2026-10-27).
  await expect(page.getByTestId("project-rooms-setting")).toBeVisible();
  await expect(page.getByTestId("project-rooms-rail")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("runtime-rail-pins-settings")).toContainText(
    "Choose which installed apps appear in Chats, under Apps.",
  );
  // Settings' section list stands where the rail does, in the same tone.
  const tone = await page
    .locator("[data-luca-settings-list]")
    .evaluate((list) => getComputedStyle(list).backgroundColor);
  measure("settings_list_tone", { tone });
  expect(tone).toBe("rgba(0, 0, 0, 0.2)");
  await shot(page, "settings-appearance-night");
});

test("flag off: the same as the base build", async ({ browser }) => {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, hash, ready] of [
    ["chats", `/channels/${GENERAL}`, "chat-list"],
    ["activity", "/pulse", "owner-activity-view"],
    ["agents", "/agents", "agents-view"],
  ] as const) {
    const hashes: string[] = [];
    const colors: number[] = [];
    for (const [index, origin] of ["", BASE_URL, BASE_URL].entries()) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, {
        hash,
        origin,
        shell: false,
        waiting: false,
        work: false,
      });
      await expect(page.getByTestId(ready).first()).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1500);
      await railGlassAtRest(page);
      // The residents' eyes over the composer glance on a timer, so the base
      // differs from itself there: both builds' shots mask that one small
      // patch (140 × 70, well under 200 × 200), and nothing else.
      await page.evaluate(() => {
        const patch = document.createElement("div");
        patch.setAttribute("data-flagoff-mask", "");
        Object.assign(patch.style, {
          height: "70px",
          left: "570px",
          pointerEvents: "none",
          position: "fixed",
          top: "720px",
          width: "140px",
        });
        document.body.append(patch);
      });
      const shotName = `flagoff-${name}-${["here", "base", "base-again"][index]}`;
      hashes.push(await shot(page, shotName, { still: true }));
      colors.push((await pixelsOf(page, shotName)).colors);
      await context.close();
    }
    result[name] = {
      base: hashes[1],
      baseAgain: hashes[2],
      colors,
      here: hashes[0],
      same: hashes[0] === hashes[1],
    };
  }
  measure("flag_off", result);
  for (const each of Object.values(result)) {
    expect(each.same).toBe(true);
    for (const count of each.colors as number[])
      expect(count).toBeGreaterThan(8);
  }
});

test.afterAll(() => {
  if (Object.keys(shotHashes).length === 0) return;
  const existing = (() => {
    try {
      return JSON.parse(
        readFileSync(`${SHOTS}/measures/shot_hashes.json`, "utf8"),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  })();
  measure("shot_hashes", { ...existing, ...shotHashes });
});
