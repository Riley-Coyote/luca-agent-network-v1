import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const AGENTS_CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const OWNED_AGENT_PUBKEY =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";

function commandCount(commands: string[], command: string) {
  return commands.filter((candidate) => candidate === command).length;
}

async function requestContextualCreate(
  page: import("@playwright/test").Page,
  channelId = AGENTS_CHANNEL_ID,
  channelName = "agents",
) {
  await page.evaluate(
    ({ id, name }) => {
      window.dispatchEvent(
        new CustomEvent("buzz:open-create-agent", {
          detail: { channelId: id, channelName: name },
        }),
      );
    },
    { id: channelId, name: channelName },
  );
}

async function installDefaultBridge(page: import("@playwright/test").Page) {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
}

test("manual native creation commits only after its review sheet", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await page.goto("/?e2e=mock#/agents");
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await page.getByRole("button", { name: "New Hermes agent…" }).click();

  await page.getByLabel("Name").fill("Researcher");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Research product questions and preserve source attribution.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toContainText("Hermes profile");

  let commands = await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []);
  expect(commands).toContain("preview_native_agent_provisioning");
  expect(commands).not.toContain("execute_native_agent_provisioning");

  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  commands = await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []);
  expect(commands).toContain("execute_native_agent_provisioning");
});

test("an owned Luca chat proposal uses the same native review sheet", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
  );
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Luca details" }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "agent_management_request",
            agentIndex: 0,
            channelId,
            sessionId: "operator-forge-session",
            turnId: "operator-forge-turn",
            payload: {
              type: "agent_management_request",
              action: "create",
              requestId: "operator-forge-request-1",
              request: {
                channelId,
                displayName: "Scout",
                systemPrompt:
                  "Investigate a question and report sourced findings.",
                requestedRuntimeFamily: "openclaw",
                provisioningIntent: "fresh",
              },
            },
          },
        ],
      });
    },
    { agentPubkey: OWNED_AGENT_PUBKEY, channelId: AGENTS_CHANNEL_ID },
  );

  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Scout");
  await expect(page.getByLabel("Runtime")).toHaveValue("openclaw");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toContainText("OpenClaw agent");
  await page.getByRole("button", { name: "Cancel" }).click();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).toContain("preview_native_agent_provisioning");
  expect(commands).not.toContain("execute_native_agent_provisioning");
});

test("an authenticated Brain review request opens discovery without connecting", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
  );
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();

  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "brain_review_request",
            agentIndex: 0,
            channelId: "feedf00d-0000-4000-8000-000000000007",
            sessionId: null,
            turnId: null,
            payload: {
              type: "brain_review_request",
              requestId: "brain-review-mismatched-channel",
              channelId,
            },
          },
        ],
      });
    },
    { agentPubkey: OWNED_AGENT_PUBKEY, channelId: AGENTS_CHANNEL_ID },
  );
  await page.waitForTimeout(100);
  await expect(page).toHaveURL(new RegExp(`#/channels/${AGENTS_CHANNEL_ID}`));

  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 2,
            timestamp: new Date().toISOString(),
            kind: "brain_review_request",
            agentIndex: 0,
            channelId,
            sessionId: null,
            turnId: null,
            payload: {
              type: "brain_review_request",
              requestId: "brain-review-request-1",
              channelId,
            },
          },
        ],
      });
    },
    { agentPubkey: OWNED_AGENT_PUBKEY, channelId: AGENTS_CHANNEL_ID },
  );

  await expect(page).toHaveURL(/#\/brain/);
  await expect(page.getByTestId("brain-view")).toBeVisible();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("connect_connected_brain_source");
  expect(commands).not.toContain("commit_owner_brain_import");
});

test("contextual creation consumes ready Hermes as the unconfirmed owner default and attaches the exact resident", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();

  await requestContextualCreate(page);
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await expect(page.getByLabel("Runtime")).toHaveValue("hermes");

  await page.getByLabel("Name").fill("Project Researcher");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Research this project's sources and report with attribution.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "create_persona")).toBe(1);
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
});

test("a partial native transaction reconciles without another persona or execute", async ({
  page,
}) => {
  await installMockBridge(page, {
    createManagedAgentErrors: [
      "Native identity exists, but resident linking was interrupted.",
    ],
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();
  await requestContextualCreate(page);

  await page.getByLabel("Name").fill("Recovery Scout");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Recover one reviewed native creation without duplication.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("button", { name: "Reconcile" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create agent" }),
  ).not.toBeVisible();

  await page.getByRole("button", { name: "Reconcile" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "create_persona")).toBe(1);
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "reconcile_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
});

test("room attachment failure retries membership without rerunning native creation", async ({
  page,
}) => {
  await installMockBridge(page, {
    addChannelMembersErrors: ["The room is temporarily unavailable.", null],
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
  await page.goto(`/?e2e=mock#/channels/${AGENTS_CHANNEL_ID}`);
  await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();
  await requestContextualCreate(page);

  await page.getByLabel("Name").fill("Room Scout");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Join exactly one room after reviewed native creation.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", { name: "Room attachment needs attention" }),
  ).toContainText("does not create another agent");

  await page.getByRole("button", { name: "Try room again" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "create_persona")).toBe(1);
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(2);
});
