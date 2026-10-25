import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-02, the rail ironed out (docs/luca/rail-system/SHELL_BUILD.md): the
 * shell's rail under the `shell-frame` flag, against SPEC.md's "Done means".
 * Screenshots land in WP02_SHOTS when set (the build's scratch folder).
 */

const SHOTS = process.env.WP02_SHOTS ?? "test-results/shell-rail";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const CODEX = "d".repeat(64);
const ALICE =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";

/** Rooms with fixed ids, so projects can be assigned before they exist. */
const ROOM = {
  landing: "0e6a0000-0000-4000-8000-000000000001",
  chapter: "0e6a0000-0000-4000-8000-000000000002",
  hero: "0e6a0000-0000-4000-8000-000000000003",
  monday: "0e6a0000-0000-4000-8000-000000000004",
  tides: "0e6a0000-0000-4000-8000-000000000005",
  review: "0e6a0000-0000-4000-8000-000000000006",
  palette: "0e6a0000-0000-4000-8000-000000000007",
  weekly: "0e6a0000-0000-4000-8000-000000000008",
};

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

async function boot(page: Page, { shell }: { shell: boolean }) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  if (shell) {
    // Seed the flag before the bridge, as React reads it on mount.
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
  await page.goto("/?e2e=mock#/pulse");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20000,
  });
  await seedScene(page);
}

/**
 * The study's scene, through the mock bridge's own commands: Luca's thread and
 * a session of Luca's; Atlas and Wren with sessions; Codex with none; two
 * projects with rooms and one without; a fleet's group chat; a fleet with two
 * sessions and no group chat; and a person (Alice) from the stock data.
 */
async function seedScene(page: Page) {
  await page.evaluate(
    async ({ ids, luca, atlas, wren, alice }) => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!invoke || !emit) throw new Error("Expected the mock bridge.");
      const owner = "deadbeef".repeat(8);
      // The stock fixture's rooms leave, except Alice's 1:1.
      const rows = (await invoke("get_channels")) as Array<{
        id: string;
        name: string;
        is_member: boolean;
      }>;
      for (const row of rows) {
        if (!row.is_member || row.name === "alice-tyler") continue;
        window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
          channelId: row.id,
          removeMemberPubkey: owner,
        });
      }
      const now = Math.floor(Date.now() / 1000);
      let minutes = 400;
      const say = (channelId: string, pubkey: string, content: string) => {
        minutes -= 7;
        emit({ channelId, content, createdAt: now - minutes * 60, pubkey });
      };
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
      const room = async (id: string, name: string, members: string[]) => {
        await pinned(id, () =>
          invoke("create_channel", {
            channelType: "stream",
            description: "",
            name,
            visibility: "private",
          }),
        );
        await invoke("add_channel_members", {
          channelId: id,
          pubkeys: members,
          role: "bot",
        });
        // The owner's own words: read, so only the one unread shows.
        say(id, owner, `${name}: first notes.`);
      };
      const dm = async (pubkeys: string[], text: string) => {
        const channel = (await invoke("open_dm", { pubkeys })) as {
          id: string;
        };
        say(channel.id, owner, text);
        return channel.id;
      };

      await room(ids.landing, "Landing page copy", [wren]);
      await room(ids.chapter, "Chapter nine", [atlas]);
      await room(ids.review, "Design review", [atlas, wren]);
      await room(ids.palette, "Palette", [atlas, wren]);
      await room(ids.weekly, "Weekly review", [luca]);
      await dm([atlas], "The release notes are drafted.");
      await room(ids.monday, "Monday plan", [wren]);
      await room(ids.tides, "The tide tables", [wren]);
      await dm([wren], "Morning. The tide tables are in.");
      await dm([luca, wren], "Wren and I looked at the plan.");
      await room(ids.hero, "Hero image", [atlas]);
      await dm([luca], "Morning. Three things came in overnight.");
      say(ids.hero, atlas, "A new hero image is ready."); // unread
      void alice;

      // Projects: Tidepool (two rooms), Studio site (one), Field guide (none).
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
            { id: "studio-site", label: "Studio site" },
            { id: "field-guide", label: "Field guide" },
          ],
          assignments: {
            [ids.landing]: "tidepool",
            [ids.chapter]: "tidepool",
            [ids.hero]: "studio-site",
          },
        }),
      );
      window.dispatchEvent(new Event("luca:room-projects-changed"));
      await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
    },
    { ids: ROOM, luca: LUCA, atlas: ATLAS, wren: WREN, alice: ALICE },
  );
}

const shots: string[] = [];
async function shoot(page: Page, name: string, target?: Locator) {
  await page.mouse.move(1400, 880);
  await waitForAnimations(page);
  const path = `${SHOTS}/${name}.png`;
  await (target ?? page.getByTestId("app-sidebar")).screenshot({ path });
  shots.push(path);
  return path;
}

/** A home row is one button under its name; the chevron sits on top of it
 *  just after the name, so a click lands on the name itself. */
const ON_NAME = { position: { x: 14, y: 15 } };
const home = (page: Page, id: string) =>
  page.locator(`[data-testid="rail-home-${id}"]`);
const hit = (page: Page, id: string) =>
  home(page, id).locator('[data-rail-focus="home"]');
const session = (page: Page, channelId: string) =>
  page.getByTestId(`rail-session-${channelId}`);
const agentId = (pubkey: string) => `agent:${pubkey}`;
const fleetId = (...members: string[]) =>
  `fleet:${[...members].sort().join("+")}`;

async function railRows(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-shell-rail] [data-rail-focus], [data-shell-rail] .luca-rail-section-head",
      ),
    ].map((el) =>
      el.classList.contains("luca-rail-section-head")
        ? `# ${el.textContent?.trim()}`
        : (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
    ),
  );
}

test.describe("the shell's rail", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    await expect(home(page, fleetId(ATLAS, WREN))).toBeVisible();
  });

  test("order, one home per chat, rows and selection", async ({ page }) => {
    const rows = await railRows(page);
    console.log("RAIL ROWS", JSON.stringify(rows));
    // Luca first, then PROJECTS, AGENTS, FLEETS.
    const heads = rows.filter((row) => row.startsWith("# "));
    expect(heads).toEqual(["# Projects", "# Agents", "# Fleets"]);
    expect(rows[0]).toMatch(/^Luca\b(?! \+)/);

    // No glyphs: a home row is its name, a chevron and the + only.
    const glyphs = await page.evaluate(() =>
      [...document.querySelectorAll("[data-shell-rail] .luca-rail-row")].map(
        (row) =>
          [...row.querySelectorAll("svg, img, canvas")].filter(
            (el) =>
              !el.closest(".luca-rail-chevron") &&
              !el.closest(".luca-rail-add"),
          ).length,
      ),
    );
    expect(glyphs.every((count) => count === 0)).toBe(true);
    console.log("GLYPHS", glyphs.length, "rows, 0 glyphs");

    // Nothing open: no home active, nothing current.
    await expect(
      page.locator('[data-shell-rail] [data-active="true"]'),
    ).toHaveCount(0);
    await shoot(page, "01-nothing-open");

    // Type and measures, against the shell study's.
    await home(page, agentId(WREN)).locator("[data-chevron]").click();
    const measures = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector<HTMLElement>(
          `[data-shell-rail] ${selector}`,
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: r.x,
          w: r.width,
          h: r.height,
          size: cs.fontSize,
          color: cs.color,
          family: cs.fontFamily.split(",")[0],
          caps: cs.textTransform,
          tracking: cs.letterSpacing,
        };
      };
      const thread = document.querySelector(
        "[data-shell-rail] .luca-rail-sessions",
      );
      return {
        row: box(".luca-rail-row"),
        name: box(".luca-rail-row-name"),
        chevron: box(".luca-rail-chevron"),
        label: box(".luca-rail-section-head"),
        session: box(".luca-rail-session"),
        sessions: box(".luca-rail-sessions"),
        thread: thread
          ? getComputedStyle(thread, "::before").backgroundColor
          : null,
      };
    });
    console.log("MEASURES", JSON.stringify(measures));
    expect(measures.row?.h).toBe(30);
    expect(measures.session?.h).toBe(28);
    expect(measures.label?.h).toBe(26);
    expect(measures.name?.size).toBe("14px");
    expect(measures.session?.size).toBe("13px");
    expect(measures.label?.size).toBe("11px");
    expect(measures.label?.caps).toBe("uppercase");
    await home(page, agentId(WREN)).locator("[data-chevron]").click();

    // Luca open.
    await hit(page, "luca").click(ON_NAME);
    await expect(home(page, "luca")).toHaveAttribute("data-active", "true");
    await expect(hit(page, "luca")).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator('[data-shell-rail] [data-current="true"]'),
    ).toHaveCount(0);
    await shoot(page, "02-luca-open");

    // An agent's session open: the agent active, the session lit.
    await hit(page, agentId(WREN)).click(ON_NAME);
    await expect(home(page, agentId(WREN))).toHaveAttribute(
      "data-active",
      "true",
    );
    await session(page, ROOM.monday).click();
    await expect(page.getByTestId("chat-title")).toHaveText("Monday plan");
    await expect(home(page, agentId(WREN))).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(session(page, ROOM.monday)).toHaveAttribute(
      "data-current",
      "true",
    );
    await expect(session(page, ROOM.monday)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(session(page, ROOM.monday)).not.toHaveAttribute("data-active");
    await expect(
      page.locator('[data-shell-rail] [data-active="true"]'),
    ).toHaveCount(1);
    await shoot(page, "03-agent-session-open");

    // A collapsed parent with an open session keeps data-active.
    await home(page, agentId(WREN)).locator("[data-chevron]").click();
    await expect(session(page, ROOM.monday)).toHaveCount(0);
    await expect(home(page, agentId(WREN))).toHaveAttribute(
      "data-active",
      "true",
    );
    await shoot(page, "06-collapsed-parent-open");

    // A project room open: Tidepool opens its last room, in the rail.
    await hit(page, "project:tidepool").click(ON_NAME);
    await expect(home(page, "project:tidepool")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(
      page.locator('[data-shell-rail] [data-current="true"]'),
    ).toHaveCount(1);
    await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
    await shoot(page, "04-project-room-open");

    // A fleet open: Atlas + Wren opens its newest session.
    await hit(page, fleetId(ATLAS, WREN)).click(ON_NAME);
    await expect(home(page, fleetId(ATLAS, WREN))).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("chat-title")).toHaveText(
      /Palette|Design review/,
    );
    await shoot(page, "05-fleet-open");
    await shoot(page, "05b-fleet-open-window", page.locator("body"));
  });

  test("expansion is remembered per home", async ({ page }) => {
    await home(page, fleetId(ATLAS, WREN)).locator("[data-chevron]").click();
    await home(page, "project:tidepool").locator("[data-chevron]").click();
    await expect(session(page, ROOM.review)).toBeVisible();
    await expect(session(page, ROOM.landing)).toBeVisible();
    await page.reload();
    await expect(home(page, "luca")).toBeVisible({ timeout: 20000 });
    await seedScene(page);
    await expect(session(page, ROOM.review)).toBeVisible();
    await expect(session(page, ROOM.landing)).toBeVisible();
    await expect(
      home(page, agentId(WREN)).locator("[data-chevron]"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("hover and keyboard show the +, which starts a session", async ({
    page,
  }) => {
    const atlas = home(page, agentId(ATLAS));
    await atlas.hover();
    const plus = atlas.getByRole("button", { name: "New session with Atlas" });
    await expect(plus).toBeVisible();
    await waitForAnimations(page);
    const hoverPath = `${SHOTS}/07-hover-plus.png`;
    await page.getByTestId("app-sidebar").screenshot({ path: hoverPath });
    shots.push(hoverPath);

    // Keyboard: Tab from Tidepool's row reaches its +, labelled.
    await page.mouse.move(1400, 880);
    await hit(page, "project:tidepool").focus();
    await page.keyboard.press("Tab");
    const roomPlus = home(page, "project:tidepool").getByRole("button", {
      name: "New room in Tidepool",
    });
    await expect(roomPlus).toBeFocused();
    await waitForAnimations(page);
    const focusPath = `${SHOTS}/08-focus-plus.png`;
    await page.getByTestId("app-sidebar").screenshot({ path: focusPath });
    shots.push(focusPath);

    // The agent's + opens a new session with it.
    await atlas.hover();
    await plus.click();
    await expect(page.getByRole("dialog")).toContainText(
      "New session with Atlas",
    );
    await page.getByLabel("Session name").fill("Release notes");
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(page.getByTestId("chat-title")).toHaveText("Release notes");
    await expect(atlas).toHaveAttribute("data-active", "true");
    await expect(
      page.locator(
        `[data-home-group="${agentId(ATLAS)}"] [data-current="true"]`,
      ),
    ).toHaveText("Release notes");

    // The fleet's + opens a session with every member.
    const fleet = home(page, fleetId(ATLAS, WREN));
    await fleet.hover();
    await fleet
      .getByRole("button", { name: "New session with Atlas + Wren" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "New session with Atlas + Wren",
    );
    await page.keyboard.press("Escape");

    // The project's + opens New room for that project.
    await home(page, "project:tidepool").hover();
    await roomPlus.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    console.log(
      "PROJECT PLUS DIALOG",
      (await page.getByRole("dialog").innerText()).slice(0, 120),
    );
    await page.keyboard.press("Escape");

    // FLEETS + opens New conversation (several recipients).
    await page.getByTestId("create-fleet").click();
    await expect(page).toHaveURL(/#\/messages\/new/);
  });

  test("keyboard moves between rows, opens and closes homes", async ({
    page,
  }) => {
    await hit(page, "luca").focus();
    await page.keyboard.press("ArrowDown");
    await expect(hit(page, "project:studio-site")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(session(page, ROOM.hero)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.locator('[data-rail-focus="session"]').first(),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(hit(page, "project:studio-site")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(session(page, ROOM.hero)).toHaveCount(0);
    await page.keyboard.press("ArrowUp");
    await expect(hit(page, "luca")).toBeFocused();
  });

  test("home rows have the study's 8-point corners, at rest, hover and focus", async ({
    page,
  }) => {
    const radii = (selector: string) =>
      page.evaluate(
        (sel) =>
          [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
            const hitEl = el.querySelector<HTMLElement>(".luca-rail-row-hit");
            return {
              row: getComputedStyle(el).borderRadius,
              hit: hitEl ? getComputedStyle(hitEl).borderRadius : null,
            };
          }),
        selector,
      );
    // Every home row, and the hit beneath it, at rest.
    const rest = await radii("[data-shell-rail] .luca-rail-row");
    console.log("RADIUS REST", JSON.stringify(rest.slice(0, 3)), rest.length);
    expect(rest.length).toBeGreaterThan(5);
    for (const r of rest) expect(r).toEqual({ row: "8px", hit: "8px" });

    // Hover: the plate is the study's colour on 8-point corners.
    const atlas = home(page, agentId(ATLAS));
    await atlas.hover();
    const hover = await atlas.evaluate((el) => ({
      radius: getComputedStyle(el).borderRadius,
      background: getComputedStyle(el).backgroundColor,
    }));
    console.log("RADIUS HOVER", JSON.stringify(hover));
    expect(hover.radius).toBe("8px");
    expect(hover.background).not.toBe("rgba(0, 0, 0, 0)");
    await waitForAnimations(page);
    const hoverPath = `${SHOTS}/11-hover-row-8px.png`;
    await atlas.screenshot({ path: hoverPath });
    shots.push(hoverPath);

    // Keyboard focus: the ring follows the same corners.
    await page.mouse.move(1400, 880);
    await hit(page, "luca").focus();
    await page.keyboard.press("ArrowDown");
    const focused = hit(page, "project:studio-site");
    await expect(focused).toBeFocused();
    const ring = await focused.evaluate((el) => ({
      focusVisible: el.matches(":focus-visible"),
      radius: getComputedStyle(el).borderRadius,
      outline: `${getComputedStyle(el).outlineWidth} ${getComputedStyle(el).outlineStyle} ${getComputedStyle(el).outlineColor}`,
      offset: getComputedStyle(el).outlineOffset,
    }));
    console.log("RADIUS FOCUS", JSON.stringify(ring));
    expect(ring.focusVisible).toBe(true);
    expect(ring.radius).toBe("8px");
    await waitForAnimations(page);
    const focusPath = `${SHOTS}/12-focus-row-8px.png`;
    await home(page, "project:studio-site").screenshot({ path: focusPath });
    shots.push(focusPath);

    // A home and its own sessions share one corner; the + stays round.
    await home(page, "project:tidepool").locator("[data-chevron]").click();
    const shapes = await page.evaluate(() => ({
      home: getComputedStyle(
        document.querySelector('[data-home="project:tidepool"]') as Element,
      ).borderRadius,
      session: getComputedStyle(
        document.querySelector(
          '[data-home-group="project:tidepool"] .luca-rail-session',
        ) as Element,
      ).borderRadius,
      plus: getComputedStyle(
        document.querySelector(".luca-rail-row-add") as Element,
      ).borderRadius,
    }));
    console.log("RADIUS SHAPES", JSON.stringify(shapes));
    expect(shapes.home).toBe("8px");
    expect(shapes.session).toBe("8px");
    expect(shapes.plus).toBe("999px");
  });

  test("a project's details and sources keep a home on its row", async ({
    page,
  }) => {
    // Rooms in the rail (the default): the room column is not there.
    await hit(page, "project:tidepool").click(ON_NAME);
    await expect(home(page, "project:tidepool")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);

    // The project row's menu: Project details and Sources.
    await home(page, "project:tidepool").click({
      button: "right",
      ...ON_NAME,
    });
    await expect(page.getByTestId("rail-project-details")).toBeVisible();
    await expect(page.getByTestId("rail-project-sources")).toBeVisible();
    await waitForAnimations(page);
    const menuPath = `${SHOTS}/13-project-row-menu.png`;
    await page.screenshot({
      path: menuPath,
      clip: { x: 0, y: 0, width: 560, height: 520 },
    });
    shots.push(menuPath);

    // Project details: rename the project.
    await page.getByTestId("rail-project-details").click();
    const dialog = page.getByTestId("project-details-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Project name")).toHaveValue("Tidepool");
    await expect(dialog).toContainText("2 rooms");
    await waitForAnimations(page);
    const dialogPath = `${SHOTS}/14-project-details-from-rail.png`;
    await page.screenshot({ path: dialogPath });
    shots.push(dialogPath);
    await dialog.getByLabel("Project name").fill("Tidepool East");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      home(page, "project:tidepool").locator(".luca-rail-row-name"),
    ).toHaveText("Tidepool East");

    // Remove the grouping: the project leaves, its rooms stay.
    await home(page, "project:tidepool").click({
      button: "right",
      ...ON_NAME,
    });
    await page.getByTestId("rail-project-details").click();
    await page
      .getByTestId("project-details-dialog")
      .getByRole("button", { name: "Remove grouping" })
      .click();
    await page
      .getByTestId("project-delete-grouping-dialog")
      .getByRole("button", { name: "Remove grouping" })
      .click();
    await expect(home(page, "project:tidepool")).toHaveCount(0);
    // Its rooms are loose now, each in its agent's home: Chapter nine
    // (with Atlas) under Atlas, Landing page copy (with Wren) under Wren.
    for (const [pubkey, room] of [
      [ATLAS, ROOM.chapter],
      [WREN, ROOM.landing],
    ] as const) {
      const chevron = home(page, agentId(pubkey)).locator("[data-chevron]");
      if ((await chevron.getAttribute("aria-expanded")) === "false")
        await chevron.click();
      await expect(session(page, room)).toBeVisible();
    }

    // The keyboard's menu key (Shift+F10) on a focused project row.
    await hit(page, "project:studio-site").focus();
    await page.keyboard.press("Shift+F10");
    const byKey = await page
      .getByTestId("rail-project-details")
      .isVisible()
      .catch(() => false);
    console.log("PROJECT MENU BY SHIFT+F10", byKey);
    expect(byKey).toBe(true);
    // The menu takes focus, so Enter opens the details from the keyboard.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("project-details-dialog")).toBeVisible();
    await expect(
      page.getByTestId("project-details-dialog").getByLabel("Project name"),
    ).toHaveValue("Studio site");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("project-details-dialog")).toHaveCount(0);

    // Sources: Brain, from the row's menu.
    await home(page, "project:studio-site").click({
      button: "right",
      ...ON_NAME,
    });
    await page.getByTestId("rail-project-sources").click();
    await expect(page).toHaveURL(/#\/brain/);

    // A chat row's menu is unchanged: Mark as read / unread.
    await page.goto("/?e2e=mock#/pulse");
    await expect(home(page, "luca")).toBeVisible({ timeout: 20000 });
    await home(page, "luca").click({ button: "right", ...ON_NAME });
    const chatMenu = page.getByRole("menu");
    await expect(chatMenu).toBeVisible();
    console.log(
      "CHAT ROW MENU",
      (await chatMenu.innerText()).replace(/\n/g, " | "),
    );
    await expect(page.getByTestId("rail-project-details")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Room search moves to Search: a room is found by name.
    await page.getByTestId("open-search").click();
    await page.keyboard.type("Landing page");
    const result = page.getByTestId(`search-result-channel-${ROOM.landing}`);
    await expect(result).toBeVisible({ timeout: 10000 });
  });

  test("Runtimes lives on the Agents page, and Project rooms is a setting", async ({
    page,
  }) => {
    await expect(page.getByTestId("sidebar-runtime-section")).toHaveCount(0);
    await page.goto("/?e2e=mock#/agents");
    await expect(page.getByTestId("agents-view")).toBeVisible({
      timeout: 20000,
    });
    const runtimes = page
      .getByTestId("agents-view")
      .getByTestId("sidebar-runtime-section");
    await expect(runtimes).toBeVisible();
    await waitForAnimations(page);
    const agentsPath = `${SHOTS}/09-runtimes-on-agents-page.png`;
    await page.screenshot({ path: agentsPath });
    shots.push(agentsPath);
    await runtimes.locator("[data-runtime-connection-key]").first().click();
    await expect(page).toHaveURL(/#\/messages\/new/);
    await expect(page.locator("#runtime-sessions-panel")).toBeVisible();

    await page.goto("/?e2e=mock#/settings");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const row = page.getByTestId("project-rooms-rail");
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("project-rooms-column").click();
    await expect(page.getByTestId("project-rooms-column")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await row.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    const settingsPath = `${SHOTS}/10-project-rooms-setting.png`;
    await page.screenshot({ path: settingsPath });
    shots.push(settingsPath);

    // In a column: projects behave as they do today.
    await page.goto("/?e2e=mock#/pulse");
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20000,
    });
    await seedScene(page);
    await hit(page, "project:tidepool").click(ON_NAME);
    await expect(page.getByTestId("project-room-navigator")).toBeVisible();
  });
});

test("flag off: today's rail, unchanged", async ({ page }) => {
  await boot(page, { shell: false });
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
  await expect(page.locator("[data-shell-rail]")).toHaveCount(0);
  await expect(page.getByTestId("primary-companion")).toBeVisible();
  const port = process.env.LUCA_PLAYWRIGHT_PORT ?? "base";
  const path = await shoot(page, `00-flag-off-${port}`);
  console.log(
    "FLAG OFF HASH",
    port,
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  );
});

test.afterAll(() => {
  const hashes = shots.map((path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  );
  console.log(
    "SHOT HASHES",
    JSON.stringify(
      Object.fromEntries(shots.map((p, i) => [p.split("/").pop(), hashes[i]])),
    ),
  );
});
