import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * One voice for the small things (docs/luca/rail-system/SHELL_BUILD.md,
 * WP-19): one measurement per decision under the frame, at 1440 × 900 and
 * 800 × 500, dark and light, and the views it touches compared by hash with
 * the flag off against the base build. Boots at `/#/…` with no page query.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else
 * test-results/shell-one-voice). SHELL_BASE_URL: the base build (default
 * http://127.0.0.1:4320).
 */

const SHOTS = process.env.SHELL_SHOTS ?? "test-results/shell-one-voice";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4320";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const NOW = Date.now();
const RECORD_AT = Math.floor((NOW - 40 * 60_000) / 1000);

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 240_000 });

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

async function settle(page: Page, ms = 300) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
  await page.waitForTimeout(ms);
}

async function shot(page: Page, name: string, mask: string[] = []) {
  await settle(page);
  const file = path.join(dir(), `${name}.png`);
  await page.screenshot({
    path: file,
    animations: "disabled",
    caret: "hide",
    ...(mask.length > 0
      ? { mask: mask.map((selector) => page.locator(selector)) }
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

/** An image Luca made, with no summary of its own, so the row says its
 *  kind: served over the mock's own listing. */
async function seedArtifacts(page: Page) {
  await page.addInitScript((luca) => {
    type Invoke = (c: string, p?: unknown, o?: unknown) => Promise<unknown>;
    let real: Invoke | undefined;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        real = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          if (!real) throw new Error(`mock invoke not ready: ${command}`);
          const result = await real(command, payload, options);
          if (command !== "list_artifacts") return result;
          const listing = result as {
            artifacts: Record<string, unknown>[];
            total: number;
          };
          const input = (payload as { input?: { deleted?: string } })?.input;
          if (input?.deleted === "deleted") return result;
          const sample = listing.artifacts[0] ?? {};
          const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
          return {
            ...listing,
            artifacts: [
              {
                ...sample,
                availability: "ready",
                createdAt: at,
                currentVersion: 1,
                currentVersionId: "luca-tide:v1",
                deletedAt: null,
                id: "luca-tide",
                kind: "image",
                language: null,
                mediaType: "image/png",
                pinned: false,
                provenance: {
                  conversationId: null,
                  dispatchReceiptId: null,
                  finalMessageId: null,
                  projectId: null,
                  residentPubkey: luca,
                  turnId: null,
                },
                sourceBinding: null,
                summary: null,
                title: "Tide pools at night",
                updatedAt: at,
              },
              ...listing.artifacts,
            ],
            total: listing.total + 1,
          };
        },
    });
  }, LUCA);
}

const MOCK = {
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
      name: "Wren",
      pubkey: WREN,
      personaId: "persona-wren",
      status: "stopped",
    },
  ],
  personas: [
    {
      id: "persona-atlas",
      displayName: "Atlas",
      systemPrompt: "Keeps the release honest.",
      runtime: "claude",
    },
    {
      id: "persona-wren",
      displayName: "Wren",
      systemPrompt: "Walks the design through.",
      runtime: "hermes",
    },
  ],
  teams: [
    {
      id: "team-design",
      name: "Design team",
      description: "The two who walk a design from sketch to release.",
      personaIds: ["persona-atlas", "persona-wren"],
    },
  ],
  capabilitySkills: [
    {
      skillId: "skill-review",
      name: "review-pass",
      description: "Reads a diff for correctness and leaves notes.",
      sourceLabels: ["~/.claude/skills"],
      runtimeIds: ["claude"],
      content: "# review-pass",
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
        protocol: "luca.managed.permission.v1",
        resident_pubkey: LUCA,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
  ],
};

async function boot(
  page: Page,
  {
    frame = true,
    hash,
    light = false,
    origin = "",
    ready = "app-sidebar",
    size = { width: 1440, height: 900 },
  }: {
    frame?: boolean;
    hash: string;
    light?: boolean;
    origin?: string;
    ready?: string;
    size?: { width: number; height: number };
  },
) {
  watchConsole(page);
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: light ? "light" : "dark" });
  await page.addInitScript(
    ({ key, on }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": on }));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  if (light)
    await page.addInitScript(() => {
      localStorage.setItem("buzz-theme", "paper");
      localStorage.setItem("buzz-follow-system", "false");
    });
  await seedArtifacts(page);
  await installMockBridge(page, MOCK as never);
  await expect(async () => {
    await page.goto(`${origin}/#${hash}`);
    await expect(page.getByTestId(ready)).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
  // Luca's own signed words in #general, for the record.
  await page.evaluate(
    ({ luca, at }) => {
      const emit = (
        window as unknown as {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (message: unknown) => void;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      emit?.({
        channelName: "general",
        content: "Atlas, are the release notes ready for Sam's read?",
        createdAt: at,
        kind: 9,
        pubkey: luca,
      });
    },
    { luca: LUCA, at: RECORD_AT },
  );
}

async function go(page: Page, hash: string) {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, hash);
  await page.waitForTimeout(700);
}

const lip = (page: Page) =>
  page
    .getByTestId("shell-lip-name")
    .innerText()
    .then((text) => text.trim());

/** The shared label's voice: the rail's own section head. */
async function labelVoice(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      text: el.textContent?.trim().slice(0, 40),
      family: s.fontFamily.split(",")[0]?.replaceAll('"', "").trim(),
      size: s.fontSize,
      tracking: s.letterSpacing,
      transform: s.textTransform,
      weight: s.fontWeight,
    };
  }, selector);
}

const checks: Record<string, unknown> = {};

for (const light of [false, true]) {
  const mode = light ? "light" : "dark";
  test(`one voice, 1440 ${mode}`, async ({ page }) => {
    await boot(page, { hash: `/channels/${GENERAL}`, light });
    await expect(page.getByTestId("message-input")).toBeVisible({
      timeout: 20_000,
    });
    const out: Record<string, unknown> = {};
    const railLabel = await labelVoice(
      page,
      "[data-shell-rail] .luca-rail-section-head",
    );

    // ── d2: the details card's labels, Current work, Action preview ──
    await page
      .getByRole("button", { name: "Open conversation details", exact: true })
      .click();
    await expect(page.locator("#conversation-at-a-glance")).toBeVisible({
      timeout: 15_000,
    });
    await settle(page);
    const details: Record<string, unknown> = {};
    for (const id of [
      "conversation-at-a-glance",
      "conversation-agents",
      "conversation-people",
      "conversation-working-context",
      "conversation-between-agents",
    ])
      details[id] = await labelVoice(page, `#${id}`);
    const work = await labelVoice(page, ".luca-work-tray__heading > span");
    const preview = await labelVoice(
      page,
      '[data-testid="managed-permission-action-preview"] > p:first-child',
    );
    const same = (each: unknown) => {
      const v = each as { family: string; tracking: string; size: string };
      return Boolean(
        v &&
          railLabel &&
          v.family === railLabel.family &&
          v.tracking === railLabel.tracking &&
          v.size === railLabel.size,
      );
    };
    const present = Object.values(details).filter(Boolean);
    out.d2 = {
      rail: railLabel,
      details,
      current_work: work,
      action_preview: preview,
      ok:
        present.length >= 3 &&
        present.every(same) &&
        (work === null || same(work)),
      action_preview_matches: preview ? same(preview) : null,
    };
    if (!light) await shot(page, `d2-details-${mode}`);
    await page.keyboard.press("Escape");

    // ── d3: Chats drifts like the other places ──
    await go(page, "/agents");
    await page.evaluate(() => {
      const w = window as unknown as { __M__: string[] };
      w.__M__ = [];
      new MutationObserver(() => {
        const value = document.documentElement.dataset.navMotion;
        if (value) w.__M__.push(value);
      }).observe(document.documentElement, {
        attributeFilter: ["data-nav-motion"],
        attributes: true,
      });
    });
    const move = async (key: string, act: () => Promise<void>) => {
      await page.evaluate(() => {
        (window as unknown as { __M__: string[] }).__M__ = [];
      });
      const from = await page.evaluate(() => window.location.hash);
      await act();
      await page.waitForTimeout(900);
      const motions = await page.evaluate(
        () => (window as unknown as { __M__: string[] }).__M__,
      );
      const to = await page.evaluate(() => window.location.hash);
      return { key, from, to, motion: motions[0] ?? null };
    };
    const moves = [
      await move("agents>chats", () =>
        page.getByTestId("shell-place-conversations").click(),
      ),
      await move("chats>library", () =>
        page.getByTestId("open-artifacts-view").click(),
      ),
      await move("library>chats", () =>
        page.getByTestId("shell-place-conversations").click(),
      ),
      await move("conversation>conversation", () =>
        page
          .locator(
            '[data-shell-rail] .luca-rail-row[data-home-kind="room"] .luca-rail-row-hit[title="engineering"]',
          )
          .first()
          .click(),
      ),
      await move("chats>activity", () =>
        page.getByTestId("open-activity-view").click(),
      ),
    ];
    const motionOf = (key: string) =>
      moves.find((each) => each.key === key)?.motion;
    out.d3 = {
      moves,
      ok:
        motionOf("agents>chats") === "up" &&
        motionOf("chats>library") === "down" &&
        motionOf("library>chats") === "up" &&
        motionOf("chats>activity") === "down" &&
        motionOf("conversation>conversation") === "same",
    };

    // ── d1: the signed record ──
    await go(page, `/pulse?record=${LUCA}`);
    await expect(page.getByTestId("provenance-time").first()).toBeVisible({
      timeout: 20_000,
    });
    await settle(page);
    out.d1 = await page.evaluate(() => {
      const time = document.querySelector<HTMLElement>(
        '[data-testid="provenance-time"]',
      );
      const day = document.querySelector<HTMLElement>(
        '[data-testid="provenance-day"]',
      );
      const rule = day?.parentElement?.querySelector(".h-px");
      const axis = document.querySelector<HTMLElement>(".luca-place-page-axis");
      const end = document.querySelector<HTMLElement>(
        '[data-testid="provenance-end-note"]',
      );
      const mark = axis?.querySelector(".agent-identity-specimen");
      const initial = [...(axis?.querySelectorAll("span") ?? [])].some(
        (each) =>
          each.children.length === 0 &&
          /^[A-Z]$/.test(each.textContent?.trim() ?? ""),
      );
      const dayStyle = day ? getComputedStyle(day) : null;
      const shared = document.querySelector<HTMLElement>(
        "[data-shell-rail] .luca-rail-section-head",
      );
      const sharedStyle = shared ? getComputedStyle(shared) : null;
      const axisLeft = axis?.getBoundingClientRect().left ?? 0;
      return {
        time: time?.textContent?.trim(),
        time_ok: /^\d{1,2}:\d{2}\s?(AM|PM)$/.test(
          time?.textContent?.trim() ?? "",
        ),
        day: day?.textContent?.trim(),
        day_family: dayStyle?.fontFamily.split(",")[0],
        day_tracking: dayStyle?.letterSpacing,
        rail_family: sharedStyle?.fontFamily.split(",")[0],
        rail_tracking: sharedStyle?.letterSpacing,
        rule: Boolean(rule),
        mark: Boolean(mark),
        initial,
        end_align: end ? getComputedStyle(end).textAlign : null,
        end_left_offset: end
          ? Math.round(end.getBoundingClientRect().left - axisLeft)
          : null,
      };
    });
    {
      const d1 = out.d1 as Record<string, unknown>;
      d1.ok =
        d1.time_ok === true &&
        d1.day_family === d1.rail_family &&
        d1.day_tracking === d1.rail_tracking &&
        d1.rule === false &&
        d1.mark === true &&
        d1.initial === false &&
        d1.end_align !== "center" &&
        d1.end_left_offset === 0;
    }
    await shot(page, `d1-record-${mode}`);

    // ── d5 / d6: the lip's names, the cards' eyebrows ──
    const eyebrow = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-testid="place-page-head"] p')
            ?.textContent?.trim() ?? null,
      );
    const names: Record<string, { lip: string; eyebrow: string | null }> = {};
    names.record = { lip: await lip(page), eyebrow: await eyebrow() };
    for (const [key, hash] of [
      ["made_all", "/artifacts?made=all"],
      ["skills_all", "/artifacts?skills=all"],
      ["deleted", "/artifacts?deleted=recently"],
      ["now", "/pulse?stream=now"],
      ["needs", "/pulse?stream=needs-you"],
      ["group", "/agents?group=team-design"],
    ] as const) {
      await go(page, hash);
      await expect(page.getByTestId("place-page-head")).toBeVisible({
        timeout: 15_000,
      });
      // The rail's rows (skills, deleted) arrive after the head.
      await page.waitForTimeout(800);
      names[key] = { lip: await lip(page), eyebrow: await eyebrow() };
    }
    out.d5 = {
      names,
      ok:
        names.made_all.lip === "Made / All" &&
        names.skills_all.lip === "Skills / All" &&
        names.record.lip === `Signed record / Luca` &&
        names.group.lip === "Design team",
    };
    out.d6 = {
      ok:
        names.now.eyebrow === null &&
        names.needs.eyebrow === null &&
        names.deleted.eyebrow === null &&
        names.group.eyebrow === "Group" &&
        names.record.eyebrow === "Signed record" &&
        names.made_all.eyebrow === "Made",
    };

    // ── d8: the group's buttons are quiet ──
    out.d8 = await page.evaluate(() => {
      const style = (id: string) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          border: `${s.borderTopWidth} ${s.borderTopColor}`,
          color: s.color,
          height: el.getBoundingClientRect().height,
        };
      };
      const add = style("group-add-to-room");
      const edit = style("group-edit");
      return {
        add,
        edit,
        ok:
          Boolean(add && edit) &&
          add?.background === edit?.background &&
          add?.border === edit?.border &&
          add?.color === edit?.color,
      };
    });
    if (!light) await shot(page, `d8-group-${mode}`);

    // ── d7: kinds, the empty pane, another agent's home ──
    await go(page, "/artifacts?made=all");
    await expect(page.getByTestId("artifact-row-luca-tide")).toBeVisible({
      timeout: 15_000,
    });
    const kind = await page
      .getByTestId("artifact-row-luca-tide")
      .locator(".luca-place-row-summary")
      .innerText();
    await go(page, `/channels/${GENERAL}`);
    await expect(page.getByTestId("message-input")).toBeVisible();
    const agentHomes = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-shell-rail] .luca-rail-row[data-home-kind="agent"] .luca-rail-row-name',
        ),
      ].map((row) => row.textContent?.trim() ?? ""),
    );
    await page.getByTestId("workspace-layout-menu").click();
    await page.getByTestId("workspace-preset-columns-2").click();
    const pane = page.getByTestId("workspace-pane-slot-2");
    await expect(pane).toBeVisible();
    const paneWords = (await pane.innerText()).trim();
    await page.getByTestId("workspace-layout-menu").first().click();
    await page.getByTestId("workspace-preset-single").click();
    out.d7 = {
      kind,
      pane_words: paneWords,
      agent_homes: agentHomes,
      ok:
        kind.startsWith("Image ·") &&
        !/artifact/i.test(kind) &&
        paneWords === "Choose a conversation from the rail" &&
        agentHomes.includes("alice") &&
        !agentHomes.includes("alice-tyler"),
    };

    // ── d4: New conversation's To: on the reading column ──
    await go(page, "/messages/new");
    await expect(page.getByTestId("new-message-to-field")).toBeVisible();
    await page.mouse.move(1400, 880);
    await settle(page);
    out.d4 = await readNewMessage(page);
    await shot(page, `d4-new-1440-${mode}`);
    checks[`1440-${mode}`] = out;
    record(`1440-${mode}`, out);
  });
}

async function readNewMessage(page: Page) {
  // Closed: the band and the field at rest. Then open, the list's foot
  // against the message box.
  await page.getByTestId("new-dm-search").blur();
  await page.waitForTimeout(250);
  const rest = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '[data-testid="new-message-header"]',
    );
    const field = document.querySelector<HTMLElement>(
      '[data-testid="new-message-to-field"]',
    );
    const to = field?.querySelector("span");
    const box = document.querySelector<HTMLElement>(
      '[data-testid="message-composer"]',
    );
    const hs = header ? getComputedStyle(header) : null;
    const fs = field ? getComputedStyle(field) : null;
    return {
      header_border_bottom: hs?.borderBottomWidth,
      header_background: hs?.backgroundColor,
      header_backdrop: hs?.backdropFilter,
      field_border: fs ? `${fs.borderTopWidth} ${fs.borderTopColor}` : null,
      to_left: to ? Math.round(to.getBoundingClientRect().left) : null,
      box_left: box ? Math.round(box.getBoundingClientRect().left) : null,
      box_top: box ? Math.round(box.getBoundingClientRect().top) : null,
    };
  });
  await page.getByTestId("new-dm-search").focus();
  await expect(page.getByTestId("new-dm-results")).toBeVisible({
    timeout: 10_000,
  });
  await settle(page);
  const open = await page.evaluate(() => {
    const field = document.querySelector<HTMLElement>(
      '[data-testid="new-message-to-field"]',
    );
    const list = document.querySelector<HTMLElement>(
      '[data-testid="new-message-recipient-popover"]',
    );
    const box = document.querySelector<HTMLElement>(
      '[data-testid="message-composer"]',
    );
    const fs = field ? getComputedStyle(field) : null;
    return {
      field_border_focused: fs
        ? `${fs.borderTopWidth} ${fs.borderTopColor}`
        : null,
      field_background_focused: fs?.backgroundColor,
      list_bottom: list
        ? Math.round(list.getBoundingClientRect().bottom)
        : null,
      box_top: box ? Math.round(box.getBoundingClientRect().top) : null,
      list_left: list ? Math.round(list.getBoundingClientRect().left) : null,
      list_right: list ? Math.round(list.getBoundingClientRect().right) : null,
      box_left: box ? Math.round(box.getBoundingClientRect().left) : null,
      box_right: box ? Math.round(box.getBoundingClientRect().right) : null,
    };
  });
  const noBorder = (value: string | null | undefined) =>
    !value || value.startsWith("0px") || /rgba\(.*, 0\)$/.test(value);
  return {
    rest,
    open,
    ok:
      rest.header_border_bottom === "0px" &&
      rest.header_backdrop === "none" &&
      /rgba\(0, 0, 0, 0\)/.test(rest.header_background ?? "") &&
      noBorder(rest.field_border) &&
      noBorder(open.field_border_focused) &&
      rest.to_left !== null &&
      rest.box_left !== null &&
      Math.abs(rest.to_left - rest.box_left) <= 8 &&
      open.list_bottom !== null &&
      open.box_top !== null &&
      open.list_bottom < open.box_top &&
      open.list_left !== null &&
      open.box_left !== null &&
      Math.abs(open.list_left - open.box_left) <= 1 &&
      (open.list_right ?? 0) <= (open.box_right ?? 0) + 1,
  };
}

for (const light of [false, true]) {
  const mode = light ? "light" : "dark";
  test(`one voice, 800 ${mode}`, async ({ page }) => {
    await boot(page, {
      hash: "/messages/new",
      light,
      ready: "new-message-to-field",
      size: { width: 800, height: 500 },
    });
    await settle(page);
    const out: Record<string, unknown> = {};
    out.d4 = await readNewMessage(page);
    await shot(page, `d4-new-800-${mode}`);
    await go(page, "/artifacts?made=all");
    out.d5_lip = await lip(page);
    await go(page, `/pulse?record=${LUCA}`);
    await expect(page.getByTestId("provenance-time").first()).toBeVisible({
      timeout: 20_000,
    });
    out.d5_record_lip = await lip(page);
    out.d1_time = (
      await page.getByTestId("provenance-time").first().innerText()
    ).trim();
    out.scroll = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    checks[`800-${mode}`] = out;
    record(`800-${mode}`, out);
  });
}

// ── flag off: the views this package touches, as on the base build ─────
test("flag off: the same as the base build", async ({ browser }) => {
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, "base build unreachable");
  const views: {
    name: string;
    hash: string;
    ready: string;
    size?: { width: number; height: number };
    light?: boolean;
    act?: (page: Page) => Promise<void>;
  }[] = [
    {
      name: "conversation",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
    },
    {
      name: "details",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      act: async (page) => {
        await page
          .getByRole("button", { name: /conversation details/i })
          .first()
          .click();
        await page.waitForTimeout(800);
      },
    },
    {
      name: "panes",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      act: async (page) => {
        const menu = page.getByTestId("workspace-layout-menu");
        if (await menu.count()) {
          await menu.first().click();
          await page.getByTestId("workspace-preset-columns-2").click();
          await page.waitForTimeout(600);
        }
      },
    },
    { name: "new", hash: "/messages/new", ready: "new-message-to-field" },
    {
      name: "new-800",
      hash: "/messages/new",
      ready: "new-message-to-field",
      size: { width: 800, height: 500 },
    },
    { name: "library", hash: "/artifacts", ready: "app-sidebar" },
    {
      name: "record",
      hash: "/pulse",
      ready: "owner-activity-view",
      act: async (page) => {
        await page.getByTestId("activity-section-record").click();
        await page.waitForTimeout(1200);
      },
    },
    { name: "agents", hash: "/agents", ready: "app-sidebar" },
    {
      name: "paper-conversation",
      hash: `/channels/${GENERAL}`,
      ready: "message-input",
      light: true,
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
        origin,
        ready: view.ready,
        size: view.size ?? { width: 1440, height: 900 },
      });
      await page.waitForTimeout(1500);
      if (view.act) await view.act(page);
      await page.mouse.move(0, 0);
      const file = await shot(
        page,
        `flagoff-${view.name}-${origin ? "base" : "here"}`,
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
