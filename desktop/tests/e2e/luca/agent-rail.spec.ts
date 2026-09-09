import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

/**
 * The rail after the restructure: PROJECTS, then AGENTS (one row per
 * resident), then runtimes. Choosing a resident opens the agent column —
 * every conversation they are part of — and that column and the project
 * room navigator are both "the second column": only one is ever open.
 */

const ATLAS_PUBKEY = "a".repeat(64);
const BEX_PUBKEY = "b".repeat(64);

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      { name: "Atlas", pubkey: ATLAS_PUBKEY, status: "running" },
      { name: "Bex", pubkey: BEX_PUBKEY, status: "running" },
    ],
  });
});

test("the rail reads Projects and Agents, and lists residents rather than chats", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  const rail = page.getByTestId("app-sidebar");
  const rooms = page.getByTestId("chat-channels");
  const agents = page.getByTestId("chat-direct-messages");
  await expect(rooms.getByText("Projects", { exact: true })).toBeVisible();
  await expect(agents.getByText("Agents", { exact: true })).toBeVisible();
  await expect(rail.getByText("Channels", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Direct messages", { exact: true })).toHaveCount(
    0,
  );

  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
  await expect(page.getByTestId("agent-rail-bex")).toBeVisible();
  // A direct message with a person, not a resident, keeps its own row.
  await expect(page.getByTestId("channel-alice-tyler")).toBeVisible();
  await expect(page.getByTestId("agent-chats-column")).toHaveCount(0);
});

test("a resident's column offers the direct thread until it exists, then lists it by name", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  const column = page.getByTestId("agent-chats-column");
  await expect(column).toBeVisible();
  await expect(column.getByRole("heading")).toHaveCount(0);
  await expect(column).toContainText("Atlas");

  const start = page.getByTestId("agent-column-new-chat");
  await expect(start).toHaveText(/Chat with Atlas/);
  await start.click();

  // The canonical pair thread now exists, so the offer is gone and the thread
  // is a row wearing the resident's own name.
  await expect(start).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(
    column.locator('[data-testid^="agent-column-chat-"]'),
  ).toHaveCount(1);
  await expect(
    column.locator('[data-testid^="agent-column-chat-"]'),
  ).toContainText("Atlas");

  // Bex's column does not borrow Atlas's thread, and the loose rows below
  // the rail never show a chat that belongs to a resident.
  await page.getByTestId("agent-rail-bex").click();
  await expect(column).toContainText("Bex");
  await expect(
    column.locator('[data-testid^="agent-column-chat-"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("agent-column-new-chat")).toHaveText(
    /Chat with Bex/,
  );
  await expect(page.getByTestId("channel-alice-tyler")).toBeVisible();

  // Choosing the open resident again closes the column.
  await page.getByTestId("agent-rail-bex").click();
  await expect(column).toHaveCount(0);
});

test("the agent column and the project room navigator never open together", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();

  await page.getByTestId("agent-rail-atlas").click();
  const column = page.getByTestId("agent-chats-column");
  await expect(column).toBeVisible();
  await expect(navigator).toHaveCount(0);
  // The conversation itself stays put; only the navigator stepped aside.
  await expect(page.getByTestId("chat-title")).toBeVisible();

  await page.getByTestId("project-row-luca").click();
  await expect(column).toHaveCount(0);
  await expect(navigator).toBeVisible();
});

test("an empty project keeps its content while a resident's column is open", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-field-unit").click();
  await expect(page).toHaveURL(/#\/projects\/field-unit$/);
  const heading = page.getByRole("heading", {
    name: /has no conversations yet/i,
  });
  await expect(heading).toBeVisible();

  await page.getByTestId("agent-rail-atlas").click();
  await expect(page.getByTestId("agent-chats-column")).toBeVisible();
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  await expect(heading).toBeVisible();
});

test("leaving for another destination closes the column; arriving in a chat keeps it", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  const column = page.getByTestId("agent-chats-column");
  await expect(column).toBeVisible();

  // Picking a chat from inside the column is what the column is for.
  await page.getByTestId("agent-column-new-chat").click();
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(column).toBeVisible();

  // Going somewhere else entirely is a change of destination.
  await page
    .locator('[data-sidebar="menu-button"]', { hasText: "Brain" })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await expect(column).toHaveCount(0);
});

test("on a phone the column takes the rail's place and backs out of it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId("agent-rail-atlas").click();
  const column = page.getByTestId("agent-chats-column");
  await expect(column).toBeVisible();
  const box = await column.boundingBox();
  expect(box?.x ?? 1).toBeLessThanOrEqual(1);

  await column.getByRole("button", { name: "Back to agents" }).click();
  await expect(column).toHaveCount(0);
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
});

// Two regressions Codex reproduced in review (agent-rail-review.spec.ts,
// folded in here so the rail has one spec).

test("starting a resident's thread on a phone reveals the conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(page).toHaveURL(/#\/channels\//);
  // The sheet steps aside for the thread it just opened, exactly as it does
  // when an existing row is chosen.
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toBeHidden({ timeout: 1500 });
});

test("column rows keep the rail's context actions", async ({ page }) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const row = page
    .getByTestId("agent-chats-column")
    .locator('[data-testid^="agent-column-chat-"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-channel-id", /.+/);
  await row.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /mark.*unread/i }),
  ).toBeVisible({ timeout: 1500 });
});

test("a thread that fails to open says so and leaves the column in place", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [{ name: "Atlas", pubkey: ATLAS_PUBKEY, status: "running" }],
    openDmErrors: ["Runtime unavailable."],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();

  await expect(page.getByText("Couldn't open the conversation")).toBeVisible();
  await expect(page.getByText("Runtime unavailable.")).toBeVisible();
  await expect(page).not.toHaveURL(/#\/channels\//);
  await expect(page.getByTestId("agent-chats-column")).toBeVisible();
  await expect(page.getByTestId("agent-column-new-chat")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toBeVisible();
});

test("collapsing the rail keeps the resident's column as the pane", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const column = page.getByTestId("agent-chats-column");
  const row = column.locator('[data-testid^="agent-column-chat-"]');
  await expect(row).toHaveCount(1);

  // Put the rail away: the column stays, at the left edge, and still works.
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(page.getByTestId("agent-rail-atlas")).toBeHidden();
  await expect(column).toBeVisible();
  await expect
    .poll(async () => (await column.boundingBox())?.x ?? -1)
    .toBeLessThanOrEqual(1);
  // The column's header sits below the window-controls strip, as the rail's
  // first row does — nothing of it hides under the traffic lights or the nav.
  const chrome = await page.getByTestId("app-top-chrome").boundingBox();
  const header = await column.locator("header").boundingBox();
  expect(header?.y ?? -1).toBeGreaterThanOrEqual(
    (chrome?.y ?? 0) + (chrome?.height ?? 0) - 1,
  );
  await row.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /mark.*unread/i }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Bring the rail back: it returns beside the column, which never left.
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
  await expect(column).toBeVisible();
  await expect
    .poll(async () => (await column.boundingBox())?.x ?? -1)
    .toBeGreaterThan(100);
});

test("with the rail collapsed, hovering the column's edge peeks the rail beside it", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  const column = page.getByTestId("agent-chats-column");
  await expect(page.getByTestId("agent-rail-atlas")).toBeHidden();

  await page.getByTestId("sidebar-peek-edge").hover();
  await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
  await expect
    .poll(async () => (await column.boundingBox())?.x ?? -1)
    .toBeGreaterThan(100);

  // Leaving the sidebar altogether puts the rail away again; the column
  // returns to the edge and the collapse was never undone.
  await page.mouse.move(1000, 400);
  await expect(page.getByTestId("agent-rail-atlas")).toBeHidden();
  await expect
    .poll(async () => (await column.boundingBox())?.x ?? -1)
    .toBeLessThanOrEqual(1);
});

test("the rail still scrolls while a resident's column is open", async ({
  page,
}) => {
  // Short enough that the rail's list must scroll.
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("agent-rail-atlas").click();
  await expect(page.getByTestId("agent-chats-column")).toBeVisible();

  const anchor = page.getByTestId("app-sidebar-scroll-anchor");
  const viewport = await page.viewportSize();
  const anchorBox = await anchor.boundingBox();
  // The rail is sized to the window, not to its content.
  expect(anchorBox?.height ?? 0).toBeLessThanOrEqual(viewport?.height ?? 0);

  await page.getByTestId("agent-rail-atlas").hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() =>
      anchor.evaluate((el) =>
        Math.max(
          0,
          ...Array.from(el.querySelectorAll<HTMLElement>("*")).map(
            (node) => node.scrollTop,
          ),
        ),
      ),
    )
    .toBeGreaterThan(0);
});

test("both second-column headers sit at the height of the rail's first row", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");
  const railFirstRow = await page
    .getByTestId("sidebar-pinned-header")
    .evaluate((el) => {
      const first = el.querySelector("button, input, [role='button']");
      return (first ?? el).getBoundingClientRect().top;
    });

  // Rail open: the agent column's header lines up with the rail's search row.
  await page.getByTestId("agent-rail-atlas").click();
  const columnHeader = page.getByTestId("agent-chats-column").locator("header");
  await expect
    .poll(async () =>
      Math.abs(((await columnHeader.boundingBox())?.y ?? -99) - railFirstRow),
    )
    .toBeLessThanOrEqual(6);

  // Same for the project navigator's title.
  await page.getByTestId("project-row-luca").click();
  const navigatorHeader = page
    .getByTestId("project-room-navigator")
    .locator("header");
  await expect(navigatorHeader).toBeVisible();
  // Polled: the plane is still arriving when the navigator first reports visible.
  await expect
    .poll(async () =>
      Math.abs(
        ((
          await navigatorHeader.locator("[data-luca-header-meta]").boundingBox()
        )?.y ?? -99) - railFirstRow,
      ),
    )
    .toBeLessThanOrEqual(8);

  // Collapse the rail: the navigator is now the leading surface and its
  // title is clear of the strip where the window controls and nav live.
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  const chrome = await page.getByTestId("app-top-chrome").boundingBox();
  await expect
    .poll(
      async () =>
        (await navigatorHeader.locator("[data-luca-header-meta]").boundingBox())
          ?.y ?? -1,
    )
    .toBeGreaterThanOrEqual((chrome?.y ?? 0) + (chrome?.height ?? 0) - 1);
});

test("Escape closes a keyboard-opened column and returns focus to the resident's row", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");
  // From a room, not the compose view: its recipient popover is still leaving
  // when the column opens, and a leaving Radix layer claims the first Escape.
  await page.getByTestId("channel-watercooler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("watercooler");

  const atlas = page.getByTestId("agent-rail-atlas");
  const column = page.getByTestId("agent-chats-column");
  const focusInsideColumn = () =>
    page.evaluate(
      () =>
        document.activeElement?.closest(
          '[data-testid="agent-chats-column"]',
        ) !== null,
    );
  await atlas.focus();
  await page.keyboard.press("Enter");
  await expect(column).toBeVisible();
  // Opened from the keyboard, the column takes focus at its first control
  // once the rows have landed.
  await expect.poll(focusInsideColumn).toBe(true);

  await page.keyboard.press("Escape");
  await expect(column).toHaveCount(0);
  await expect(atlas).toBeFocused();
});

test("a pointer open leaves focus where it was", async ({ page }) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  await expect(page.getByTestId("agent-column-new-chat")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.activeElement?.closest(
          '[data-testid="agent-chats-column"]',
        ) !== null,
    ),
  ).toBe(false);
});

test("the column arrives and leaves on the compositor, and holds still under reduced motion", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  const atlas = page.getByTestId("agent-rail-atlas");
  const column = page.getByTestId("agent-chats-column");
  await atlas.click();
  await expect(column).toHaveAttribute("data-panel-open", "true");
  const transitions = await column.evaluate((el) => ({
    column: getComputedStyle(el).transitionProperty,
    mover: el.parentElement
      ? getComputedStyle(el.parentElement).transitionProperty
      : "",
  }));
  // The column fades and drifts; the mover slides by transform. Nothing
  // here animates `left` or `width`.
  expect(transitions.column).toMatch(/opacity/);
  expect(transitions.column).toMatch(/translate/);
  expect(transitions.mover).toMatch(/transform|translate/);
  expect(transitions.mover).not.toMatch(/left|width/);

  // Closing keeps the column through its exit, then lets it go.
  await atlas.click();
  await expect(column).toHaveAttribute("data-panel-open", "false");
  await expect(column).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await atlas.click();
  await expect(column).toHaveAttribute("data-panel-open", "true");
  expect(
    await column.evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test("the keyboard opens a column row's menu", async ({ page }) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const row = page
    .getByTestId("agent-chats-column")
    .locator('[data-testid^="agent-column-chat-"]')
    .first();
  await expect(row).toBeVisible();
  await row.focus();
  // The keyboard's menu key reaches the row as a `contextmenu` event from the
  // browser (Shift+F10 is not one on macOS); this is what that event does.
  await row.dispatchEvent("contextmenu");
  await expect(
    page.getByRole("menuitem", { name: /mark.*unread/i }),
  ).toBeVisible({ timeout: 1500 });
});

test("a runtime and a resident's column never open together", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");
  const column = page.getByTestId("agent-chats-column");
  const runtimePanel = page.getByTestId("runtime-sessions-panel");

  await page.getByTestId("agent-rail-atlas").click();
  await expect(column).toHaveAttribute("data-panel-open", "true");

  // A runtime replaces the column.
  await page.getByTestId("runtime-rail-claude_code").click();
  await expect(runtimePanel).toBeVisible();
  await expect(column).toHaveCount(0);

  // And a resident replaces the runtime panel.
  await page.getByTestId("agent-rail-atlas").click();
  await expect(column).toHaveAttribute("data-panel-open", "true");
  await expect(runtimePanel).toHaveCount(0);
});

test("the rail slides by transform, the inset changes once, and the phone sheet is on the drawer curve", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  const container = page.getByTestId("app-sidebar");
  const styles = () =>
    container.evaluate((el) => ({
      container: getComputedStyle(el).transitionProperty,
      gapDuration: el.previousElementSibling
        ? getComputedStyle(el.previousElementSibling).transitionDuration
        : "",
      translate: getComputedStyle(el).translate,
    }));
  const resting = await styles();
  expect(resting.container).toMatch(/transform|translate/);
  expect(resting.container).not.toMatch(/left|right/);
  expect(resting.gapDuration).toBe("0s");

  // Collapse: the container leaves by translate; the gap is gone at once.
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect.poll(async () => (await styles()).translate).toMatch(/^-\d+px/);
  expect(
    await container.evaluate((el) =>
      el.previousElementSibling
        ? el.previousElementSibling.getBoundingClientRect().width
        : -1,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect
    .poll(async () => (await styles()).translate)
    .toMatch(/^(none|0px)/);

  // The phone sheet arrives on the house drawer curve.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
  await expect(sheet).toBeVisible();
  const motion = await sheet.evaluate((el) => ({
    duration: getComputedStyle(el).animationDuration,
    easing: getComputedStyle(el).animationTimingFunction,
  }));
  expect(motion.duration).toBe("0.26s");
  expect(motion.easing).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
});
