import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-13, a mind's own space (docs/luca/rail-system/SHELL_BUILD.md;
 * NAVIGATION.md, "A mind's own space"): under `shell-frame` a mind's card in
 * Agents is their space, Notebook · Self · Settings, Brain is What they can
 * read inside Settings, and an agent's profile card is a short summary.
 * Screenshots land in WP13_SHOTS; measurements in WP13_SHOTS/measures. The
 * base build is read for the flag-off comparison at WP13_BASE_URL.
 */

const SHOTS = process.env.WP13_SHOTS ?? "test-results/shell-mind-space";
const BASE_URL = process.env.WP13_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const KESTREL = "d".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DM = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A small picture of three pools of light under a night sky. */
function tidePng(): string {
  const w = 96;
  const h = 64;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let r = 6 + 10 * t;
      let g = 8 + 14 * t;
      let b = 16 + 18 * t;
      for (const [cx, cy, rx, ry, a] of [
        [0.3, 0.66, 0.22, 0.16, 0.55],
        [0.64, 0.58, 0.15, 0.11, 0.38],
        [0.82, 0.74, 0.1, 0.07, 0.3],
      ]) {
        const d = ((x / w - cx) / rx) ** 2 + ((y / h - cy) / ry) ** 2;
        if (d < 1) {
          const k = a * (1 - d);
          r += (168 - r) * k;
          g += (196 - g) * k;
          b += (232 - b) * k;
        }
      }
      rows.push(Math.round(r), Math.round(g), Math.round(b));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
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

/** Today at an hour, as the app's clock reads it. */
function todayAt(hour: number, minute = 0) {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return at;
}

function yesterdayAt(hour: number) {
  const at = todayAt(hour);
  at.setDate(at.getDate() - 1);
  return at;
}

type Seed = ReturnType<typeof seedData>;

function seedData() {
  const iso = (at: Date) => at.toISOString();
  const now = new Date();
  // Keep "today" before now, so nothing sits in the future.
  const hour = (h: number) => Math.min(h, Math.max(0, now.getHours() - 1));
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
      {
        itemId: "page-quiet-night",
        lineageRootId: "page-quiet-night",
        kind: "journal_page",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinnedOwnerCorrection: false,
        title: "A quiet night",
        body: "I like the hour before you wake, when the inbox is still and I can finish a thought.",
        category: null,
        sourceEventIds: [],
        sourcePageIds: [],
        createdAt: iso(todayAt(hour(4), 5)),
        updatedAt: iso(todayAt(hour(4), 5)),
      },
      {
        itemId: "annotation-quiet-night",
        lineageRootId: "annotation-quiet-night",
        kind: "journal_annotation",
        status: "active",
        authorship: "owner",
        revision: 1,
        pinnedOwnerCorrection: false,
        title: null,
        body: "Keep writing these.",
        category: null,
        sourceEventIds: [],
        sourcePageIds: ["page-quiet-night"],
        createdAt: iso(todayAt(hour(6), 30)),
        updatedAt: iso(todayAt(hour(6), 30)),
      },
      {
        itemId: "note-drafts",
        lineageRootId: "note-drafts",
        kind: "memory_note",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinnedOwnerCorrection: false,
        title: null,
        body: "You read long drafts after lunch, never before.",
        category: "explicit_preference",
        sourceEventIds: [],
        sourcePageIds: [],
        createdAt: iso(todayAt(hour(7), 58)),
        updatedAt: iso(todayAt(hour(7), 58)),
      },
      {
        itemId: "page-succession",
        lineageRootId: "page-succession",
        kind: "journal_page",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinnedOwnerCorrection: false,
        title: "Succession",
        body: "In tide pools the first settlers make room for the rest.",
        category: null,
        sourceEventIds: [],
        sourcePageIds: [],
        createdAt: iso(yesterdayAt(23)),
        updatedAt: iso(yesterdayAt(23)),
      },
    ],
    memory: {
      core: null,
      memories: [
        {
          slug: "tide-tables",
          body: "Saturday's low tide is at 6:40, the best light for the shoot.",
          eventId: "e".repeat(64),
          createdAt: Math.floor(yesterdayAt(21).getTime() / 1000),
          outgoingRefs: [],
        },
      ],
      truncated: false,
      fetchedAt: Math.floor(Date.now() / 1000),
    },
    artifacts: [
      {
        id: "luca-tide",
        title: "Tide pools at night",
        kind: "image",
        mediaType: "image/png",
        summary: null,
        conversationId: DM,
        createdAt: iso(todayAt(hour(3), 30)),
      },
      {
        id: "luca-release-notes",
        title: "release-notes.md",
        kind: "markdown",
        mediaType: "text/markdown",
        summary: "Drafted the release notes",
        conversationId: GENERAL,
        createdAt: iso(yesterdayAt(22)),
      },
    ],
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
    permission: {
      pendingId: "luca-permission-1",
      request: {
        protocol: "luca.managed.permission.v1",
        resident_pubkey: LUCA,
        conversation_id: DM,
        session_epoch: 1,
        turn_id: "turn-1",
        acp_request_id: "acp-1",
        title: "Run the release script",
        tool_call_id: null,
        action_preview: "./scripts/release.sh --dry-run",
        options: [
          { option_id: "allow", name: "Allow once", kind: "allow_once" },
          { option_id: "reject", name: "Reject", kind: "reject_once" },
        ],
        tool_kind: "execute",
        tool_name: "Bash",
      },
      offer: { once: true, task: false, alwaysHere: false, deny: true },
    },
  };
}

/** The mock's invoke, with Luca's own words, notebook, memory, made pieces
 *  and asks layered over it. Installed before the bridge sets the mock. */
async function seedInvoke(page: Page, seed: Seed) {
  await page.addInitScript((seed) => {
    type Invoke = (
      command: string,
      payload?: unknown,
      options?: unknown,
    ) => Promise<unknown>;
    let real: Invoke | undefined;
    const pending = { inputs: [seed.question], permissions: [seed.permission] };
    const calls: string[] = [];
    (window as unknown as { __WP13_CALLS__: string[] }).__WP13_CALLS__ = calls;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    const isLuca = (payload: unknown) =>
      String(
        (payload as { residentPubkey?: string; agentPubkey?: string } | null)
          ?.residentPubkey ??
          (payload as { agentPubkey?: string } | null)?.agentPubkey ??
          "",
      ).toLowerCase() === seed.luca;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        real = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          calls.push(command);
          if (command === "get_resident_place") {
            if (isLuca(payload)) return structuredClone(seed.place);
            throw new Error("resident-place-resident-unmanaged");
          }
          if (command === "set_resident_place_editing" && isLuca(payload)) {
            seed.place.residentEditingEnabled =
              !seed.place.residentEditingEnabled;
            seed.place.revision += 1;
            return structuredClone(seed.place);
          }
          if (command === "list_resident_notebook_items" && isLuca(payload))
            return {
              availability: "ready",
              items: structuredClone(seed.notebook),
              nextCursor: null,
            };
          if (command === "get_resident_notebook_item" && isLuca(payload)) {
            const itemId = (payload as { itemId: string }).itemId;
            const item = seed.notebook.find((each) => each.itemId === itemId);
            return {
              availability: "ready",
              item: item ?? null,
              revisions: item ? [item] : [],
              annotations: seed.notebook.filter((each) =>
                each.sourcePageIds.includes(itemId),
              ),
            };
          }
          if (command === "get_agent_memory" && isLuca(payload))
            return structuredClone(seed.memory);
          if (command === "list_pending_managed_inputs")
            return structuredClone(pending.inputs);
          if (command === "list_pending_managed_permissions")
            return structuredClone(pending.permissions);
          if (command === "resolve_managed_input") {
            const { pendingId } = payload as { pendingId: string };
            pending.inputs = pending.inputs.filter(
              (each) => each.pendingId !== pendingId,
            );
            (
              window as unknown as {
                __BUZZ_E2E_EMIT_TAURI_EVENT__?: (
                  name: string,
                  payload: unknown,
                ) => void;
              }
            ).__BUZZ_E2E_EMIT_TAURI_EVENT__?.("managed-input-resolved", {
              action: "accept",
              pendingId,
            });
            return null;
          }
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
          const result = await real(command, payload, options);
          if (command === "list_artifacts") {
            const listing = result as {
              artifacts: Record<string, unknown>[];
              total: number;
            };
            const sample = listing.artifacts[0] ?? {};
            const input = (payload as { input?: { deleted?: string } })?.input;
            if (input?.deleted === "deleted") return result;
            const mine = seed.artifacts.map((each) => ({
              ...sample,
              availability: "ready",
              createdAt: each.createdAt,
              currentVersion: 1,
              currentVersionId: `${each.id}:v1`,
              deletedAt: null,
              id: each.id,
              kind: each.kind,
              language: null,
              mediaType: each.mediaType,
              pinned: false,
              provenance: {
                conversationId: each.conversationId,
                dispatchReceiptId: null,
                finalMessageId: null,
                projectId: null,
                residentPubkey: seed.luca,
                turnId: null,
              },
              sourceBinding: null,
              summary: each.summary,
              title: each.title,
              updatedAt: each.createdAt,
            }));
            return {
              ...listing,
              artifacts: [...mine, ...listing.artifacts],
              total: listing.total + mine.length,
            };
          }
          return result;
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
test.describe.configure({ timeout: 150_000 });

async function boot(
  page: Page,
  {
    hash = "/agents",
    origin,
    shell = true,
  }: { hash?: string; origin?: string; shell?: boolean } = {},
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  if (shell) {
    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    }, FEATURE_OVERRIDES_STORAGE_KEY);
  }
  await seedInvoke(page, seedData());
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
      {
        name: "Kestrel",
        pubkey: KESTREL,
        status: "deployed",
        backend: { type: "provider", id: "remote-host", config: {} },
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
        "soul.md": "Warm, exact, and unhurried.",
        "lessons.md": "When a build fails, read the last change first.",
      },
    },
  });
  await page.goto(`${origin ?? ""}/#${hash}`);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

/** Signed records through the mock relay: in #general (you're a member)
 *  and #engineering (you're not). */
async function seedRecords(page: Page) {
  measure(
    "channels",
    await page.evaluate(async () => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, payload?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const channels = (await internals.invoke("get_channels")) as {
        name: string;
        is_member: boolean;
        channel_type: string;
      }[];
      return channels.map((each) => [
        each.name,
        each.channel_type,
        each.is_member,
      ]);
    }),
  );
  const now = new Date();
  const hour = (h: number) => Math.min(h, Math.max(0, now.getHours() - 1));
  const at = (h: number, m = 0) =>
    Math.floor(todayAt(hour(h), m).getTime() / 1000);
  await page.evaluate(
    ({ luca, times }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      for (const [index, createdAt] of times.general.entries())
        emit?.({
          channelName: "general",
          content: `A note for the release, part ${index + 1}.`,
          createdAt,
          kind: 9,
          pubkey: luca,
        });
      emit?.({
        channelName: "design",
        content: "Wondering why caches go stale.",
        createdAt: times.engineering,
        kind: 9,
        pubkey: luca,
      });
      emit?.({
        channelName: "general",
        content: "The studio site builds again.",
        createdAt: times.job,
        extraTags: [["subject", "Fix the studio site's failing build"]],
        kind: 1618,
        pubkey: luca,
      });
    },
    {
      luca: LUCA,
      times: {
        engineering: at(5, 10),
        general: [at(9, 1), at(9, 12), at(9, 21)],
        job: at(8, 19),
      },
    },
  );
}

async function shot(page: Page, name: string, maskMoving = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  // The marks that move never hold one frame (the notebook's growth field,
  // a resident's specimen, a clock): the flag-off comparison masks their
  // own boxes, in both builds alike, and nothing else.
  await page.screenshot({
    mask: maskMoving
      ? [
          page.getByTestId("resident-notebook-growth-field"),
          page.locator(".agent-identity-specimen"),
          // A message's time of day, which moves on between two loads.
          page.locator("time"),
        ]
      : [],
    path,
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** How many colours a shot holds, sampled on a 120 x 75 grid: a blank or
 *  one-colour shot proves nothing. */
async function colorsOf(page: Page, name: string) {
  const data = readFileSync(`${SHOTS}/${name}.png`).toString("base64");
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

function hashOf(page: Page) {
  return page.evaluate(() => decodeURIComponent(window.location.hash));
}

/** Pick a mind in the Agents rail (by its row's own button). */
async function pickMind(page: Page, pubkey: string) {
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByTestId(`place-row-mind:${pubkey}`)
    .locator(".luca-rail-row-hit")
    .click();
}

async function openLuca(page: Page, tab?: string) {
  // Agents opens on Luca: pick only if the address names someone else, and
  // let the pick land before a tab is chosen.
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  if (!(await hashOf(page)).includes(`profile=${LUCA}`))
    await pickMind(page, LUCA);
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain(`profile=${LUCA}`);
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  if (tab) await page.getByTestId(`mind-tab-${tab}`).click();
}

/** Bounding box and type of the first match of each selector. */
function readType(page: Page, selectors: string[]) {
  return page.evaluate((selectors) => {
    const out: Record<string, unknown> = {};
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        out[selector] = null;
        continue;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      out[selector] = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        font: `${style.fontSize} ${style.fontWeight} ${style.fontStyle}`,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
        background: style.backgroundColor,
        radius: style.borderRadius,
        family: style.fontFamily.split(",")[0],
      };
    }
    return out;
  }, selectors);
}

test("Luca's space: the head, Notebook, its stream and its filters", async ({
  page,
}) => {
  await boot(page);
  await seedRecords(page);
  await openLuca(page);
  const head = page.getByTestId("mind-head");
  await expect(head.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(page.getByTestId("mind-talk")).toHaveText("Talk");
  await expect(page.getByTestId("resident-place-introduction")).toContainText(
    "learning to draw the coast",
  );
  await expect(page.getByTestId("mind-asks")).toBeVisible();
  await expect(page.getByTestId("mind-entry").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByTestId("mind-made").locator("img").first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => hashOf(page)).toContain(`profile=${LUCA}`);
  const hashes: Record<string, string> = {};
  hashes["space-luca"] = await shot(page, "space-luca");

  const entries = await page.getByTestId("mind-entry").evaluateAll((rows) =>
    rows.map((row) => ({
      kind: row.getAttribute("data-kind"),
      label: row.querySelector(".luca-mind-kind")?.textContent,
      text: row.querySelector(".luca-mind-entry p")?.textContent,
      time: row.querySelector("time")?.textContent,
      made: Boolean(row.querySelector("[data-testid='mind-made']")),
      picture: Boolean(row.querySelector(".luca-mind-thumb img")),
      annotations: [...row.querySelectorAll(".luca-mind-annotation")].map(
        (each) => each.textContent,
      ),
    })),
  );
  const days = await page
    .locator(".luca-mind-day > h2")
    .evaluateAll((items) => items.map((each) => each.textContent));
  measure("stream", { days, entries });

  measure(
    "type",
    await readType(page, [
      ".luca-place-page-axis",
      ".luca-mind-head",
      ".luca-mind-head .agent-identity-specimen",
      ".luca-mind-who .luca-place-page-name",
      ".luca-mind-now",
      ".luca-mind-talk",
      ".luca-mind-tabs",
      ".luca-mind-tab[data-selected]",
      ".luca-mind-words blockquote",
      ".luca-mind-words figcaption",
      ".luca-mind-piece .luca-mind-thumb",
      "[data-testid='mind-asks'] li.luca-ask",
      ".luca-mind-filter[data-selected]",
      ".luca-mind-filter:not([data-selected])",
      ".luca-mind-day > h2",
      ".luca-mind-day li",
      ".luca-mind-kind",
      ".luca-mind-entry p",
      ".luca-mind-day time",
      ".luca-mind-made",
      ".luca-mind-made .luca-mind-thumb",
    ]),
  );

  const filters = await page
    .locator(".luca-mind-filter")
    .evaluateAll((items) => items.map((each) => each.textContent));
  const perFilter: Record<string, unknown> = {};
  for (const id of ["you", "own", "journal", "memory", "all"]) {
    const button = page.getByTestId(`mind-filter-${id}`);
    if ((await button.count()) === 0) {
      perFilter[id] = "hidden";
      continue;
    }
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    perFilter[id] = await page
      .getByTestId("mind-entry")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
    if (id !== "all") {
      await page
        .locator(".luca-mind-filters")
        .evaluate((each) => each.scrollIntoView({ block: "start" }));
      hashes[`notebook-${id}`] = await shot(page, `notebook-${id}`);
    }
  }
  measure("filters", { filters, perFilter });
  measure("hashes-space", hashes);
});

test("asks are the shared ask row, answered in place; notebook actions stay reachable", async ({
  page,
}) => {
  await boot(page);
  await openLuca(page);
  // The asks are the one ask row Needs you uses (WP-09b, Decided 1).
  const asks = page.getByTestId("mind-asks");
  await expect(asks.locator("li.luca-ask")).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("mind-entry").first()).toBeVisible({
    timeout: 20_000,
  });
  const lines = await asks.locator("li.luca-ask").evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.getBoundingClientRect();
      const answer = row.querySelector<HTMLElement>(".luca-ask-answers button");
      const text = row.querySelector<HTMLElement>(".luca-place-row-title");
      return {
        height: Math.round(box.height),
        kind: (row as HTMLElement).dataset.askKind ?? null,
        where: row.querySelector(".luca-place-row-summary")?.textContent,
        question: text?.textContent,
        questionSize: text ? getComputedStyle(text).fontSize : null,
        answer: answer?.textContent,
        answerFill: answer ? getComputedStyle(answer).backgroundColor : null,
        cardShown: Boolean(row.querySelector(".luca-ask-panel")),
      };
    }),
  );
  // Nothing solid on the first screen but Talk.
  const solid = await page.evaluate(() => {
    const out: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".luca-mind button, .luca-mind [role=switch]",
    )) {
      const box = element.getBoundingClientRect();
      if (box.top > window.innerHeight || box.bottom < 0) continue;
      const fill = getComputedStyle(element).backgroundColor;
      const match = fill.match(/rgba?\(([^)]+)\)/);
      const alpha = match ? Number(match[1].split(",")[3] ?? 1) : 0;
      if (alpha > 0.5)
        out.push(
          element.textContent?.trim() ||
            element.getAttribute("aria-label") ||
            "?",
        );
    }
    return out;
  });
  const firstDay = await page
    .locator(".luca-mind-day li")
    .first()
    .evaluate((row) => Math.round(row.getBoundingClientRect().top));
  const lineShot = await shot(page, "asks-one-line");
  // A one-choice question is answered on its row: the choice, then Send.
  const question = asks.getByTestId("mind-ask-question:luca-question-1");
  await question.getByRole("button", { name: "Beta", exact: true }).click();
  await question.getByTestId("needs-you-question-send").click();
  await expect(asks.locator("li.luca-ask")).toHaveCount(1, {
    timeout: 10_000,
  });
  const answered = await shot(page, "asks-answered");

  // A journal page opens in place, in its own voice, where annotate lives.
  await page
    .getByTestId("mind-entry")
    .filter({ hasText: "A quiet night" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Annotate" })).toBeVisible();
  const voice = await page.getByTestId("notebook-detail-voice").innerText();
  const notes = await page.getByText("Your notes").count();
  const journalPage = await shot(page, "journal-page");
  await page.getByRole("button", { name: "Back to notebook" }).click();
  await expect(page.getByTestId("mind-notebook")).toBeVisible();
  // New page and the saved handoff, at the end of the filters' row.
  const row = await page.locator(".luca-mind-toolbar").evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    return [...bar.querySelectorAll<HTMLElement>(".luca-mind-action")].map(
      (each) => {
        const b = each.getBoundingClientRect();
        return {
          text: each.textContent?.trim(),
          fromRight: Math.round(box.right - b.right),
          top: Math.round(b.top),
          bottom: Math.round(b.bottom),
        };
      },
    );
  });
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.getByText("New journal page")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Luca" })).toBeInViewport({
    timeout: 5_000,
  });
  const askName = await page.getByRole("button", { name: "Ask Luca" }).count();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("mind-handoff-toggle").click();
  await expect(page.getByTestId("mind-handoff")).toBeVisible();
  measure("asks-and-actions", {
    answered,
    askName,
    firstDay,
    journalPage,
    lineShot,
    lines,
    notes,
    row,
    solid,
    voice,
  });
});

test("Self and Settings: who they are; how they run", async ({ page }) => {
  await boot(page);
  await openLuca(page, "self");
  await expect.poll(() => hashOf(page)).toContain("section=self");
  await expect(page.getByTestId("mind-self")).toBeVisible();
  await expect(page.getByTestId("resident-document-soul-line")).toHaveAttribute(
    "data-written",
    "true",
  );
  const rows = await page
    .getByTestId("mind-self")
    .locator("li")
    .evaluateAll((items) =>
      items.map((item) => ({
        title: item.querySelector(".luca-mind-title")?.textContent,
        line: item.querySelector(".luca-mind-excerpt")?.textContent,
        written:
          item
            .querySelector(".luca-mind-excerpt")
            ?.getAttribute("data-written") === "true",
        who: item.querySelector(".luca-mind-writer")?.textContent,
        height: Math.round(item.getBoundingClientRect().height),
      })),
    );
  const quiet = await page.locator(".luca-mind-quiet").first().textContent();
  const folderPath = await page
    .getByTestId("mind-space")
    .getByText(/^residents\//)
    .count();
  const eyebrow = await page
    .getByTestId("resident-extra-files")
    .locator("h3")
    .evaluate((h) => getComputedStyle(h).fontFamily.split(",")[0]);
  const self = await shot(page, "self");
  await page.getByTestId("resident-document-soul").click();
  const back = page.getByRole("button", { name: "Self", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByTestId("mind-self")).toBeVisible();
  measure("self", { eyebrow, folderPath, quiet, rows, self });

  await page.getByTestId("mind-tab-settings").click();
  await expect.poll(() => hashOf(page)).toContain("section=settings");
  await expect(page.getByTestId("mind-setting-wakes")).toBeVisible();
  await page.waitForTimeout(800);
  const settingRows = await page
    .getByTestId("agent-settings")
    .locator(":scope > li")
    .evaluateAll((items) =>
      items.map((item) => {
        const title = item.querySelector<HTMLElement>(".luca-mind-title");
        const value = item.querySelector<HTMLElement>(".luca-mind-value");
        return {
          title: title?.textContent,
          titleSize: title ? getComputedStyle(title).fontSize : null,
          value: value?.textContent,
          valueSize: value ? getComputedStyle(value).fontSize : null,
          open: item.getAttribute("data-open") === "true",
          height: Math.round(item.getBoundingClientRect().height),
        };
      }),
    );
  const smallCaps = await page
    .getByTestId("agent-settings")
    .evaluate(
      (list) =>
        [...list.querySelectorAll<HTMLElement>("*")].filter(
          (each) =>
            getComputedStyle(each).textTransform === "uppercase" &&
            each.textContent?.trim(),
        ).length,
    );
  const helpClosed = await page
    .getByText("Starts when Polyphonic opens", { exact: false })
    .count();
  const settings = await shot(page, "settings");
  await page
    .getByTestId("mind-setting-wakes")
    .locator("button")
    .first()
    .click();
  const helpOpen = await page
    .getByText("Starts when Polyphonic opens", { exact: false })
    .count();
  const wakesOpen = await shot(page, "settings-wakes-open");
  await page
    .getByTestId("mind-what-they-can-read")
    .locator("button")
    .first()
    .click();
  // WP-38 (BETA14_RELEASE.md, Decided 3): the row is this mind's own access,
  // source by source, with Open Brain; Brain's body is Brain's place alone.
  await expect(page.getByTestId("mind-brain-access")).toBeVisible();
  await expect(
    page.getByTestId("mind-brain-source-connected-repository-luca"),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByTestId("mind-what-they-can-read")
    .evaluate((each) => each.scrollIntoView({ block: "start" }));
  const read = await shot(page, "what-they-can-read");
  const brain = await page
    .getByTestId("mind-what-they-can-read")
    .evaluate((row) => ({
      sources: row.querySelectorAll("[data-testid^='mind-brain-source-']")
        .length,
      cards: row.querySelectorAll("[data-testid^='brain-card-']").length,
      tabStrip: row.querySelectorAll("[role=tablist]").length,
      openBrain: Boolean(row.querySelector("[data-testid='mind-open-brain']")),
    }));
  expect(brain.sources).toBeGreaterThan(0);
  expect(brain.cards).toBe(0);
  expect(brain.openBrain).toBe(true);
  measure("settings", {
    brain,
    helpClosed,
    helpOpen,
    hashes: { read, settings, wakesOpen },
    scan: await page
      .getByRole("button", { name: "Scan for Brain sources" })
      .isVisible(),
    settingRows,
    smallCaps,
  });
});

// WP-38 (BETA14_RELEASE.md, Decided 1 and 6): `/brain` is Brain's own place
// again, no longer a redirect to Luca's space.
test("/brain opens Brain's own place, not Luca's space", async ({ page }) => {
  await boot(page, { hash: "/brain" });
  await expect(page.getByTestId("brain-place")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("brain-card-repository")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("mind-space")).toHaveCount(0);
  const landing = await hashOf(page);
  expect(landing).toMatch(/^#\/brain/);
  const redirect = await shot(page, "brain-redirect");
  measure("brain-redirect", { landing, redirect });
});

test("the profile card for an agent is a short summary", async ({ page }) => {
  await boot(page, { hash: `/channels/${GENERAL}?profile=${LUCA}` });
  const panel = page
    .getByTestId("user-profile-panel")
    .locator("visible=true")
    .first();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const summary = page.getByTestId("profile-agent-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("profile-agent-summary-intro")).toContainText(
    "learning to draw the coast",
  );
  const before = {
    buttons: await summary.getByRole("button").evaluateAll((items) =>
      items.map((each) => ({
        text: each.textContent?.trim(),
        icon: Boolean(each.querySelector("svg")),
        top: Math.round(each.getBoundingClientRect().top),
      })),
    ),
    tabs: await panel.getByRole("tab").allTextContents(),
  };
  const summaryShot = await shot(page, "profile-summary");
  await page.getByTestId("profile-agent-more").click();
  const afterTabs = await panel.getByRole("tab").allTextContents();
  const moreShot = await shot(page, "profile-more");
  await page.getByTestId("profile-open-their-space").click();
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  const landing = await hashOf(page);
  const opened = await shot(page, "open-their-space");
  measure("profile", {
    afterTabs,
    before,
    landing,
    moreShot,
    opened,
    summaryShot,
  });
});

test("a profile opened from a conversation writes no dead tab", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  await seedRecords(page);
  const author = page
    .getByTestId("message-author")
    .filter({ hasText: "Luca" })
    .first();
  await expect(author).toBeVisible({ timeout: 20_000 });
  await author.click();
  await expect(page.getByTestId("profile-agent-summary")).toBeVisible({
    timeout: 20_000,
  });
  const address = await hashOf(page);
  measure("profile-tab", { address });
  expect(address).not.toContain("profileTab=continuity");
});

test("a mind not on this Mac: the same space, its parts with no data hide", async ({
  page,
}) => {
  await boot(page);
  await pickMind(page, KESTREL);
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  const own = await page.getByTestId("resident-place").count();
  const asks = await page.getByTestId("mind-asks").count();
  const native = await shot(page, "space-native-agent");
  measure("native", { asks, native, ownWords: own });
});

test("the head's mark draws at 40 on a 40 column", async ({ page }) => {
  await boot(page);
  await openLuca(page);
  const column = await page.locator(".luca-mind-mark").evaluate((box) => {
    const outer = box.getBoundingClientRect();
    const specimen = box.querySelector<HTMLElement>(".agent-identity-specimen");
    const next = box.nextElementSibling?.getBoundingClientRect();
    return {
      column: [Math.round(outer.width), Math.round(outer.height)],
      specimen: specimen
        ? [
            Math.round(specimen.getBoundingClientRect().width),
            Math.round(specimen.getBoundingClientRect().height),
          ]
        : null,
      nameX: next ? Math.round(next.x - outer.x) : null,
      box: [Math.round(outer.x), Math.round(outer.y)],
    };
  });
  await page.mouse.move(0, 0);
  await page.screenshot({
    clip: {
      x: column.box[0] - 12,
      y: column.box[1] - 12,
      width: 64,
      height: 64,
    },
    path: `${SHOTS}/mark.png`,
  });
  measure("mark", column);
});

test("the keyboard through the tabs and the filters", async ({ page }) => {
  await boot(page);
  await openLuca(page);
  await page.getByTestId("mind-tab-notebook").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mind-tab-self")).toBeFocused();
  await expect.poll(() => hashOf(page)).toContain("section=self");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mind-tab-settings")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("mind-tab-notebook")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("mind-tab-settings")).toBeFocused();
  await expect.poll(() => hashOf(page)).toContain("section=settings");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("mind-tab-notebook")).toBeFocused();
  await expect(page.getByTestId("mind-filter-all")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("mind-filter-all").focus();
  await page.keyboard.press("Tab");
  const next = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null,
  );
  await page.keyboard.press("Enter");
  const pressed = await page
    .locator(".luca-mind-filter[aria-pressed='true']")
    .getAttribute("data-testid");
  const focusRing = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element ? getComputedStyle(element).outlineStyle : null;
  });
  measure("keyboard", { focusRing, next, pressed });
});

test("at 800 × 500 the space still reads", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await boot(page);
  await seedRecords(page);
  await openLuca(page);
  await expect(page.getByTestId("mind-entry").first()).toBeVisible({
    timeout: 20_000,
  });
  const small = await shot(page, "space-luca-800");
  const overflow = await page.evaluate(() => {
    const page = document.querySelector(".luca-mind") as HTMLElement | null;
    return page ? page.scrollWidth - page.clientWidth : null;
  });
  await page.getByTestId("mind-tab-settings").click();
  const settingsSmall = await shot(page, "settings-800");
  measure("small", { overflow, settingsSmall, small });
});

test("flag off: today's agent page and Brain match the base", async ({
  browser,
}) => {
  const views: [string, string][] = [
    ["agents-place", `/agents?profile=${LUCA}`],
    ["agents-notebook", `/agents?profile=${LUCA}&section=notebook`],
    ["agents-documents", `/agents?profile=${LUCA}&section=documents`],
    ["agents-settings", `/agents?profile=${LUCA}&section=settings`],
    ["brain", "/brain"],
    ["profile", `/channels/${GENERAL}?profile=${LUCA}`],
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
      // Both builds' clocks start at the same instant (WP-21, 3), so a time
      // printed on the page can't differ by a minute between the two shots.
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false });
      await page.waitForTimeout(2500);
      const shotName = `flag-off-${name}-${origin ? "base" : "ours"}`;
      hashes.push(await shot(page, shotName, true));
      colors.push(await colorsOf(page, shotName));
      await context.close();
    }
    result[name] = {
      base: hashes[0] ?? "",
      colors: Math.min(colors[0] ?? 0, colors[1] ?? 0),
      ours: hashes[1] ?? "",
    };
  }
  measure("flag-off", result);
  for (const [name, pair] of Object.entries(result)) {
    expect(pair.ours, name).toBe(pair.base);
    expect(pair.colors, `${name} is not one colour`).toBeGreaterThan(24);
  }
  // Six views, six pictures.
  expect(new Set(Object.values(result).map((pair) => pair.ours)).size).toBe(
    views.length,
  );
});
