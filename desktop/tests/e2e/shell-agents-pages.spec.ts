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

async function openMind(page: Page, pubkey: string) {
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
        // Instrument Sans again since c0fb16ae4 (the Apple face and the mono labels retired).
        expect(head.family, `${place.id} ${head.text}`).toMatch(
          /Instrument Sans/,
        );
        expect(head.size).toBe("11px");
        expect(head.transform).toBe("uppercase");
        // The eyebrow tracking (0.14em, 1.54px at 11px) since c0fb16ae4.
        expect(head.tracking).toBeCloseTo(1.54, 1);
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

/*
 * WP-43 (BETA14_RELEASE.md, "Each agent's page is their place; Settings is
 * yours") replaced WP-40's Notebook · Self · Settings tabs and its all-open
 * Settings with two places. Their page, Settings, its panes and the ways in
 * are proved in shell-agent-place.spec.ts; here, what WP-40 asserted about
 * the tabs is asserted about the two places in their stead.
 */
test("WP-43: two places, no tabs; the old tab words land on their homes", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByTestId("mind-place")).toBeVisible();
  await page.getByTestId("mind-open-settings").click();
  await expect(page.getByTestId("agent-settings")).toBeVisible();
  await expect(page.getByTestId("mind-back")).toHaveText("Luca");
  await page.getByTestId("mind-back").click();
  await expect(page.getByTestId("mind-place")).toBeVisible();
  for (const [section, testId] of [
    ["settings", "agent-settings"],
    // Self held what you write: Settings, at Who {name} is (WP-43, round 3).
    ["self", "mind-group-who"],
    ["notebook", "mind-place"],
  ] as const) {
    await page.goto(`/#/agents?profile=${LUCA}&section=${section}`);
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => hashOf(page)).not.toContain("section=");
  }
});

test("WP-43: an agent's long instructions are shown once, inside Settings", async ({
  page,
}) => {
  const longPrompt = `Warm, exact, and unhurried. ${"Follow the release checklist. ".repeat(40)}`;
  await boot(page, { systemPrompt: longPrompt });
  await page.goto(`/#/agents?profile=${LUCA}&page=settings`);
  const settings = page.getByTestId("agent-settings");
  await expect(settings).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mind-row-instructions")).toBeVisible();
  // The folder's documents are what Luca reads, so the runtime's prompt
  // built from them isn't shown again (WP-43, Decided 13).
  expect(await settings.textContent()).not.toContain(
    "Follow the release checklist.",
  );
  const overflow = await page.evaluate(() => {
    const space = document.querySelector('[data-testid="mind-space"]');
    return space ? space.scrollWidth - space.clientWidth : -1;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  measure("shown-once", { overflow });
});

test("flag off: the classic agents page and the rail match the base", async ({
  browser,
}) => {
  const hashes: Record<string, Record<string, string>> = {};
  const colors: Record<string, number> = {};
  // With one port to serve on (WP-43), the base and this build are shot in
  // two runs: FLAG_OFF_PHASE=base against the base build, then
  // FLAG_OFF_PHASE=here against this one, which compares the two.
  const phase = process.env.FLAG_OFF_PHASE;
  const builds = (
    [
      ["base", BASE_URL],
      ["here", ""],
    ] as const
  ).filter(([build]) => !phase || build === phase);
  for (const [build, origin] of builds) {
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
          await expect(
            page
              .getByRole("button")
              .filter({ hasText: "Luca" })
              .filter({ hasText: "wakes with the app" })
              .first(),
          ).toBeVisible({ timeout: 20_000 });
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
  for (const value of Object.values(colors)) expect(value).toBeGreaterThan(8);
  if (phase) {
    measure(`flag-off-${phase}`, { colors, hashes: hashes[phase] });
    if (phase === "base") return;
    hashes.base = JSON.parse(
      readFileSync(`${SHOTS}/measures/flag-off-base.json`, "utf8"),
    ).hashes;
  }
  measure("flag-off", { base: phase ? "two runs" : BASE_URL, colors, hashes });
  expect(hashes.here).toEqual(hashes.base);
});

test.afterAll(() => {
  measure(`console-${test.info().parallelIndex}`, { errors });
});
