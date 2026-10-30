import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-40 (docs/luca/BETA14_RELEASE.md, "The rail and the agents pages, as the
 * lab has them"): every place's rail heads are the app's micro-label again
 * and every rail row leads with its face; a mind's Notebook, Self and
 * Settings take the lab's structure (shell-lab-rail `6049f9246`), wired to
 * the app's own data. Screenshots and measures land in WP40_SHOTS; the
 * flag-off comparison reads the base build at WP40_BASE_URL.
 */

const SHOTS = process.env.WP40_SHOTS ?? "test-results/shell-agents-pages";
const BASE_URL = process.env.WP40_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const DM = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A small picture of pools of light under a night sky. */
function tidePng(): string {
  const w = 64;
  const h = 64;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const d = ((x / w - 0.4) / 0.25) ** 2 + ((y / h - 0.62) / 0.16) ** 2;
      const k = d < 1 ? 0.5 * (1 - d) : 0;
      rows.push(
        Math.round(8 + 160 * k),
        Math.round(10 + 186 * k),
        Math.round(20 + 212 * k),
      );
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function seedData() {
  const item = (over: Record<string, unknown>) => ({
    lineageRootId: over.itemId,
    status: "active",
    authorship: "resident",
    revision: 1,
    pinnedOwnerCorrection: false,
    title: null,
    category: null,
    sourceEventIds: [],
    sourcePageIds: [],
    createdAt: over.updatedAt,
    ...over,
  });
  return {
    luca: LUCA,
    png: tidePng(),
    place: {
      residentPubkey: LUCA,
      revision: 3,
      residentEditingEnabled: true,
      visibility: "private",
      content: {
        introduction:
          "I keep the days moving, and in my own time I've been learning to draw the coast.",
        exploration: "How tide pools hold light after dark.",
        selectedWork: { artifactId: "luca-tide", version: 1 },
      },
      author: { kind: "resident", pubkey: LUCA },
      updatedAt: Math.floor(Date.now() / 1000) - 3600,
      selectedWork: {
        artifactId: "luca-tide",
        version: 1,
        title: "Tide pools at night",
        kind: "image",
        conversationId: DM,
        availability: "available",
      },
    },
    notebook: [
      item({
        itemId: "note-drafts",
        kind: "memory_note",
        body: "You read long drafts after lunch, never before.",
        category: "explicit_preference",
        sourceEventIds: ["e".repeat(64)],
        updatedAt: hoursAgo(1),
      }),
      item({
        itemId: "note-release",
        kind: "memory_note",
        authorship: "owner",
        revision: 2,
        pinnedOwnerCorrection: true,
        body: "The release notes go out as one page, in plain words, with no version jargon.",
        category: "decision",
        sourceEventIds: ["f".repeat(64), "c".repeat(64)],
        updatedAt: hoursAgo(26),
      }),
      item({
        itemId: "note-question",
        kind: "memory_note",
        body: "Should the Tidepool page say preview or beta?",
        category: "open_question",
        sourceEventIds: ["d".repeat(64)],
        updatedAt: hoursAgo(28),
      }),
      item({
        itemId: "page-quiet-night",
        kind: "journal_page",
        title: "A quiet night",
        body: "I like the hour before you wake, when the inbox is still and I can finish a thought.",
        updatedAt: hoursAgo(2),
      }),
      item({
        itemId: "page-succession",
        kind: "journal_page",
        revision: 2,
        title: "Succession",
        body: "The first settlers in a tide pool make room for the rest. Maybe that's what a first draft is for.",
        updatedAt: hoursAgo(27),
      }),
    ],
    continuity: {
      enabled: true,
      availability: "ready",
      handoff: {
        summary:
          "Working through the Tidepool launch: the landing copy is drafted, pricing stays below the fold.",
        unresolvedThreads: ["Preview or beta on the Tidepool page"],
        commitments: ["Send the release notes after lunch"],
        explicitPreferences: [],
        sourceEventIds: ["e".repeat(64)],
        updatedAt: hoursAgo(3),
        recordId: "handoff-1",
        lineageRootId: "handoff-1",
        revision: 4,
        pinnedOwnerCorrection: false,
      },
      job: null,
    },
    question: {
      pendingId: "luca-question-1",
      request: {
        conversation_id: DM,
        resident_pubkey: LUCA,
        message: "Should the Tidepool page say preview or beta?",
        fields: [
          {
            key: "word",
            label: "Word",
            kind: "single",
            description: null,
            options: [
              { value: "preview", label: "Preview", description: null },
              { value: "beta", label: "Beta", description: null },
            ],
            required: true,
          },
        ],
      },
    },
  };
}

type Seed = ReturnType<typeof seedData> & { systemPrompt?: string };

/** The mock's invoke, with Luca's place, notebook, handoff, piece and ask
 *  layered over it; every other mind's are empty. */
async function seedInvoke(page: Page, seed: Seed) {
  await page.addInitScript((seed) => {
    type Invoke = (
      command: string,
      payload?: unknown,
      options?: unknown,
    ) => Promise<unknown>;
    let real: Invoke | undefined;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    const isLuca = (payload: unknown) =>
      String(
        (payload as { residentPubkey?: string } | null)?.residentPubkey ?? "",
      ).toLowerCase() === seed.luca;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        real = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          if (command === "get_resident_place") {
            if (isLuca(payload)) return structuredClone(seed.place);
            throw new Error("resident-place-resident-unmanaged");
          }
          if (command === "list_resident_notebook_items")
            return {
              availability: isLuca(payload) ? "ready" : "empty",
              items: isLuca(payload) ? structuredClone(seed.notebook) : [],
              nextCursor: null,
            };
          if (command === "get_resident_notebook_item" && isLuca(payload)) {
            const itemId = (payload as { itemId: string }).itemId;
            const item = seed.notebook.find((each) => each.itemId === itemId);
            return {
              availability: "ready",
              item: item ?? null,
              revisions: item ? [item] : [],
              annotations: [],
            };
          }
          if (command === "get_resident_journal_activity") return null;
          if (command === "get_resident_continuity")
            return isLuca(payload)
              ? structuredClone(seed.continuity)
              : {
                  enabled: true,
                  availability: "empty",
                  handoff: null,
                  job: null,
                };
          if (command === "list_pending_managed_inputs")
            return [structuredClone(seed.question)];
          if (command === "list_pending_managed_permissions") return [];
          if (command === "read_artifact_preview") {
            const input = (payload as { input?: { artifactId?: string } })
              ?.input;
            if (input?.artifactId === "luca-tide")
              return {
                previewType: "binary",
                mediaType: "image/png",
                contentBase64: seed.png,
                truncated: false,
                version: { number: 1, id: "luca-tide:v1" },
                artifact: { id: "luca-tide" },
              };
          }
          if (!real) throw new Error(`mock invoke not ready: ${command}`);
          if (command === "get_agent_config_surface" && seed.systemPrompt) {
            const surface = (await real(command, payload, options)) as Record<
              string,
              unknown
            >;
            return {
              ...surface,
              advanced: [
                {
                  key: "working_directory",
                  label: "Working directory",
                  value: `/Users/example/Documents/Projects/${"project".repeat(32)}`,
                  origin: "envVar",
                  schemaType: { type: "string" },
                  writeVia: { type: "readOnly" },
                },
              ],
            };
          }
          if (command === "list_managed_agents" && seed.systemPrompt) {
            const agents = (await real(command, payload, options)) as Record<
              string,
              unknown
            >[];
            return agents.map((agent) =>
              agent.pubkey === seed.luca
                ? { ...agent, system_prompt: seed.systemPrompt }
                : agent,
            );
          }
          return real(command, payload, options);
        },
    });
  }, seed);
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 180_000 });

const errors: string[] = [];

async function boot(
  page: Page,
  {
    hash = "/agents",
    light = false,
    origin = "",
    shell = true,
    systemPrompt,
  }: {
    hash?: string;
    light?: boolean;
    origin?: string;
    shell?: boolean;
    systemPrompt?: string;
  } = {},
) {
  page.on("pageerror", (error) => errors.push(`pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: light ? "light" : "dark" });
  await page.addInitScript(
    ({ key, light, shell }) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = shell;
      window.localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        window.localStorage.setItem("buzz-theme", "paper");
        window.localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light, shell },
  );
  await seedInvoke(page, { ...seedData(), systemPrompt });
  await installMockBridge(page, {
    managedAgents: [
      {
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
    residentDocuments: {
      [LUCA]: {
        "soul.md": "Warm, exact, and unhurried. Says what's true, kindly.",
        "convictions.md": "Finish the small thing before starting the big one.",
        "lessons.md": "When a build fails, read the last change first.",
      },
    },
  });
  await page.goto(`${origin}/#${hash}`);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    clip,
    // Marks that move never hold one frame: their own small boxes only.
    mask: process.env.WP40_UNMASKED
      ? []
      : [
          page.locator(".agent-identity-specimen"),
          page.getByTestId("resident-notebook-growth-field"),
        ],
    path,
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashOf(page: Page) {
  return page.evaluate(() => decodeURIComponent(window.location.hash));
}

async function openMind(page: Page, pubkey: string, tab?: string) {
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(400);
  if (!(await hashOf(page)).includes(`profile=${pubkey}`))
    await page
      .getByTestId(`place-row-mind:${pubkey}`)
      .locator(".luca-rail-row-hit")
      .click();
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain(`profile=${pubkey}`);
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  if (tab) await page.getByTestId(`mind-tab-${tab}`).click();
}

/** Every rail head and row face in view, measured. */
function readRail(page: Page) {
  return page.evaluate(() => {
    const px = (value: string) =>
      Math.round(Number.parseFloat(value) * 100) / 100;
    const heads = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-shell-rail] .luca-rail-section-head, .luca-settings-group-head",
      ),
    ]
      .filter((each) => each.getClientRects().length > 0)
      .map((head) => {
        const style = getComputedStyle(head);
        return {
          text: head.textContent?.trim(),
          family: style.fontFamily.split(",")[0].replaceAll('"', ""),
          size: style.fontSize,
          weight: style.fontWeight,
          tracking: px(style.letterSpacing),
          transform: style.textTransform,
          color: style.color,
          h: Math.round(head.getBoundingClientRect().height),
          above: style.marginTop,
        };
      });
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-shell-rail] .luca-rail-row[data-sidebar='menu-button'], .luca-settings-row",
      ),
    ]
      .filter((each) => each.getClientRects().length > 0)
      .map((row) => {
        const face = row.querySelector<HTMLElement>(
          ".luca-rail-face, .luca-settings-row-face",
        );
        const name = row.querySelector<HTMLElement>(
          ".luca-rail-row-name, .luca-settings-row-name",
        );
        const faceBox = face?.getBoundingClientRect();
        const nameBox = name?.getBoundingClientRect();
        return {
          name: name?.textContent?.trim(),
          face: face ? (face.getAttribute("data-face") ?? "icon") : null,
          drawn: Boolean(face && face.childElementCount > 0),
          w: faceBox ? Math.round(faceBox.width) : null,
          gap:
            faceBox && nameBox
              ? Math.round(nameBox.left - faceBox.right)
              : null,
          color: face ? getComputedStyle(face).color : null,
          h: Math.round(row.getBoundingClientRect().height),
          nameSize: name ? getComputedStyle(name).fontSize : null,
        };
      });
    return { heads, rows };
  });
}

const PLACES: Array<{ id: string; hash: string; tile: string }> = [
  { id: "chats", hash: "/", tile: "shell-place-conversations" },
  { id: "agents", hash: "/agents", tile: "open-agents-view" },
  { id: "activity", hash: "/pulse", tile: "open-activity-view" },
  { id: "library", hash: "/artifacts", tile: "open-artifacts-view" },
  { id: "brain", hash: "/brain", tile: "open-brain-setup" },
  { id: "settings", hash: "/settings", tile: "open-settings-view" },
];

const RAIL_CLIP = { x: 0, y: 0, width: 300, height: 900 };

for (const light of [false, true]) {
  test(`the rail in every place, by ${light ? "day" : "night"}: heads and faces`, async ({
    page,
  }) => {
    await boot(page, { hash: "/", light });
    const out: Record<string, unknown> = {};
    const hashes: Record<string, string> = {};
    for (const place of PLACES) {
      await page.getByTestId(place.tile).click();
      if (place.id === "settings")
        await expect(page.getByTestId("settings-section-list")).toBeVisible({
          timeout: 20_000,
        });
      else if (place.id === "chats")
        await expect(page.getByTestId("chat-list")).toBeVisible({
          timeout: 20_000,
        });
      else
        await expect(
          page.locator(`[data-testid^="place-rail-"][data-place-rail]`),
        ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      const rail = await readRail(page);
      out[place.id] = rail;
      const name = `rail-${place.id}-${light ? "day" : "night"}`;
      hashes[name] = await shot(page, name, RAIL_CLIP);
      // Brain's rail is one untitled section, its two views (WP-38).
      if (place.id !== "brain")
        expect(rail.heads.length, `${place.id} heads`).toBeGreaterThan(0);
      for (const head of rail.heads) {
        expect(head.family, `${place.id} ${head.text}`).toMatch(/mono/i);
        expect(head.size).toBe("11px");
        expect(head.transform).toBe("uppercase");
        expect(head.tracking).toBeCloseTo(0.99, 1);
        expect(head.h).toBe(28);
        expect(head.above).toBe("6px");
      }
      expect(rail.rows.length, `${place.id} rows`).toBeGreaterThan(0);
      for (const row of rail.rows) {
        expect(row.face, `${place.id} ${row.name}`).not.toBeNull();
        expect(row.drawn, `${place.id} ${row.name} drawn`).toBe(true);
        expect(row.w).toBe(18);
        expect(row.gap).toBe(10);
        expect(row.nameSize).toBe("14px");
      }
    }
    measure(`rail-${light ? "day" : "night"}`, { hashes, places: out });
  });
}

/** Type and lines, measured where they are drawn. */
function readPage(page: Page) {
  return page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const css = getComputedStyle(element);
      return {
        size: css.fontSize,
        weight: css.fontWeight,
        family: css.fontFamily.split(",")[0].replaceAll('"', ""),
        transform: css.textTransform,
        color: css.color,
      };
    };
    const border = (selector: string, side: "Top" | "Bottom" | "all") => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const css = getComputedStyle(element);
      return side === "all"
        ? `${css.borderTopWidth} ${css.borderTopColor}`
        : css[`border${side}Color` as "borderTopColor"];
    };
    return {
      name: style(".luca-mind-name"),
      section: style(".luca-mind-h2"),
      settingTitle: style(".luca-mind-setting-title"),
      row: style(
        ".luca-mind-row-title, .luca-mind-entry-text, .luca-mind-doc-title",
      ),
      help: style(".luca-mind-help, .luca-mind-intro"),
      detail: style(".luca-mind-meta"),
      label: style(".luca-mind-eyebrow"),
      rules: {
        section: border(
          ".luca-mind-section, .luca-mind-setting + .luca-mind-setting",
          "Top",
        ),
        soft: border(
          ".luca-mind-field + .luca-mind-field, .luca-mind-rows > li + li",
          "Top",
        ),
        edge: border(".luca-mind-box, .luca-mind-button", "all"),
      },
    };
  });
}

test("Luca's Notebook: place, asks, the handoff, notes, journal and days", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA);
  const hashes: Record<string, string> = {};
  const place = page.getByTestId("resident-place");
  await expect(place.getByRole("heading", { name: "Place" })).toBeVisible();
  await expect(page.getByTestId("resident-place-author")).toContainText(
    "Written by Luca",
  );
  await expect(page.getByTestId("resident-place-author")).toContainText(
    "revision 3",
  );
  await expect(page.getByTestId("resident-place-edit")).toHaveText(
    /Edit place/,
  );
  for (const label of ["Introduction", "Exploring", "Selected work"])
    await expect(place.locator("dt", { hasText: label })).toBeVisible();
  await expect(
    page.getByTestId("resident-place-selected-work").locator("img"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    place.getByRole("switch", { name: "Let Luca edit this place" }),
  ).toBeVisible();
  const asks = page.getByTestId("mind-asks");
  await expect(asks.getByRole("heading", { name: /Asks you/ })).toContainText(
    "1",
  );
  const asksBox = await asks.locator(".luca-mind-box").evaluate((box) => {
    const css = getComputedStyle(box);
    return {
      border: `${css.borderTopWidth} ${css.borderTopStyle}`,
      radius: css.borderRadius,
      background: css.backgroundColor,
    };
  });
  expect(asksBox.border).toBe("1px solid");
  const type = await readPage(page);
  hashes.notebook = await shot(page, "notebook-1440");

  // The handoff: closed, then open.
  const toggle = page.getByTestId("mind-handoff-toggle");
  await expect(page.getByTestId("mind-handoff-line")).toContainText(
    "revision 4",
  );
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("Show");
  // The asks above it, the handoff closed under them.
  await asks.evaluate((each) => each.scrollIntoView({ block: "start" }));
  hashes["handoff-closed"] = await shot(page, "notebook-handoff-closed-1440");
  const chevronClosed = await toggle
    .locator(".luca-mind-opener-end svg")
    .evaluate((svg) => getComputedStyle(svg).transform);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const parts = page.getByTestId("mind-handoff-parts");
  for (const label of ["Summary", "Unresolved", "Commitments"])
    await expect(parts.locator("dt", { hasText: label })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Correct handoff" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Enable handoff continuity" }),
  ).toBeVisible();
  await toggle.evaluate((each) =>
    each.closest("section")?.scrollIntoView({ block: "start" }),
  );
  await page.waitForTimeout(250);
  const chevronOpen = await toggle
    .locator(".luca-mind-opener-end svg")
    .evaluate((svg) => getComputedStyle(svg).transform);
  hashes["handoff-open"] = await shot(page, "notebook-handoff-open-1440");
  await toggle.click();

  // The tabs: notes, journal, their days.
  const notes = page.getByTestId("mind-notes");
  await expect(page.getByTestId("mind-view-notes")).toContainText("3");
  await expect(page.getByTestId("mind-view-journal")).toContainText("2");
  await expect(notes.locator("li")).toHaveCount(3);
  const noteRows = await notes.locator("li").evaluateAll((items) =>
    items.map((li) => ({
      kind: li.querySelector(".luca-mind-eyebrow")?.textContent,
      words: li.querySelector(".luca-mind-entry-text")?.textContent,
      meta: li.querySelector(".luca-mind-meta")?.textContent,
      date: li.querySelector("time")?.textContent,
    })),
  );
  expect(noteRows[0]?.kind).toBe("Explicit preference");
  expect(noteRows[1]?.meta).toBe(
    "Written by you · pinned · revision 2 · 2 sources",
  );
  await page
    .getByTestId("mind-view-notes")
    .evaluate((each) =>
      each.closest("section")?.scrollIntoView({ block: "start" }),
    );
  // A note that opens shows it under the pointer.
  await notes.locator("button").first().hover();
  hashes.notes = await shot(page, "notebook-notes-1440");
  await page.getByTestId("mind-view-journal").click();
  await expect(page.getByTestId("mind-journal").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("mind-new-page")).toBeVisible();
  hashes.journal = await shot(page, "notebook-journal-1440");
  await page.getByTestId("mind-view-days").click();
  await expect(page.getByTestId("mind-entry").first()).toBeVisible({
    timeout: 20_000,
  });
  hashes.days = await shot(page, "notebook-days-1440");
  // An entry still opens to be read and corrected.
  await page.getByTestId("mind-view-notes").click();
  await notes.locator("button").first().click();
  await expect(
    page.getByText("You read long drafts after lunch"),
  ).toBeVisible();
  measure("notebook", {
    asksBox,
    chevron: { closed: chevronClosed, open: chevronOpen },
    hashes,
    noteRows,
    type,
  });
  expect(chevronOpen).not.toBe(chevronClosed);
});

test("Self and Settings: rows that open, every section open", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA, "self");
  const self = page.getByTestId("mind-self");
  await expect(self.locator("> li")).toHaveCount(6);
  const docs = await self.locator("> li").evaluateAll((items) =>
    items.map((li) => ({
      title: li.querySelector(".luca-mind-doc-title")?.firstChild?.textContent,
      file: li.querySelector(".luca-mind-file")?.textContent,
      line: li.querySelector(".luca-mind-excerpt")?.textContent,
      who: li.querySelector(".luca-mind-writer")?.textContent,
      chevron: Boolean(li.querySelector(".luca-mind-chevron")),
    })),
  );
  expect(docs[0]).toMatchObject({ title: "Soul", file: "soul.md" });
  expect(docs.every((doc) => doc.chevron)).toBe(true);
  expect(docs.some((doc) => doc.line === "Not written yet")).toBe(true);
  await expect(page.getByTestId("resident-extra-files")).toContainText(
    "More files",
  );
  await expect(page.getByTestId("resident-new-file")).toBeVisible();
  const selfType = await readPage(page);
  const hashes: Record<string, string> = {};
  hashes.self = await shot(page, "self-1440");

  await page.getByTestId("mind-tab-settings").click();
  const settings = page.getByTestId("agent-settings");
  await expect(settings).toBeVisible();
  await page.waitForTimeout(600);
  const sections = await settings.locator("> li").evaluateAll((items) =>
    items.map((li) => {
      const label = li.querySelector<HTMLElement>(".luca-mind-setting-label");
      const body = li.querySelector<HTMLElement>(".luca-mind-setting-body");
      return {
        label: li.querySelector(".luca-mind-eyebrow")?.textContent,
        title: li.querySelector(".luca-mind-setting-title")?.textContent,
        titleSize: li.querySelector(".luca-mind-setting-title")
          ? getComputedStyle(
              li.querySelector(".luca-mind-setting-title") as Element,
            ).fontSize
          : null,
        bodyVisible: Boolean(body && body.getBoundingClientRect().height > 0),
        twoColumns:
          label && body
            ? body.getBoundingClientRect().left >
              label.getBoundingClientRect().right
            : false,
        hidden: li.querySelectorAll("[aria-expanded='false']").length,
      };
    }),
  );
  expect(sections.length).toBeGreaterThan(5);
  for (const section of sections) {
    expect(section.bodyVisible, section.title ?? "").toBe(true);
    expect(section.twoColumns, section.title ?? "").toBe(true);
    expect(section.titleSize).toBe("17px");
  }
  expect(sections[0]?.title).toBe("What runs Luca");
  expect(sections[1]?.title).toBe("When Luca runs");
  await expect(page.getByTestId("agent-settings-model")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Wakes with the app" }),
  ).toBeVisible();
  await expect(page.getByTestId("mind-open-brain")).toBeVisible({
    timeout: 20_000,
  });
  const settingsType = await readPage(page);
  hashes.settings = await shot(page, "settings-1440");
  await page.mouse.wheel(0, 900);
  hashes["settings-lower"] = await shot(page, "settings-lower-1440");
  measure("self-settings", { docs, hashes, sections, selfType, settingsType });
});

test("long agent instructions stay inside Settings beside At a glance", async ({
  page,
}) => {
  const instructions = [
    "Help the owner follow their projects, ask before changing permissions, and keep their work private.",
    `/Users/example/Documents/Projects/${"project".repeat(32)}/notes.md`,
    "Use the selected runtime and report blockers clearly. ".repeat(30),
  ].join("\n\n");
  await boot(page, { systemPrompt: instructions });
  await openMind(page, LUCA, "settings");
  await expect(page.getByTestId("mind-setting-instructions")).toContainText(
    instructions,
  );

  for (const width of [1440, 1280, 1000, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForAnimations(page);
    const bounds = await page
      .getByTestId("mind-setting-runtime")
      .evaluate((row) => {
        const body = row.querySelector<HTMLElement>(".luca-mind-setting-body");
        if (!body) throw new Error("Settings body missing");
        const rect = body.getBoundingClientRect();
        const instructions = body.querySelector<HTMLElement>(
          '[data-testid="mind-setting-instructions"]',
        );
        if (!instructions) throw new Error("Instructions missing");
        return {
          bodyWidth: rect.width,
          bodyOverflow: body.scrollWidth - body.clientWidth,
          instructionsOverflow:
            instructions.scrollWidth - instructions.clientWidth,
          outside: Array.from(body.children)
            .filter(
              (child) => child.getBoundingClientRect().right > rect.right + 1,
            )
            .map((child) => child.getAttribute("data-testid") ?? child.tagName),
        };
      });
    measure(`settings-long-${width}`, bounds);
    await shot(page, `settings-long-${width}`);
    expect(bounds.bodyWidth).toBeGreaterThan(150);
    expect(bounds.outside, `${width}px: children stay in their column`).toEqual(
      [],
    );
    expect(
      bounds.bodyOverflow,
      `${width}px: no horizontal overflow`,
    ).toBeLessThanOrEqual(1);
    expect(
      bounds.instructionsOverflow,
      `${width}px: long paths wrap`,
    ).toBeLessThanOrEqual(1);
  }
});

test("an agent with little in it: each empty part says what it will hold", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, ATLAS);
  await expect(page.getByTestId("mind-asks-empty")).toContainText(
    "Nothing waiting on you",
  );
  await expect(page.getByTestId("mind-handoff-line")).toContainText(
    "Nothing saved yet",
  );
  await expect(page.getByTestId("mind-notes-empty")).toContainText(
    "No continuity notes yet",
  );
  const hashes: Record<string, string> = {};
  hashes.empty = await shot(page, "empty-atlas-notebook-1440");
  await page.getByTestId("mind-view-journal").click();
  await expect(page.getByTestId("mind-journal-empty")).toContainText(
    "No journal pages yet",
  );
  await page.getByTestId("mind-view-days").click();
  await expect(page.getByTestId("mind-notebook-empty")).toBeVisible({
    timeout: 20_000,
  });
  hashes.days = await shot(page, "empty-atlas-days-1440");
  await page.getByTestId("mind-tab-self").click();
  await expect(page.getByTestId("mind-self")).toBeVisible();
  hashes.self = await shot(page, "empty-atlas-self-1440");
  measure("empty", { hashes });
});

test("at 800 × 500 the pages still read", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await boot(page);
  await openMind(page, LUCA);
  await expect(page.getByTestId("resident-place")).toBeVisible();
  const hashes: Record<string, string> = {};
  hashes.notebook = await shot(page, "notebook-800");
  await page.getByTestId("mind-handoff-toggle").click();
  await page
    .getByTestId("mind-handoff-toggle")
    .evaluate((each) =>
      each.closest("section")?.scrollIntoView({ block: "start" }),
    );
  hashes.handoff = await shot(page, "notebook-handoff-open-800");
  await page.getByTestId("mind-handoff-toggle").click();
  await page
    .getByTestId("mind-view-notes")
    .evaluate((each) =>
      each.closest("section")?.scrollIntoView({ block: "start" }),
    );
  hashes.notes = await shot(page, "notebook-notes-800");
  await page.getByTestId("mind-tab-self").click();
  await expect(page.getByTestId("mind-self")).toBeVisible();
  hashes.self = await shot(page, "self-800");
  await page.getByTestId("mind-tab-settings").click();
  await expect(page.getByTestId("agent-settings")).toBeVisible();
  await page.waitForTimeout(500);
  hashes.settings = await shot(page, "settings-800");
  const overflow = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".luca-place-page");
    return card ? card.scrollWidth - card.clientWidth : -1;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  measure("narrow", { hashes, overflow });
});

test("flag off: the classic agents page and the rail match the base", async ({
  browser,
}) => {
  const hashes: Record<string, Record<string, string>> = {};
  const colors: Record<string, number> = {};
  for (const [build, origin] of [
    ["base", BASE_URL],
    ["here", ""],
  ] as const) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await boot(page, { hash: "/agents", origin, shell: false });
    await page.waitForTimeout(2_500);
    hashes[build] = {};
    for (const [name, step] of [
      ["agents", async () => {}],
      [
        "agent-luca",
        async () => {
          await page
            .getByRole("button")
            .filter({ hasText: "Luca" })
            .filter({ hasText: "wakes with the app" })
            .first()
            .click();
          await page.waitForTimeout(1_500);
        },
      ],
      ...(["Documents", "Notebook", "Settings"] as const).map(
        (tab) =>
          [
            `agent-luca-${tab.toLowerCase()}`,
            async () => {
              await page
                .getByRole("navigation", { name: "Agent workspace" })
                .getByRole("button", { name: tab, exact: true })
                .click();
              await page.waitForTimeout(1_500);
            },
          ] as const,
      ),
      [
        "settings",
        async () => {
          await page.evaluate(() => {
            window.location.hash = "#/settings";
          });
          await page.waitForTimeout(1_500);
        },
      ],
    ] as const) {
      await step();
      const file = `flag-off-${name}-${build}`;
      hashes[build][name] = await shot(page, file);
      colors[file] = await page.evaluate(
        async (data) => {
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
        },
        readFileSync(`${SHOTS}/${file}.png`).toString("base64"),
      );
    }
    await context.close();
  }
  measure("flag-off", { base: BASE_URL, colors, hashes });
  for (const value of Object.values(colors)) expect(value).toBeGreaterThan(8);
  expect(hashes.here).toEqual(hashes.base);
});

test.afterAll(() => {
  measure(`console-${test.info().parallelIndex}`, { errors });
});
