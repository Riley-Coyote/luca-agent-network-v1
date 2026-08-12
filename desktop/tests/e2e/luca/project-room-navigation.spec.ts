import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const EXISTING_RESIDENT_PUBKEY = "a".repeat(64);

test.beforeEach(async ({ page }, testInfo) => {
  await installMockBridge(page, {
    addChannelMembersErrors: testInfo.title.includes("membership failure")
      ? ["Membership unavailable.", null]
      : undefined,
    createChannelErrors: testInfo.title.includes("room failure")
      ? ["Room unavailable."]
      : undefined,
    managedAgents: [
      {
        name: "Atlas",
        pubkey: EXISTING_RESIDENT_PUBKEY,
        status: "running",
      },
    ],
  });
});

async function commandLog(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
}

async function storedProjects(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("luca-room-projects.v1:"),
    );
    if (!key) return null;
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      projects: Array<{ id: string; sourceIds?: string[] }>;
      assignments: Record<string, string>;
    } | null;
  });
}

test("projects open their room navigator and remember the selected room", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await expect(page.getByTestId("chat-title")).toBeVisible();

  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");

  await page.getByTestId("channel-alice-tyler").click();
  await expect(navigator).toHaveCount(0);
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");

  await page.getByTestId("project-row-luca").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(navigator).toBeVisible();
});

test("project search and empty-project navigation stay purposeful", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  const search = navigator.getByRole("searchbox");
  await search.fill("not-a-room");
  await expect(navigator).toContainText("No rooms match");
  await search.fill("");
  await expect(navigator).toContainText("engineering");

  await page.getByTestId("project-row-field-unit").click();
  await expect(page).toHaveURL(/#\/projects\/field-unit$/);
  await expect(
    page.getByRole("heading", { name: /has no conversations yet/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create first room" }),
  ).toBeVisible();
});

test("mobile projects move from their room list into the conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByTestId("project-row-luca").click();
  const mobileBack = page.locator(".luca-project-mobile-back");
  await expect(mobileBack).toBeVisible();
  await mobileBack.click();

  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(mobileBack).toBeVisible();
});

test("a new project creates its first real room with chosen connected context", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-project-name").fill("Launch Work");
  await dialog.getByTestId("create-project-room-name").fill("planning");
  await expect(dialog.getByText("luca-agent-network")).toBeVisible();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("project-row-launch-work")).toBeVisible();
  await expect(page.getByTestId("chat-title")).toHaveText("planning");
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await expect(navigator).toContainText("2 connected sources");

  await navigator.getByRole("button", { name: "New room" }).click();
  const roomDialog = page.getByTestId("create-channel-dialog");
  await expect(roomDialog).toContainText("Create a new room");
  await roomDialog.getByTestId("create-channel-name").fill("shipping");
  await roomDialog.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("chat-title")).toHaveText("shipping");
  await expect(navigator.getByText("shipping", { exact: true })).toBeVisible();
});

test("a project can begin empty with no room residents or sources", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Quiet Research");
  await dialog.getByTestId("project-first-room-enabled").click();
  await dialog.getByRole("button", { name: "Clear" }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("project-row-quiet-research")).toBeVisible();
  const store = await storedProjects(page);
  expect(store?.projects).toEqual([
    expect.objectContaining({ id: "quiet-research", sourceIds: [] }),
  ]);
  expect(store?.assignments).toEqual({});
  expect(
    (await commandLog(page)).filter(
      (entry) => entry.command === "create_channel",
    ),
  ).toHaveLength(0);
});

test("a first room attaches selected existing residents as membership only", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Resident Work");
  await dialog.getByTestId("create-project-room-name").fill("resident-room");
  await dialog.getByTestId("project-resident-mode-existing").click();
  await dialog.getByText("Atlas", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByTestId("chat-title")).toHaveText("resident-room");
  const membershipCalls = (await commandLog(page)).filter(
    (entry) => entry.command === "add_channel_members",
  );
  expect(membershipCalls).toHaveLength(1);
  expect(membershipCalls[0]?.payload).toEqual({
    channelId: expect.any(String),
    pubkeys: [EXISTING_RESIDENT_PUBKEY],
    role: "bot",
  });
  expect(JSON.stringify(membershipCalls)).not.toMatch(
    /runtime|provider|model|tools|mcp|budget|grant|signing|authority/i,
  );
});

test("a new resident handoff contains only the exact created room identity", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener(
      "buzz:open-create-agent",
      (event) => {
        (
          window as Window & { __PRJ201_AGENT_REQUEST__?: unknown }
        ).__PRJ201_AGENT_REQUEST__ = (event as CustomEvent).detail;
      },
      { capture: true },
    );
  });
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Agent Handoff");
  await dialog.getByTestId("create-project-room-name").fill("agent-room");
  await dialog.getByTestId("project-resident-mode-new").click();
  await dialog.getByRole("button", { name: "Create project" }).click();

  const request = await page.evaluate(
    () =>
      (
        window as Window & {
          __PRJ201_AGENT_REQUEST__?: Record<string, unknown>;
        }
      ).__PRJ201_AGENT_REQUEST__,
  );
  expect(request).toEqual({
    channelId: expect.any(String),
    channelName: "agent-room",
  });
  expect(Object.keys(request ?? {}).sort()).toEqual([
    "channelId",
    "channelName",
  ]);
});

test("a room failure retains one empty project and retry creates one room", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Recovery Plan");
  await dialog.getByTestId("create-project-room-name").fill("recovery-room");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "The empty project is saved",
  );
  let store = await storedProjects(page);
  expect(store?.projects).toHaveLength(1);
  expect(store?.assignments).toEqual({});

  await dialog.getByRole("button", { name: "Retry setup" }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("recovery-room");
  store = await storedProjects(page);
  expect(store?.projects).toHaveLength(1);
  expect(Object.keys(store?.assignments ?? {})).toHaveLength(1);
  expect(
    (await commandLog(page)).filter(
      (entry) => entry.command === "create_channel",
    ),
  ).toHaveLength(2);
});

test("a membership failure retries membership without another project or room", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-room-project").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Membership Recovery");
  await dialog.getByTestId("create-project-room-name").fill("membership-room");
  await dialog.getByTestId("project-resident-mode-existing").click();
  await dialog.getByText("Atlas", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "Retry to add only the remaining residents",
  );
  await dialog.getByRole("button", { name: "Retry setup" }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("membership-room");

  const commands = await commandLog(page);
  expect(
    commands.filter((entry) => entry.command === "create_channel"),
  ).toHaveLength(1);
  expect(
    commands.filter((entry) => entry.command === "add_channel_members"),
  ).toHaveLength(2);
  expect((await storedProjects(page))?.projects).toHaveLength(1);
});
