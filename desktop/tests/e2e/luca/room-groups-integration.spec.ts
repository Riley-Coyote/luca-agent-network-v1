import { expect, test, type Page } from "@playwright/test";

import {
  installMockBridge,
  openCreateChannelDialog,
} from "../../helpers/bridge";

const LUCA_PERSONA_ID = "persona-luca-room";
const MARA_PERSONA_ID = "persona-mara-room";

const PERSONAS = [
  {
    id: LUCA_PERSONA_ID,
    displayName: "Luca Room",
    systemPrompt: "Keep the room organized.",
    isActive: true,
    runtime: "codex",
  },
  {
    id: MARA_PERSONA_ID,
    displayName: "Mara Room",
    systemPrompt: "Review launch details.",
    isActive: true,
    runtime: "codex",
  },
];

function readyCodexRuntime() {
  return {
    id: "codex",
    label: "Codex",
    avatar_url: "",
    availability: "available",
    command: "codex-acp",
    binary_path: "/fixture/codex-acp",
    default_args: ["--acp"],
    mcp_command: "codex mcp serve",
    model_env_var: null,
    provider_env_var: null,
    thinking_env_var: null,
    install_hint: "Install Codex",
    install_instructions_url: "https://example.invalid/runtime",
    can_auto_install: false,
    underlying_cli_path: null,
    node_required: false,
    auth_status: { status: "logged_in" },
    login_hint: null,
  };
}

async function openGroups(page: Page) {
  await page.goto("/?e2e=mock#/agents");
  await page.getByRole("button", { name: "Groups" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent groups" }),
  ).toBeVisible();
}

test("a saved group creates permanent room members and retries only failures", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [readyCodexRuntime()],
    createManagedAgentErrors: [null, "Synthetic Mara provisioning failure"],
    personas: PERSONAS,
    teams: [
      {
        id: "team-launch-room",
        name: "Launch Crew",
        description: "The two launch residents.",
        personaIds: [LUCA_PERSONA_ID, MARA_PERSONA_ID],
      },
    ],
  });
  await page.goto("/?e2e=mock");
  await openCreateChannelDialog(page);

  const dialog = page.getByTestId("create-channel-dialog");
  await dialog.getByTestId("create-channel-name").fill("launch-room");
  const group = dialog.getByRole("button", {
    name: "Launch Crew, 2 agents",
  });
  await group.click();
  await expect(group).toHaveAttribute("aria-pressed", "true");
  await dialog.getByTestId("create-channel-submit").click();

  await expect(dialog).toContainText(
    "Room created. Added 1; retry the remaining 1.",
  );
  await expect(
    dialog.getByText("Synthetic Mara provisioning failure"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Retry remaining agents" }),
  ).toBeVisible();

  const creationsBeforeRetry = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "create_managed_agent")
      .map((entry) => entry.payload),
  );
  expect(creationsBeforeRetry).toHaveLength(2);
  expect(creationsBeforeRetry).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        input: expect.objectContaining({ personaId: LUCA_PERSONA_ID }),
      }),
      expect.objectContaining({
        input: expect.objectContaining({ personaId: MARA_PERSONA_ID }),
      }),
    ]),
  );

  await dialog.getByRole("button", { name: "Retry remaining agents" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("chat-title")).toHaveText("launch-room");

  const result = await page.evaluate(async () => {
    const agents = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_managed_agents",
    )) as Array<{ persona_id: string | null; pubkey: string }>;
    const channelId = window.location.hash.split("/channels/")[1] ?? "";
    const response = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "get_channel_members",
      { channelId },
    )) as {
      members: Array<{ is_agent: boolean; pubkey: string; role: string }>;
    };
    return {
      agents,
      members: response.members,
      creationPayloads: (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
        .filter((entry) => entry.command === "create_managed_agent")
        .map((entry) => entry.payload),
    };
  });

  expect(result.creationPayloads).toHaveLength(3);
  expect(
    result.creationPayloads.filter(
      (payload) =>
        (payload as { input?: { personaId?: string } }).input?.personaId ===
        LUCA_PERSONA_ID,
    ),
  ).toHaveLength(1);
  const residentPubkeys = new Set(
    result.agents
      .filter((agent) =>
        [LUCA_PERSONA_ID, MARA_PERSONA_ID].includes(agent.persona_id ?? ""),
      )
      .map((agent) => agent.pubkey),
  );
  expect(residentPubkeys.size).toBe(2);
  expect(
    result.members.filter(
      (member) => member.role === "bot" && residentPubkeys.has(member.pubkey),
    ),
  ).toHaveLength(2);
});

test("Groups supports create, membership edit, rename, and delete", async ({
  page,
}) => {
  await installMockBridge(page, { personas: PERSONAS });
  await openGroups(page);

  await page.getByTestId("new-team-card").click();
  await page.getByRole("menuitem", { name: "Create group" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create group" });
  await createDialog.getByLabel("Name").fill("Launch Partners");
  await createDialog.getByRole("option", { name: "Luca Room" }).click();
  await createDialog.getByRole("button", { name: "Create group" }).click();

  const groupsDialog = page.getByRole("dialog", { name: "Agent groups" });
  await expect(
    groupsDialog.getByText("Launch Partners", { exact: true }),
  ).toBeVisible();
  await groupsDialog
    .getByRole("button", { name: "Launch Partners group actions" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog", { name: "Edit group" });
  await editDialog.getByLabel("Name").fill("Launch Partners Updated");
  await editDialog.getByRole("option", { name: "Mara Room" }).click();
  await editDialog.getByRole("button", { name: "Save changes" }).click();

  await expect(
    groupsDialog.getByText("Launch Partners Updated", { exact: true }),
  ).toBeVisible();
  const updatedGroup = groupsDialog
    .locator("[data-testid^='team-card-']")
    .filter({ hasText: "Launch Partners Updated" });
  await expect(
    updatedGroup.locator("[data-team-member-avatar='avatar']"),
  ).toHaveCount(2);
  await groupsDialog
    .getByRole("button", { name: "Launch Partners Updated group actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const deleteDialog = page.getByRole("alertdialog", { name: "Delete group?" });
  await expect(deleteDialog).toContainText("Launch Partners Updated");
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(
    groupsDialog.getByText("Launch Partners Updated", { exact: true }),
  ).toHaveCount(0);
});
