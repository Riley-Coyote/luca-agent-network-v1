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

async function shot(page: Page, name: string, maskCanvas = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  // A living dot field (the notebook's growth sigil) never holds one frame:
  // the flag-off comparison masks it in both builds alike.
  await page.screenshot({
    mask: maskCanvas ? [page.locator("canvas")] : [],
    path,
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
      ".luca-mind-ask",
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

test("asks are answered in place; notebook actions stay reachable", async ({
  page,
}) => {
  await boot(page);
  await openLuca(page);
  const asks = page.getByTestId("mind-asks");
  await expect(asks.locator(".luca-mind-ask")).toHaveCount(2, {
    timeout: 20_000,
  });
  await asks.getByText("Beta", { exact: true }).click();
  const send = asks.getByRole("button", { name: /send|answer|submit/i });
  await send.first().click();
  await expect(asks.locator(".luca-mind-ask")).toHaveCount(1, {
    timeout: 10_000,
  });
  const answered = await shot(page, "asks-answered");

  // A journal page opens in place, where today's annotate lives.
  await page
    .getByTestId("mind-entry")
    .filter({ hasText: "A quiet night" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Annotate" })).toBeVisible();
  await page.getByRole("button", { name: "Back to notebook" }).click();
  await expect(page.getByTestId("mind-notebook")).toBeVisible();
  // A new journal page and the saved handoff.
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.getByText("New journal page")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator(".luca-mind-handoff > summary").click();
  measure("notebook-actions", {
    annotate: true,
    answered,
    handoffOpen: await page
      .locator(".luca-mind-handoff")
      .evaluate((each) => (each as HTMLDetailsElement).open),
    newPage: true,
  });
});

test("Self and Settings: who writes each part; What they can read", async ({
  page,
}) => {
  await boot(page);
  await openLuca(page, "self");
  await expect.poll(() => hashOf(page)).toContain("section=self");
  await expect(page.getByTestId("mind-self")).toBeVisible();
  const rows = await page
    .getByTestId("mind-self")
    .locator("li")
    .evaluateAll((items) =>
      items.map((item) => ({
        title: item.querySelector(".luca-mind-title")?.textContent,
        who: item.querySelector(".luca-mind-writer")?.textContent,
        status: item.querySelector("time")?.textContent ?? null,
      })),
    );
  const self = await shot(page, "self");
  await page.getByTestId("resident-document-soul").click();
  const back = page.getByRole("button", { name: "Documents" });
  await expect(back).toBeVisible();
  const editorOpens = await back.isVisible();
  await back.click();
  await expect(page.getByTestId("mind-self")).toBeVisible();
  const moreFiles = await page.getByTestId("resident-extra-files").isVisible();
  const newFile = await page.getByTestId("resident-new-file").isVisible();
  measure("self", { editorOpens, moreFiles, newFile, rows });

  await page.getByTestId("mind-tab-settings").click();
  await expect.poll(() => hashOf(page)).toContain("section=settings");
  const sections = await page
    .getByTestId("agent-settings")
    .locator(":scope > section, :scope > div > section")
    .evaluateAll((items) =>
      items.map((item) => item.querySelector("h3")?.textContent),
    );
  const settings = await shot(page, "settings");
  await page.getByTestId("mind-what-they-can-read").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("brain-body")).toBeVisible();
  await expect(page.getByTestId("brain-card-repository")).toBeVisible({
    timeout: 20_000,
  });
  const read = await shot(page, "what-they-can-read");
  const brainHeader = await page
    .getByTestId("brain-body")
    .getByRole("heading", { name: "Brain" })
    .count();
  const cards = await page.locator("[data-testid^='brain-card-']").count();
  measure("settings", {
    brainCards: cards,
    brainPageHeader: brainHeader,
    hashes: { read, self, settings },
    scan: await page
      .getByRole("button", { name: "Scan for Brain sources" })
      .isVisible(),
    sections,
  });
});

test("/brain opens Luca's space on Settings, at What they can read", async ({
  page,
}) => {
  await boot(page, { hash: "/brain" });
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("mind-what-they-can-read")).toBeInViewport({
    timeout: 10_000,
  });
  const landing = await hashOf(page);
  const redirect = await shot(page, "brain-redirect");
  // Every way in calls the same route: the rail's project menu says Sources.
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
  const tabs = await panel
    .getByRole("tab")
    .evaluateAll((items) => items.map((each) => each.textContent?.trim()));
  const message = await panel.getByTestId("user-profile-message").count();
  const summaryShot = await shot(page, "profile-summary");
  await page.getByTestId("profile-open-their-space").click();
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  const landing = await hashOf(page);
  const opened = await shot(page, "open-their-space");
  measure("profile", { landing, message, opened, summaryShot, tabs });
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

test("the keyboard through the tabs and the filters", async ({ page }) => {
  await boot(page);
  await openLuca(page);
  await page.getByTestId("mind-tab-notebook").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mind-tab-self")).toBeFocused();
  await expect.poll(() => hashOf(page)).toContain("section=self");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mind-tab-settings")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
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
  const result: Record<string, { base: string; ours: string }> = {};
  for (const [name, hash] of views) {
    const hashes: string[] = [];
    for (const origin of [BASE_URL, ""]) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        deviceScaleFactor: 2,
        // Still marks, so two builds' frames can match by hash.
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false });
      await page.waitForTimeout(2500);
      hashes.push(
        await shot(page, `flag-off-${name}-${origin ? "base" : "ours"}`, true),
      );
      await context.close();
    }
    result[name] = { base: hashes[0] ?? "", ours: hashes[1] ?? "" };
  }
  measure("flag-off", result);
  for (const [name, pair] of Object.entries(result))
    expect(pair.ours, name).toBe(pair.base);
});
