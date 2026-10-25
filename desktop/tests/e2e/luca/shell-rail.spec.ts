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
    await expect(page.getByTestId("shell-lip-name")).toHaveText("Monday plan");
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
    await expect(session(page, ROOM.monday)).toBeHidden();
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
    await expect(page.getByTestId("shell-lip-name")).toHaveText(
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
    await expect(hit(page, agentId(WREN))).toHaveAttribute(
      "aria-expanded",
      "false",
    );
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
    await expect(page.getByTestId("shell-lip-name")).toHaveText(
      "Release notes",
    );
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
    await expect(session(page, ROOM.hero)).toBeHidden();
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
      if (
        (await hit(page, agentId(pubkey)).getAttribute("aria-expanded")) ===
        "false"
      )
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
    // The dialog focuses its input a frame after it opens; type once it has.
    await expect(page.getByTestId("search-dialog-input")).toBeFocused();
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

/** WP-02b, the rail finished (SHELL_BUILD.md): the checks it names. */
const measured: Record<string, unknown> = {};

async function bootDefault(page: Page, init?: (page: Page) => Promise<void>) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await init?.(page);
  await installMockBridge(page);
  await page.goto("/?e2e=mock#/pulse");
  await expect(page.locator("[data-shell-rail]")).toBeVisible({
    timeout: 20000,
  });
}

test.describe("the rail, finished (WP-02b)", () => {
  test("groups: every chat findable by its own name, no group named after a chat", async ({
    page,
  }) => {
    await bootDefault(page);
    // The default mock's chats, as the relay lists them.
    const chats = await page.evaluate(async () => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      if (!invoke) throw new Error("Expected the mock bridge.");
      const rows = (await invoke("get_channels")) as Array<{
        id: string;
        name: string;
        channel_type: string;
        is_member: boolean;
      }>;
      return rows
        .filter((row) => row.is_member)
        .map((row) => ({ id: row.id, name: row.name, type: row.channel_type }));
    });
    await expect(
      page.locator('[data-shell-rail] [data-home-kind="fleet"]').first(),
    ).toBeVisible({ timeout: 20000 });
    // Open every home, so each chat is drawn where it lives.
    const closed = page.locator(
      '[data-shell-rail] [data-chevron][data-expanded="false"]',
    );
    await expect
      .poll(
        async () => {
          while ((await closed.count()) > 0) await closed.first().click();
          return page.evaluate(
            () =>
              document.querySelectorAll("[data-shell-rail] [data-channel-id]")
                .length,
          );
        },
        { timeout: 20000 },
      )
      .toBe(chats.length);
    const rail = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-shell-rail] [data-home]",
        ),
      ].map((row) => {
        const group = row.closest("[data-home-group]");
        return {
          id: row.dataset.home ?? "",
          kind: row.dataset.homeKind ?? "",
          name: row.querySelector(".luca-rail-row-name")?.textContent ?? "",
          channel: row.dataset.channelId ?? null,
          chevron: Boolean(row.querySelector("[data-chevron]")),
          sessions: [
            ...(group?.querySelectorAll<HTMLElement>(".luca-rail-session") ??
              []),
          ].map((el) => ({
            channel: el.dataset.channelId ?? "",
            title: el.textContent ?? "",
          })),
        };
      }),
    );
    console.log("DEFAULT RAIL", JSON.stringify(rail, null, 1));
    // Each chat exactly once, as a home (its own conversation) or a session.
    const placed = rail.flatMap((each) => [
      ...(each.channel ? [each.channel] : []),
      ...each.sessions.map((entry) => entry.channel),
    ]);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(chats.map((chat) => chat.id).sort());
    // A stream or forum is findable by its own name.
    const byChannel = new Map(
      rail.flatMap((each) => [
        ...(each.channel ? [[each.channel, each.name] as const] : []),
        ...each.sessions.map((entry) => [entry.channel, entry.title] as const),
      ]),
    );
    for (const chat of chats.filter((chat) => chat.type !== "dm")) {
      // A chat that is an agent's or a person's own conversation is opened
      // by that home's row, named for them.
      const label = byChannel.get(chat.id);
      const homeRow = rail.find((each) => each.channel === chat.id);
      if (homeRow && homeRow.kind === "agent") continue;
      expect(label, chat.name).toBe(chat.name);
    }
    // No fleet with several chats is named after one of them, and a fleet
    // with one chat is that chat, with no chevron.
    const names = new Set(chats.map((chat) => chat.name));
    const fleets = rail.filter((each) => each.kind === "fleet");
    for (const fleet of fleets) {
      if (fleet.sessions.length > 0) {
        expect(fleet.channel).toBeNull();
        expect(names.has(fleet.name), fleet.name).toBe(false);
        expect(fleet.name).toContain(" + ");
      } else {
        expect(fleet.chevron).toBe(false);
        expect(fleet.channel).not.toBeNull();
      }
    }
    measured.group_naming = fleets.map((fleet) => ({
      name: fleet.name,
      sessions: fleet.sessions.map((entry) => entry.title),
    }));
    measured.default_mock_chats = {
      chats: chats.length,
      placed: placed.length,
    };
    await shoot(page, "20-groups-default-mock");
  });

  test("column mode: project rows nest nothing", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("luca.project-rooms-placement.v1", "column");
    });
    await boot(page, { shell: true });
    await expect(home(page, "project:tidepool")).toBeVisible();
    const projects = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-shell-rail] [data-home-kind="project"]',
        ),
      ].map((row) => ({
        id: row.dataset.home,
        chevron: Boolean(row.querySelector("[data-chevron]")),
        expanded: row
          .querySelector('[data-rail-focus="home"]')
          ?.getAttribute("aria-expanded"),
        sessions:
          row
            .closest("[data-home-group]")
            ?.querySelectorAll(".luca-rail-session").length ?? 0,
      })),
    );
    console.log("COLUMN PROJECTS", JSON.stringify(projects));
    expect(projects.length).toBe(3);
    for (const each of projects) {
      expect(each.chevron).toBe(false);
      expect(each.expanded).toBeNull();
      expect(each.sessions).toBe(0);
    }
    // Rooms are not in the rail twice: each project room is nowhere in it.
    for (const room of [ROOM.landing, ROOM.chapter, ROOM.hero])
      await expect(
        page.locator(`[data-shell-rail] [data-channel-id="${room}"]`),
      ).toHaveCount(0);
    // Opening the project opens the room column, and the row is active.
    await hit(page, "project:tidepool").click(ON_NAME);
    await expect(page.getByTestId("project-room-navigator")).toBeVisible({
      timeout: 20000,
    });
    await expect(home(page, "project:tidepool")).toHaveAttribute(
      "data-active",
      "true",
    );
    measured.column_mode = projects;
    await shoot(page, "21-column-mode", page.locator("body"));
  });

  test("first row, aria-expanded, the session token and the anchor", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    const first = await page.evaluate(() => {
      const card = document
        .querySelector('[data-sidebar="sidebar"]')
        ?.getBoundingClientRect();
      const row = document
        .querySelector("[data-shell-rail] [data-home]")
        ?.getBoundingClientRect();
      if (!card || !row) return null;
      return {
        cardTop: card.top,
        rowTop: row.top,
        offset: row.top - card.top,
        left: row.left - card.left,
      };
    });
    console.log("FIRST ROW", JSON.stringify(first));
    expect(first?.offset).toBe(6);
    measured.first_row_offset = first;
    // The card's top, where the first row's 6 is measured.
    await page.mouse.move(1400, 880);
    await waitForAnimations(page);
    const firstPath = `${SHOTS}/22-first-row.png`;
    await page.screenshot({
      path: firstPath,
      clip: { x: 44, y: 30, width: 226, height: 90 },
    });
    shots.push(firstPath);

    // A home with sessions says so on its own button; the chevron is hidden.
    const wren = hit(page, agentId(WREN));
    await expect(wren).toHaveAttribute("aria-expanded", "false");
    const controls = await wren.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toBeHidden();
    const chevron = home(page, agentId(WREN)).locator("[data-chevron]");
    await expect(chevron).toHaveAttribute("aria-hidden", "true");
    await expect(chevron).toHaveAttribute("tabindex", "-1");
    await wren.focus();
    await page.keyboard.press("ArrowRight");
    await expect(wren).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`[id="${controls}"]`)).toBeVisible();
    // A home without sessions carries neither.
    const codex = hit(page, agentId(CODEX));
    expect(await codex.getAttribute("aria-expanded")).toBeNull();
    expect(await codex.getAttribute("aria-controls")).toBeNull();
    const a11y = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-shell-rail] [data-rail-focus="home"]',
        ),
      ].map((el) => ({
        name: el.getAttribute("aria-label"),
        expanded: el.getAttribute("aria-expanded"),
        controls: el.getAttribute("aria-controls"),
        resolves: el.getAttribute("aria-controls")
          ? Boolean(
              document.getElementById(el.getAttribute("aria-controls") ?? ""),
            )
          : null,
      })),
    );
    for (const each of a11y)
      if (each.controls) expect(each.resolves, each.name ?? "").toBe(true);
    measured.aria_expanded = a11y;

    // Sessions use the text-lip token (13), no literal.
    const sessionStyle = await session(page, ROOM.monday).evaluate((el) => ({
      size: getComputedStyle(el).fontSize,
      token: el.classList.contains("text-lip"),
    }));
    expect(sessionStyle).toEqual({ size: "13px", token: true });
    measured.session_token = sessionStyle;

    // Onboarding's travelling mark is published on Luca's row name.
    const anchor = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        "[data-onboarding-anchor]",
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const row = el.closest("[data-home]") as HTMLElement | null;
      return {
        home: row?.dataset.home,
        text: el.textContent,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        count: document.querySelectorAll("[data-onboarding-anchor]").length,
      };
    });
    console.log("ANCHOR", JSON.stringify(anchor));
    expect(anchor?.home).toBe("luca");
    expect(anchor?.count).toBe(1);
    expect(anchor?.w ?? 0).toBeGreaterThan(0);
    measured.onboarding_anchor = anchor;
  });

  test("slot order: working before the unread dot; statuses without an ellipsis", async ({
    page,
  }) => {
    page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    }, FEATURE_OVERRIDES_STORAGE_KEY);
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
          lastError: "The harness exited.",
        },
        { name: "Wren", pubkey: WREN, status: "running" },
        // Still being brought up: the mock says waking only while not running.
        { name: "Codex", pubkey: CODEX, status: "stopped", waking: true },
      ],
    });
    await page.goto("/?e2e=mock#/pulse");
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20000,
    });
    await seedScene(page);
    await expect(home(page, agentId(WREN))).toBeVisible();
    // Wren: an unread message in one session, a turn working in another.
    await page.evaluate(
      ({ wren, monday, tides }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId: tides,
          content: "The tide tables are updated.",
          pubkey: wren,
        });
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
          turnId: "wp02b-wren-monday",
        });
      },
      { wren: WREN, monday: ROOM.monday, tides: ROOM.tides },
    );
    const slot = (id: string) =>
      home(page, id).locator(".luca-rail-signal").first();
    await expect(hit(page, agentId(WREN))).toHaveAttribute(
      "aria-label",
      /unread/,
      { timeout: 10000 },
    );
    await expect(slot(agentId(WREN))).toHaveText(/working/, { timeout: 10000 });
    const slots = await page.evaluate(
      (ids) =>
        Object.fromEntries(
          ids.map((id) => {
            const row = document.querySelector(`[data-home="${id}"]`);
            const signal = row?.querySelector(".luca-rail-signal");
            const label = signal?.querySelector(
              ".luca-rail-working, .luca-rail-status",
            );
            return [
              id,
              {
                children: signal ? signal.children.length : 0,
                dot: Boolean(signal?.querySelector(".luca-rail-dot")),
                text: label?.textContent ?? null,
                className: label?.className ?? null,
                after: label
                  ? getComputedStyle(label, "::after").content
                  : null,
                color: label ? getComputedStyle(label).color : null,
                size: label ? getComputedStyle(label).fontSize : null,
                label: row
                  ?.querySelector('[data-rail-focus="home"]')
                  ?.getAttribute("aria-label"),
              },
            ];
          }),
        ),
      [agentId(WREN), agentId(ATLAS), agentId(CODEX)],
    );
    console.log("SLOTS", JSON.stringify(slots, null, 1));
    const wrenSlot = slots[agentId(WREN)];
    expect(wrenSlot.children).toBe(1);
    expect(wrenSlot.dot).toBe(false);
    expect(wrenSlot.after).toBe('"…"');
    expect(wrenSlot.label).toContain("unread");
    // The sessions show the same order: Monday working, the tides unread.
    await home(page, agentId(WREN)).locator("[data-chevron]").click();
    await expect(
      session(page, ROOM.monday).locator(".luca-rail-working"),
    ).toBeVisible();
    await expect(
      session(page, ROOM.tides).locator(".luca-rail-dot"),
    ).toBeVisible();
    measured.slot_order = wrenSlot;
    // A collapsed home's unread session is not "above" the rail's view.
    await expect(page.getByTestId("sidebar-more-unread-above")).toHaveCount(0);
    await shoot(page, "23-slot-order");
    // The + still wins on hover.
    await home(page, agentId(WREN)).hover();
    await expect(
      home(page, agentId(WREN)).getByRole("button", {
        name: "New session with Wren",
      }),
    ).toBeVisible();
    const hidden = await slot(agentId(WREN)).evaluate(
      (el) => getComputedStyle(el).visibility,
    );
    expect(hidden).toBe("hidden");
    await waitForAnimations(page);
    const hoverPath = `${SHOTS}/24-slot-order-hover-plus.png`;
    await home(page, agentId(WREN)).screenshot({ path: hoverPath });
    shots.push(hoverPath);

    // Needs attention: its own class, the working tone and size, no ellipsis.
    const atlas = slots[agentId(ATLAS)];
    expect(atlas.text).toBe("Needs attention");
    expect(atlas.className).toContain("luca-rail-status");
    expect(atlas.after).toBe("none");
    expect(atlas.color).toBe(wrenSlot.color);
    expect(atlas.size).toBe(wrenSlot.size);
    // Waking keeps its ellipsis.
    const codex = slots[agentId(CODEX)];
    expect(codex.text).toBe("Waking");
    expect(codex.after).toBe('"…"');
    measured.status_ellipsis = { atlas, codex };
    await page.mouse.move(1400, 880);
    await waitForAnimations(page);
    const attentionPath = `${SHOTS}/25-needs-attention.png`;
    await page
      .locator('[data-shell-rail] [data-testid="rail-section-agent"]')
      .screenshot({ path: attentionPath });
    shots.push(attentionPath);
  });

  test("settings: Project rooms ends the Conversation group; Runtimes' words", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await page.goto("/?e2e=mock#/settings");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const row = page.getByTestId("project-rooms-setting");
    await expect(row).toBeVisible({ timeout: 20000 });
    const place = await row.evaluate((el) => {
      const group = el.parentElement;
      const heading = group?.parentElement?.querySelector("h3")?.textContent;
      const siblings = group ? [...group.children] : [];
      const prev = el.previousElementSibling;
      return {
        heading,
        last: siblings[siblings.length - 1] === el,
        rows: siblings.length,
        sameGroupAsMessageText: Boolean(
          group?.querySelector('[data-testid="message-text-default"]'),
        ),
        borderTop: getComputedStyle(el).borderTopWidth,
        borderColor: getComputedStyle(el).borderTopColor,
        prevBorderColor: prev ? getComputedStyle(prev).borderTopColor : null,
        gapAbove:
          el.getBoundingClientRect().top -
          (prev?.getBoundingClientRect().bottom ?? 0),
      };
    });
    console.log("SETTINGS ROW", JSON.stringify(place));
    expect(place.heading).toBe("Conversation");
    expect(place.last).toBe(true);
    expect(place.sameGroupAsMessageText).toBe(true);
    expect(place.borderTop).toBe("1px");
    expect(place.borderColor).toBe(place.prevBorderColor);
    expect(place.gapAbove).toBe(0);
    measured.settings_row = place;
    await row.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    const settingsPath = `${SHOTS}/26-settings-row.png`;
    await row.locator("xpath=../..").screenshot({ path: settingsPath });
    shots.push(settingsPath);

    const pins = page.getByTestId("runtime-rail-pins-settings");
    await pins.scrollIntoViewIfNeeded();
    await expect(pins.locator("h3")).toHaveText("Runtimes");
    await expect(pins).toContainText(
      "Choose which installed harnesses appear on the Agents page.",
    );
    measured.runtime_pins_words = {
      heading: await pins.locator("h3").textContent(),
      line: await pins.locator("p").first().textContent(),
    };
    await waitForAnimations(page);
    const pinsPath = `${SHOTS}/27-runtime-pins-words.png`;
    await pins.screenshot({ path: pinsPath });
    shots.push(pinsPath);
  });

  test("agents page: Runtimes on the roster's axes", async ({ page }) => {
    await boot(page, { shell: true });
    await page.goto("/?e2e=mock#/agents");
    const section = page
      .getByTestId("agents-view")
      .getByTestId("sidebar-runtime-section");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(
      section.locator("[data-runtime-connection-key]").first(),
    ).toBeVisible({ timeout: 20000 });
    const axes = await page.evaluate(() => {
      const box = (el: Element | null | undefined) => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x, w: r.width, cx: r.x + r.width / 2 } : null;
      };
      const rosterRows = [
        ...document.querySelectorAll('[data-testid^="agent-library-row-"]'),
      ];
      const runtimeRows = [
        ...document.querySelectorAll(
          '[data-testid="agents-view"] [data-runtime-connection-key]',
        ),
      ];
      return {
        roster: rosterRows.map((row) => ({
          mark: box(row.firstElementChild),
          name: box(row.querySelector(".truncate")),
        })),
        runtimes: runtimeRows.map((row) => ({
          icon: box(row.firstElementChild?.querySelector("svg, img")),
          slot: box(row.firstElementChild),
          name: box(row.querySelector(".truncate")),
          border: getComputedStyle(row).borderLeftWidth,
        })),
      };
    });
    console.log("AGENTS AXES", JSON.stringify(axes));
    const markAxis = axes.roster[0]?.mark?.cx ?? 0;
    const textEdge = axes.roster[0]?.name?.x ?? 0;
    expect(axes.runtimes.length).toBeGreaterThan(0);
    for (const runtime of axes.runtimes) {
      expect(Math.abs((runtime.icon?.cx ?? 0) - markAxis)).toBeLessThan(0.5);
      expect(Math.abs((runtime.name?.x ?? 0) - textEdge)).toBeLessThan(0.5);
    }
    measured.runtimes_geometry = {
      markAxis,
      textEdge,
      runtimes: axes.runtimes,
    };
    await waitForAnimations(page);
    const path = `${SHOTS}/28-agents-runtimes.png`;
    await page
      .getByTestId("agents-view")
      .locator("aside")
      .first()
      .screenshot({ path });
    shots.push(path);
  });

  test("⌘K finds a project's room and opens it", async ({ page }) => {
    await boot(page, { shell: true });
    await expect(home(page, "project:tidepool")).toBeVisible();
    await page.getByTestId("open-search").click();
    // The dialog focuses its input a frame after it opens; type once it has.
    await expect(page.getByTestId("search-dialog-input")).toBeFocused();
    await page.keyboard.type("Landing page");
    const result = page.getByTestId(`search-result-channel-${ROOM.landing}`);
    await expect(result).toBeVisible({ timeout: 10000 });
    await waitForAnimations(page);
    const searchPath = `${SHOTS}/29-cmd-k-room-search.png`;
    await page.screenshot({ path: searchPath });
    shots.push(searchPath);
    await result.click();
    await expect(page.getByTestId("shell-lip-name")).toHaveText(
      "Landing page copy",
      { timeout: 20000 },
    );
    await expect(home(page, "project:tidepool")).toHaveAttribute(
      "data-active",
      "true",
    );
    // A collapsed home keeps the mark; opened, its room is the lit one.
    if (
      (await hit(page, "project:tidepool").getAttribute("aria-expanded")) ===
      "false"
    )
      await home(page, "project:tidepool").locator("[data-chevron]").click();
    await expect(session(page, ROOM.landing)).toHaveAttribute(
      "data-current",
      "true",
    );
    measured.cmd_k_room = {
      opened: await page.getByTestId("shell-lip-name").textContent(),
      projectActive: await home(page, "project:tidepool").getAttribute(
        "data-active",
      ),
      roomCurrent: await session(page, ROOM.landing).getAttribute(
        "data-current",
      ),
    };
    await shoot(page, "30-cmd-k-room-open", page.locator("body"));
  });

  test.afterAll(() => {
    console.log("WP02B MEASURED", JSON.stringify(measured));
  });
});

/** The reviewers' findings on WP-02b, each proven fixed where it was found. */
const fixes: Record<string, unknown> = {};
test.describe("the rail, finished: review fixes (WP-02b)", () => {
  test("one Escape closes Search opened by ⌘K", async ({ page }) => {
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    const runs: unknown[] = [];
    for (const route of ["#/pulse", "#/agents"]) {
      await page.goto(`/?e2e=mock${route}`);
      await expect(page.getByTestId("shell-places")).toBeVisible({
        timeout: 20000,
      });
      await page.mouse.move(1400, 880);
      await page.keyboard.press("ControlOrMeta+k");
      const dialog = page.getByTestId("search-results");
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("search-dialog-input")).toBeFocused();
      // Give a tooltip every chance to open on its own delay.
      await page.waitForTimeout(900);
      const tooltips = await page.locator('[role="tooltip"]').count();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      runs.push({
        route,
        tooltipsWhileOpen: tooltips,
        closedByOneEscape: true,
      });
      expect(tooltips).toBe(0);
    }
    // The tile's own tooltip still shows on hover, once Search is closed.
    await page.getByTestId("shell-place-search").hover();
    await expect(page.locator('[role="tooltip"]')).toHaveText(/Search/, {
      timeout: 5000,
    });
    // Clicking the tile and one Escape, as before.
    await page.getByTestId("open-search").click();
    await expect(page.getByTestId("search-results")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-results")).toBeHidden();
    fixes.search_escape = runs;
  });

  test("Conversations returns to the conversation you left", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    const places = [
      "open-artifacts-view",
      "open-agents-view",
      "open-activity-view",
      "open-brain-setup",
    ];
    const results: unknown[] = [];
    for (const place of places) {
      await page.goto(`/?e2e=mock#/channels/${ROOM.monday}`);
      await expect(page.getByTestId("shell-lip-name")).toHaveText(
        "Monday plan",
        {
          timeout: 20000,
        },
      );
      await page.getByTestId(place).click();
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .not.toContain(ROOM.monday);
      const away = await page.evaluate(() => window.location.hash);
      await page.getByTestId("shell-place-conversations").click();
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toContain(`/channels/${ROOM.monday}`);
      await expect(page.getByTestId("shell-lip-name")).toHaveText(
        "Monday plan",
      );
      results.push({
        place,
        away,
        back: await page.evaluate(() => window.location.hash),
      });
    }
    const inbox = page.getByTestId("open-inbox-view");
    if ((await inbox.count()) > 0) {
      await inbox.click();
      await page.getByTestId("shell-place-conversations").click();
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toContain(`/channels/${ROOM.monday}`);
      results.push({ place: "open-inbox-view", back: "monday" });
    }
    // With no conversation opened yet, Conversations is the new one.
    await page.goto("/?e2e=mock#/artifacts");
    await page.reload();
    await expect(page.getByTestId("shell-places")).toBeVisible({
      timeout: 20000,
    });
    await page.getByTestId("shell-place-conversations").click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/messages/new");
    fixes.conversations_place = {
      results,
      freshLoad: await page.evaluate(() => window.location.hash),
    };
    await shoot(page, "40-conversations-place-fresh", page.locator("body"));
  });

  test("scrolled rows slip under the card's top edge", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 });
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    const closed = page.locator(
      '[data-shell-rail] [data-chevron][data-expanded="false"]',
    );
    while ((await closed.count()) > 0) await closed.first().click();
    const geometry = (scrollTop: number) =>
      page.evaluate((top) => {
        const card = document.querySelector('[data-sidebar="sidebar"]');
        const scroller = document.querySelector(
          '[data-testid="app-sidebar-scroll-anchor"] [data-sidebar="content"]',
        );
        const row = document.querySelector("[data-shell-rail] [data-home]");
        if (!card || !scroller || !row) return null;
        scroller.scrollTop = top;
        return {
          scrollTop: scroller.scrollTop,
          cardTop: card.getBoundingClientRect().top,
          scrollerTop: scroller.getBoundingClientRect().top,
          firstRowTop: row.getBoundingClientRect().top,
          firstRowOffset:
            row.getBoundingClientRect().top - card.getBoundingClientRect().top,
        };
      }, scrollTop);
    const rest = await geometry(0);
    expect(rest?.firstRowOffset).toBe(6);
    expect(rest?.scrollerTop).toBe(rest?.cardTop);
    await page.mouse.move(780, 480);
    await waitForAnimations(page);
    const restPath = `${SHOTS}/41-rail-top-rest-800.png`;
    await page.screenshot({
      path: restPath,
      clip: { x: 44, y: 30, width: 226, height: 60 },
    });
    shots.push(restPath);
    const scrolled = await geometry(18);
    expect(scrolled?.scrollTop).toBe(18);
    // The viewport starts at the card's top, so the first row runs under
    // the card's edge instead of being cut 6 inside it.
    expect(scrolled?.scrollerTop).toBe(scrolled?.cardTop);
    expect(scrolled?.firstRowTop).toBe((scrolled?.cardTop ?? 0) + 6 - 18);
    await waitForAnimations(page);
    const scrolledPath = `${SHOTS}/42-rail-top-scrolled-800.png`;
    await page.screenshot({
      path: scrolledPath,
      clip: { x: 44, y: 30, width: 226, height: 60 },
    });
    shots.push(scrolledPath);
    fixes.rail_scroll_clip = { rest, scrolled };
  });

  test("a group's own chat is its home's conversation, not a session", async ({
    page,
  }) => {
    await boot(page, { shell: true });
    await expect(home(page, "luca")).toBeVisible();
    const planReview = "0e6a0000-0000-4000-8000-000000000009";
    await page.evaluate(
      async ({ id, luca, wren }) => {
        const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
        const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
        if (!invoke || !emit) throw new Error("Expected the mock bridge.");
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
            name: "Plan review",
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
          pubkeys: [luca, wren],
          role: "bot",
        });
        emit({
          channelId: id,
          content: "Plan review: first notes.",
          createdAt: Math.floor(Date.now() / 1000),
          pubkey: "deadbeef".repeat(8),
        });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
      },
      { id: planReview, luca: LUCA, wren: WREN },
    );
    const fleet = home(page, fleetId(LUCA, WREN));
    // The new room makes the group's home one with sessions; open it.
    const chevron = fleet.locator("[data-chevron]");
    await expect(chevron).toHaveCount(1, { timeout: 20000 });
    if ((await chevron.getAttribute("data-expanded")) === "false")
      await chevron.click();
    await expect(
      page.locator(`[data-shell-rail] [data-channel-id="${planReview}"]`),
    ).toHaveCount(1, { timeout: 20000 });
    const read = await page.evaluate(
      (id) => {
        const row = document.querySelector<HTMLElement>(
          `[data-shell-rail] [data-home="${id}"]`,
        );
        const group = row?.closest("[data-home-group]");
        return {
          name: row?.querySelector(".luca-rail-row-name")?.textContent ?? null,
          channel: row?.dataset.channelId ?? null,
          sessions: [
            ...(group?.querySelectorAll<HTMLElement>(".luca-rail-session") ??
              []),
          ].map((el) => el.textContent ?? ""),
        };
      },
      fleetId(LUCA, WREN),
    );
    console.log("FLEET OWN CHAT", JSON.stringify(read));
    expect(read.name).toBe("Luca + Wren");
    expect(read.channel).not.toBeNull();
    expect(read.sessions).toEqual(["Plan review"]);
    expect(read.sessions.some((title) => title.includes(","))).toBe(false);
    // The home's row opens the group's own chat.
    await hit(page, fleetId(LUCA, WREN)).click(ON_NAME);
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain(`/channels/${read.channel}`);
    await expect(fleet).toHaveAttribute("data-active", "true");
    fixes.fleet_own_chat = { ...read, opened: read.channel };
    await shoot(page, "43-fleet-own-chat");
  });

  test("Runtimes rows on the Agents page answer hover", async ({ page }) => {
    await boot(page, { shell: true });
    await page.goto("/?e2e=mock#/agents");
    const row = page
      .getByTestId("agents-view")
      .locator("[data-agents-runtimes] [data-runtime-connection-key]")
      .first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await page.mouse.move(1400, 880);
    await waitForAnimations(page);
    const style = () =>
      row.evaluate((el) => {
        const name = el.querySelector(".truncate") as HTMLElement | null;
        const slot = el.firstElementChild as HTMLElement | null;
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          radius: s.borderTopLeftRadius,
          name: name ? getComputedStyle(name).color : null,
          slot: slot ? getComputedStyle(slot).color : null,
        };
      });
    const rest = await style();
    const roster = await page
      .locator('[data-testid^="agent-library-row-"]')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    const box = await row.boundingBox();
    const section = page
      .getByTestId("agents-view")
      .locator("[data-agents-runtimes]");
    const restPath = `${SHOTS}/44-runtimes-rest.png`;
    await section.screenshot({ path: restPath });
    shots.push(restPath);
    await row.hover();
    await waitForAnimations(page);
    const hover = await style();
    const hoverPath = `${SHOTS}/45-runtimes-hover.png`;
    await section.screenshot({ path: hoverPath });
    shots.push(hoverPath);
    console.log("RUNTIMES HOVER", JSON.stringify({ rest, hover, roster, box }));
    expect(rest.background).toBe("rgba(0, 0, 0, 0)");
    expect(hover.background).not.toBe(rest.background);
    expect(hover.name).not.toBe(rest.name);
    expect(hover.slot).not.toBe(rest.slot);
    expect(rest.radius).toBe(roster);
    fixes.runtimes_hover = { rest, hover, rosterRadius: roster };
  });

  test.afterAll(() => {
    console.log("WP02B FIXES", JSON.stringify(fixes));
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

test("flag off: Settings → Appearance and the Agents page, unchanged", async ({
  page,
}) => {
  await boot(page, { shell: false });
  const port = process.env.LUCA_PLAYWRIGHT_PORT ?? "base";
  const hash = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  await page.goto("/?e2e=mock#/settings");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const pins = page.getByTestId("runtime-rail-pins-settings");
  await expect(pins).toBeVisible({ timeout: 20000 });
  await expect(pins.locator("h3")).toHaveText("Sidebar runtimes");
  await expect(page.getByTestId("project-rooms-setting")).toHaveCount(0);
  await pins.scrollIntoViewIfNeeded();
  await page.mouse.move(1400, 880);
  await waitForAnimations(page);
  const settingsPath = `${SHOTS}/00-flag-off-settings-${port}.png`;
  await pins.locator("xpath=..").screenshot({ path: settingsPath });
  console.log("FLAG OFF SETTINGS HASH", port, hash(settingsPath));

  await page.goto("/?e2e=mock#/agents");
  await expect(page.getByTestId("agents-view")).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByTestId("agents-view").getByTestId("sidebar-runtime-section"),
  ).toHaveCount(0);
  await page.mouse.move(1400, 880);
  await waitForAnimations(page);
  const agentsPath = `${SHOTS}/00-flag-off-agents-${port}.png`;
  await page.getByTestId("agents-view").screenshot({ path: agentsPath });
  console.log("FLAG OFF AGENTS HASH", port, hash(agentsPath));
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
