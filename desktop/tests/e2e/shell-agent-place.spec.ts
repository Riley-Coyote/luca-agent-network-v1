import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-43 (docs/luca/BETA14_RELEASE.md, "Each agent's page is their place;
 * Settings is yours"): two places per agent, the pages that slide in over
 * their page, the address that keeps where you are, and the dot that says
 * new. The real component tree with the mock bridge; every word on the
 * pages comes from the seeded backend below, the same data `MindSpace`
 * reads. Screenshots and measures land in WP43_SHOTS.
 */

const SHOTS = process.env.WP43_SHOTS ?? "test-results/shell-agent-place";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const TRINITY = "c".repeat(64);
/** A member of the mock's #general (its PROFILE_ONLY_AGENT_PUBKEY). */
const FIFTY =
  "8f83d6b7f3d74f7d933ae3a54dd8c6cc85c7f98e531c16e5a827b953441a8d67";
const DM = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
/** A conversation the owner isn't in: work there is their own. */
const ELSEWHERE = "0f0f0f0f-0000-4000-8000-00000000e15e";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A small greyscale picture: rings of light, for a piece's preview. */
function ringsPng(seed: number): string {
  const w = 80;
  const h = 50;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w * (0.3 + seed * 0.12), y - h / 2);
      const v = Math.round(18 + 90 * (0.5 + 0.5 * Math.cos(d / (2 + seed))));
      rows.push(v, v, v);
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

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

type Seed = ReturnType<typeof seedData>;

function seedData(options: { asking: boolean; companion: boolean }) {
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
  const artifact = (
    id: string,
    title: string,
    kind: string,
    hours: number,
    conversation: string,
    summary: string | null,
  ) => ({
    id,
    title,
    kind,
    media_type: kind === "image" ? "image/png" : "text/markdown",
    current_version: 1,
    created_at: hoursAgo(hours),
    updated_at: hoursAgo(hours),
    pinned: false,
    availability: "ready",
    summary,
    provenance: { conversation_id: conversation, resident_pubkey: LUCA },
  });
  return {
    luca: LUCA,
    atlas: ATLAS,
    asking: options.asking,
    companion: options.companion,
    pngs: [0, 1, 2, 3].map(ringsPng),
    artifacts: [
      artifact(
        "luca-tide",
        "Tide pools at night",
        "image",
        20,
        ELSEWHERE,
        "I drew the coast from last week's notes while you were away.",
      ),
      artifact(
        "luca-release",
        "Release notes, one page",
        "markdown",
        30,
        DM,
        "The page you asked for, in plain words.",
      ),
      artifact("luca-rings", "Rings of the week", "image", 50, ELSEWHERE, null),
      artifact("luca-map", "Where the week went", "image", 75, ELSEWHERE, null),
      artifact("luca-timer", "A timer for long builds", "image", 98, DM, null),
    ],
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
        conversationId: ELSEWHERE,
        availability: "available",
      },
    },
    emptyPlace: {
      residentPubkey: ATLAS,
      revision: 0,
      residentEditingEnabled: false,
      visibility: "private",
      content: { introduction: "", exploration: "", selectedWork: null },
      author: null,
      updatedAt: null,
      selectedWork: null,
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
        body: "The release notes go out as one page, in plain words.",
        category: "decision",
        sourceEventIds: ["f".repeat(64)],
        updatedAt: hoursAgo(26),
      }),
      item({
        itemId: "page-quiet-night",
        kind: "journal_page",
        title: "A quiet night",
        body: "I like the hour before you wake, when the inbox is still and I can finish a thought. Tonight I finished two.",
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
          "Working through the Tidepool launch: the landing copy is drafted.",
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
    surface: {
      runtimeId: "claude",
      runtimeLabel: "Claude Code",
      isPreSpawn: false,
      normalized: {
        model: {
          value: "opus",
          origin: "configFile",
          overriddenValue: null,
          overriddenOrigin: null,
          isRequired: false,
          writeVia: { type: "readOnly" },
        },
        provider: null,
        mode: null,
        thinkingEffort: {
          value: "high",
          origin: "configFile",
          overriddenValue: null,
          overriddenOrigin: null,
          isRequired: false,
          writeVia: { type: "readOnly" },
        },
        maxOutputTokens: null,
        contextLimit: null,
        systemPrompt: null,
      },
      advanced: [
        ["alwaysThinkingEnabled", "true"],
        ["enabledPlugins.playwright@claude-plugins-official", "true"],
        ["enabledPlugins.plugin-dev@claude-plugins-official", "true"],
        ["enabledPlugins.ralph-loop@claude-plugins-official", "false"],
        [
          "extraKnownMarketplaces.claude-plugins-official.source.repo",
          "anthropics/claude-plugins-official",
        ],
        ["theme", "dark"],
        ["statusLine.command", "~/.claude/statusline.sh"],
        ["cleanupPeriodDays", "36500"],
        ["permissions.defaultMode", "default"],
      ].map(([key, value]) => ({
        key,
        label: key,
        value,
        origin: "configFile",
        schemaType: { type: "string" },
        writeVia: { type: "readOnly" },
      })),
      extensions: [],
      sources: {
        acpNative: "available",
        acpConfigOptions: "notApplicable",
        envVars: "available",
        configFile: "available",
        configFilePath: "~/.claude/settings.json",
        mcpConfigFilePath: null,
      },
    },
  };
}

/** The mock's invoke, with Luca's place, notebook, handoff, pieces, ask
 *  and companion layered over it; Atlas has an empty place and nothing
 *  else. */
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
    const who = (payload: unknown) =>
      String(
        (payload as { residentPubkey?: string; pubkey?: string } | null)
          ?.residentPubkey ??
          (payload as { pubkey?: string } | null)?.pubkey ??
          "",
      ).toLowerCase();
    const isLuca = (payload: unknown) => who(payload) === seed.luca;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        real = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          if (command === "get_resident_place") {
            if (isLuca(payload)) return structuredClone(seed.place);
            if (who(payload) === seed.atlas)
              return structuredClone(seed.emptyPlace);
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
          const flags = window as unknown as {
            __WP43_FAIL_WRITE__?: boolean;
            __WP43_SLOW_START__?: boolean;
            __WP43_CHANNEL__?: string;
          };
          if (
            command === "write_resident_document" &&
            flags.__WP43_FAIL_WRITE__
          )
            throw new Error("The disk is full.");
          if (command === "start_managed_agent" && flags.__WP43_SLOW_START__)
            await new Promise((resolve) => setTimeout(resolve, 1800));
          if (
            command === "get_companion_initiative" &&
            flags.__WP43_CHANNEL__ &&
            who(payload) === flags.__WP43_CHANNEL__
          )
            return {
              availability: "ready",
              executionPaused: false,
              nativeChannelAvailable: true,
              actualModelExecutionVerified: false,
              policy: {
                revision: 0,
                enabled: false,
                paused: true,
                allow_local_creations: false,
                allow_outreach: false,
              },
            };
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
            return seed.asking ? [structuredClone(seed.question)] : [];
          if (command === "list_pending_managed_permissions") return [];
          if (command === "list_artifacts") {
            const input =
              (payload as { input?: { deleted?: string } } | null)?.input ?? {};
            const list = input.deleted === "deleted" ? [] : seed.artifacts;
            return {
              artifacts: structuredClone(list),
              nextCursor: null,
              total: list.length,
            };
          }
          if (command === "read_artifact_preview") {
            const id = (payload as { input?: { artifactId?: string } })?.input
              ?.artifactId;
            const index = seed.artifacts.findIndex((each) => each.id === id);
            if (index >= 0 && seed.artifacts[index].kind === "image")
              return {
                previewType: "binary",
                mediaType: "image/png",
                contentBase64: seed.pngs[index % seed.pngs.length],
                truncated: false,
                version: { number: 1, id: `${id}:v1` },
                artifact: { id },
              };
          }
          if (command === "get_agent_config_surface" && isLuca(payload))
            return structuredClone(seed.surface);
          if (seed.companion && isLuca(payload)) {
            if (command === "get_companion_awareness")
              return {
                availability: "ready",
                paused: false,
                collectionRunning: true,
                revision: 3,
                truncated: false,
                grants: ["src-codex", "src-claude"].map((id) => ({
                  source: { source_id: id, state: "active" },
                  grant: {
                    grant_revision: 1,
                    state: "active",
                    choices: {
                      observe: true,
                      promote: true,
                      retain: false,
                      provider_egress_binding: null,
                    },
                  },
                })),
              };
            if (command === "list_companion_native_profiles")
              return [
                {
                  sourceId: "src-codex",
                  kind: "codex_sessions",
                  class: "native",
                },
                {
                  sourceId: "src-claude",
                  kind: "claude_projects",
                  class: "native",
                },
              ];
            if (command === "get_companion_initiative")
              return {
                availability: "ready",
                executionPaused: false,
                nativeChannelAvailable: true,
                actualModelExecutionVerified: true,
                policy: {
                  revision: 1,
                  enabled: true,
                  paused: false,
                  allow_local_creations: true,
                  allow_outreach: false,
                },
              };
            if (command === "get_companion_native_history_choice")
              return {
                choice: { revision: 1, allowed: false },
                currentBindingConfirmed: true,
                consumersReady: false,
                disclosureRevision: 1,
                disclosure:
                  "Selected activity may be summarised into a conversation.",
              };
          }
          if (!real) throw new Error(`mock invoke not ready: ${command}`);
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
    asking = false,
    companion = true,
    hash = "/agents",
    light = false,
    runtimeTask = false,
    alsoAgents = [],
  }: {
    /** More minds on this Mac, by name and key. */
    alsoAgents?: Array<{ name: string; pubkey: string }>;
    asking?: boolean;
    companion?: boolean;
    hash?: string;
    light?: boolean;
    runtimeTask?: boolean;
  } = {},
) {
  page.on("pageerror", (error) => errors.push(`pageerror ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({
    colorScheme: light ? "light" : "dark",
    reducedMotion: "no-preference",
  });
  await page.addInitScript(
    ({ key, light }) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        window.localStorage.setItem("buzz-theme", "paper");
        window.localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light },
  );
  await seedInvoke(page, seedData({ asking, companion }));
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
        agentCommand: "claude-agent-acp",
      },
      {
        name: "Trinity",
        pubkey: TRINITY,
        personaId: "persona-trinity",
        status: "stopped",
      },
      {
        name: "Atlas",
        pubkey: ATLAS,
        personaId: "persona-atlas",
        status: "running",
      },
      ...alsoAgents.map((agent) => ({ ...agent, status: "running" as const })),
    ],
    personas: [
      {
        id: "persona-atlas",
        displayName: "Atlas",
        systemPrompt: "Keeps the release honest.",
        runtime: "claude",
      },
      {
        id: "persona-trinity",
        displayName: "Trinity",
        systemPrompt: "",
        runtime: "codex",
      },
      // Not set up on this Mac: a definition with no resident yet.
      {
        id: "persona-kestrel",
        displayName: "Kestrel",
        systemPrompt: "",
        runtime: "codex",
      },
    ],
    activePersonaIds: ["persona-kestrel"],
    residentDocuments: {
      [LUCA]: {
        "soul.md":
          "# Luca\n\nWarm, exact, and unhurried. Says what's true, kindly.",
        "convictions.md": "Finish the small thing before starting the big one.",
        "instructions.md": "Work in the open. Say what you changed.",
        "self-model.md": "I'm learning that I rush the last step.",
        "user-model.md": "You read long drafts after lunch.",
        "lessons.md": "When a build fails, read the last change first.",
        "notes/coast.md": "Low tide on Thursday.",
      },
    },
    runtimeTasks: runtimeTask
      ? [
          {
            taskId: "task-own",
            conversationId: ELSEWHERE,
            residentPubkey: LUCA,
            runtimeFamily: "claude_code",
            summary: "reading back through this week's notes",
            state: "active",
            startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          },
        ]
      : [],
  });
  await page.goto(`/#${hash}`);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

/** Seed when you last looked at each mind, under the active community. */
async function setVisits(page: Page, visits: Record<string, number>) {
  await page.evaluate((visits) => {
    const keys = Object.keys(window.localStorage);
    const community = keys
      .map((key) => key.match(/^luca-mind-visits-v1:(.+)$/)?.[1])
      .find(Boolean);
    const scope = community ?? "";
    window.localStorage.setItem(
      `luca-mind-visits-v1:${scope}`,
      JSON.stringify(visits),
    );
  }, visits);
}

async function shot(page: Page, name: string, fullPage = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    fullPage,
    mask: [
      page.locator(".agent-identity-specimen"),
      page.getByTestId("resident-notebook-growth-field"),
    ],
    path,
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const hashOf = (page: Page) =>
  page.evaluate(() => decodeURIComponent(window.location.hash));

async function openMind(page: Page, pubkey: string) {
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(300);
  if (!(await hashOf(page)).includes(`profile=${pubkey}`))
    await page
      .getByTestId(`place-row-mind:${pubkey}`)
      .locator(".luca-rail-row-hit")
      .click();
  // A second boot in one test may land before the rail's pick is kept:
  // the address then names the mind itself.
  if (!(await hashOf(page)).includes(`profile=${pubkey}`))
    await page.goto(`/#/agents?profile=${pubkey}`);
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain(`profile=${pubkey}`);
  await expect(page.getByTestId("mind-space")).toBeVisible({ timeout: 20_000 });
}

/** Every colour the page paints, outside pictures and the fingerprint:
 *  each must be one of the app's inks (an ink, its alphas, the surface;
 *  today's controls inside a pane use the same tokens under their own
 *  names), and no gradient anywhere (Decided 15). */
function readColours(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="mind-space"]');
    if (!root) return { stray: ["no page"], gradients: [], seen: 0, inks: [] };
    const probe = document.createElement("span");
    root.appendChild(probe);
    const inks = new Set<string>();
    for (const token of [
      "--mn-ink",
      "--mn-ink-muted",
      "--mn-ink-faint",
      "--mn-surface",
      "--foreground",
      "--muted-foreground",
      "--background",
      "--border",
      "--ring",
      "--primary",
      "--primary-foreground",
      "--muted",
      "--input",
      "--card",
      "--popover",
      "--accent",
      "--accent-foreground",
      "--secondary",
    ]) {
      probe.style.color = `hsl(var(${token}))`;
      const value = getComputedStyle(probe).color;
      const rgb = value
        .match(/\d+(\.\d+)?/g)
        ?.slice(0, 3)
        .join(",");
      if (rgb) inks.add(rgb);
    }
    probe.remove();
    const stray: string[] = [];
    const gradients: string[] = [];
    let seen = 0;
    const ok = (value: string) => {
      const match = value.match(/rgba?\([^)]+\)/g);
      if (!match) return true;
      return match.every((each) => {
        const parts = each
          .replace(/rgba?\(|\)/g, "")
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        if (parts[3] === 0) return true;
        return inks.has(parts.slice(0, 3).join(","));
      });
    };
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      // The mark (WP-42's dendrite, its well by day) is measured by its own
      // spec; pictures are their own pixels.
      if (
        element.closest(".agent-identity-specimen, .luca-agent-dendrite, img")
      )
        continue;
      if (element.getClientRects().length === 0) continue;
      seen += 1;
      const css = getComputedStyle(element);
      for (const [what, value] of [
        ["color", css.color],
        ["background", css.backgroundColor],
        ["border", css.borderTopColor],
        ["border-b", css.borderBottomColor],
        ["shadow", css.boxShadow],
      ] as const)
        if (value && value !== "none" && !ok(value))
          stray.push(
            `${String(element.className) || element.tagName} ${what} ${value}`,
          );
      if (/gradient/.test(css.backgroundImage))
        gradients.push(String(element.className) || element.tagName);
    }
    return { stray: stray.slice(0, 20), gradients, seen, inks: [...inks] };
  });
}

/** The header, the three sections and the tiles, measured. */
function readPlace(page: Page) {
  return page.evaluate(() => {
    const css = (element: Element | null) =>
      element ? getComputedStyle(element) : null;
    const parts = [
      ...document.querySelectorAll<HTMLElement>(".luca-mind-part"),
    ].map((part) => {
      const head = part.querySelector(".luca-mind-part-head");
      const title = part.querySelector(".luca-mind-part-title");
      return {
        testId: part.dataset.testid,
        rule: `${css(part)?.borderTopWidth} ${css(part)?.borderTopColor}`,
        title: title?.textContent,
        titleSize: css(title)?.fontSize,
        titleWeight: css(title)?.fontWeight,
        control: Boolean(head?.querySelector(".luca-mind-part-control")),
        top: Math.round(part.getBoundingClientRect().top),
        bottom: Math.round(part.getBoundingClientRect().bottom),
      };
    });
    const tiles = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="mind-made-tiles"] .luca-mind-tile',
      ),
    ].map((tile) => {
      const plate = tile.querySelector<HTMLElement>(".luca-mind-plate");
      const box = plate?.getBoundingClientRect();
      return {
        title: tile.querySelector(".luca-mind-tile-title")?.textContent,
        line: tile.querySelector(".luca-mind-tile-line")?.textContent,
        w: box ? Math.round(box.width) : null,
        h: box ? Math.round(box.height) : null,
        background: plate ? css(plate)?.backgroundColor : null,
        ring: plate ? css(plate)?.boxShadow : null,
        radius: plate ? css(plate)?.borderRadius : null,
        titleSize: css(tile.querySelector(".luca-mind-tile-title"))?.fontSize,
        titleWeight: css(tile.querySelector(".luca-mind-tile-title"))
          ?.fontWeight,
      };
    });
    const now = document.querySelector('[data-testid="mind-now"]');
    return {
      name: {
        size: css(document.querySelector(".luca-mind-name"))?.fontSize,
        weight: css(document.querySelector(".luca-mind-name"))?.fontWeight,
      },
      status: {
        text: now?.textContent,
        lines: now ? Math.round(now.getBoundingClientRect().height) : null,
        size: css(now)?.fontSize,
        live: now?.getAttribute("data-live"),
      },
      runs: document.querySelector('[data-testid="mind-runs"]')?.textContent,
      tabs: document.querySelectorAll('[role="tab"]').length,
      parts,
      gaps: parts
        .slice(1)
        .map((part, index) => part.top - (parts[index]?.bottom ?? 0)),
      tiles,
      intro: {
        size: css(document.querySelector(".luca-mind-intro-text"))?.fontSize,
        width: Math.round(
          document
            .querySelector(".luca-mind-intro-text")
            ?.getBoundingClientRect().width ?? 0,
        ),
      },
    };
  });
}

for (const light of [false, true]) {
  const time = light ? "day" : "night";
  for (const size of [
    { w: 1440, h: 900 },
    { w: 800, h: 500 },
  ]) {
    test(`their page for Luca, ${size.w}×${size.h} by ${time}: the top, then Notebook and Days`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await boot(page, { light });
      await openMind(page, LUCA);
      await expect(page.getByTestId("mind-made-tile")).toHaveCount(4, {
        timeout: 20_000,
      });
      await expect(page.getByTestId("mind-keeping-up")).toBeVisible();
      const place = await readPlace(page);
      const colours = await readColours(page);
      const tag = `${size.w}-${time}`;
      measure(`place-${tag}`, { place, colours });
      expect(place.tabs).toBe(0);
      expect(colours.stray).toEqual([]);
      expect(colours.gradients).toEqual([]);
      await shot(page, `01-their-page-top-${tag}`);
      await page.getByTestId("mind-notebook").scrollIntoViewIfNeeded();
      await page.getByTestId("mind-space").evaluate((element) => {
        const notebook = element.querySelector<HTMLElement>(
          '[data-testid="mind-notebook"]',
        );
        if (notebook) element.scrollTop = notebook.offsetTop - 40;
      });
      await shot(page, `02-their-page-lower-${tag}`);
    });
  }
}

test("their page: one header, one status, three sections built alike", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA);
  await expect(page.getByTestId("mind-made-tile")).toHaveCount(4, {
    timeout: 20_000,
  });
  const place = await readPlace(page);
  measure("structure", place);
  expect(place.name).toEqual({ size: "26px", weight: "600" });
  expect(place.status.size).toBe("13px");
  expect(place.status.text).toBe(
    "Resting·Keeping up with Codex and Claude Code",
  );
  expect(place.status.lines).toBeLessThan(24);
  expect(place.parts.map((part) => part.title)).toEqual([
    "Made by Luca",
    "Notebook",
    "Days",
  ]);
  for (const part of place.parts) {
    expect(part.rule).toMatch(/^1px rgba\(\d+, \d+, \d+, 0\.09\)/);
    expect(part.titleSize).toBe("17px");
    expect(part.titleWeight).toBe("600");
    expect(part.control).toBe(true);
  }
  expect(new Set(place.gaps)).toEqual(new Set([36]));
  // Made: four even tiles, Pinned first, the plate as decided.
  expect(place.tiles[0]?.line).toMatch(/^Pinned · /);
  expect(place.tiles[0]?.title).toContain("Tide pools at night");
  expect(new Set(place.tiles.map((tile) => tile.w)).size).toBe(1);
  for (const tile of place.tiles) {
    expect(tile.radius).toBe("8px");
    expect(tile.background).toMatch(/^rgba\(\d+, \d+, \d+, 0\.04\)$/);
    expect(tile.ring).toContain("inset");
    expect(Math.abs((tile.w ?? 0) / (tile.h ?? 1) - 1.6)).toBeLessThan(0.03);
    expect(tile.titleSize).toBe("13px");
    expect(tile.titleWeight).toBe("500");
  }
  expect(place.tiles.map((tile) => tile.line?.split(" · ")[0])).toEqual([
    "Pinned",
    "For you",
    "On their own",
    "On their own",
  ]);
  expect(place.intro.size).toBe("16px");
  // Notebook opens on Journal (there are entries): its chips and counts.
  await expect(page.getByTestId("mind-view-journal")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("mind-view-journal")).toContainText("2");
  await expect(page.getByTestId("mind-view-pages")).toContainText("3");
  await expect(page.getByTestId("mind-view-notes")).toContainText("2");
  await page.getByTestId("mind-view-pages").click();
  await expect(page.getByTestId("mind-pages").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("mind-page-selfModel")).toContainText(
    "Who I'm becoming",
  );
  await page.getByTestId("mind-view-notes").click();
  await expect(page.getByTestId("mind-notes").locator("li")).toHaveCount(2);
  // Days: where they left off comes first; the filters work.
  const days = page.getByTestId("mind-days");
  const first = await days.evaluate(
    (element) =>
      element.querySelector(".luca-mind-part-head")?.nextElementSibling
        ?.className,
  );
  expect(first).toContain("luca-mind-leftoff");
  await expect(page.getByTestId("mind-handoff-toggle")).toContainText(
    "Where Luca left off",
  );
  const all = await days.getByTestId("mind-entry").count();
  await page.getByTestId("mind-filter-own").click();
  const own = await days.getByTestId("mind-entry").allTextContents();
  for (const text of own) expect(text).toContain("On their own");
  await page.getByTestId("mind-filter-you").click();
  const you = await days.getByTestId("mind-entry").allTextContents();
  for (const text of you) expect(text).toContain("With you");
  measure("days-filters", { all, own, you });
  expect(all).toBeGreaterThan(0);
  expect(own.length).toBeGreaterThan(0);
  expect(you.length).toBeGreaterThan(0);
});

test("asking, and working on their own", async ({ page }) => {
  await boot(page, { asking: true, runtimeTask: true });
  await openMind(page, LUCA);
  const asks = page.getByTestId("mind-asks");
  await expect(asks).toBeVisible({ timeout: 20_000 });
  await expect(asks).toContainText("Luca is asking");
  await expect(asks).toContainText(
    "Should the Tidepool page say preview or beta?",
  );
  // It sits right under the header, before their words.
  const order = await page.evaluate(() => {
    const head = document.querySelector('[data-testid="mind-head"]');
    return head?.nextElementSibling?.getAttribute("data-testid");
  });
  expect(order).toBe("mind-asks");
  const now = page.getByTestId("mind-now");
  await expect(now).toContainText(
    "On their own · reading back through this week's notes · 12 min",
    { timeout: 20_000 },
  );
  await expect(now).toHaveAttribute("data-live", "true");
  await page.getByTestId("mind-made-tile").first().waitFor();
  await shot(page, "03-asking-and-working-1440-night");
  measure("asking-working", {
    status: await now.textContent(),
    asks: await asks.textContent(),
  });
});

for (const light of [false, true]) {
  test(`a made piece's page, and Made with its filters, by ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    await boot(page, { light });
    await openMind(page, LUCA);
    await page.getByTestId("mind-made-tile").first().click();
    const piece = page.getByTestId("mind-piece-page");
    await expect(piece).toBeVisible();
    await expect(page.getByTestId("mind-page-title")).toHaveText(
      "Tide pools at night",
    );
    await expect(page.getByTestId("mind-page-title")).toBeFocused();
    await expect(piece).toContainText("Luca made this on their own");
    await expect(piece).toContainText("Image");
    await expect(page.getByTestId("mind-piece-note")).toContainText(
      "I drew the coast",
    );
    await expect(piece).toContainText("Pinned to Luca's page");
    await expect(page.getByTestId("mind-piece-open")).toBeVisible();
    await expect(page.getByTestId("mind-piece-library")).toBeVisible();
    await expect(page.getByTestId("mind-back")).toHaveText("Luca");
    await shot(page, `05-a-piece-1440-${light ? "day" : "night"}`);
    await page.getByTestId("mind-back").click();
    await page.getByTestId("mind-made-all").click();
    await expect(page.getByTestId("mind-made-grid")).toBeVisible();
    const grid = page.getByTestId("mind-made-grid").locator("li");
    await expect(grid).toHaveCount(5);
    const columns = await page
      .getByTestId("mind-made-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBe(3);
    await shot(page, `06-made-all-1440-${light ? "day" : "night"}`);
    await page.getByTestId("mind-made-filter-own").click();
    await expect(grid).toHaveCount(3);
    await page.getByTestId("mind-made-filter-you").click();
    await expect(grid).toHaveCount(2);
    await grid.first().click();
    await expect(page.getByTestId("mind-back")).toHaveText("Made");
    measure(`made-${light ? "day" : "night"}`, { columns });
  });
}

for (const light of [false, true]) {
  test(`a new agent's empty place, by ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    await boot(page, { light });
    await openMind(page, ATLAS);
    const empty = page.getByTestId("mind-empty-place");
    await expect(empty).toBeVisible({ timeout: 20_000 });
    await expect(empty).toContainText("Atlas's place is empty for now");
    await expect(page.getByTestId("mind-no-intro")).toContainText(
      "Atlas hasn't written an introduction yet.",
    );
    await expect(page.locator(".luca-mind-part")).toHaveCount(0);
    await expect(page.getByTestId("mind-start-conversation")).toBeVisible();
    await shot(page, `12-new-agent-empty-1440-${light ? "day" : "night"}`);
  });
}

/** Settings' groups, panels and titles, measured. */
function readSettings(page: Page) {
  return page.evaluate(() => {
    const groups = [
      ...document.querySelectorAll<HTMLElement>(".luca-mind-group"),
    ].map((group) => {
      const title = group.querySelector(".luca-mind-group-title");
      const panel = group.querySelector(".luca-mind-panel");
      const pcss = panel ? getComputedStyle(panel) : null;
      const rows = [...group.querySelectorAll<HTMLElement>(".luca-mind-prow")];
      return {
        title: title?.textContent,
        titleSize: title ? getComputedStyle(title).fontSize : null,
        titleWeight: title ? getComputedStyle(title).fontWeight : null,
        fill: pcss?.backgroundColor,
        edge: pcss ? `${pcss.borderTopWidth} ${pcss.borderTopColor}` : null,
        radius: pcss?.borderRadius,
        rows: rows.map((row) => ({
          label: row.querySelector(".luca-mind-prow-label")?.textContent,
          h: Math.round(row.getBoundingClientRect().height),
          labelSize: getComputedStyle(
            row.querySelector(".luca-mind-prow-label") ?? row,
          ).fontSize,
        })),
      };
    });
    const title = document.querySelector('[data-testid="mind-settings-title"]');
    return {
      title: title?.textContent,
      titleSize: title ? getComputedStyle(title).fontSize : null,
      text: document.querySelector('[data-testid="agent-settings"]')
        ?.textContent,
      groups,
    };
  });
}

for (const light of [false, true]) {
  test(`Settings in full, then its panes, by ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    const time = light ? "day" : "night";
    await boot(page, { light });
    await openMind(page, LUCA);
    await page.getByTestId("mind-open-settings").click();
    const settings = page.getByTestId("agent-settings");
    await expect(settings).toBeVisible();
    await expect(page.getByTestId("mind-settings-title")).toBeFocused();
    await expect(page.getByTestId("mind-row-keeps")).toContainText(
      "Codex, Claude Code",
    );
    await expect(page.getByTestId("mind-row-config")).toContainText("values");
    const read = await readSettings(page);
    measure(`settings-${time}`, read);
    expect(read.groups.map((group) => group.title)).toEqual([
      "Who Luca is",
      "Their page",
      "Companion",
      "How Luca runs",
      "Advanced",
    ]);
    for (const group of read.groups) {
      expect(group.titleSize).toBe("13px");
      expect(group.titleWeight).toBe("600");
      expect(group.radius).toBe("10px");
      expect(group.edge).toMatch(/^1px /);
      for (const row of group.rows) {
        expect(row.h, `${group.title} ${row.label}`).toBeGreaterThanOrEqual(44);
        expect(row.labelSize).toBe("13px");
      }
    }
    // Shown once (Decided 13), and Sphere or Glyph moved to the app.
    expect(read.text).not.toContain("Sphere");
    expect(read.text).not.toContain("Glyph");
    expect((read.text ?? "").match(/Warm, exact, and unhurried/g)).toBeNull();
    await shot(page, `07-settings-1440-${time}`);
    await page.getByTestId("mind-space").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await shot(page, `07-settings-lower-1440-${time}`);
    await page.getByTestId("mind-space").evaluate((element) => {
      element.scrollTop = 0;
    });

    const settingsColours = await readColours(page);
    measure(`settings-colours-${time}`, settingsColours);
    expect(settingsColours.stray).toEqual([]);
    expect(settingsColours.gradients).toEqual([]);
    await page.getByTestId("mind-row-keeps").click();
    await expect(page.getByTestId("mind-keeps-up-with")).toBeVisible();
    await expect(page.getByTestId("mind-back")).toHaveText("Settings");
    await expect(page.getByTestId("mind-follow-codex_sessions")).toContainText(
      "Following",
    );
    await expect(page.getByTestId("mind-also-available")).toContainText(
      "A file",
    );
    await shot(page, `08-keeps-up-with-1440-${time}`);
    await page.getByTestId("mind-back").click();

    await page.getByTestId("mind-row-permissions").click();
    await expect(page.getByTestId("mind-pane-permissions")).toBeVisible();
    await expect(page.getByTestId("mind-access")).toBeVisible();
    const paneColours = await readColours(page);
    measure(`permissions-colours-${time}`, paneColours);
    expect(paneColours.gradients).toEqual([]);
    await shot(page, `09-permissions-1440-${time}`);
    await page.getByTestId("mind-back").click();

    await page.getByTestId("mind-row-config").click();
    await expect(page.getByTestId("mind-pane-config")).toContainText(
      "These belong to Claude Code, not to Luca",
    );
    await page.getByTestId("mind-config-search").fill("plugin");
    await expect(page.getByTestId("mind-config-plugins")).toBeVisible();
    await expect(page.getByTestId("mind-config-model")).toHaveCount(0);
    await expect(page.getByTestId("mind-config-plugins")).toContainText(
      "playwright@claude-plugins-official",
    );
    await shot(page, `11-claude-code-settings-plugin-1440-${time}`);
    await page.getByTestId("mind-back").click();

    await page.getByTestId("mind-row-soul").click();
    await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
    await expect(page.getByTestId("mind-page-title")).toHaveText("Soul");
    await page
      .getByTestId("resident-document-textarea")
      .fill("# Luca\n\nWarm, exact, unhurried, and brief.");
    await page.getByTestId("mind-back").click();
    // The row under the editor asks (WP-43, round 3); Save holds focus.
    await expect(page.getByTestId("mind-leave-question")).toContainText(
      "Save changes to Soul before leaving?",
    );
    await expect(page.getByTestId("mind-leave-save")).toBeFocused();
    await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
    await shot(page, `10-soul-editor-unsaved-1440-${time}`);
    // Esc keeps editing, the caret back in the editor.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mind-leave-question")).toHaveCount(0);
    await expect(page.getByTestId("resident-document-textarea")).toBeFocused();
    await page.getByTestId("mind-back").click();
    await page.getByTestId("mind-leave-discard").click();
    await expect(page.getByTestId("agent-settings")).toBeVisible();
  });
}

for (const light of [false, true]) {
  test(`at 800 × 500: Settings and a pane still read, by ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await boot(page, { light, hash: `/agents?profile=${LUCA}&page=settings` });
    await expect(page.getByTestId("agent-settings")).toBeVisible({
      timeout: 20_000,
    });
    const overflow = await page.evaluate(() => {
      const page = document.querySelector('[data-testid="mind-space"]');
      return page ? page.scrollWidth - page.clientWidth : -1;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, `07-settings-800-${light ? "day" : "night"}`);
    await page.getByTestId("mind-row-keeps").click();
    await shot(page, `08-keeps-up-with-800-${light ? "day" : "night"}`);
  });
}

test("the rail's dot: new work since your last visit, gone after it", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA);
  // Mark Luca last seen a day and a half ago: the journal page, the note
  // and the piece made since are new.
  await setVisits(page, { [LUCA]: Date.now() - 36 * 3_600_000 });
  await page.reload();
  await expect(page.getByTestId("mind-space")).toBeVisible({ timeout: 20_000 });
  // Their page records this visit at once: the rail's dot is gone, the
  // page's dots stay for this visit.
  await expect(page.getByTestId(`place-row-new-mind:${LUCA}`)).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("mind-new").first()).toBeVisible({
    timeout: 20_000,
  });
  const marked = await page.getByTestId("mind-new").count();
  await shot(page, "15-new-marks-on-their-page-1440-night");
  // Away from their page, with the old visit back: the rail shows the dot.
  await page
    .getByTestId(`place-row-mind:${ATLAS}`)
    .locator(".luca-rail-row-hit")
    .click();
  await expect(page.getByTestId("mind-empty-place")).toBeVisible({
    timeout: 20_000,
  });
  await setVisits(page, {
    [LUCA]: Date.now() - 36 * 3_600_000,
    [ATLAS]: Date.now(),
  });
  await page.reload();
  const dot = page.getByTestId(`place-row-new-mind:${LUCA}`);
  await expect(dot).toBeVisible({ timeout: 20_000 });
  await shot(page, "16-rail-dot-before-visit-1440-night");
  const box = await dot.boundingBox();
  const dotFill = await dot.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(dotFill).not.toBe("rgba(0, 0, 0, 0)");
  await page
    .getByTestId(`place-row-mind:${LUCA}`)
    .locator(".luca-rail-row-hit")
    .click();
  await expect(page.getByTestId("mind-made-tile").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(dot).toHaveCount(0);
  await shot(page, "17-rail-dot-after-visit-1440-night");
  // The next visit: nothing on their page is new any more.
  await page.reload();
  await expect(page.getByTestId("mind-made-tile").first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  const after = await page.getByTestId("mind-new").count();
  measure("new-marks", { marked, dot: box, dotFill, afterNextVisit: after });
  expect(marked).toBeGreaterThan(0);
  expect(after).toBe(0);
});

test("back, forward, Esc, ⌘[ and ⌘] through three levels", async ({ page }) => {
  await boot(page);
  await openMind(page, LUCA);
  const where = async () =>
    (await hashOf(page)).match(/[?&]page=([^&]*)/)?.[1] ?? "";
  await page.getByTestId("mind-open-settings").click();
  await page.getByTestId("mind-row-files").click();
  await expect(page.getByTestId("mind-pane-files")).toBeVisible();
  await page.getByText("notes/coast.md").click();
  await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
  expect(await where()).toBe("settings/files/notes/coast.md");
  await expect(page.getByTestId("mind-back")).toHaveText("Files");
  const trail: string[] = [await where()];
  // Esc walks back one; ⌘[ another; the title bar's back the last.
  await page.locator("body").click({ position: { x: 900, y: 860 } });
  await page.keyboard.press("Escape");
  await expect.poll(where).toBe("settings/files");
  trail.push(await where());
  await page.keyboard.press("Meta+BracketLeft");
  await expect.poll(where).toBe("settings");
  trail.push(await where());
  await page.getByTestId("global-back").click();
  await expect.poll(where).toBe("");
  trail.push(await where());
  await expect(page.getByTestId("mind-place")).toBeVisible();
  // ⌘] forward twice, then the title bar's forward.
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(where).toBe("settings");
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(where).toBe("settings/files");
  await page.getByTestId("global-forward").click();
  await expect.poll(where).toBe("settings/files/notes/coast.md");
  trail.push(await where());
  // A reload keeps the page.
  await page.reload();
  await expect(page.getByTestId("mind-doc-pane")).toBeVisible({
    timeout: 20_000,
  });
  expect(await where()).toBe("settings/files/notes/coast.md");
  // The back link walks the same history.
  await page.getByTestId("mind-back").click();
  await expect.poll(where).toBe("settings/files");
  trail.push(await where());
  measure("history", { trail });
});

test("every way in lands on its new home", async ({ page }) => {
  const ways: Array<[string, string, string]> = [
    ["at=read", "settings/read", "mind-pane-read"],
    ["at=runtime", "settings/harness", "mind-pane-harness"],
    ["at=permissions", "settings/permissions", "mind-pane-permissions"],
    ["section=settings", "settings", "agent-settings"],
    ["section=self", "settings", "mind-group-who"],
    ["section=documents", "settings", "mind-group-who"],
    ["section=overview", "", "mind-place"],
    ["section=notebook", "notebook", "mind-notebook"],
    ["profileTab=memories", "", "mind-place"],
  ];
  const landed: Record<string, string> = {};
  await boot(page);
  for (const [word, page_, testId] of ways) {
    // Each way in arrives from elsewhere in the app, as a link does.
    await page.goto("/#/");
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await page.evaluate((target) => {
      window.location.hash = target;
    }, `/agents?profile=${LUCA}&${word}`);
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () => (await hashOf(page)).match(/[?&]page=([^&]*)/)?.[1] ?? "",
      )
      .toBe(page_);
    const hash = await hashOf(page);
    expect(hash).not.toMatch(/[?&](at|section|profileTab)=/);
    landed[word] = hash;
    if (word === "at=read")
      await expect(page.getByTestId("mind-back")).toHaveText("Settings");
  }
  measure("deep-links", landed);
});

test("Sphere or Glyph lives in the app's Settings, Appearance", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("chat-mark-style-glyph")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("chat-mark-style-sphere")).toBeVisible();
});

for (const light of [false, true]) {
  test(`the header wears the dendrite, clear of the name, by ${light ? "day" : "night"}`, async ({
    page,
  }) => {
    await boot(page, { light });
    await openMind(page, LUCA);
    const mark = page.locator('[data-testid="mind-head"] .luca-agent-dendrite');
    await expect(mark).toBeVisible({ timeout: 20_000 });
    const head = await page.evaluate(() => {
      const well = document
        .querySelector('[data-testid="mind-head"] .luca-agent-dendrite')
        ?.getBoundingClientRect();
      const column = document
        .querySelector('[data-testid="mind-head"] .luca-mind-mark')
        ?.getBoundingClientRect();
      const name = document
        .querySelector('[data-testid="mind-head"] .luca-mind-name')
        ?.getBoundingClientRect();
      const css = document.querySelector(
        '[data-testid="mind-head"] .luca-agent-dendrite',
      );
      return {
        well: well && { x: well.x, w: well.width, h: well.height },
        column: column && { x: column.x, w: column.width },
        nameX: name?.x,
        clearance:
          well && name ? Math.round((name.x - well.right) * 100) / 100 : null,
        wellFill: css ? getComputedStyle(css).backgroundColor : null,
        margin: css ? getComputedStyle(css).margin : null,
      };
    });
    measure(`head-mark-${light ? "day" : "night"}`, head);
    expect(head.well?.w).toBe(72);
    expect(head.column?.w).toBe(72);
    expect(head.margin).toBe("0px");
    expect(head.clearance ?? -1).toBeGreaterThanOrEqual(16);
    await shot(page, `21-header-dendrite-1440-${light ? "day" : "night"}`);
  });
}

test("the title bar says where you are", async ({ page }) => {
  await boot(page);
  await openMind(page, LUCA);
  const lip = page.getByTestId("shell-lip-name");
  await expect(lip).toHaveText("Luca");
  const said: Record<string, string> = {};
  await page.getByTestId("mind-open-settings").click();
  await expect(lip).toHaveText("Luca · Settings");
  said.settings = (await lip.textContent()) ?? "";
  await shot(page, "18-settings-title-bar-1440-night");
  await page.getByTestId("mind-row-permissions").click();
  await expect(lip).toHaveText("Luca · Permissions");
  said.permissions = (await lip.textContent()) ?? "";
  await shot(page, "19-pane-title-bar-1440-night");
  await page.getByTestId("mind-back").click();
  await page.getByTestId("mind-row-soul").click();
  await expect(lip).toHaveText("Luca · Soul");
  said.soul = (await lip.textContent()) ?? "";
  await page.getByTestId("mind-back").click();
  await page.getByTestId("mind-back").click();
  await expect(lip).toHaveText("Luca");
  await page.getByTestId("mind-made-tile").first().click();
  await expect(lip).toHaveText("Luca · Tide pools at night");
  said.piece = (await lip.textContent()) ?? "";
  await page.getByTestId("mind-back").click();
  await expect(lip).toHaveText("Luca");
  measure("title-bar", said);
});

test("a Days talk entry names the other minds in its room", async ({
  page,
}) => {
  // Fifty lives on this Mac and is a member of the mock's #general. The mock
  // relay lives in the page: Luca's talk there is seeded first, in Chats,
  // and their page is opened after it, without a reload.
  await boot(page, {
    alsoAgents: [{ name: "Fifty", pubkey: FIFTY }],
    hash: "/",
  });
  await expect(page.getByTestId("chat-list")).toBeVisible({ timeout: 20_000 });
  await page.evaluate((luca) => {
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
      content: "The release notes are up.",
      pubkey: luca,
    });
  }, LUCA);
  await page.getByTestId("open-agents-view").click();
  await openMind(page, LUCA);
  const entry = page
    .getByTestId("mind-days")
    .getByTestId("mind-entry")
    .filter({ hasText: "Talked in general" });
  await expect(entry).toHaveCount(1, { timeout: 20_000 });
  await expect(entry).toContainText("With you · with Fifty");
  // Plain words: the row is one button, with nothing to press inside it.
  await expect(entry.locator("button")).toHaveCount(1);
  await expect(entry.locator("a")).toHaveCount(0);
  await entry.scrollIntoViewIfNeeded();
  measure("days-with-minds", { text: await entry.textContent() });
  await shot(page, "20-days-with-other-minds-1440-night");
});

// ── leaving with unsaved changes (WP-43, round 3) ────────────────────────
const WAYS = [
  "back-link",
  "title-back",
  "title-forward",
  "esc",
  "cmd-[",
  "cmd-]",
  "rail-row",
  "agents-icon",
  "chats-icon",
  "search-icon",
] as const;
const ANSWERS = ["save", "discard", "keep", "esc"] as const;

const SOUL = `/agents?profile=${"a".repeat(64)}&page=settings/soul`;

async function openSoul(page: Page) {
  // From Settings, as a person would: the push gives the back link its way.
  await page.evaluate((luca) => {
    window.location.hash = `/agents?profile=${luca}&page=settings`;
  }, LUCA);
  await expect(page.getByTestId("agent-settings")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("mind-row-soul").click();
  await expect(page.getByTestId("resident-document-textarea")).toBeEnabled({
    timeout: 20_000,
  });
}

/** Where the page is: its address, the title bar, what holds focus. */
async function stateOf(page: Page) {
  return page.evaluate(() => ({
    hash: decodeURIComponent(window.location.hash),
    lip: document.querySelector('[data-testid="shell-lip-name"]')?.textContent,
    focus:
      document.activeElement?.getAttribute("data-testid") ??
      document.activeElement?.tagName ??
      null,
    question: Boolean(
      document.querySelector('[data-testid="mind-leave-question"]'),
    ),
  }));
}

for (const way of WAYS) {
  test(`unsaved changes: ${way} × Save, Discard, Keep editing, Esc`, async ({
    page,
  }) => {
    await boot(page);
    await openMind(page, LUCA);
    const results: Record<string, unknown> = {};
    for (const answer of ANSWERS) {
      await openSoul(page);
      if (way === "title-forward" || way === "cmd-]") {
        // Something ahead to go forward to: Atlas, then back to the Soul.
        await page
          .getByTestId(`place-row-mind:${ATLAS}`)
          .locator(".luca-rail-row-hit")
          .click();
        await expect(page.getByTestId("mind-empty-place")).toBeVisible({
          timeout: 20_000,
        });
        await page.getByTestId("global-back").click();
        await expect(
          page.getByTestId("resident-document-textarea"),
        ).toBeEnabled({ timeout: 20_000 });
      }
      const marker = `EDITED-${way}-${answer}`;
      const area = page.getByTestId("resident-document-textarea");
      await area.click();
      await area.press("End");
      await area.type(` ${marker}`);
      const caret = await area.evaluate(
        (el) => (el as HTMLTextAreaElement).selectionStart,
      );
      const before = await stateOf(page);
      // The way out.
      if (way === "back-link") await page.getByTestId("mind-back").click();
      if (way === "title-back") await page.getByTestId("global-back").click();
      if (way === "title-forward")
        await page.getByTestId("global-forward").click();
      if (way === "esc") await page.keyboard.press("Escape");
      if (way === "cmd-[") await page.keyboard.press("Meta+BracketLeft");
      if (way === "cmd-]") await page.keyboard.press("Meta+BracketRight");
      if (way === "rail-row")
        await page
          .getByTestId(`place-row-mind:${ATLAS}`)
          .locator(".luca-rail-row-hit")
          .click();
      if (way === "agents-icon")
        await page.getByTestId("open-agents-view").click();
      if (way === "chats-icon")
        await page.getByTestId("shell-place-conversations").click();
      if (way === "search-icon")
        await page
          .getByTestId("shell-place-search")
          .locator("button")
          .first()
          .click();
      await page.waitForTimeout(300);
      const asked = await stateOf(page);
      const run: Record<string, unknown> = { asked };
      if (way === "search-icon" && !asked.question) {
        // Search opens its own field over the page; it goes nowhere until a
        // result is picked, so there is nothing to ask yet.
        run.note = "search opens a field; no move, so no question";
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        run.after = await stateOf(page);
        await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
        // Leave the edit unsaved and drop it for the next run.
        await page.getByTestId("resident-document-discard").click();
        results[answer] = run;
        continue;
      }
      await expect(page.getByTestId("mind-leave-question")).toContainText(
        "Save changes to Soul before leaving?",
      );
      await expect(page.getByTestId("mind-leave-save")).toBeFocused();
      if (answer === "save") await page.getByTestId("mind-leave-save").click();
      if (answer === "discard")
        await page.getByTestId("mind-leave-discard").click();
      if (answer === "keep") await page.getByTestId("mind-leave-keep").click();
      if (answer === "esc") await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      const landed = await stateOf(page);
      run.landed = landed;
      if (answer === "keep" || answer === "esc") {
        expect(landed.question).toBe(false);
        expect(landed.hash).toBe(before.hash);
        await expect(area).toBeFocused();
        const caretAfter = await area.evaluate(
          (el) => (el as HTMLTextAreaElement).selectionStart,
        );
        expect(caretAfter).toBe(caret);
        expect(await area.inputValue()).toContain(marker);
        run.caret = { before: caret, after: caretAfter };
        await page.getByTestId("resident-document-discard").click();
        results[answer] = run;
        continue;
      }
      expect(landed.question).toBe(false);
      expect(landed.hash).not.toBe(before.hash);
      // Focus lands where the destination puts it on arrival: a page's own
      // heading (never the title bar's); a conversation's composer, as the
      // app arrives in every conversation.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el) return null;
            if (el.getAttribute("data-testid") === "message-input")
              return location.hash.startsWith("#/channels") ? "composer" : null;
            return /^H[12]$/.test(el.tagName) &&
              !el.closest('[data-testid="shell-lip"]')
              ? el.textContent
              : null;
          }),
        )
        .not.toBeNull();
      run.focusedHeading = await page.evaluate(
        () => document.activeElement?.textContent,
      );
      // Reopened, the text is saved or gone.
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, SOUL);
      const reopened = page.getByTestId("resident-document-textarea");
      await expect(reopened).toBeEnabled({ timeout: 20_000 });
      const text = await reopened.inputValue();
      run.reopenedHasEdit = text.includes(marker);
      expect(text.includes(marker)).toBe(answer === "save");
      results[answer] = run;
    }
    measure(`unsaved-${way}`, results);
  });
}

test("unsaved changes: a failed save stays, keeps the text and says why", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (
      window as unknown as { __WP43_FAIL_WRITE__: boolean }
    ).__WP43_FAIL_WRITE__ = true;
  });
  await boot(page);
  await openMind(page, LUCA);
  await openSoul(page);
  const area = page.getByTestId("resident-document-textarea");
  await area.click();
  await area.press("End");
  await area.type(" EDITED-fail");
  await page.getByTestId("mind-back").click();
  await page.getByTestId("mind-leave-save").click();
  await expect(page.getByTestId("mind-leave-question")).toHaveCount(0);
  await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
  await expect(area).toHaveValue(/EDITED-fail/);
  await expect(page.getByTestId("resident-document-status")).toContainText(
    "The disk is full",
  );
  measure("unsaved-save-fails", {
    status: await page.getByTestId("resident-document-status").textContent(),
    state: await stateOf(page),
  });
});

// ── round 3: the empty place's reasons, Set up, one harness, restart ──────
const CAUSES: Array<{
  cause: string;
  open: (page: Page) => Promise<void>;
  channel?: string;
}> = [
  {
    cause: "unsupported",
    open: (page) => openMind(page, ATLAS),
  },
  {
    cause: "stopped",
    open: (page) => openMind(page, TRINITY),
  },
  {
    cause: "setup",
    open: async (page) => {
      await expect(page.getByTestId("place-rail-agents")).toBeVisible({
        timeout: 20_000,
      });
      await page
        .getByTestId("place-row-persona:persona-kestrel")
        .locator(".luca-rail-row-hit")
        .click();
      await expect(page.getByTestId("mind-space")).toBeVisible({
        timeout: 20_000,
      });
    },
  },
  {
    cause: "ready",
    open: (page) => openMind(page, ATLAS),
    channel: ATLAS,
  },
];

for (const each of CAUSES)
  for (const light of [false, true])
    test(`the empty place says why, ${each.cause}, by ${light ? "day" : "night"}`, async ({
      page,
    }) => {
      if (each.channel)
        await page.addInitScript((key) => {
          (window as unknown as { __WP43_CHANNEL__: string }).__WP43_CHANNEL__ =
            key;
        }, each.channel);
      await boot(page, { light });
      await each.open(page);
      const empty = page.getByTestId("mind-empty-place");
      await expect(empty).toBeVisible({ timeout: 20_000 });
      const read = await empty.evaluate((box) => ({
        reason: box
          .querySelector('[data-testid="mind-away-reason"]')
          ?.getAttribute("data-reason"),
        reasonText: box.querySelector('[data-testid="mind-away-reason"]')
          ?.textContent,
        fix: box.querySelector('[data-testid="mind-away-fix"]')?.textContent,
        first: box.querySelector(".luca-mind-actions button")?.textContent,
        give: Boolean(box.querySelector('[data-testid="mind-give-time"]')),
        header: document.querySelector('[data-testid="mind-now"]')?.textContent,
      }));
      measure(`empty-${each.cause}-${light ? "day" : "night"}`, read);
      if (each.cause === "ready") {
        expect(read.give).toBe(true);
        expect(read.reason ?? null).toBeNull();
        expect(read.first).toContain("time of their own");
      } else {
        expect(read.give).toBe(false);
        expect(read.reason).toBe(each.cause);
      }
      if (each.cause === "unsupported") {
        expect(read.reasonText).toContain(
          "Codex can't take time of their own yet.",
        );
        expect(read.fix ?? null).toBeNull();
        expect(read.first).toBe("Start a conversation");
      }
      if (each.cause === "stopped") {
        expect(read.header).toBe("Off");
        expect(read.reasonText).toContain("Trinity is off.");
        expect(read.fix).toBe("Start Trinity");
        expect(read.first).toBe("Start a conversation");
      }
      if (each.cause === "setup") {
        expect(read.reasonText).toContain(
          "Kestrel isn't set up on this Mac yet.",
        );
        expect(read.fix).toBe("Set up Kestrel");
      }
      await shot(
        page,
        `22-empty-${each.cause}-1440-${light ? "day" : "night"}`,
      );
    });

test("Settings › Companion's While you're away says the same reason", async ({
  page,
}) => {
  await boot(page);
  const said: Record<string, unknown> = {};
  for (const [key, cause] of [
    [TRINITY, "stopped"],
    [ATLAS, "unsupported"],
  ] as const) {
    await page.evaluate((key) => {
      window.location.hash = `/agents?profile=${key}&page=settings`;
    }, key);
    const row = page.getByTestId("mind-row-away");
    await expect(row).toBeVisible({ timeout: 20_000 });
    const reason = row.getByTestId("mind-away-reason");
    await expect(reason).toHaveAttribute("data-reason", cause);
    said[cause] = await reason.textContent();
    if (cause === "stopped")
      await expect(row.getByTestId("mind-away-fix")).toHaveText(
        "Start Trinity",
      );
    else await expect(row.getByTestId("mind-away-fix")).toHaveCount(0);
  }
  await shot(page, "23-settings-away-unsupported-1440-night");
  measure("settings-away", said);
});

test("Set up: an agent not yet on this Mac", async ({ page }) => {
  await boot(page);
  await CAUSES[2].open(page);
  const setUp = page.getByTestId("mind-head").getByRole("button", {
    name: "Set up",
  });
  await expect(setUp).toBeVisible();
  await expect(page.getByTestId("mind-now")).toBeVisible();
  await shot(page, "24-set-up-kestrel-1440-night");
  const before = await page.evaluate(
    () =>
      (
        (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
          .__BUZZ_E2E_COMMANDS__ ?? []
      ).length,
  );
  await setUp.click();
  await expect
    .poll(() =>
      page.evaluate(
        (from) =>
          (
            (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
              .__BUZZ_E2E_COMMANDS__ ?? []
          )
            .slice(from)
            .filter((command) => /managed_agent|persona/.test(command)),
        before,
      ),
    )
    .not.toEqual([]);
  // Settings for it says what isn't there yet, with a way to write it.
  await page.getByTestId("mind-open-settings").click();
  await expect(page.getByTestId("mind-row-instructions")).toContainText(
    "Not set",
  );
});

test("one harness value: header, Settings row, Harness pane and its settings", async ({
  page,
}) => {
  await boot(page);
  await openMind(page, LUCA);
  const header = await page.getByTestId("mind-runs").textContent();
  await page.getByTestId("mind-open-settings").click();
  const row = await page
    .getByTestId("mind-row-harness")
    .locator(".luca-mind-prow-value")
    .textContent();
  await page.getByTestId("mind-row-harness").click();
  const pane = await page
    .getByTestId("mind-pane-harness")
    .locator(".luca-mind-prow")
    .filter({ hasText: "Runtime" })
    .locator(".luca-mind-prow-value")
    .textContent();
  await page.getByTestId("mind-back").click();
  await page.getByTestId("mind-row-config").click();
  const configTitle = await page.getByTestId("mind-page-title").textContent();
  measure("harness-one-value", { header, row, pane, configTitle });
  expect(header?.split(" · ")[0]).toBe("Claude Code");
  expect(row).toBe("Claude Code");
  expect(pane).toBe("Claude Code");
  expect(configTitle).toBe("Claude Code settings");
});

test("restart shows while it's under way, then settles", async ({ page }) => {
  await page.addInitScript(() => {
    (
      window as unknown as { __WP43_SLOW_START__: boolean }
    ).__WP43_SLOW_START__ = true;
  });
  await boot(page);
  await openMind(page, LUCA);
  await page.getByTestId("mind-open-settings").click();
  const restart = page.getByTestId("mind-restart");
  await expect(restart).toHaveText("Restart Luca");
  await restart.click();
  await expect(restart).toHaveText("Restarting Luca…");
  await expect(restart).toBeDisabled();
  await shot(page, "25-restarting-1440-night");
  await page.getByTestId("mind-back").click();
  const now = page.getByTestId("mind-now");
  await expect(now).toContainText("Restarting Luca…");
  await expect(now).toHaveAttribute("data-live", "true");
  await expect(now).not.toContainText("Restarting", { timeout: 10_000 });
  await page.getByTestId("mind-open-settings").click();
  await expect(page.getByTestId("mind-restart")).toHaveText("Restart Luca");
  await expect(page.getByTestId("mind-restart")).toBeEnabled();
  measure("restart", { settled: await now.count() });
});

for (const light of [false, true])
  for (const size of [
    { w: 800, h: 500 },
    { w: 1440, h: 900 },
  ])
    test(`no cut sentences: the status line at ${size.w}, by ${light ? "day" : "night"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await boot(page, { light });
      await openMind(page, LUCA);
      const now = page.getByTestId("mind-now");
      await expect(page.getByTestId("mind-keeping-up")).toBeVisible({
        timeout: 20_000,
      });
      const read = await now.evaluate((line) => {
        const parts = [...line.children].map((child) => {
          const style = getComputedStyle(child);
          return {
            text: child.textContent,
            overflow: style.textOverflow,
            cut:
              (child as HTMLElement).scrollWidth >
              (child as HTMLElement).clientWidth + 1,
          };
        });
        const name = document
          .querySelector('[data-testid="mind-page-title"]')
          ?.getBoundingClientRect();
        const box = line.getBoundingClientRect();
        return {
          parts,
          text: line.textContent,
          lines: Math.round(box.height / 18),
          underName: name ? box.top >= name.bottom - 1 : null,
          right: Math.round(box.right),
          buttons: Math.round(
            document
              .querySelector(".luca-mind-head-actions")
              ?.getBoundingClientRect().left ?? 0,
          ),
        };
      });
      measure(`status-${size.w}-${light ? "day" : "night"}`, read);
      expect(read.text).toBe("Resting·Keeping up with Codex and Claude Code");
      for (const part of read.parts) {
        expect(part.overflow).not.toBe("ellipsis");
        expect(part.cut).toBe(false);
      }
      expect(read.underName).toBe(true);
      await shot(page, `26-status-${size.w}-${light ? "day" : "night"}`);
    });

test("Instructions not set: the row says so and opens where they're written", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate((key) => {
    window.location.hash = `/agents?profile=${key}&page=settings`;
  }, ATLAS);
  const row = page.getByTestId("mind-row-instructions");
  await expect(row).toContainText("Not set", { timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId("mind-doc-pane")).toBeVisible();
  await expect(page.getByTestId("mind-page-title")).toHaveText("Instructions");
  await expect(page.getByTestId("resident-document-textarea")).toBeEditable();
  measure("instructions-not-set", { row: await page.url() });
});

test("App Settings › Appearance › Conversation › Chat mark", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/#/settings?section=appearance");
  const glyph = page.getByTestId("chat-mark-style-glyph");
  await expect(glyph).toBeVisible({ timeout: 20_000 });
  await glyph.scrollIntoViewIfNeeded();
  await shot(page, "27-app-settings-chat-mark-1440-night");
});

test("the chat drawer's links land on their homes", async ({ page }) => {
  await boot(page);
  await openMind(page, LUCA);
  await page.getByTestId("mind-talk").click();
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 20_000 });
  const dm = await page.evaluate(() => window.location.hash);
  const landed: Record<string, string> = {};
  const links: Array<[string, () => Promise<void>, RegExp, string]> = [
    [
      "open",
      () => page.getByTestId("resident-drawer-open-agent").click(),
      /^#\/agents\?profile=a{64}$/,
      "mind-place",
    ],
    [
      "instructions",
      () =>
        page
          .getByTestId("resident-drawer")
          .locator("section", { hasText: "Instructions" })
          .getByRole("button")
          .first()
          .click(),
      /page=settings\/instructions/,
      "mind-doc-pane",
    ],
    [
      "notebook",
      () =>
        page
          .getByTestId("resident-drawer")
          .getByRole("button", { name: "Notebook" })
          .click(),
      /page=notebook(&|$)/,
      "mind-notebook",
    ],
    [
      "settings",
      () =>
        page
          .getByTestId("resident-drawer")
          .getByRole("button", { name: "Settings" })
          .click(),
      /page=settings(&|$)/,
      "agent-settings",
    ],
  ];
  for (const [name, click, address, testId] of links) {
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, dm);
    const details = page.getByTestId("shell-lip-details");
    await expect(details).toBeVisible({ timeout: 20_000 });
    if ((await details.getAttribute("aria-expanded")) !== "true")
      await details.click();
    await expect(page.getByTestId("resident-drawer")).toBeVisible({
      timeout: 20_000,
    });
    await click();
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
    const hash = decodeURIComponent(await page.evaluate(() => location.hash));
    expect(hash).toMatch(address);
    expect(hash).not.toMatch(/[?&](section|at|profileTab)=/);
    landed[name] = hash;
  }
  measure("drawer-links", landed);
});

test.afterAll(() => {
  measure(`console-${test.info().parallelIndex}`, { errors });
});
