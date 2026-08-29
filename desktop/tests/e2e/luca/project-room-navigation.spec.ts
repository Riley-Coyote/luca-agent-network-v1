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
      projects: Array<{
        id: string;
        label: string;
        sourceIds?: string[];
        workingContextStatus?: "attached" | "missing" | "none";
      }>;
      assignments: Record<string, string>;
    } | null;
  });
}

async function markProjectContextMissing(
  page: import("@playwright/test").Page,
  projectId: string,
) {
  await page.evaluate((id) => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("luca-room-projects.v1:"),
    );
    if (!key) throw new Error("Expected a local project store.");
    const store = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      projects: Array<{
        id: string;
        workingContextStatus?: "attached" | "missing" | "none";
      }>;
    };
    const project = store.projects.find((candidate) => candidate.id === id);
    if (!project) throw new Error(`Expected project ${id}.`);
    project.workingContextStatus = "missing";
    window.localStorage.setItem(key, JSON.stringify(store));
    window.dispatchEvent(new Event("luca:room-projects-changed"));
  }, projectId);
}

async function assignStoredProject(
  page: import("@playwright/test").Page,
  channelId: string,
  projectId: string,
) {
  await page.evaluate(
    ({ channelId: id, projectId: assignedProjectId }) => {
      const key = Object.keys(window.localStorage).find((candidate) =>
        candidate.startsWith("luca-room-projects.v1:"),
      );
      if (!key) throw new Error("Expected a local project store.");
      const store = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
        assignments: Record<string, string>;
      };
      store.assignments[id] = assignedProjectId;
      window.localStorage.setItem(key, JSON.stringify(store));
      window.dispatchEvent(new Event("luca:room-projects-changed"));
    },
    { channelId, projectId },
  );
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

test("the approved room picker is complete by mouse and keyboard", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");
  await page.getByTestId("project-row-luca").click();

  const trigger = page.getByTestId("project-room-picker-trigger");
  const initialRoom = await page.getByTestId("chat-title").innerText();
  await expect(trigger).toHaveAccessibleName(
    new RegExp(`Switch room from ${initialRoom} in Luca`),
  );
  await trigger.click();

  const picker = page.getByTestId("project-room-picker");
  const options = picker.getByRole("option");
  await expect(picker).toBeVisible();
  const selectedOption = options.filter({ hasText: initialRoom });
  await expect(selectedOption).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(selectedOption).not.toBeFocused();
  await page.keyboard.press("Home");
  await expect(options.first()).toBeFocused();
  await page.keyboard.press("End");
  const selectedLabel = (await options.last().innerText()).split("\n")[0];
  await expect(options.last()).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId("chat-title")).toHaveText(selectedLabel);

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByTestId("project-room-navigator").click({
    position: { x: 8, y: 8 },
  });
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId("project-room-navigator")).toBeVisible();
});

test("a stale local assignment cannot project a direct message into a project", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("DM Trap");
  await dialog.getByTestId("project-first-room-enabled").click();
  await dialog.getByRole("button", { name: "Create channel" }).click();

  const dm = page.getByTestId("channel-alice-tyler");
  const dmId = await dm.getAttribute("data-channel-id");
  if (!dmId) throw new Error("Expected the canonical DM channel id.");
  await assignStoredProject(page, dmId, "dm-trap");

  await expect(page.getByTestId("project-row-dm-trap")).toBeVisible();
  await expect(dm).toBeVisible();
  await dm.click();
  await expect(page).toHaveURL(new RegExp(`#/channels/${dmId}$`));
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  expect((await storedProjects(page))?.assignments[dmId]).toBe("dm-trap");

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/channels/${dmId}$`));
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  expect((await storedProjects(page))?.assignments[dmId]).toBe("dm-trap");
});

test("project loose-room and direct-message history stays route-derived", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  const projectRoomUrl = page.url();

  await page.getByTestId("channel-all-replies").click();
  await expect(page.getByTestId("chat-title")).toHaveText("all-replies");
  await expect(navigator).toHaveCount(0);
  const looseRoomUrl = page.url();

  await page.getByTestId("channel-alice-tyler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect(navigator).toHaveCount(0);
  const dmUrl = page.url();

  await page.goBack();
  await expect(page).toHaveURL(looseRoomUrl);
  await expect(page.getByTestId("chat-title")).toHaveText("all-replies");
  await expect(navigator).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(projectRoomUrl);
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(navigator).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(looseRoomUrl);
  await expect(navigator).toHaveCount(0);

  await page.goto(projectRoomUrl);
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(navigator).toBeVisible();

  await page.goto(dmUrl);
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect(navigator).toHaveCount(0);
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

test("project Sources opens Brain and browser back preserves project context", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&projectDemo=1");

  await page.getByTestId("project-row-luca").click();
  let navigator = page.getByTestId("project-room-navigator");
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");

  await navigator.getByRole("button", { name: "Sources" }).click();
  await expect(page).toHaveURL(/#\/brain$/);
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();

  await page.getByTestId("project-row-field-unit").click();
  await expect(page).toHaveURL(/#\/projects\/field-unit$/);
  await navigator.getByRole("button", { name: "Sources" }).click();
  await expect(page).toHaveURL(/#\/brain$/);

  await page.goBack();
  await expect(page).toHaveURL(/#\/projects\/field-unit$/);
  await expect(
    page.getByRole("heading", { name: /has no conversations yet/i }),
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

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-project-name").fill("Launch Work");
  await dialog.getByTestId("create-project-room-name").fill("planning");
  await dialog.getByRole("button", { name: /Context/ }).click();
  await dialog.getByRole("button", { name: "Select all" }).click();
  await expect(dialog.getByText("luca-agent-network")).toBeVisible();
  await dialog.getByRole("button", { name: "Create channel" }).click();

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

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Quiet Research");
  await dialog.getByTestId("project-first-room-enabled").click();
  await dialog.getByRole("button", { name: "Create channel" }).click();

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

test("project details rename, reopen, recover missing context, and remove an empty grouping", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-channel").click();
  const createDialog = page.getByTestId("create-room-project-dialog");
  await createDialog.getByTestId("create-project-name").fill("Quiet Research");
  await createDialog.getByTestId("project-first-room-enabled").click();
  await createDialog.getByRole("button", { name: "Create channel" }).click();

  await page.getByTestId("project-row-quiet-research").click();
  const navigator = page.getByTestId("project-room-navigator");
  await navigator.getByRole("button", { name: "Project details" }).click();
  let details = page.getByTestId("project-details-dialog");
  await expect(details).toBeVisible();
  const projectName = details.getByRole("textbox", { name: "Project name" });
  await expect(projectName).toBeFocused();
  await expect(
    details.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await projectName.fill("Quiet Field");
  await details.getByRole("button", { name: "Save changes" }).click();

  await expect(navigator).toContainText("Quiet Field");
  await expect(page).toHaveURL(/#\/projects\/quiet-research$/);
  expect((await storedProjects(page))?.projects[0]).toEqual(
    expect.objectContaining({ id: "quiet-research", label: "Quiet Field" }),
  );

  await navigator.getByRole("button", { name: "Project details" }).click();
  details = page.getByTestId("project-details-dialog");
  await expect(
    details.getByRole("textbox", { name: "Project name" }),
  ).toHaveValue("Quiet Field");
  await details.locator("form").getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page).toHaveURL(/#\/projects\/quiet-research$/);
  await expect(page.getByTestId("project-room-navigator")).toContainText(
    "Quiet Field",
  );

  await markProjectContextMissing(page, "quiet-research");
  await expect(page.getByTestId("project-room-navigator")).toContainText(
    "Working folder unavailable",
  );
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: "Project details" })
    .click();
  details = page.getByTestId("project-details-dialog");
  const recovery = details.getByTestId("project-missing-context-recovery");
  await expect(recovery).toContainText(
    "The project and its rooms are still here",
  );
  await expect(recovery).not.toContainText("/Users/");
  await recovery
    .getByRole("button", { name: "Review sources in Brain" })
    .click();
  await expect(page).toHaveURL(/#\/brain$/);

  await page.goBack();
  await expect(page).toHaveURL(/#\/projects\/quiet-research$/);
  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: "Project details" })
    .click();
  await page
    .getByTestId("project-details-dialog")
    .getByRole("button", { name: "Remove grouping" })
    .click();
  const confirmation = page.getByTestId("project-delete-grouping-dialog");
  await expect(confirmation).toContainText("No rooms will be deleted");
  await expect(confirmation).toContainText(
    "Connected sources and resident grants remain in Brain",
  );
  await confirmation.getByRole("button", { name: "Keep project" }).click();
  await expect(page.getByTestId("project-details-dialog")).toBeVisible();

  await page
    .getByTestId("project-details-dialog")
    .getByRole("button", { name: "Remove grouping" })
    .click();
  await page
    .getByTestId("project-delete-grouping-dialog")
    .getByRole("button", { name: "Remove grouping" })
    .click();
  await expect(page).toHaveURL(/#\/messages\/new$/);
  await expect(page.getByTestId("project-row-quiet-research")).toHaveCount(0);
  expect(await storedProjects(page)).toEqual({
    assignments: {},
    projects: [],
    version: 1,
  });
});

test("removing a populated project keeps its room, message, and native state intact", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-channel").click();
  const createDialog = page.getByTestId("create-room-project-dialog");
  await createDialog.getByTestId("create-project-name").fill("Launch Work");
  await createDialog.getByTestId("create-project-room-name").fill("planning");
  await createDialog.getByRole("button", { name: "Create channel" }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("planning");

  await page
    .getByTestId("message-input")
    .fill("This message stays with planning.");
  await page.getByTestId("send-message").click();
  await expect(
    page.getByText("This message stays with planning."),
  ).toBeVisible();
  const commandsBeforeDelete = (await commandLog(page)).length;

  await page
    .getByTestId("project-room-navigator")
    .getByRole("button", { name: "Project details" })
    .click();
  await page
    .getByTestId("project-details-dialog")
    .getByRole("button", { name: "Remove grouping" })
    .click();
  const confirmation = page.getByTestId("project-delete-grouping-dialog");
  await expect(confirmation).toContainText(
    "The room stays intact and becomes loose",
  );
  await confirmation.getByRole("button", { name: "Remove grouping" }).click();

  await expect(page.getByTestId("project-room-navigator")).toHaveCount(0);
  await expect(page.getByTestId("chat-title")).toHaveText("planning");
  await expect(
    page.getByText("This message stays with planning."),
  ).toBeVisible();
  await expect(page.getByTestId("message-input")).toBeEditable();
  await expect(page.getByTestId("project-row-launch-work")).toHaveCount(0);
  expect(await storedProjects(page)).toEqual({
    assignments: {},
    projects: [],
    version: 1,
  });
  expect(
    (await commandLog(page))
      .slice(commandsBeforeDelete)
      .filter((entry) => /disconnect|delete|revoke|grant/i.test(entry.command)),
  ).toEqual([]);
});

test("a first room attaches selected existing residents as membership only", async ({
  page,
}) => {
  await page.goto("/?e2e=mock");

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Resident Work");
  await dialog.getByTestId("create-project-room-name").fill("resident-room");
  await dialog.getByRole("button", { name: /People/ }).click();
  await dialog.getByTestId("project-resident-mode-existing").click();
  await dialog.getByText("Atlas", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create channel" }).click();

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

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Agent Handoff");
  await dialog.getByTestId("create-project-room-name").fill("agent-room");
  await dialog.getByRole("button", { name: /People/ }).click();
  await dialog.getByTestId("project-resident-mode-new").click();
  await dialog.getByRole("button", { name: "Create channel" }).click();

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

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Recovery Plan");
  await dialog.getByTestId("create-project-room-name").fill("recovery-room");
  await dialog.getByRole("button", { name: "Create channel" }).click();

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

  await page.getByTestId("create-channel").click();
  const dialog = page.getByTestId("create-room-project-dialog");
  await dialog.getByTestId("create-project-name").fill("Membership Recovery");
  await dialog.getByTestId("create-project-room-name").fill("membership-room");
  await dialog.getByRole("button", { name: /People/ }).click();
  await dialog.getByTestId("project-resident-mode-existing").click();
  await dialog.getByText("Atlas", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create channel" }).click();

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
