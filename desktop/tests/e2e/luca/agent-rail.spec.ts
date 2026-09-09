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
  await expect(column.locator('[data-testid^="agent-column-chat-"]')).toHaveCount(
    1,
  );
  await expect(
    column.locator('[data-testid^="agent-column-chat-"]'),
  ).toContainText("Atlas");

  // Bex's column does not borrow Atlas's thread, and the loose rows below
  // the rail never show a chat that belongs to a resident.
  await page.getByTestId("agent-rail-bex").click();
  await expect(column).toContainText("Bex");
  await expect(column.locator('[data-testid^="agent-column-chat-"]')).toHaveCount(
    0,
  );
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
