import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { railGlassAtRest } from "./flagOffSettle";

/**
 * A project's rooms in the shell's Chats rail. Riley, 2026-10-27: "they
 * should show each room/chat within the project below the project". WP-34
 * had read his note on the line under a home ("it should be used for agents
 * and their task sessions specifically. so like not below projects for each
 * chat within a prject") as "projects never nest", and kept the rooms in the
 * project's column. He meant the line: the rooms sit under the project again,
 * as they did before WP-34, on no thread, and Settings' Project rooms puts
 * them back in a column. A new project made from the rail's +, and a project
 * with several rooms. The classic layout (the flag off) is compared by hash
 * with PROJECT_ROOMS_BASE_URL. Screenshots land in PROJECT_ROOMS_SHOTS,
 * measurements in PROJECT_ROOMS_SHOTS/measures.
 */

const SHOTS =
  process.env.PROJECT_ROOMS_SHOTS ?? "test-results/shell-project-rooms";
const BASE_URL = process.env.PROJECT_ROOMS_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
/** The default mock's rooms, by their fixed ids. */
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RANDOM = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
const ENGINEERING = "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9";

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 240_000 });

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

async function shot(
  page: Page,
  name: string,
  { still = false }: { still?: boolean } = {},
) {
  await page.mouse.move(1400, 880);
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    path,
    ...(still
      ? {
          animations: "disabled" as const,
          mask: [page.locator("[data-flagoff-mask]")],
        }
      : {}),
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Tidepool, a project of the default mock's rooms, put in the project store
 *  before the app reads it (after the mock bridge seeds the community). */
async function seedTidepool(page: Page, rooms: readonly string[]) {
  await page.addInitScript((ids) => {
    const community = (
      JSON.parse(localStorage.getItem("buzz-communities") ?? "[]") as {
        pubkey: string;
        relayUrl: string;
      }[]
    )[0];
    if (!community) return;
    const scope = (value: string) =>
      encodeURIComponent(value.trim().toLowerCase());
    localStorage.setItem(
      `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
      JSON.stringify({
        version: 1,
        projects: [{ id: "tidepool", label: "Tidepool" }],
        assignments: Object.fromEntries(ids.map((id) => [id, "tidepool"])),
      }),
    );
  }, rooms);
}

async function boot(
  page: Page,
  {
    hash = `/channels/${GENERAL}`,
    light = false,
    origin = "",
    seed,
    shell = true,
  }: {
    hash?: string;
    light?: boolean;
    origin?: string;
    seed?: readonly string[];
    shell?: boolean;
  } = {},
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: LUCA,
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
    ],
  });
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
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light, on: shell },
  );
  if (seed) await seedTidepool(page, seed);
  await expect(async () => {
    await page.goto(`${origin}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

const home = (page: Page, id: string) => page.getByTestId(`rail-home-${id}`);
const hit = (page: Page, id: string) =>
  home(page, id).locator('[data-rail-focus="home"]');
const group = (page: Page, id: string) =>
  page.locator(`[data-shell-rail] [data-home-group="${id}"]`);
/** A home's own rows: its rooms or sessions, never "N more". */
const rooms = (page: Page, id: string) =>
  group(page, id).locator('[data-rail-focus="session"][data-channel-id]');

async function titles(page: Page, id: string) {
  return group(page, id)
    .locator('[data-rail-focus="session"]')
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.querySelector(".luca-rail-session-title")?.textContent ??
          row.textContent?.trim(),
      ),
    );
}

/** A project's rooms on the rail's axes: each title's start against the
 *  project's name, and whether its row draws a stretch of thread; the same
 *  for an agent's sessions, which keep theirs. */
async function geometry(page: Page, id: string) {
  return page.evaluate((homeId) => {
    const of = (selector: string) => {
      const groupEl = document.querySelector(
        `[data-shell-rail] [data-home-group="${selector}"]`,
      );
      const name = groupEl
        ?.querySelector(".luca-rail-row-name")
        ?.getBoundingClientRect().left;
      return [
        ...(groupEl?.querySelectorAll<HTMLElement>(
          '[data-rail-focus="session"][data-channel-id]',
        ) ?? []),
      ].map((row) => ({
        title: row.querySelector(".luca-rail-session-title")?.textContent,
        title_minus_name:
          name === undefined
            ? null
            : Math.round(
                ((row
                  .querySelector(".luca-rail-session-title")
                  ?.getBoundingClientRect().left ?? 0) -
                  name) *
                  100,
              ) / 100,
        thread: getComputedStyle(row, "::before").content,
      }));
    };
    const agentGroup = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-shell-rail] [data-home-group^='agent:']",
      ),
    ].find((each) => each.querySelector("[data-channel-id]"));
    return {
      project: of(homeId),
      agent: agentGroup ? of(agentGroup.dataset.homeGroup ?? "") : [],
      sessions_label: document
        .querySelector(
          `[data-shell-rail] [data-home-group="${homeId}"] fieldset`,
        )
        ?.getAttribute("aria-label"),
    };
  }, id);
}

async function makeProject(page: Page, label: string, room?: string) {
  await page
    .locator("[data-shell-rail]")
    .getByRole("button", { name: "New project" })
    .click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-project-name").fill(label);
  if (room) await dialog.getByTestId("create-project-room-name").fill(room);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** A new room from the project row's +, which shows under the project the
 *  moment it exists. */
async function addRoom(
  page: Page,
  projectId: string,
  label: string,
  name: string,
) {
  await home(page, projectId).hover();
  await home(page, projectId)
    .getByRole("button", { name: `New room in ${label}` })
    .click();
  const dialog = page.getByTestId("create-channel-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-channel-name").fill(name);
  await dialog.getByTestId("create-channel-submit").click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(
    rooms(page, projectId).filter({ hasText: name }),
  ).toHaveAttribute("data-current", "true", { timeout: 15_000 });
}

test("a new project: its first room sits under it, on no thread", async ({
  page,
}) => {
  await boot(page);
  // As Riley made his: a project called test, with the first room the
  // dialog offers.
  await makeProject(page, "test");
  const room = rooms(page, "project:test");
  await expect(room).toHaveCount(1);
  await expect(room).toContainText("general");
  await expect(room).toHaveAttribute("data-current", "true");
  await expect(room).toHaveAttribute("aria-current", "page");
  await expect(home(page, "project:test")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(hit(page, "project:test")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // A project wears its folder (WP-34, Decided 6); its room is a title only.
  await expect(
    home(page, "project:test").locator(".luca-rail-face svg"),
  ).toHaveClass(/lucide-folder/);
  await expect(room.locator("svg")).toHaveCount(0);
  // The room is listed once: under the project, never as a loose room, and
  // never again in a column beside the conversation.
  const id = await room.getAttribute("data-channel-id");
  await expect(
    page.locator(`[data-shell-rail] [data-channel-id="${id}"]`),
  ).toHaveCount(1);
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  await expect(page.getByTestId("project-room-picker-trigger")).toHaveCount(0);
  await expect(page.getByTestId("shell-lip-name")).toHaveText("test/general");
  const shape = await geometry(page, "project:test");
  measure("new_project", shape);
  expect(shape.sessions_label).toBe("test's rooms");
  expect(shape.project.map((each) => each.thread)).toEqual(["none"]);
  for (const each of shape.project)
    expect(Math.abs(each.title_minus_name ?? 99)).toBeLessThan(1);
  // An agent's sessions keep their thread.
  expect(shape.agent.length).toBeGreaterThan(0);
  for (const each of shape.agent) expect(each.thread).not.toBe("none");
  await shot(page, "new-project-night");
});

test("a project with several rooms: the latest three, N more, the open one lit", async ({
  page,
}) => {
  await boot(page);
  await makeProject(page, "Tidepool", "landing page");
  for (const name of ["chapter nine", "launch notes", "press kit"])
    await addRoom(page, "project:tidepool", "Tidepool", name);

  // Newest first, the latest three and "1 more"; the one just made is open.
  expect(await titles(page, "project:tidepool")).toEqual([
    "press kit",
    "launch notes",
    "chapter nine",
    "1 more",
  ]);
  await expect(page.getByTestId("shell-lip-name")).toHaveText(
    "Tidepool/press kit",
  );
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  const shape = await geometry(page, "project:tidepool");
  measure("several_rooms", shape);
  for (const each of shape.project) {
    expect(each.thread).toBe("none");
    expect(Math.abs(each.title_minus_name ?? 99)).toBeLessThan(1);
  }
  for (const each of shape.agent) expect(each.thread).not.toBe("none");
  await shot(page, "several-rooms-night");

  // "1 more" opens the whole list; the oldest opened stays in view after
  // "Show fewer", the open one wherever it falls.
  await page.getByTestId("rail-more-project:tidepool").click();
  await rooms(page, "project:tidepool")
    .filter({ hasText: "landing page" })
    .click();
  await expect(
    rooms(page, "project:tidepool").filter({ hasText: "landing page" }),
  ).toHaveAttribute("data-current", "true");
  await expect(home(page, "project:tidepool")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByTestId("rail-fewer-project:tidepool").click();
  expect(await titles(page, "project:tidepool")).toEqual([
    "press kit",
    "launch notes",
    "chapter nine",
    "landing page",
  ]);
  // Each room is listed once in the rail.
  for (const id of await rooms(page, "project:tidepool").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-channel-id") ?? ""),
  ))
    await expect(
      page.locator(`[data-shell-rail] [data-channel-id="${id}"]`),
    ).toHaveCount(1);

  // The keys: Left folds the project, Right opens it and steps into its
  // first room, Left steps back out.
  await hit(page, "project:tidepool").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(hit(page, "project:tidepool")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(rooms(page, "project:tidepool")).toHaveCount(0);
  // Folded, the project still carries the selection.
  await expect(home(page, "project:tidepool")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await expect(rooms(page, "project:tidepool")).toHaveCount(4);
  await page.keyboard.press("ArrowRight");
  await expect(rooms(page, "project:tidepool").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(hit(page, "project:tidepool")).toBeFocused();
});

test("folding is remembered; Project rooms puts them in a column, and back", async ({
  page,
}) => {
  await boot(page, { seed: [GENERAL, RANDOM, ENGINEERING] });
  await expect(rooms(page, "project:tidepool")).toHaveCount(3);
  await expect(
    rooms(page, "project:tidepool").filter({ hasText: "general" }),
  ).toHaveAttribute("data-current", "true");
  // The project's rooms left the loose rooms.
  for (const id of [GENERAL, RANDOM, ENGINEERING])
    await expect(home(page, `room:${id}`)).toHaveCount(0);

  // The chevron folds it, and it stays folded.
  await home(page, "project:tidepool").locator("[data-chevron]").click();
  await expect(rooms(page, "project:tidepool")).toHaveCount(0);
  await page.reload();
  await expect(home(page, "project:tidepool")).toBeVisible({
    timeout: 20_000,
  });
  await expect(hit(page, "project:tidepool")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(home(page, "project:tidepool")).toHaveAttribute(
    "data-active",
    "true",
  );
  await home(page, "project:tidepool").locator("[data-chevron]").click();
  await expect(rooms(page, "project:tidepool")).toHaveCount(3);

  // Settings → Appearance → Project rooms: In a column.
  await page.goto("/#/settings?section=appearance");
  const setting = page.getByTestId("project-rooms-setting");
  await expect(setting).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("project-rooms-rail")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("project-rooms-column").click();
  await expect(page.getByTestId("project-rooms-column")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto(`/#/channels/${GENERAL}`);
  await expect(page.getByTestId("project-room-navigator")).toBeVisible({
    timeout: 20_000,
  });
  for (const id of [GENERAL, RANDOM, ENGINEERING])
    await expect(page.getByTestId(`project-room-${id}`)).toBeVisible();
  await expect(rooms(page, "project:tidepool")).toHaveCount(0);
  await expect(
    home(page, "project:tidepool").locator("[data-chevron]"),
  ).toHaveCount(0);
  await expect(page.getByTestId("project-room-picker-trigger")).toHaveCount(1);
  await shot(page, "in-a-column-night");

  // In the rail again.
  await page.goto("/#/settings?section=appearance");
  await page.getByTestId("project-rooms-rail").click();
  await page.goto(`/#/channels/${GENERAL}`);
  await expect(rooms(page, "project:tidepool")).toHaveCount(3, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
});

test("by day: the rooms under the project, on no thread", async ({ page }) => {
  await boot(page, { light: true, seed: [GENERAL, RANDOM, ENGINEERING] });
  await expect(rooms(page, "project:tidepool")).toHaveCount(3);
  const shape = await geometry(page, "project:tidepool");
  measure("by_day", shape);
  for (const each of shape.project) {
    expect(each.thread).toBe("none");
    expect(Math.abs(each.title_minus_name ?? 99)).toBeLessThan(1);
  }
  for (const each of shape.agent) expect(each.thread).not.toBe("none");
  await shot(page, "several-rooms-day");
});

test("flag off: the classic layout is the same as the base build", async ({
  browser,
}) => {
  const hashes: string[] = [];
  for (const [index, origin] of ["", BASE_URL, BASE_URL].entries()) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
    const page = await context.newPage();
    await boot(page, {
      origin,
      seed: [GENERAL, RANDOM, ENGINEERING],
      shell: false,
    });
    await expect(page.getByTestId("project-row-tidepool")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("project-room-navigator")).toBeVisible();
    await page.waitForTimeout(1500);
    await railGlassAtRest(page);
    // The residents' marks over the composer glance on a timer, so the base
    // differs from itself there, a few points past the ledge's own box (seen
    // at its right edge): both builds' shots mask the ledge, 12 points wider
    // all round, and nothing else.
    await page.evaluate(() => {
      const ledge = document
        .querySelector('[data-testid="composer-agent-ledge"]')
        ?.getBoundingClientRect();
      if (!ledge) return;
      const patch = document.createElement("div");
      patch.setAttribute("data-flagoff-mask", "");
      Object.assign(patch.style, {
        height: `${ledge.height + 24}px`,
        left: `${ledge.left - 12}px`,
        pointerEvents: "none",
        position: "fixed",
        top: `${ledge.top - 12}px`,
        width: `${ledge.width + 24}px`,
      });
      document.body.append(patch);
    });
    hashes.push(
      await shot(page, `flagoff-${["here", "base", "base-again"][index]}`, {
        still: true,
      }),
    );
    await context.close();
  }
  measure("flag_off", {
    base: hashes[1],
    baseAgain: hashes[2],
    here: hashes[0],
    same: hashes[0] === hashes[1],
  });
  expect(hashes[0]).toBe(hashes[1]);
});
