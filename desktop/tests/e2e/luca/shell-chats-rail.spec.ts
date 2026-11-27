import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { chooseRailAgents } from "../../helpers/railAgents";

/**
 * WP-11, the Chats rail (docs/luca/rail-system/SHELL_BUILD.md; SPEC.md as
 * amended 2026-10-25), as WP-34 settled it (BETA14_RELEASE.md): its heading
 * and +, Luca, Projects (the loose rooms after the projects, Browse rooms…
 * and Archived closing it), Agents and Apps; one home per chat by what it
 * is, an agent's latest three with their times, "N more", where the app
 * opens, and a room's Manage. Only work hangs on the thread: Luca nests
 * nothing, a project's rooms sit under it on no thread (Riley, 2026-10-27),
 * and a person's 1:1 is found in Search. Screenshots land in WP11_SHOTS when
 * set.
 * SHELL_BASE_URL is the base build for the flag-off comparison (default
 * http://127.0.0.1:4300); unreachable, it is reported as not run.
 */

const SHOTS = process.env.WP11_SHOTS ?? "test-results/shell-chats-rail";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const OWNER = "deadbeef".repeat(8);
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const CODEX = "d".repeat(64);
/** In the stock fixture Alice is an agent (her profile says so) and Bob a
 *  person; the group dm (bob, charlie) has no name of its own. */
const BOB = "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260";
const ALICE_DM = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const BOB_DM = "7eb9f239-9393-50b0-bd76-d85eef0511c7";
const STOCK_GROUP = "d1ec7000-d000-4000-8000-000000000003";
const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

/** Rooms with fixed ids, so projects can be assigned before they exist. */
const ROOM = {
  landing: "0e6b0000-0000-4000-8000-000000000001",
  chapter: "0e6b0000-0000-4000-8000-000000000002",
  hero: "0e6b0000-0000-4000-8000-000000000003",
  press: "0e6b0000-0000-4000-8000-000000000004",
  monday: "0e6b0000-0000-4000-8000-000000000005",
  tides: "0e6b0000-0000-4000-8000-000000000006",
  review: "0e6b0000-0000-4000-8000-000000000007",
  watch: "0e6b0000-0000-4000-8000-000000000008",
  scratch: "0e6b0000-0000-4000-8000-000000000009",
  weekly: "0e6b0000-0000-4000-8000-00000000000a",
  old: "0e6b0000-0000-4000-8000-00000000000b",
  chart: "0e6b0000-0000-4000-8000-00000000000c",
  notes: "0e6b0000-0000-4000-8000-00000000000d",
};

/** Two more sessions of Wren's, so Wren shows three and "1 more" (only work
 *  nests since WP-34: an agent is where "N more" lives now). */
async function moreWrenSessions(page: Page) {
  await page.evaluate(
    async ({ wren, owner, chart, notes }) => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!invoke || !emit) throw new Error("Expected the mock bridge.");
      const now = Math.floor(Date.now() / 1000);
      for (const [id, name, ago] of [
        [chart, "Tide chart", 26 * 60 * 60],
        [notes, "Old notes", 21 * 24 * 60 * 60],
      ] as const) {
        const real = crypto.randomUUID.bind(crypto);
        let spent = false;
        Object.defineProperty(crypto, "randomUUID", {
          configurable: true,
          writable: true,
          value: () => {
            if (spent) return real();
            spent = true;
            return id;
          },
        });
        try {
          await invoke("create_channel", {
            channelType: "stream",
            description: "",
            name,
            visibility: "private",
          });
        } finally {
          Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            writable: true,
            value: real,
          });
        }
        await invoke("add_channel_members", {
          channelId: id,
          pubkeys: [wren],
          role: "bot",
        });
        emit({
          channelId: id,
          content: `${name}: notes.`,
          createdAt: now - ago,
          pubkey: owner,
        });
      }
      await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
    },
    { wren: WREN, owner: OWNER, chart: ROOM.chart, notes: ROOM.notes },
  );
  await expect(page.getByTestId(`rail-more-agent:${WREN}`)).toBeVisible({
    timeout: 20_000,
  });
}

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const checks: Record<string, unknown> = {};
const shots: string[] = [];

async function boot(
  page: Page,
  {
    shell,
    light = false,
    atlasError,
  }: { shell: boolean; light?: boolean; atlasError?: string },
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
  if (light) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-theme", "paper");
    });
  }
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
        status: "running",
        ...(atlasError ? { lastError: atlasError } : {}),
      },
      { name: "Wren", pubkey: WREN, status: "running" },
      { name: "Codex", pubkey: CODEX, status: "running" },
    ],
  });
  await chooseRailAgents(page);
  // Boot on a conversation, so the rail is Chats' (/pulse is Activity's
  // place now: NAVIGATION.md). Bob's 1:1 is in every scene, and the bare
  // /#/ route keeps Back clean. Retry a blank first load: the machine runs
  // several builds at once.
  await expect(async () => {
    await page.goto(`/#/channels/${BOB_DM}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

/**
 * The scene WP-11 names: a person's 1:1 (Bob); a group conversation with a
 * name (Design review) and without (Luca + Wren, and the stock bob +
 * charlie); an open room and a private room outside any project; an agent's
 * sessions (Wren's, Luca's); a project with four rooms; an archived room;
 * activity from minutes to weeks ago. Returns the dms' ids.
 */
async function seedScene(page: Page, { lucaUnread = false } = {}) {
  return page.evaluate(
    async ({ ids, owner, luca, atlas, wren, keep, lucaUnread }) => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!invoke || !emit) throw new Error("Expected the mock bridge.");
      // The stock fixture's rooms leave, except the ones the scene keeps.
      const rows = (await invoke("get_channels")) as Array<{
        id: string;
        is_member: boolean;
      }>;
      for (const row of rows) {
        if (!row.is_member || keep.includes(row.id)) continue;
        window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
          channelId: row.id,
          removeMemberPubkey: owner,
        });
      }
      const now = Math.floor(Date.now() / 1000);
      const MIN = 60;
      const say = (
        channelId: string,
        pubkey: string,
        content: string,
        ago: number,
      ) => emit({ channelId, content, createdAt: now - ago, pubkey });
      const pinned = async (uuid: string, run: () => Promise<unknown>) => {
        const real = crypto.randomUUID.bind(crypto);
        let spent = false;
        Object.defineProperty(crypto, "randomUUID", {
          configurable: true,
          writable: true,
          value: () => {
            if (spent) return real();
            spent = true;
            return uuid;
          },
        });
        try {
          return await run();
        } finally {
          Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            writable: true,
            value: real,
          });
        }
      };
      const room = async (
        id: string,
        name: string,
        members: string[],
        ago: number,
        visibility: "open" | "private" = "private",
      ) => {
        await pinned(id, () =>
          invoke("create_channel", {
            channelType: "stream",
            description: "",
            name,
            visibility,
          }),
        );
        if (members.length > 0)
          await invoke("add_channel_members", {
            channelId: id,
            pubkeys: members,
            role: "bot",
          });
        // The owner's own words: read.
        say(id, owner, `${name}: notes.`, ago);
      };
      const dm = async (pubkeys: string[], text: string, ago: number) => {
        const channel = (await invoke("open_dm", { pubkeys })) as {
          id: string;
        };
        say(channel.id, owner, text, ago);
        return channel.id;
      };

      // Tidepool: four rooms, so it shows three and "1 more".
      await room(ids.landing, "Landing page copy", [wren], 2 * 60 * MIN);
      await room(ids.chapter, "Chapter nine", [atlas], 26 * 60 * MIN);
      await room(ids.hero, "Hero image", [atlas], 3 * 24 * 60 * MIN);
      await room(ids.press, "Press kit", [wren], 15 * 24 * 60 * MIN);
      // Agent sessions: private rooms with one agent.
      await room(ids.monday, "Monday plan", [wren], 3 * 60 * MIN);
      await room(ids.tides, "The tide tables", [wren], 2 * 24 * 60 * MIN);
      await room(ids.weekly, "Weekly review", [luca], 5 * MIN);
      // Rooms: a named group, an open room, a private room with no one yet.
      await room(ids.review, "Design review", [atlas, wren], 40 * MIN);
      await room(ids.watch, "Tide watch", [wren], 9 * 24 * 60 * MIN, "open");
      await room(ids.scratch, "Scratch", [], 20 * 24 * 60 * MIN);
      // An archived room: in the browser's Archived tab, never in the rail.
      await room(ids.old, "Old launch", [atlas], 30 * 24 * 60 * MIN);
      await invoke("archive_channel", { channelId: ids.old });
      // 1:1s, and an unnamed group of Luca and Wren.
      const atlasDm = await dm(
        [atlas],
        "The release notes?",
        7 * 24 * 60 * MIN,
      );
      const wrenDm = await dm([wren], "Morning, Wren.", 4 * 60 * MIN);
      const groupDm = await dm(
        [luca, wren],
        "Wren and I looked.",
        6 * 60 * MIN,
      );
      const lucaDm = await dm([luca], "Morning, Luca.", 30 * MIN);
      say(keep[1], owner, "See you Saturday.", 26 * 60 * MIN); // Bob
      say(keep[0], owner, "Thanks, Alice.", 4 * 24 * 60 * MIN); // Alice
      say(keep[2], owner, "Both of you, Friday.", 12 * 24 * 60 * MIN);
      if (lucaUnread) say(lucaDm, luca, "Two things came in overnight.", 60);

      // Projects: Tidepool (four rooms) and Field guide (none).
      const community = (
        JSON.parse(window.localStorage.getItem("buzz-communities") ?? "[]") as {
          pubkey: string;
          relayUrl: string;
        }[]
      )[0];
      if (!community) throw new Error("Expected the seeded community.");
      const scope = (value: string) =>
        encodeURIComponent(value.trim().toLowerCase());
      window.localStorage.setItem(
        `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
        JSON.stringify({
          version: 1,
          projects: [
            { id: "tidepool", label: "Tidepool" },
            { id: "field-guide", label: "Field guide" },
          ],
          assignments: {
            [ids.landing]: "tidepool",
            [ids.chapter]: "tidepool",
            [ids.hero]: "tidepool",
            [ids.press]: "tidepool",
          },
        }),
      );
      window.dispatchEvent(new Event("luca:room-projects-changed"));
      await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
      return { atlasDm, wrenDm, groupDm, lucaDm };
    },
    {
      ids: ROOM,
      owner: OWNER,
      luca: LUCA,
      atlas: ATLAS,
      wren: WREN,
      keep: [ALICE_DM, BOB_DM, STOCK_GROUP],
      lucaUnread,
    },
  );
}

async function shoot(
  page: Page,
  name: string,
  target?: Locator,
  { keepPointer = false } = {},
) {
  if (!keepPointer) await page.mouse.move(1400, 880);
  await waitForAnimations(page);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await (target ?? page.getByTestId("app-sidebar")).screenshot({ path });
  shots.push(path);
  return path;
}

const ON_NAME = { position: { x: 14, y: 15 } };
const home = (page: Page, id: string) =>
  page.locator(`[data-testid="rail-home-${id}"]`);
const hit = (page: Page, id: string) =>
  home(page, id).locator('[data-rail-focus="home"]');
const session = (page: Page, channelId: string) =>
  page.getByTestId(`rail-session-${channelId}`);
const goChannel = (page: Page, id: string) =>
  page.evaluate((target) => {
    window.location.hash = `#/channels/${target}`;
  }, id);

/** The rail as read: headings, homes with what nests under them. */
async function readRail(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector("[data-shell-rail]");
    if (!rail) return null;
    const out: Array<Record<string, unknown>> = [];
    for (const el of rail.querySelectorAll<HTMLElement>(
      ".luca-rail-section-head, [data-home-group], .luca-rail-tail",
    )) {
      if (el.classList.contains("luca-rail-section-head")) {
        out.push({
          heading: el.querySelector("span")?.textContent?.trim(),
          plus: el.querySelector("button")?.getAttribute("aria-label") ?? null,
        });
      } else if (el.classList.contains("luca-rail-tail")) {
        out.push({ tail: el.textContent?.trim() });
      } else {
        const row = el.querySelector<HTMLElement>("[data-home]");
        const fieldset = el.querySelector("fieldset");
        out.push({
          home: row?.querySelector(".luca-rail-row-name")?.textContent?.trim(),
          kind: row?.dataset.homeKind,
          channel: row?.dataset.channelId ?? null,
          expanded:
            row
              ?.querySelector("[data-rail-focus=home]")
              ?.getAttribute("aria-expanded") ?? null,
          sessions: fieldset?.hidden
            ? []
            : [
                ...el.querySelectorAll<HTMLElement>(
                  "fieldset [data-rail-focus=session]",
                ),
              ].map((s) => ({
                title:
                  s.querySelector(".luca-rail-session-title")?.textContent ??
                  s.textContent?.trim(),
                channel: s.dataset.channelId ?? null,
                ago:
                  s.querySelector(".luca-rail-session-ago")?.textContent ??
                  null,
              })),
        });
      }
    }
    return out;
  });
}

test.describe("the Chats rail", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await expect(home(page, "luca")).toBeVisible();
    await expect(home(page, `room:${ROOM.review}`)).toBeVisible();
  });

  test("top to bottom: the heading, the sections, one home per chat", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    const rail = await readRail(page);
    checks.rail = rail;
    const headings = (rail ?? []).filter((each) => "heading" in each);
    // WP-34, Decided 1: People and Rooms go as sections; Apps comes in.
    expect(headings).toEqual([
      { heading: "Chats", plus: "Message Luca" },
      { heading: "Projects", plus: "New project" },
      // Agents offers Browse agents since 468075227 (the rail shows the chosen).
      { heading: "Agents", plus: "Browse agents" },
      { heading: "Apps", plus: "Connect an app" },
    ]);
    checks.heading_plus = headings[0];
    checks.sections_order = headings.map((each) => each.heading);
    expect(page.getByTestId("rail-section-fleet")).toHaveCount(0);
    checks.fleets_gone =
      (await page.getByTestId("rail-section-fleet").count()) === 0 &&
      !(await page.locator("[data-shell-rail]").innerText()).includes("Fleet");

    // Luca first, under no heading.
    const homes = (rail ?? []).filter((each) => "home" in each);
    expect(homes[0]).toMatchObject({ home: "Luca", kind: "luca" });
    expect((rail ?? [])[1]).toMatchObject({ home: "Luca" });

    // Every chat once.
    const placed = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-shell-rail] [data-home][data-channel-id], [data-shell-rail] [data-rail-focus=session][data-channel-id]",
        ),
      ].map((el) => el.dataset.channelId),
    );
    const dupes = placed.filter((id, index) => placed.indexOf(id) !== index);
    checks.one_home_per_chat = {
      rows_with_a_chat: placed.length,
      duplicates: dupes,
    };
    expect(dupes).toEqual([]);

    // A person's 1:1 (Bob's) leaves the rail by Riley's decision (WP-34,
    // Decided 1), found in Search; Alice is an agent by her profile.
    const people = homes.filter((each) => each.kind === "person");
    const agents = homes.filter((each) => each.kind === "agent");
    checks.people = {
      people: people.map((each) => [each.home, each.channel]),
      agents: agents.map((each) => each.home),
    };
    expect(people).toEqual([]);
    await expect(
      page.locator(`[data-shell-rail] [data-channel-id="${BOB_DM}"]`),
    ).toHaveCount(0);
    // This Mac's agents by name, then any other agent, named by the agent's
    // profile name, not the conversation's title "alice-tyler" (WP-19,
    // Decided 7).
    expect(agents.map((each) => each.home)).toEqual([
      "Atlas",
      "Codex",
      "Wren",
      "alice",
    ]);
    // Rooms, by their own names; unnamed groups by their members.
    const rooms = homes.filter((each) => each.kind === "room");
    checks.rooms_named = rooms.map((each) => each.home);
    expect(rooms.map((each) => each.home)).toEqual([
      "Design review",
      "Luca + Wren",
      "Tide watch",
      "bob-tyler + charlie",
      "Scratch",
    ]);
    // The loose rooms follow the projects; Projects ends on the two ways
    // in, and Agents follows.
    const browse = (rail ?? []).findIndex(
      (each) => each.tail === "Browse rooms…",
    );
    expect((rail ?? []).slice(browse, browse + 3)).toEqual([
      { tail: "Browse rooms…" },
      { tail: "Archived" },
      { heading: "Agents", plus: "Browse agents" },
    ]);
    const projectsAt = (rail ?? []).findIndex(
      (each) => each.heading === "Projects",
    );
    expect(
      (rail ?? [])
        .slice(projectsAt, browse)
        .filter((each) => each.kind === "room").length,
    ).toBe(rooms.length);
    // The archived room is nowhere in the rail.
    await expect(session(page, ROOM.old)).toHaveCount(0);
    await expect(home(page, `room:${ROOM.old}`)).toHaveCount(0);

    await shoot(page, "chats-rail");
    await page
      .locator('[data-sidebar="content"]')
      .first()
      .evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    await shoot(page, "chats-rail-end");
  });

  test("an agent shows its latest three with their times, then N more", async ({
    page,
  }) => {
    await moreWrenSessions(page);
    await goChannel(page, ROOM.review);
    const wrenGroup = home(page, `agent:${WREN}`).locator("..");
    const rail = await readRail(page);
    const wren = (rail ?? []).find((each) => each.home === "Wren") as {
      sessions: { title: string; ago: string | null }[];
      expanded: string | null;
    };
    // Homes start open.
    expect(wren.expanded).toBe("true");
    expect(wren.sessions.map((each) => each.title)).toEqual([
      "Monday plan",
      "Tide chart",
      "The tide tables",
      "1 more",
    ]);
    const more = page.getByTestId(`rail-more-agent:${WREN}`);
    await expect(more).toHaveText("1 more");
    checks.latest_three = wren.sessions.map((each) => each.title);
    // Times, newest first: hours to weeks.
    const times = (rail ?? []).flatMap((each) =>
      ((each.sessions as { title: string; ago: string | null }[]) ?? []).map(
        (s) => [s.title, s.ago],
      ),
    );
    checks.times = times;
    expect(wren.sessions.slice(0, 3).map((each) => each.ago)).toEqual([
      "3h",
      "1d",
      "2d",
    ]);
    // Luca is one chat (WP-34, Decided 3). A project's rooms sit under it,
    // its latest three with their times and "1 more", as before WP-34
    // (Riley, 2026-10-27).
    const luca = (rail ?? []).find((each) => each.home === "Luca") as {
      sessions: unknown[];
      expanded: string | null;
    };
    expect(luca.sessions).toEqual([]);
    expect(luca.expanded).toBeNull();
    const tide = (rail ?? []).find((each) => each.home === "Tidepool") as {
      sessions: { title: string; ago: string | null }[];
      expanded: string | null;
    };
    expect(tide.expanded).toBe("true");
    expect(tide.sessions.map((each) => each.title)).toEqual([
      "Landing page copy",
      "Chapter nine",
      "Hero image",
      "1 more",
    ]);
    expect(tide.sessions.slice(0, 3).map((each) => each.ago)).toEqual([
      "2h",
      "1d",
      "3d",
    ]);
    await expect(session(page, ROOM.weekly)).toHaveCount(0);
    await shoot(page, "home-more", wrenGroup);

    // "1 more" shows the rest, by keyboard too: the focus moves onto the
    // first of them.
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveCount(0);
    await expect(session(page, ROOM.notes)).toBeFocused();
    await expect(session(page, ROOM.notes)).toContainText("3w");
    checks.more_row = {
      label: "1 more",
      after: await wrenGroup
        .locator("fieldset [data-rail-focus=session]")
        .allInnerTexts(),
      focus_moved_to: ROOM.notes,
    };
    await shoot(page, "home-more-open", wrenGroup);
  });

  test("the open conversation is always visible", async ({ page }) => {
    // The oldest of Wren's four: shown after the latest three.
    await moreWrenSessions(page);
    await goChannel(page, ROOM.notes);
    await expect(session(page, ROOM.notes)).toHaveAttribute(
      "data-current",
      "true",
    );
    const titles = await home(page, `agent:${WREN}`)
      .locator("..")
      .locator("fieldset [data-rail-focus=session]")
      .allInnerTexts();
    checks.open_always_visible = { opened: "Old notes", rows: titles };
    expect(titles.map((each) => each.split("\n")[0])).toEqual([
      "Monday plan",
      "Tide chart",
      "The tide tables",
      "Old notes",
    ]);
    await expect(home(page, `agent:${WREN}`).locator("..")).not.toContainText(
      "more",
    );
    await shoot(page, "open-always-visible");
  });

  test("hover and keyboard show the +; the heading's + is Luca", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    const wren = home(page, `agent:${WREN}`);
    await wren.hover();
    // WP-34, Decided 5: a conversation of your own with the agent.
    const plus = wren.getByRole("button", {
      name: "New conversation with Wren",
    });
    await expect(plus).toHaveCSS("opacity", "1");
    // The slot holds the + alone: no time or dot beside it.
    checks.hover_slot = await wren.evaluate((row) => ({
      plus_opacity: getComputedStyle(
        row.querySelector(".luca-rail-row-add") as Element,
      ).opacity,
      signal_visible: row.querySelector(".luca-rail-signal")
        ? getComputedStyle(row.querySelector(".luca-rail-signal") as Element)
            .visibility
        : "none",
    }));
    await shoot(page, "hover-plus", wren.locator(".."), { keepPointer: true });
    // A room is itself, and Luca is one chat: neither has a +.
    const room = home(page, `room:${ROOM.review}`);
    await room.hover();
    await expect(room.locator(".luca-rail-row-add")).toHaveCount(0);
    await expect(home(page, "luca").locator(".luca-rail-row-add")).toHaveCount(
      0,
    );
    // Focus: Tab from Wren's row reaches its +.
    await page.mouse.move(1400, 880);
    await hit(page, `agent:${WREN}`).focus();
    await page.keyboard.press("Tab");
    await expect(plus).toBeFocused();
    await shoot(page, "focus-plus", wren.locator(".."), {
      keepPointer: true,
    });

    // The heading's +: Luca's one chat (WP-34, Decided 5); ⌘N stays New
    // conversation.
    await page.getByTestId("rail-message-luca").click();
    await expect(home(page, "luca")).toHaveAttribute("data-active", "true", {
      timeout: 20_000,
    });
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Meta+n");
    await expect(page).toHaveURL(/#\/messages\/new/);
    // Rooms' + went with Rooms: a room outside any project starts from the
    // room browser's own "Start a room".
    await expect(page.getByTestId("create-room")).toHaveCount(0);
    await page.getByTestId("rail-browse-rooms").click();
    await expect(
      page.getByRole("dialog").getByTestId("channel-browser-create-row"),
    ).toBeVisible({ timeout: 20_000 });
    checks.heading_plus = {
      ...(checks.heading_plus as object),
      opens: "Luca",
      meta_n: "#/messages/new",
      new_room: "Browse rooms… → Start a room",
    };
  });

  test("Browse rooms… and Archived open the room browser on their tabs", async ({
    page,
  }) => {
    await page.getByTestId("rail-browse-rooms").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const tab = (name: string) => dialog.getByRole("tab", { name });
    await expect(tab("All")).toHaveAttribute("aria-selected", "true");
    await shoot(page, "browse", page.locator("body"));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("rail-archived-rooms").click();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(tab("Archived")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByText("Old launch")).toBeVisible();
    await shoot(page, "archived", page.locator("body"));
    checks.browse_and_archived = {
      browse_tab: "All",
      archived_tab: "Archived",
      archived_lists: await dialog
        .getByRole("option")
        .allInnerTexts()
        .catch(() => []),
    };
    // Closing and opening again from Browse rooms… is on All again.
    await page.keyboard.press("Escape");
    await page.getByTestId("rail-browse-rooms").click();
    await expect(tab("All")).toHaveAttribute("aria-selected", "true");
  });

  test("a room's details have Manage; a direct conversation's do not", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.getByTestId("shell-lip-details").click();
    const panel = page.getByTestId("conversation-context-panel");
    await expect(panel).toBeVisible();
    const manage = page.getByTestId("conversation-manage-room");
    await expect(manage).toBeVisible();
    await expect(manage).toHaveText("Room settings…");
    await shoot(page, "manage-details", page.locator("body"));
    await manage.click();
    const management = page.getByTestId("channel-management-auxiliary-pane");
    await expect(management).toBeVisible();
    await shoot(page, "manage", page.locator("body"));
    checks.manage = {
      room_has_manage: true,
      opens: "channel-management-auxiliary-pane",
      panel_text: (await management.innerText()).slice(0, 240),
    };
    // A direct conversation's details: no Manage. (A person's 1:1 has no
    // row in the rail since WP-34: it opens by its address or Search.)
    await goChannel(page, BOB_DM);
    await expect(page).toHaveURL(new RegExp(BOB_DM), { timeout: 20_000 });
    await page.waitForTimeout(800);
    await expect(
      page.locator('[data-shell-rail] [data-home][data-active="true"]'),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    const details = page.getByTestId("shell-lip-details");
    if (!(await panel.isVisible().catch(() => false))) await details.click();
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("conversation-manage-room")).toHaveCount(0);
    (checks.manage as Record<string, unknown>).dm_has_manage = false;
  });

  test("the keyboard moves through every row, rooms, apps and N more", async ({
    page,
  }) => {
    await moreWrenSessions(page);
    await goChannel(page, ROOM.review);
    await hit(page, "luca").focus();
    const order: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()
          : "";
      });
      if (order.at(-1) === label) break;
      order.push(label);
      await page.keyboard.press("ArrowDown");
    }
    checks.keyboard = { down: order };
    expect(order[0]).toBe("Luca");
    expect(order).toContain("Show 1 more in Wren");
    expect(order).toContain("Design review");
    const browse = order.indexOf("Browse rooms…");
    expect(order[browse + 1]).toBe("Archived");
    expect(order).toContain("Claude Code");
    expect(order.indexOf("Claude Code")).toBeGreaterThan(browse);
    // Left from a session returns to its home; Left on an open home closes
    // it; Right opens it again.
    await session(page, ROOM.tides).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(hit(page, `agent:${WREN}`)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(hit(page, `agent:${WREN}`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press("ArrowRight");
    await expect(hit(page, `agent:${WREN}`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Enter on a room's row opens it.
    await hit(page, `room:${ROOM.scratch}`).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(ROOM.scratch));
    // A closed home stays closed after a reload of the rail.
    await hit(page, `agent:${WREN}`).focus();
    await page.keyboard.press("ArrowLeft");
    await page.reload();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    // Mock channels live in page memory, unlike the real relay. Restore the
    // scene after reload so this checks the saved fold, not an empty home.
    await seedScene(page);
    await expect(hit(page, `agent:${WREN}`)).toHaveAttribute(
      "aria-expanded",
      "false",
      { timeout: 20_000 },
    );
    (checks.keyboard as Record<string, unknown>).left_right_enter = true;
  });

  test("at 800 × 500 the rail keeps its sections", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await shoot(page, "chats-rail-800");
    await page.setViewportSize({ width: 1440, height: 900 });
    // The study's values, measured the same way (shellStudy.css).
    checks.measures = await page.evaluate(() => {
      const pick = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          h: r.height,
          w: r.width,
          fs: cs.fontSize,
          color: cs.color,
          pad: cs.padding,
          ls: cs.letterSpacing,
          tnum: cs.fontVariantNumeric,
        };
      };
      return {
        head: pick("[data-shell-rail] .luca-rail-head"),
        section_head: pick(
          "[data-shell-rail] .luca-rail-section .luca-rail-section-head",
        ),
        row: pick("[data-shell-rail] .luca-rail-row"),
        name: pick("[data-shell-rail] .luca-rail-row-name"),
        session: pick(
          "[data-shell-rail] .luca-rail-session:not(.luca-rail-session-more)",
        ),
        ago: pick("[data-shell-rail] .luca-rail-session-ago"),
        more: pick("[data-shell-rail] .luca-rail-session-more"),
        tail: pick("[data-shell-rail] .luca-rail-tail"),
        head_to_luca:
          (document
            .querySelector('[data-testid="rail-home-luca"]')
            ?.getBoundingClientRect().top ?? 0) -
          (document
            .querySelector("[data-shell-rail] .luca-rail-head")
            ?.getBoundingClientRect().bottom ?? 0),
      };
    });
    const box = await page.locator("[data-shell-rail]").boundingBox();
    checks.narrow = { rail: box };
  });
});

test.describe("where the app opens", () => {
  test("Luca, when Luca's conversation has something unread", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    const { lucaDm } = await seedScene(page, { lucaUnread: true });
    // The conversation you left was another one.
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(home(page, "luca").locator(".luca-rail-dot")).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await expect(page).toHaveURL(new RegExp(`channels/${lucaDm}`), {
      timeout: 20_000,
    });
    await shoot(page, "landing-unread", page.locator("body"));
    checks.landing = { unread_luca: `channels/${lucaDm}` };
  });

  test("else the conversation you left; else Luca; never New conversation", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    const { lucaDm } = await seedScene(page);
    // Opened from the rail, so the app remembers it (goChannel writes it).
    await hit(page, `room:${ROOM.review}`).click(ON_NAME);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await expect(page).toHaveURL(new RegExp(`channels/${ROOM.review}`), {
      timeout: 20_000,
    });
    await shoot(page, "landing-last", page.locator("body"));
    // Nothing remembered: Luca.
    await page.evaluate(() => {
      window.localStorage.removeItem("luca:last-conversation.v1");
      window.location.hash = "#/";
    });
    await expect(page).toHaveURL(new RegExp(`channels/${lucaDm}`), {
      timeout: 20_000,
    });
    checks.landing = {
      ...(checks.landing as object),
      last: `channels/${ROOM.review}`,
      nothing_remembered: `channels/${lucaDm}`,
    };
  });
});

/** The review's twelve items (SHELL_BUILD.md WP-11, fix round). Shots in
 *  WP11_FIX_SHOTS when set. */
const FIX_SHOTS = process.env.WP11_FIX_SHOTS ?? `${SHOTS}/fix`;
const fixChecks: Record<string, unknown> = {};

async function fixShot(page: Page, name: string, target?: Locator) {
  await waitForAnimations(page);
  mkdirSync(FIX_SHOTS, { recursive: true });
  const path = `${FIX_SHOTS}/${name}.png`;
  await (target ?? page.getByTestId("app-sidebar")).screenshot({ path });
  return path;
}

/** Where a row sits in the rail's scroll view. */
const inView = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const row = document.querySelector<HTMLElement>(sel);
    const scroller = row?.closest<HTMLElement>('[data-sidebar="content"]');
    if (!row || !scroller) return null;
    const r = row.getBoundingClientRect();
    const v = scroller.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      rowTop: Math.round(r.top - v.top),
      rowBottom: Math.round(r.bottom - v.top),
      viewHeight: Math.round(v.height),
      clearOfFade: v.bottom - r.bottom >= 39 && r.top >= v.top,
    };
  }, selector);

test.describe("the review's fixes", () => {
  test("fix 1: the rail scrolls to what opens from outside it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await boot(page, { shell: true });
    await seedScene(page);
    await expect(home(page, "luca")).toBeVisible();
    const reviewRow = `[data-testid="rail-home-room:${ROOM.review}"]`;
    // Opened by its route: its row comes into view, clear of the fade.
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect
      .poll(() => inView(page, reviewRow).then((v) => v?.clearOfFade))
      .toBe(true);
    const byRoute = await inView(page, reviewRow);
    await fixShot(page, "fix1-by-route-800");
    // Back up to Luca by route: the rail scrolls up to its row (Luca nests
    // nothing since WP-34).
    await goChannel(page, ROOM.weekly);

    await expect
      .poll(() =>
        inView(page, '[data-testid="rail-home-luca"]').then(
          (v) => v?.rowTop ?? -1,
        ),
      )
      .toBeGreaterThanOrEqual(0);
    // A folded home: its row comes into view instead (an agent's: only
    // work nests).
    await hit(page, `agent:${WREN}`).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(session(page, ROOM.tides)).toHaveCount(0);
    const scroller = page.locator(
      '[data-testid="app-sidebar-scroll-anchor"] [data-sidebar="content"]',
    );
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await goChannel(page, ROOM.tides);
    const wrenRow = `[data-testid="rail-home-agent:${WREN}"]`;
    await expect
      .poll(() =>
        inView(page, wrenRow).then((v) =>
          v ? v.rowTop >= 0 && v.clearOfFade : false,
        ),
      )
      .toBe(true);
    const folded = await inView(page, wrenRow);
    await home(page, `agent:${WREN}`).locator("[data-chevron]").click();
    // The reveal's glide (320) settles before the rail is scrolled by hand.
    await page.waitForTimeout(600);
    // A click in the rail never scrolls it. The row is put in the middle
    // of the view first, so the click itself has nothing to scroll to.
    const wren = page.getByTestId(`rail-session-${ROOM.monday}`);
    await wren.evaluate((row) => row.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const before = await scroller.evaluate((el) => el.scrollTop);
    await wren.click();
    await expect(page.getByTestId("shell-lip-name")).toHaveText("Monday plan");
    await page.waitForTimeout(600);
    const after = await scroller.evaluate((el) => el.scrollTop);
    // Reduce Motion: there in the same frame, no glide.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    // A row below the view: Wren's session (the loose rooms sit near the
    // top since WP-34, already in view).
    await goChannel(page, ROOM.tides);
    await expect(session(page, ROOM.tides)).toHaveAttribute(
      "data-current",
      "true",
    );
    const reduced = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const el = document.querySelector<HTMLElement>(
            '[data-testid="app-sidebar-scroll-anchor"] [data-sidebar="content"]',
          );
          const tops: number[] = [];
          let frames = 0;
          const tick = () => {
            tops.push(el?.scrollTop ?? -1);
            if (++frames < 6) requestAnimationFrame(tick);
            else resolve(tops);
          };
          requestAnimationFrame(tick);
        }),
    );
    fixChecks.fix_1 = {
      by_route_800: byRoute,
      folded_home: folded,
      rail_click: { before, after, unchanged: before === after },
      reduce_motion_scrollTops: reduced,
      reduce_motion_instant: new Set(reduced).size === 1 && reduced[0] > 0,
    };
    expect(before).toBe(after);
    expect(new Set(reduced).size).toBe(1);
    expect(reduced[0]).toBeGreaterThan(0);
    await fixShot(page, "fix1-reduced-tides-800");
  });

  test("fix 2: a chat you just made comes first", async ({ page }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await expect(home(page, "luca")).toBeVisible();
    const made = "0e6b0000-0000-4000-8000-0000000000ff";
    await page.evaluate(async (id) => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      if (!invoke) throw new Error("Expected the mock bridge.");
      const real = crypto.randomUUID.bind(crypto);
      let spent = false;
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        writable: true,
        value: () => {
          if (spent) return real();
          spent = true;
          return id;
        },
      });
      try {
        await invoke("create_channel", {
          channelType: "stream",
          description: "",
          name: "Lunch club",
          visibility: "private",
        });
      } finally {
        Object.defineProperty(crypto, "randomUUID", {
          configurable: true,
          writable: true,
          value: real,
        });
      }
      await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
    }, made);
    await expect(home(page, `room:${made}`)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-shell-rail] [data-home-kind="room"]',
            ),
          ].map((row) => row.querySelector(".luca-rail-row-name")?.textContent),
        ),
      )
      .toEqual([
        "Lunch club",
        "Design review",
        "Luca + Wren",
        "Tide watch",
        "bob-tyler + charlie",
        "Scratch",
      ]);
    fixChecks.fix_2 = {
      rooms: await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-shell-rail] [data-home-kind="room"]',
          ),
        ].map((row) => row.querySelector(".luca-rail-row-name")?.textContent),
      ),
    };
    await fixShot(page, "fix2-made-first");
  });

  test("fixes 3, 9, 11: section gaps, focus air, one trailing edge", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await moreWrenSessions(page);
    await goChannel(page, ROOM.monday);
    await expect(session(page, ROOM.monday)).toHaveAttribute(
      "data-current",
      "true",
    );
    await page.mouse.move(1400, 880);
    await waitForAnimations(page);
    const m = await page.evaluate(() => {
      const card = document
        .querySelector('[data-frame] [data-sidebar="sidebar"]')
        ?.getBoundingClientRect();
      const left = card?.left ?? 0;
      const top = (sel: string) =>
        document.querySelector(sel)?.getBoundingClientRect().top ?? 0;
      const bottom = (sel: string) =>
        document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0;
      const right = (el: Element | null | undefined) =>
        el
          ? Math.round((el.getBoundingClientRect().right - left) * 100) / 100
          : null;
      const rail = document.querySelector("[data-shell-rail]");
      const current = document.querySelector<HTMLElement>(
        "[data-shell-rail] .luca-rail-session[data-current]",
      );
      const title = current?.querySelector(".luca-rail-session-title");
      const thread = current?.closest(".luca-rail-sessions");
      return {
        rail_display: rail ? getComputedStyle(rail).display : null,
        // Since WP-34 Luca nests nothing: the gap after a closed home is
        // Projects' after Luca; after the last row of a section, Agents'
        // after Archived.
        gap_after_open_home:
          top('[data-testid="rail-section-agent"] .luca-rail-section-head') -
          bottom('[data-testid="rail-archived-rooms"]'),
        gap_after_closed_home:
          top('[data-testid="rail-section-project"] .luca-rail-section-head') -
          bottom('[data-home-group="luca"]'),
        session_padding_left: current
          ? getComputedStyle(current).paddingLeft
          : null,
        sessions_padding_left: thread
          ? getComputedStyle(thread).paddingLeft
          : null,
        title_x: title
          ? Math.round(title.getBoundingClientRect().left - left)
          : null,
        thread_x: thread
          ? Math.round(thread.getBoundingClientRect().left - left)
          : null,
        // The open row brightens its words and nothing else (WP-34,
        // Decided 4): its stretch of the thread is the thread's own ink.
        lit_segment_color: current
          ? getComputedStyle(current, "::before").borderLeftColor
          : null,
        thread_color: document.querySelector(
          "[data-shell-rail] .luca-rail-session:not([data-current]):not(.luca-rail-session-more)",
        )
          ? getComputedStyle(
              document.querySelector(
                "[data-shell-rail] .luca-rail-session:not([data-current]):not(.luca-rail-session-more)",
              ) as Element,
              "::before",
            ).borderLeftColor
          : null,
        title_from_thread:
          title && thread
            ? Math.round(
                (title.getBoundingClientRect().left -
                  thread.getBoundingClientRect().left) *
                  100,
              ) / 100
            : null,
        trailing: {
          heading_plus_glyph: right(
            document.querySelector('[data-testid="rail-message-luca"] svg'),
          ),
          session_time: right(
            document.querySelector("[data-shell-rail] .luca-rail-session-ago"),
          ),
          home_signal_dot: right(
            document.querySelector(
              "[data-shell-rail] .luca-rail-row .luca-rail-dot",
            ),
          ),
          home_signal_word: right(
            document.querySelector(
              "[data-shell-rail] .luca-rail-row :is(.luca-rail-working, .luca-rail-status)",
            ),
          ),
          row_plus_glyph: right(
            document.querySelector("[data-shell-rail] .luca-rail-row-add svg"),
          ),
        },
      };
    });
    fixChecks.fix_3 = {
      rail_display: m.rail_display,
      gap_after_open_home: m.gap_after_open_home,
      gap_after_closed_home: m.gap_after_closed_home,
    };
    fixChecks.fix_9 = {
      session_padding_left: m.session_padding_left,
      sessions_padding_left: m.sessions_padding_left,
      title_x: m.title_x,
      thread_x: m.thread_x,
      lit_segment_color: m.lit_segment_color,
      thread_color: m.thread_color,
      title_from_thread: m.title_from_thread,
    };
    fixChecks.fix_11 = m.trailing;
    expect(m.rail_display).toBe("block");
    expect(m.gap_after_open_home).toBe(14);
    expect(m.session_padding_left).toBe("8px");
    // WP-34, Decided 4: the thread under the face's centre, the words 19
    // from it.
    expect(m.sessions_padding_left).toBe("11px");
    expect(m.title_from_thread).toBe(19);
    expect(m.lit_segment_color).toBe(m.thread_color);
    expect(m.trailing.session_time).toBe(204);
    expect(m.trailing.heading_plus_glyph).toBe(204);
    await fixShot(page, "fix3-rail");
    // The focus ring with air: a session and "N more".
    await page.keyboard.press("Shift");
    await session(page, ROOM.tides).focus();
    const card = await page
      .locator('[data-frame] [data-sidebar="sidebar"]')
      .boundingBox();
    const box = await session(page, ROOM.tides).boundingBox();
    if (card && box)
      await fixShot(
        page,
        "fix9-focus-session",
        page.locator(`[data-home-group="agent:${WREN}"]`),
      );
    await page.getByTestId(`rail-more-agent:${WREN}`).focus();
    await fixShot(
      page,
      "fix9-focus-more",
      page.locator(`[data-home-group="agent:${WREN}"]`),
    );
    // The +'s glyph on the trailing edge too, shown by focus.
    await hit(page, "project:tidepool").focus();
    await page.keyboard.press("Tab");
    const plus = await page.evaluate(() => {
      const card = document
        .querySelector('[data-frame] [data-sidebar="sidebar"]')
        ?.getBoundingClientRect();
      const svg = document.activeElement?.querySelector("svg");
      return svg && card
        ? Math.round((svg.getBoundingClientRect().right - card.left) * 100) /
            100
        : null;
    });
    (fixChecks.fix_11 as Record<string, unknown>).row_plus_glyph_focused = plus;
    expect(plus).toBe(204);
  });

  test("fixes 4, 7, 10: signals stay without a +, no room +, working said once", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    // Unread on a person's 1:1 (no row since WP-34) and on a room's row.
    await page.evaluate(
      ({ bob, bobDm, scratch, owner }) => {
        void owner;
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId: bobDm,
          content: "Are we still on for Saturday?",
          pubkey: bob,
        });
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId: scratch,
          content: "A note.",
          pubkey: bob,
        });
      },
      { bob: BOB, bobDm: BOB_DM, scratch: ROOM.scratch, owner: OWNER },
    );
    // A row with no + (a room) keeps its dot under the pointer and focus.
    const bob = home(page, `room:${ROOM.scratch}`);
    await expect(bob.locator(".luca-rail-dot")).toBeVisible({
      timeout: 10_000,
    });
    await bob.hover();
    const hovered = await bob
      .locator(".luca-rail-signal")
      .evaluate((el) => getComputedStyle(el).visibility);
    await hit(page, `room:${ROOM.scratch}`).focus();
    await page.keyboard.press("Shift");
    const focused = await bob
      .locator(".luca-rail-signal")
      .evaluate((el) => getComputedStyle(el).visibility);
    await fixShot(page, "fix4-room-hover-dot", bob);
    // fix 11: a home's signal ends on the trailing column too.
    await page.mouse.move(1400, 880);
    const dotRight = await page.evaluate((id) => {
      const card = document
        .querySelector('[data-frame] [data-sidebar="sidebar"]')
        ?.getBoundingClientRect();
      const dot = document.querySelector(`[data-home="${id}"] .luca-rail-dot`);
      return dot && card
        ? Math.round((dot.getBoundingClientRect().right - card.left) * 100) /
            100
        : null;
    }, `room:${ROOM.scratch}`);
    fixChecks.fix_11_home_signal_dot = dotRight;
    expect(dotRight).toBe(204);
    // No + on any room.
    const roomPluses = await page
      .locator('[data-shell-rail] [data-home-kind="room"] .luca-rail-row-add')
      .count();
    // Working once: Monday plan working under an open Wren.
    await page.evaluate(
      ({ wren, monday }) => {
        (
          window as Window & {
            __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
              agentPubkey: string;
              channelId: string;
              turnId: string;
            }) => void;
          }
        ).__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: wren,
          channelId: monday,
          turnId: "wp11-fix-10",
        });
      },
      { wren: WREN, monday: ROOM.monday },
    );
    await expect(
      session(page, ROOM.monday).locator(".luca-rail-working"),
    ).toBeVisible({ timeout: 10_000 });
    const wrenRow = home(page, `agent:${WREN}`);
    const openSays = await wrenRow.locator(".luca-rail-working").count();
    await page.mouse.move(1400, 880);
    await fixShot(page, "fix10-working-open", wrenRow.locator(".."));
    await wrenRow.locator("[data-chevron]").click();
    // The pointer leaves the row: on hover its + takes the slot (SPEC.md,
    // "A row": "on hover the + wins").
    await page.mouse.move(1400, 880);
    await expect(wrenRow.locator(".luca-rail-working")).toBeVisible();
    await fixShot(page, "fix10-working-folded", wrenRow.locator(".."));
    fixChecks.fix_4 = {
      room_dot_on_hover: hovered,
      room_dot_on_focus: focused,
    };
    fixChecks.fix_7 = { room_rows_with_plus: roomPluses };
    fixChecks.fix_10 = {
      open_home_says_working: openSays,
      folded_home_says_working: 1,
    };
    expect(hovered).toBe("visible");
    expect(focused).toBe("visible");
    expect(roomPluses).toBe(0);
    expect(openSays).toBe(0);
  });

  test("fix 5: the room browser speaks of rooms", async ({ page }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await page.getByTestId("rail-browse-rooms").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const words = {
      title: await dialog.getByRole("heading").first().innerText(),
      all_tab: await dialog.getByRole("tab").first().innerText(),
      placeholder: await dialog
        .getByTestId("channel-browser-search")
        .getAttribute("placeholder"),
      create_row: await dialog
        .getByTestId("channel-browser-create-row")
        .innerText(),
      hashes: await dialog
        .locator('[data-testid^="browse-channel-"]')
        .evaluateAll(
          (rows) => rows.filter((row) => row.textContent?.includes("#")).length,
        ),
    };
    fixChecks.fix_5 = words;
    expect(words.title).toBe("Browse rooms");
    expect(words.all_tab).toBe("All rooms");
    expect(words.placeholder).toBe("Search or start a room");
    expect(words.create_row).toBe("Start a room");
    expect(words.hashes).toBe(0);
    await fixShot(page, "fix5-browse-rooms", page.locator("body"));
  });

  for (const light of [false, true]) {
    test(`fix 6: Room settings…, ${light ? "paper by day" : "a plate at night"}`, async ({
      page,
    }) => {
      await boot(page, { shell: true, light });
      await seedScene(page);
      await goChannel(page, ROOM.review);
      await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
        "data-active",
        "true",
      );
      await page.getByTestId("shell-lip-details").click();
      const button = page.getByTestId("conversation-manage-room");
      await expect(button).toBeVisible();
      await page.mouse.move(10, 880);
      await waitForAnimations(page);
      const look = await button.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          text: el.textContent,
          background: cs.backgroundColor,
          border: cs.borderStyle === "none" || cs.borderWidth === "0px",
          outline: cs.outlineStyle,
          shadow: cs.boxShadow,
          radius: cs.borderRadius,
          dark: document.documentElement.classList.contains("dark"),
        };
      });
      await expect(
        page.getByTestId("conversation-manage-participants"),
      ).toBeVisible();
      const key = light ? "light" : "dark";
      fixChecks.fix_6 = { ...(fixChecks.fix_6 as object), [key]: look };
      expect(look.text).toBe("Room settings…");
      expect(look.border).toBe(true);
      expect(look.outline).toBe("none");
      if (light) expect(look.shadow).not.toBe("none");
      else expect(look.shadow).toBe("none");
      await fixShot(
        page,
        `fix6-room-settings-${key}`,
        page.getByTestId("conversation-context-panel"),
      );
      await button.click();
      await expect(
        page.getByTestId("channel-management-auxiliary-pane"),
      ).toBeVisible();
    });
  }

  test("fix 8: N more opens the list and Show fewer folds it back", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await seedScene(page);
    await moreWrenSessions(page);
    await goChannel(page, ROOM.review);
    const group = page.locator(`[data-home-group="agent:${WREN}"]`);
    const rows = () =>
      group.locator("fieldset [data-rail-focus=session]").allInnerTexts();
    const more = page.getByTestId(`rail-more-agent:${WREN}`);
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(session(page, ROOM.notes)).toBeFocused();
    const open = await rows();
    await page.mouse.move(1400, 880);
    await fixShot(page, "fix8-open", group);
    const fewer = page.getByTestId(`rail-fewer-agent:${WREN}`);
    await fewer.focus();
    await page.keyboard.press("Enter");
    await expect(more).toBeFocused();
    const folded = await rows();
    fixChecks.fix_8 = { open, folded, focus_after_fewer: "1 more" };
    expect(open.at(-1)).toBe("Show fewer");
    expect(open.map((t) => t.split("\n")[0])).toContain("Old notes");
    expect(folded.at(-1)).toBe("1 more");
    await fixShot(page, "fix8-folded", group);
  });

  test("fixes 13, 14, 15: no loose rooms, lowercase states, a named nav", async ({
    page,
  }) => {
    await boot(page, { shell: true, atlasError: "The harness exited." });
    const { groupDm } = await seedScene(page);
    // Leave every room and the one person's 1:1.
    await page.evaluate(
      async ({ ids, owner }) => {
        for (const channelId of ids)
          window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
            channelId,
            removeMemberPubkey: owner,
          });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
      },
      {
        ids: [
          ROOM.review,
          ROOM.watch,
          ROOM.scratch,
          groupDm,
          STOCK_GROUP,
          BOB_DM,
        ],
        owner: OWNER,
      },
    );
    await expect(
      page.locator('[data-shell-rail] [data-home-kind="room"]'),
    ).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(`[data-home="person:${BOB}"]`)).toHaveCount(0);
    const heads = await page
      .locator("[data-shell-rail] .luca-rail-section-head > span")
      .allTextContents();
    // With no loose rooms, Projects still ends on its two ways in (WP-34,
    // Decided 1), its + there.
    const rooms = page.getByTestId("rail-section-project");
    await expect(rooms.getByTestId("create-channel")).toBeVisible();
    await expect(rooms.getByTestId("rail-browse-rooms")).toBeVisible();
    await expect(rooms.getByTestId("rail-archived-rooms")).toBeVisible();
    await rooms.scrollIntoViewIfNeeded();
    await page.mouse.move(1400, 880);
    await fixShot(page, "fix13-rooms-empty", rooms);
    // Lowercase state words.
    const atlas = home(page, `agent:${ATLAS}`);
    const status = await atlas.locator(".luca-rail-status").innerText();
    const label = await hit(page, `agent:${ATLAS}`).getAttribute("aria-label");
    // The rail is its place's navigation, named.
    const nav = page.getByRole("navigation", { name: "Chats" });
    const navHoldsRail = await nav.evaluate((el) =>
      el.matches("[data-shell-rail]"),
    );
    fixChecks.fix_13 = {
      heads: heads.map((head) => head.trim()),
      rooms_plus: true,
      browse_and_archived: true,
    };
    fixChecks.fix_14 = { status, aria_label: label };
    fixChecks.fix_15 = { nav_named_chats: navHoldsRail };
    expect(heads.map((head) => head.trim())).toEqual([
      "Chats",
      "Projects",
      "Agents",
      "Apps",
    ]);
    expect(status).toBe("needs attention");
    expect(label).toContain("needs attention");
    expect(navHoldsRail).toBe(true);
  });

  test.afterAll(() => {
    mkdirSync(FIX_SHOTS, { recursive: true });
    let previous: Record<string, unknown> = {};
    try {
      previous = JSON.parse(readFileSync(`${FIX_SHOTS}/checks.json`, "utf8"));
    } catch {
      /* first run */
    }
    writeFileSync(
      `${FIX_SHOTS}/checks.json`,
      JSON.stringify({ ...previous, ...fixChecks }, null, 2),
    );
  });
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);
  const sha = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");

  const captureIn = async (
    context: BrowserContext,
    origin: string,
    label: string,
    size: { width: number; height: number },
  ) => {
    await context.clock.install({ time: new Date("2026-10-26T09:30:00") });
    const page = await context.newPage();
    await installMockBridge(page);
    await chooseRailAgents(page);
    await expect(async () => {
      await page.goto(`${origin}/?e2e=mock#/`);
      await expect(page.getByTestId("app-sidebar")).toBeVisible({
        timeout: 20_000,
      });
    }).toPass({ timeout: 60_000 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const out: Record<string, string> = {};
    mkdirSync(SHOTS, { recursive: true });
    const snap = async (key: string, target?: Locator) => {
      await page.mouse.move(size.width - 1, size.height - 1);
      await page.waitForTimeout(1500);
      const file = `${SHOTS}/flag-off-${size.width}-${key}${label}.png`;
      await (target ?? page.locator("body")).screenshot({ path: file });
      out[key] = file;
    };
    // Where the app opens, with nothing remembered.
    await page.waitForTimeout(1500);
    out.landing_route = new URL(page.url()).hash;
    await expect(async () => {
      await page.evaluate((id) => {
        window.location.hash = `#/channels/${id}`;
      }, GENERAL_ID);
      await expect(page.getByTestId("chat-title")).toHaveText("general", {
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000 });
    await snap("channel");
    await snap("rail", page.getByTestId("app-sidebar"));
    // The room's details (their head changed for Manage, flag on only).
    const details = page.getByRole("button", {
      name: "Open conversation details",
    });
    await details.click();
    const panel = page.getByTestId("conversation-context-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await snap("details", panel);
    await page.keyboard.press("Escape");
    // The room browser (All), and the room's details.
    await page.keyboard.press("Meta+Shift+O");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await snap("browse");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return out;
  };
  const capture = async (
    origin: string,
    label: string,
    size: { width: number; height: number },
  ) => {
    for (let attempt = 1; ; attempt += 1) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: size,
      });
      try {
        return await captureIn(context, origin, label, size);
      } catch (error) {
        if (attempt >= 3) throw error;
      } finally {
        await context.close();
      }
    }
  };
  const result: Record<string, unknown> = {};
  for (const size of [
    { width: 800, height: 500 },
    { width: 1440, height: 900 },
  ]) {
    const ours = await capture(info.project.use.baseURL ?? "", "", size);
    const base = await capture(BASE_URL, "-base", size);
    result[`${size.width}x${size.height}_landing`] = {
      ours: ours.landing_route,
      base: base.landing_route,
      identical: ours.landing_route === base.landing_route,
    };
    for (const key of Object.keys(ours)) {
      if (key === "landing_route") continue;
      result[`${size.width}x${size.height}_${key}`] = {
        ours: sha(ours[key]),
        base: sha(base[key]),
        identical: sha(ours[key]) === sha(base[key]),
      };
    }
  }
  checks.flag_off_identical = result;
  for (const [key, value] of Object.entries(result))
    expect((value as { identical: boolean }).identical, key).toBe(true);
});

test.afterAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  const hashes = Object.fromEntries(
    shots.map((path) => [
      path.split("/").pop(),
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    ]),
  );
  let previous: Record<string, unknown> = {};
  try {
    previous = JSON.parse(readFileSync(`${SHOTS}/checks.json`, "utf8"));
  } catch {
    /* first run */
  }
  writeFileSync(
    `${SHOTS}/checks.json`,
    JSON.stringify({ ...previous, ...checks, shot_hashes: hashes }, null, 2),
  );
});
