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

/**
 * WP-11, the Chats rail (docs/luca/rail-system/SHELL_BUILD.md; SPEC.md as
 * amended 2026-10-25): its heading and +, Luca, Projects, Agents, People and
 * Rooms, one home per chat by what it is, every home's latest three with
 * their times, "N more", Rooms' Browse rooms… and Archived, where the app
 * opens, and a room's Manage. Screenshots land in WP11_SHOTS when set.
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
};

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const checks: Record<string, unknown> = {};
const shots: string[] = [];

async function boot(page: Page, { shell }: { shell: boolean }) {
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
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
      { name: "Wren", pubkey: WREN, status: "running" },
      { name: "Codex", pubkey: CODEX, status: "running" },
    ],
  });
  // Retry a blank first load: the machine runs several builds at once.
  await expect(async () => {
    await page.goto("/?e2e=mock#/pulse");
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
    expect(headings).toEqual([
      { heading: "Chats", plus: "New conversation" },
      { heading: "Projects", plus: "New project" },
      { heading: "Agents", plus: null },
      { heading: "People", plus: null },
      { heading: "Rooms", plus: "New room" },
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

    // People: Bob (a person); Alice is an agent by her profile.
    const people = homes.filter((each) => each.kind === "person");
    const agents = homes.filter((each) => each.kind === "agent");
    checks.people = {
      people: people.map((each) => [each.home, each.channel]),
      agents: agents.map((each) => each.home),
    };
    expect(people.map((each) => each.channel)).toEqual([BOB_DM]);
    // This Mac's agents by name, then any other agent (the mock names the
    // stock 1:1s "alice-tyler" and "bob-tyler").
    expect(agents.map((each) => each.home)).toEqual([
      "Atlas",
      "Codex",
      "Wren",
      "alice-tyler",
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
    // Rooms ends on its two ways in.
    expect((rail ?? []).slice(-2)).toEqual([
      { tail: "Browse rooms…" },
      { tail: "Archived" },
    ]);
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

  test("every home shows its latest three with their times, then N more", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    const tidepool = home(page, "project:tidepool").locator("..");
    const rail = await readRail(page);
    const tide = (rail ?? []).find((each) => each.home === "Tidepool") as {
      sessions: { title: string; ago: string | null }[];
      expanded: string | null;
    };
    // Homes start open.
    expect(tide.expanded).toBe("true");
    expect(tide.sessions.map((each) => each.title)).toEqual([
      "Landing page copy",
      "Chapter nine",
      "Hero image",
      "1 more",
    ]);
    const more = page.getByTestId("rail-more-project:tidepool");
    await expect(more).toHaveText("1 more");
    checks.latest_three = tide.sessions.map((each) => each.title);
    // Times, newest first: minutes to weeks.
    const times = (rail ?? []).flatMap((each) =>
      ((each.sessions as { title: string; ago: string | null }[]) ?? []).map(
        (s) => [s.title, s.ago],
      ),
    );
    checks.times = times;
    expect(tide.sessions.slice(0, 3).map((each) => each.ago)).toEqual([
      "2h",
      "1d",
      "3d",
    ]);
    const wren = (rail ?? []).find((each) => each.home === "Wren") as {
      sessions: { title: string; ago: string | null }[];
    };
    expect(wren.sessions.map((each) => each.ago)).toEqual(["3h", "2d"]);
    const luca = (rail ?? []).find((each) => each.home === "Luca") as {
      sessions: { title: string; ago: string | null }[];
    };
    expect(luca.sessions).toEqual([
      { title: "Weekly review", channel: ROOM.weekly, ago: "5m" },
    ]);
    await shoot(page, "home-more", tidepool);

    // "1 more" shows the rest, by keyboard too: the focus moves onto the
    // first of them.
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveCount(0);
    await expect(session(page, ROOM.press)).toBeFocused();
    await expect(session(page, ROOM.press)).toContainText("2w");
    checks.more_row = {
      label: "1 more",
      after: await tidepool
        .locator("fieldset [data-rail-focus=session]")
        .allInnerTexts(),
      focus_moved_to: ROOM.press,
    };
    await shoot(page, "home-more-open", tidepool);
  });

  test("the open conversation is always visible", async ({ page }) => {
    // The oldest of Tidepool's four: shown after the latest three.
    await goChannel(page, ROOM.press);
    await expect(session(page, ROOM.press)).toHaveAttribute(
      "data-current",
      "true",
    );
    const titles = await home(page, "project:tidepool")
      .locator("..")
      .locator("fieldset [data-rail-focus=session]")
      .allInnerTexts();
    checks.open_always_visible = { opened: "Press kit", rows: titles };
    expect(titles.map((each) => each.split("\n")[0])).toEqual([
      "Landing page copy",
      "Chapter nine",
      "Hero image",
      "Press kit",
    ]);
    await expect(
      home(page, "project:tidepool").locator(".."),
    ).not.toContainText("more");
    await shoot(page, "open-always-visible");
  });

  test("hover and keyboard show the +; the heading's + is New conversation", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    const wren = home(page, `agent:${WREN}`);
    await wren.hover();
    const plus = wren.getByRole("button", { name: "New session with Wren" });
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
    // People have their one conversation: no +.
    const bob = home(page, `person:${BOB}`);
    await bob.hover();
    await expect(bob.locator(".luca-rail-row-add")).toHaveCount(0);
    // Focus: Tab from the Luca row reaches its +.
    await page.mouse.move(1400, 880);
    await hit(page, "luca").focus();
    await page.keyboard.press("Tab");
    const lucaPlus = home(page, "luca").getByRole("button", {
      name: "New session with Luca",
    });
    await expect(lucaPlus).toBeFocused();
    await shoot(page, "focus-plus", home(page, "luca").locator(".."), {
      keepPointer: true,
    });

    // The heading's +: New conversation, and ⌘N stays.
    await page.getByTestId("rail-new-conversation").click();
    await expect(page).toHaveURL(/#\/messages\/new/);
    await goChannel(page, ROOM.review);
    await expect(home(page, `room:${ROOM.review}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Meta+n");
    await expect(page).toHaveURL(/#\/messages\/new/);
    // Rooms' +: the create-room dialog.
    await page.getByTestId("create-room").click();
    await expect(
      page.getByRole("dialog").getByText("Create a new room"),
    ).toBeVisible();
    checks.heading_plus = {
      ...(checks.heading_plus as object),
      opens: "#/messages/new",
      rooms_plus: "Create a new room",
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
    // A direct conversation's details: no Manage.
    await goChannel(page, BOB_DM);
    await expect(home(page, `person:${BOB}`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Escape");
    const details = page.getByTestId("shell-lip-details");
    if (!(await panel.isVisible().catch(() => false))) await details.click();
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("conversation-manage-room")).toHaveCount(0);
    (checks.manage as Record<string, unknown>).dm_has_manage = false;
  });

  test("the keyboard moves through every row, People, Rooms and N more", async ({
    page,
  }) => {
    await goChannel(page, ROOM.review);
    await hit(page, "luca").focus();
    const order: string[] = [];
    for (let i = 0; i < 40; i += 1) {
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
    expect(order).toContain("Show 1 more in Tidepool");
    expect(order).toContain("bob-tyler");
    expect(order).toContain("Design review");
    expect(order.at(-2)).toBe("Browse rooms…");
    expect(order.at(-1)).toBe("Archived");
    // Left from a session returns to its home; Left on an open home closes
    // it; Right opens it again.
    await session(page, ROOM.chapter).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(hit(page, "project:tidepool")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(hit(page, "project:tidepool")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press("ArrowRight");
    await expect(hit(page, "project:tidepool")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Enter on a person's row opens their conversation.
    await hit(page, `person:${BOB}`).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(BOB_DM));
    // A closed home stays closed after a reload of the rail.
    await hit(page, "project:tidepool").focus();
    await page.keyboard.press("ArrowLeft");
    await page.reload();
    await expect(home(page, "project:tidepool")).toBeVisible({
      timeout: 20_000,
    });
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
