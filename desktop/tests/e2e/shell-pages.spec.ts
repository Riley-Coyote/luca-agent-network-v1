import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-33, the page system (docs/luca/BETA14_RELEASE.md): faces lead, plates
 * hold, threads join. A page's head is its face on a tile, its name and one
 * line of how it is now; a section is its sentence-case label and count over
 * one plate; a row leads with its face, its hairline starts at its words;
 * what happened in order hangs from a thread under the faces. A mind's space
 * gains At a glance beside its tabs at 940 and wider. Classic layout (the
 * flag off) is compared by hash with the base build at WP33_BASE_URL.
 * Screenshots land in WP33_SHOTS; measurements in WP33_SHOTS/measures.
 */

const SHOTS = process.env.WP33_SHOTS ?? "test-results/shell-pages";
const BASE_URL = process.env.WP33_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const KESTREL = "d".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DM = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";

type Mode = "dark" | "light";

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
        resident_pubkey: ATLAS,
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
test.describe.configure({ timeout: 180_000 });

async function boot(
  page: Page,
  {
    hash = "/agents",
    mode = "dark",
    origin,
    shell = true,
  }: { hash?: string; mode?: Mode; origin?: string; shell?: boolean } = {},
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await seedInvoke(page, seedData());
  await installMockBridge(page, {
    exchanges: [
      {
        bucket: 3,
        channelName: "general",
        deadline: Math.floor(Date.now() / 1000) + 600,
        exchangeId: "c".repeat(64),
        members: [LUCA, ATLAS],
        openedBy: LUCA,
        spent: 1,
        state: "closed",
      },
    ],
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
  // After the bridge's own seed, so this one decides the frame and palette.
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
  // A first load under a busy Mac can land blank: load again until the
  // app draws (as shell-settings-agents.spec.ts boots). Settings draws its
  // own section list in the rail's place.
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

/** Signed records through the mock relay, so Luca's days hold For you. */
async function seedRecords(page: Page) {
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
      times: { general: [at(9, 1), at(9, 12)], job: at(8, 19) },
    },
  );
}

async function shot(page: Page, name: string, maskMoving = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  // Only small moving marks are masked (a resident's specimen, the
  // notebook's growth field, a clock), in both builds alike.
  await page.screenshot({
    mask: maskMoving
      ? [
          page.getByTestId("resident-notebook-growth-field"),
          page.locator(".agent-identity-specimen"),
          page.locator("time"),
        ]
      : [],
    path,
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A shot's pixels, decoded in the page: how many colours it holds, and
 *  the perceived lightness (CIE L*) at the points asked, each the mean of a
 *  3 x 3 block in device pixels. */
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
      if (!context) return { colors: 0, lightness: [] as number[] };
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
      const lightness = points.map(({ x, y }) => {
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
        return Math.round((116 * f - 16) * 100) / 100;
      });
      return { colors: seen.size, lightness };
    },
    { data, points },
  );
}

/** The plate's step: L* just inside a plate's left padding and just
 *  outside it on the card, at its vertical middle. */
async function plateStep(page: Page, name: string, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return null;
  const y = box.y + Math.min(box.height / 2, 40);
  const { lightness } = await pixelsOf(page, name, [
    { x: box.x + 2, y },
    { x: box.x - 10, y },
  ]);
  return {
    card: lightness[1],
    plate: lightness[0],
    step: Math.round((lightness[0] - lightness[1]) * 100) / 100,
  };
}

/** The head: its face tile, name, state, and their type. */
function readHead(page: Page) {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>(
      "[data-testid='place-page-head']",
    );
    if (!head) return null;
    const read = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        font: `${style.fontSize} ${style.fontWeight}`,
        h: Math.round(box.height * 10) / 10,
        letterSpacing: style.letterSpacing,
        radius: style.borderRadius,
        shadow: style.boxShadow,
        text: element.textContent?.trim().slice(0, 80) ?? "",
        w: Math.round(box.width * 10) / 10,
        x: Math.round(box.x * 10) / 10,
        y: Math.round(box.y * 10) / 10,
      };
    };
    const face = head.querySelector(".luca-place-page-face");
    const drawn = face?.querySelector(".luca-place-face > *");
    return {
      drawn: read(drawn ?? null),
      eyebrow: read(head.querySelector(".luca-place-page-eyebrow")),
      face: read(face),
      name: read(head.querySelector(".luca-place-page-name")),
      state: read(head.querySelector(".luca-place-page-state")),
    };
  });
}

/** Every section label on the page: its words and type. */
function readLabels(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".luca-place-section-label")]
      .slice(0, 6)
      .map((label) => {
        const style = getComputedStyle(label);
        const count = label.querySelector(".luca-place-section-count");
        const countStyle = count ? getComputedStyle(count) : null;
        const plate = label.nextElementSibling;
        const gap = plate
          ? Math.round(
              (plate.getBoundingClientRect().top -
                label.getBoundingClientRect().bottom) *
                10,
            ) / 10
          : null;
        return {
          color: style.color,
          count: count
            ? {
                color: countStyle?.color,
                font: `${countStyle?.fontSize} ${countStyle?.fontWeight}`,
                numeric: countStyle?.fontVariantNumeric,
                text: count.textContent,
              }
            : null,
          family: style.fontFamily.split(",")[0],
          font: `${style.fontSize} ${style.fontWeight}`,
          gapToPlate: gap,
          text: label.querySelector("span")?.textContent,
          transform: style.textTransform,
        };
      }),
  );
}

/** Plates: fill, edge, radius, padding; and every hairline's start against
 *  its row's words, and its end against the plate's. */
function readPlates(page: Page) {
  return page.evaluate(() => {
    const plates = [
      ...document.querySelectorAll<HTMLElement>(
        ".luca-place-plate, .luca-mind-list",
      ),
    ];
    const hairlines: Array<Record<string, number | string>> = [];
    for (const plate of plates) {
      if (plate.hasAttribute("data-thread")) continue;
      const rows = [
        ...plate.querySelectorAll<HTMLElement>(
          ":scope > .luca-place-row, :scope > .luca-ask > .luca-place-row, :scope > li",
        ),
      ];
      for (const row of rows) {
        const before = getComputedStyle(row, "::before");
        if (before.content === "none" || before.height === "auto") continue;
        const rowBox = row.getBoundingClientRect();
        const words =
          row.querySelector(
            ":scope > .luca-place-row-what, :scope > .luca-mind-row-open > span:first-child, :scope > div",
          ) ?? row;
        const wordsBox = words.getBoundingClientRect();
        const left = rowBox.left + Number.parseFloat(before.left);
        const right = rowBox.right - Number.parseFloat(before.right);
        const plateBox = plate.getBoundingClientRect();
        hairlines.push({
          color: before.backgroundColor,
          endShortOfPlate: Math.round((plateBox.right - right) * 100) / 100,
          endShortOfRow: Math.round((rowBox.right - right) * 100) / 100,
          height: before.height,
          startMinusWords: Math.round((left - wordsBox.left) * 100) / 100,
          testid: row.getAttribute("data-testid") ?? row.className,
        });
      }
    }
    return {
      hairlines,
      plates: plates.slice(0, 6).map((plate) => {
        const style = getComputedStyle(plate);
        return {
          background: style.backgroundColor,
          padding: style.padding,
          radius: style.borderRadius,
          shadow: style.boxShadow,
          testid: plate.getAttribute("data-testid") ?? plate.className,
          thread: plate.hasAttribute("data-thread"),
        };
      }),
    };
  });
}

function hashOf(page: Page) {
  return page.evaluate(() => decodeURIComponent(window.location.hash));
}

async function openLuca(page: Page) {
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  if (!(await hashOf(page)).includes(`profile=${LUCA}`))
    await page
      .getByTestId(`place-row-mind:${LUCA}`)
      .locator(".luca-rail-row-hit")
      .click();
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain(`profile=${LUCA}`);
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  // Their days are their page's Days section (BETA14_RELEASE.md WP-43,
  // Decided 7): always there, no tab to open.
  await expect(page.getByTestId("mind-days")).toBeVisible({ timeout: 20_000 });
}

const hashes: Record<string, string> = {};

for (const mode of ["dark", "light"] as const) {
  test(`Needs you (${mode}): the head, the plate, faces on the asks`, async ({
    page,
  }) => {
    await boot(page, { hash: "/needs-you", mode });
    await expect(page.getByTestId("needs-you-card")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator("[data-testid='needs-you-card'] .luca-ask"),
    ).toHaveCount(2, { timeout: 20_000 });
    const head = await readHead(page);
    expect(head?.face?.w).toBe(40);
    expect(head?.face?.h).toBe(40);
    expect(head?.face?.radius).toBe("11px");
    expect(head?.name?.font).toBe("22px 600");
    expect(head?.state?.font).toBe("13px 400");
    // Permissions first, then questions (orderNeedsYou): Atlas asks to
    // run a command, Luca asks a question.
    expect(head?.state?.text).toBe("2 waiting, from Atlas and Luca");
    const labels = await readLabels(page);
    expect(labels[0]?.text).toBe("Waiting on you");
    expect(labels[0]?.font).toBe("12.5px 600");
    expect(labels[0]?.transform).toBe("none");
    expect(labels[0]?.count?.text).toBe("2");
    expect(labels[0]?.count?.font).toBe("12px 400");
    expect(labels[0]?.gapToPlate).toBe(8);
    const asks = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='needs-you-card'] .luca-ask",
        ),
      ].map((ask) => {
        const title = ask.querySelector(".luca-place-row-title");
        const style = title ? getComputedStyle(title) : null;
        const face = ask.querySelector(".luca-place-row-face");
        return {
          agentMark: Boolean(face?.querySelector("[data-agent-mark]")),
          answers: ask.querySelectorAll(".luca-quiet-button").length,
          face: face ? Math.round(face.getBoundingClientRect().width) : null,
          words: style ? `${style.fontSize}/${style.lineHeight}` : null,
        };
      }),
    );
    for (const ask of asks) {
      expect(ask.agentMark).toBe(true);
      expect(ask.face).toBe(20);
      expect(ask.words).toBe("15px/21px");
      expect(ask.answers).toBeGreaterThan(0);
    }
    const plates = await readPlates(page);
    expect(plates.hairlines.length).toBeGreaterThan(0);
    for (const line of plates.hairlines) expect(line.startMinusWords).toBe(0);
    const name = `needs-you-${mode}`;
    hashes[name] = await shot(page, name);
    const step = await plateStep(
      page,
      name,
      "[data-testid='needs-you-card'] .luca-place-plate",
    );
    const pixels = await pixelsOf(page, name);
    expect(pixels.colors).toBeGreaterThan(20);
    // The hairline goes while either row is under the pointer.
    const second = page
      .locator("[data-testid='needs-you-card'] .luca-ask")
      .nth(1);
    await second.locator(".luca-place-row-title").hover();
    const hovered = await second.evaluate((ask) => {
      const row = ask.querySelector(".luca-place-row");
      return row ? getComputedStyle(row, "::before").opacity : null;
    });
    expect(hovered).toBe("0");
    measure(`needs-you-${mode}`, {
      asks,
      colors: pixels.colors,
      head,
      hoveredHairlineOpacity: hovered,
      labels,
      plates,
      step,
    });
  });

  // WP-43 retired At a glance and its Works with list (Riley's call: a Days
  // talk entry names the other minds in its room, shell-agent-place.spec.ts
  // "a Days talk entry names the other minds in its room"); the page is one
  // axis, its sections built alike ("their page: one header, one status,
  // three sections built alike"). The glyphs keep their names here.
  test(`Luca's page (${mode}, 1440 x 900): glyphs and sections`, async ({
    page,
  }) => {
    await boot(page, { mode });
    await seedRecords(page);
    await openLuca(page);
    await expect(page.getByTestId("mind-entry").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(800);
    const name = `notebook-${mode}-1440`;
    hashes[name] = await shot(page, name);
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          h: Math.round(rect.height),
          w: Math.round(rect.width * 10) / 10,
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
        };
      };
      const glyphs = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='mind-entry'] .luca-mind-glyph",
        ),
      ].map((face) => ({
        kind: face.closest("[data-kind]")?.getAttribute("data-kind"),
        label: face.getAttribute("aria-label"),
        lucide: face.querySelector("svg")?.getAttribute("class"),
      }));
      const filters = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='mind-days'] .luca-mind-filter",
        ),
      ].map((filter) => filter.textContent);
      const asksMark = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='mind-asks'] .luca-ask",
        ),
      ].map((ask) => Boolean(ask.querySelector("[data-agent-mark]")));
      const sections = [
        ...document.querySelectorAll<HTMLElement>(".luca-mind-part"),
      ].map((part) => part.getAttribute("data-testid"));
      return {
        aside: box("[data-testid='mind-aside']"),
        asksMark,
        axis: box(".luca-mind > .luca-place-page-axis"),
        filters,
        glyphs,
        sections,
      };
    });
    expect(layout.aside).toBeNull();
    expect(layout.sections).toEqual([
      "mind-made",
      "mind-notebook",
      "mind-days",
    ]);
    expect(layout.filters).toEqual(["All", "On their own", "With you"]);
    expect(layout.glyphs.length).toBeGreaterThan(0);
    for (const glyph of layout.glyphs) expect(glyph.label).toBeTruthy();
    for (const mark of layout.asksMark) expect(mark).toBe(true);
    const step = await plateStep(page, name, ".luca-mind-day .luca-mind-rows");
    measure(`notebook-${mode}-1440`, {
      labels: await readLabels(page),
      layout,
      plates: await readPlates(page),
      step,
    });
  });
}

// WP-43 retired At a glance, so nothing stacks under the body at 1100: the
// narrow page is shell-agent-place.spec.ts "their page for Luca, 800×500".

for (const mode of ["dark", "light"] as const) {
  // WP-43: Self's documents are Notebook › Pages (the ones they write) and
  // Settings › Who {name} is (the ones you write).
  test(`Luca's Pages and Settings (${mode}): rows, then panels`, async ({
    page,
  }) => {
    await boot(page, { mode });
    await openLuca(page);
    await page.getByTestId("mind-view-pages").click();
    await expect(page.getByTestId("mind-pages")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    const self = await readPlates(page);
    hashes[`self-${mode}`] = await shot(page, `self-${mode}`);
    const selfStep = await plateStep(
      page,
      `self-${mode}`,
      "[data-testid='mind-pages']",
    );
    await page.getByTestId("mind-open-settings").click();
    await expect(page.getByTestId("agent-settings")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    const settings = await readPlates(page);
    hashes[`mind-settings-${mode}`] = await shot(page, `mind-settings-${mode}`);
    const settingsStep = await plateStep(
      page,
      `mind-settings-${mode}`,
      "[data-testid='agent-settings']",
    );
    // The pages they write are rows between hairlines, not a plate.
    expect(self.plates.some((each) => each.testid === "mind-pages")).toBe(
      false,
    );
    measure(`self-settings-${mode}`, {
      self,
      selfStep,
      settings,
      settingsStep,
    });
  });

  test(`Settings > Appearance (${mode}): the head's face, sentence-case labels`, async ({
    page,
  }) => {
    await boot(page, { hash: "/settings?section=appearance", mode });
    await expect(page.getByTestId("settings-panel-appearance")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    const head = await readHead(page);
    expect(head?.face?.w).toBe(40);
    const labels = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid='settings-panel-appearance'] :is(h2, h3)",
        ),
      ].map((each) => {
        const style = getComputedStyle(each);
        return {
          family: style.fontFamily.split(",")[0],
          font: `${style.fontSize} ${style.fontWeight}`,
          text: each.textContent?.trim(),
          transform: style.textTransform,
        };
      }),
    );
    for (const label of labels) expect(label.transform).toBe("none");
    hashes[`appearance-${mode}`] = await shot(page, `appearance-${mode}`);
    measure(`appearance-${mode}`, { head, labels });
  });

  test(`a Library page (${mode}): rows on a plate, the hairline at the words`, async ({
    page,
  }) => {
    await boot(page, { hash: "/artifacts?made=all", mode });
    await expect(page.getByTestId("artifact-library-list")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    const head = await readHead(page);
    expect(head?.face?.w).toBe(40);
    const plates = await readPlates(page);
    for (const line of plates.hairlines) expect(line.startMinusWords).toBe(0);
    const name = `library-${mode}`;
    hashes[name] = await shot(page, name);
    const step = await plateStep(
      page,
      name,
      "[data-testid='artifact-library-list'] .luca-place-plate",
    );
    measure(name, { head, plates, step });
  });

  // WP-38 (BETA14_RELEASE.md, Decided 1 and 2): /brain is Brain's own page.
  test(`a Brain page (${mode}): /brain opens Brain's own place`, async ({
    page,
  }) => {
    await boot(page, { hash: "/brain", mode });
    await expect(page.getByTestId("brain-place")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("brain-body")).toBeVisible();
    await page.waitForTimeout(800);
    const name = `brain-${mode}`;
    hashes[name] = await shot(page, name);
    measure(name, { plates: await readPlates(page) });
  });
}

test("Settings > Agents: every mind wears the agent mark, on a plate", async ({
  page,
}) => {
  await boot(page, { hash: "/settings?section=agents" });
  await expect(page.getByTestId("settings-agents-minds")).toBeVisible({
    timeout: 20_000,
  });
  const rows = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-testid='settings-agents-minds'] > li",
      ),
    ].map((row) => ({
      agentMark: Boolean(row.querySelector("[data-agent-mark]")),
      face: Math.round(
        row.querySelector(".luca-place-row-face")?.getBoundingClientRect()
          .width ?? 0,
      ),
      title: row.querySelector(".luca-place-row-title")?.textContent,
    })),
  );
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.agentMark).toBe(true);
    expect(row.face).toBe(20);
  }
  const plates = await readPlates(page);
  for (const line of plates.hairlines) expect(line.startMinusWords).toBe(0);
  hashes["settings-agents-dark"] = await shot(page, "settings-agents-dark");
  measure("settings-agents", { plates, rows });
});

test("flag off: Classic layout matches the base build", async ({ browser }) => {
  const routes = [
    ["agents", "/agents"],
    ["activity", "/pulse"],
    ["library", "/artifacts"],
    ["appearance", "/settings?section=appearance"],
    ["agents-settings", "/settings?section=agents"],
  ] as const;
  const out: Record<string, Record<string, string | number | boolean>> = {};
  for (const [name, route] of routes) {
    const pair: Record<string, string | number | boolean> = {};
    for (const [build, origin] of [
      ["base", BASE_URL],
      ["mine", ""],
    ] as const) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      // Both builds start their clocks at the same minute.
      await context.clock.install({ time: new Date("2026-10-27T10:30:00") });
      const page = await context.newPage();
      await boot(page, { hash: route, origin, shell: false });
      await page.waitForTimeout(1500);
      const shotName = `classic-${name}-${build}`;
      pair[build] = await shot(page, shotName, true);
      pair[`${build}Colors`] = (await pixelsOf(page, shotName)).colors;
      await context.close();
    }
    pair.same = pair.base === pair.mine;
    out[name] = pair;
  }
  measure("classic", out);
  for (const [name, pair] of Object.entries(out)) {
    expect(Number(pair.mineColors), name).toBeGreaterThan(20);
    expect(pair.same, name).toBe(true);
  }
});

test.afterAll(() => {
  if (Object.keys(hashes).length === 0) return;
  measure(`hashes-${process.pid}`, hashes);
});
