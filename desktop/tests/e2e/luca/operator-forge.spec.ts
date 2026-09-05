import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

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

async function requestOwnedNativeCreate(
  page: Page,
  runtime: "hermes" | "openclaw" = "hermes",
  origin?: { id: string; name: string },
) {
  const channelId = origin?.id ?? AGENTS_CHANNEL_ID;
  const channelName = origin?.name ?? "agents";
  if (origin) {
    await page.evaluate((id) => {
      window.location.hash = `/channels/${id}`;
    }, channelId);
  } else {
    await page.goto(`/?e2e=mock#/channels/${channelId}`);
    await expect(page.getByRole("heading", { name: "agents" })).toBeVisible();
  }
  await page.waitForFunction(
    (channelName) =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }),
    channelName,
  );
  await page.evaluate(
    ({ agentPubkey, channelId, runtime }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "agent_management_request",
            agentIndex: 0,
            channelId,
            sessionId: "completion-session",
            turnId: "completion-turn",
            payload: {
              type: "agent_management_request",
              action: "create",
              requestId: "native-completion-1",
              request: {
                channelId,
                displayName: "Completion Scout",
                systemPrompt:
                  "Investigate this project and report sourced findings.",
                requestedRuntimeFamily: runtime,
                provisioningIntent: "fresh",
              },
            },
          },
        ],
      });
    },
    { agentPubkey: OWNED_AGENT_PUBKEY, channelId, runtime },
  );
  await expect(page.getByLabel("Runtime")).toHaveValue(runtime);
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toBeVisible();
}

// Intercept only the mock IPC send in this test page. No shared bridge change
// is needed to model a failed send or a reply lost after successful delivery.
async function failFirstCompletionSend(page: Page, afterDelivery = false) {
  await page.evaluate((afterDelivery) => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          payload?: unknown,
          options?: unknown,
        ) => Promise<unknown>;
      };
      completionSendAttempts?: number;
    };
    const original = target.__TAURI_INTERNALS__.invoke.bind(
      target.__TAURI_INTERNALS__,
    );
    target.completionSendAttempts = 0;
    target.__TAURI_INTERNALS__.invoke = async (command, payload, options) => {
      if (command === "send_managed_agent_channel_message") {
        target.completionSendAttempts =
          (target.completionSendAttempts ?? 0) + 1;
        if (target.completionSendAttempts === 1) {
          if (afterDelivery) await original(command, payload, options);
          throw new Error(
            "The conversation update acknowledgment was interrupted.",
          );
        }
      }
      return original(command, payload, options);
    };
  }, afterDelivery);
}

const completionReceipt = (page: Page) =>
  page.getByText(/^Polyphonic setup update:/);

async function openCanonicalLucaDm(page: Page) {
  await page.goto("/?e2e=mock#/agents");
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function",
  );
  return page.evaluate(async (pubkey) => {
    const channel = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "open_dm",
      { pubkeys: [pubkey] },
    )) as { id: string; name: string; participant_pubkeys: string[] };
    await window.__BUZZ_E2E_INVALIDATE_CHANNELS__?.();
    return channel;
  }, OWNED_AGENT_PUBKEY);
}

async function assertExpandedNativeConversation(
  page: Page,
  origin: { id: string; participant_pubkeys: string[] },
) {
  const state = await page.evaluate(async () => ({
    channels: (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "get_channels",
    )) as Array<{ id: string; participant_pubkeys: string[] }>,
    residents: (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_managed_agents",
    )) as Array<{ name: string; pubkey: string }>,
  }));
  const residents = state.residents.filter(
    (resident) => resident.name === "Completion Scout",
  );
  expect(residents).toHaveLength(1);
  const expectedParticipants = [
    ...origin.participant_pubkeys,
    residents[0].pubkey,
  ].sort();
  expect(
    state.channels.find((channel) => channel.id === origin.id)
      ?.participant_pubkeys,
  ).toEqual(origin.participant_pubkeys);
  const expanded = state.channels.filter(
    (channel) =>
      JSON.stringify([...channel.participant_pubkeys].sort()) ===
      JSON.stringify(expectedParticipants),
  );
  expect(expanded).toHaveLength(1);
  expect(expanded[0].id).not.toBe(origin.id);
  return { target: expanded[0], resident: residents[0] };
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
  await page.waitForFunction(() =>
    window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: "agents" }),
  );
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
  expect(commands).not.toContain("send_managed_agent_channel_message");
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
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toContainText("Retry setup for the same resident");

  await page.getByRole("button", { name: "Try conversation again" }).click();
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

for (const runtime of ["hermes", "openclaw"] as const) {
  test(`${runtime} proposal returns the exact created resident outcome to its original conversation`, async ({
    page,
  }, testInfo) => {
    await installDefaultBridge(page);
    await requestOwnedNativeCreate(page, runtime);
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(
      page.getByRole("heading", { name: "Create a native agent" }),
    ).not.toBeVisible();
    await expect(completionReceipt(page)).toHaveCount(1);
    await expect(completionReceipt(page)).toContainText(
      runtime === "hermes" ? "its Hermes profile" : "its OpenClaw agent",
    );
    await expect(completionReceipt(page)).toContainText(
      "Its runtime process was started.",
    );
    await expect(completionReceipt(page)).toContainText(
      "An authenticated reply has not been verified.",
    );

    const payloads = await page.evaluate(
      () => window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
    );
    const sends = payloads.filter(
      (entry) => entry.command === "send_managed_agent_channel_message",
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].payload).toMatchObject({
      agentPubkey: OWNED_AGENT_PUBKEY,
      channelId: AGENTS_CHANNEL_ID,
      marker: "polyphonic-agent-creation.v1:native-completion-1",
      markerScope: "agent",
      mentionPubkeys: null,
    });
    const residents = await page.evaluate(
      async () =>
        (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
          "list_managed_agents",
        )) as Array<{ name: string; pubkey: string }>,
    );
    const created = residents.filter(
      (resident) => resident.name === "Completion Scout",
    );
    expect(created).toHaveLength(1);
    expect(
      payloads.filter((entry) => entry.command === "start_managed_agent"),
    ).toEqual([
      {
        command: "start_managed_agent",
        payload: { pubkey: created[0].pubkey },
      },
    ]);
    expect(
      payloads.find((entry) => entry.command === "add_channel_members")
        ?.payload,
    ).toMatchObject({
      channelId: AGENTS_CHANNEL_ID,
      pubkeys: [created[0].pubkey],
    });
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`${runtime}-completion.png`),
    });
  });
}

test("canonical Luca DM commissioning preserves the pair and links the actual group", async ({
  page,
}, testInfo) => {
  await installDefaultBridge(page);
  const origin = await openCanonicalLucaDm(page);
  expect(origin.participant_pubkeys).toHaveLength(2);
  expect(origin.participant_pubkeys).toContain(OWNED_AGENT_PUBKEY);
  await requestOwnedNativeCreate(page, "hermes", origin);
  const before = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_PAYLOADS__?.length ?? 0,
  );
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  const { target, resident } = await assertExpandedNativeConversation(
    page,
    origin,
  );
  const payloads = await page.evaluate(
    (before) => window.__BUZZ_E2E_COMMAND_PAYLOADS__?.slice(before) ?? [],
    before,
  );
  expect(
    payloads.filter((entry) => entry.command === "add_channel_members"),
  ).toHaveLength(0);
  expect(payloads.filter((entry) => entry.command === "open_dm")).toEqual([
    {
      command: "open_dm",
      payload: {
        pubkeys: [OWNED_AGENT_PUBKEY, resident.pubkey],
      },
    },
  ]);
  expect(
    payloads.find(
      (entry) => entry.command === "send_managed_agent_channel_message",
    )?.payload,
  ).toMatchObject({ channelId: origin.id });
  await expect(completionReceipt(page)).toHaveCount(1);
  await expect(completionReceipt(page)).toContainText("Group DM (3)");
  const link = page.getByRole("link", { name: "Open group conversation" });
  await expect(link).toHaveAttribute(
    "href",
    `buzz://channel?channel=${target.id}`,
  );
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("dm-completion.png") });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/channels/${target.id}$`));
  await expect(page.locator(".tiptap[contenteditable='true']")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
});

for (const failure of ["startup", "delivery"] as const) {
  test(`canonical Luca DM ${failure} retry reuses the exact resident and group`, async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...(failure === "startup"
        ? {
            startManagedAgentErrors: ["Hermes authentication needs attention."],
          }
        : {}),
      managedAgents: [
        {
          channelNames: ["agents"],
          name: "Luca",
          pubkey: OWNED_AGENT_PUBKEY,
          status: "running",
        },
      ],
    });
    const origin = await openCanonicalLucaDm(page);
    await requestOwnedNativeCreate(page, "hermes", origin);
    if (failure === "delivery") await failFirstCompletionSend(page, true);
    const before = await page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__?.length ?? 0,
    );
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(
      page.getByRole("region", {
        name:
          failure === "startup"
            ? "Conversation attachment needs attention"
            : "Conversation update needs attention",
      }),
    ).toBeVisible();
    const first = await assertExpandedNativeConversation(page, origin);
    await page
      .getByRole("button", {
        name:
          failure === "startup"
            ? "Try conversation again"
            : "Retry conversation update",
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create a native agent" }),
    ).not.toBeVisible();
    const retried = await assertExpandedNativeConversation(page, origin);
    expect(retried).toMatchObject({
      target: {
        id: first.target.id,
        participant_pubkeys: first.target.participant_pubkeys,
      },
      resident: {
        name: first.resident.name,
        pubkey: first.resident.pubkey,
        status: "running",
      },
    });
    await expect(completionReceipt(page)).toHaveCount(1);
    await expect(completionReceipt(page)).toContainText(
      "Its runtime process was started.",
    );
    await expect(
      page.getByRole("link", { name: "Open group conversation" }),
    ).toHaveAttribute("href", `buzz://channel?channel=${first.target.id}`);
    const commands = await page.evaluate(
      (before) => window.__BUZZ_E2E_COMMANDS__?.slice(before) ?? [],
      before,
    );
    expect(commandCount(commands, "create_persona")).toBe(1);
    expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
    expect(commandCount(commands, "open_dm")).toBe(1);
    expect(commandCount(commands, "add_channel_members")).toBe(0);
    expect(commandCount(commands, "start_managed_agent")).toBe(
      failure === "startup" ? 2 : 1,
    );
    expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(
      failure === "startup" ? 1 : 2,
    );
  });
}

test("a retained group never replaces the original Luca DM authority during startup retry", async ({
  page,
}) => {
  await installMockBridge(page, {
    startManagedAgentErrors: ["Hermes authentication needs attention."],
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
  const origin = await openCanonicalLucaDm(page);
  await requestOwnedNativeCreate(page, "hermes", origin);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toContainText("Hermes authentication needs attention.");
  await assertExpandedNativeConversation(page, origin);
  const before = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__?.length ?? 0,
  );
  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
        channelId,
        removeMemberPubkey: pubkey,
      });
    },
    { channelId: origin.id, pubkey: OWNED_AGENT_PUBKEY },
  );
  await page.getByRole("button", { name: "Try conversation again" }).click();
  await expect(
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toContainText("both still belong to");
  const retriedCommands = await page.evaluate(
    (before) => window.__BUZZ_E2E_COMMANDS__?.slice(before) ?? [],
    before,
  );
  for (const command of [
    "execute_native_agent_provisioning",
    "open_dm",
    "add_channel_members",
    "start_managed_agent",
    "send_managed_agent_channel_message",
  ]) {
    expect(commandCount(retriedCommands, command)).toBe(0);
  }
});

test("navigation during review keeps attachment and completion in the original conversation", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await requestOwnedNativeCreate(page);
  await page.evaluate(() => {
    window.location.hash = "/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  });
  await expect(
    page.getByRole("heading", {
      name: "general",
      exact: true,
      includeHidden: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  await expect(completionReceipt(page)).toHaveCount(0);
  const payloads = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
  expect(
    payloads.find(
      (entry) => entry.command === "send_managed_agent_channel_message",
    )?.payload,
  ).toMatchObject({
    channelId: AGENTS_CHANNEL_ID,
  });
  await page.evaluate((channelId) => {
    window.location.hash = `/channels/${channelId}`;
  }, AGENTS_CHANNEL_ID);
  await expect(completionReceipt(page)).toHaveCount(1);
});

test("native startup failure preserves the resident and sends no completion until retry succeeds", async ({
  page,
}) => {
  await installMockBridge(page, {
    startManagedAgentErrors: ["Hermes authentication needs attention."],
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: OWNED_AGENT_PUBKEY,
        status: "running",
      },
    ],
  });
  await requestOwnedNativeCreate(page);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toContainText("Hermes authentication needs attention.");
  await expect(completionReceipt(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Try conversation again" }).click();
  await expect(completionReceipt(page)).toHaveCount(1);
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "create_persona")).toBe(1);
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
  expect(commandCount(commands, "start_managed_agent")).toBe(2);
  expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(1);
});

test("a lost completion acknowledgment retries only delivery and deduplicates the conversation receipt", async ({
  page,
}, testInfo) => {
  await installDefaultBridge(page);
  await requestOwnedNativeCreate(page);
  await failFirstCompletionSend(page, true);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", { name: "Conversation update needs attention" }),
  ).toContainText("already saved");
  await expect(completionReceipt(page)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Create agent", exact: true }),
  ).not.toBeVisible();
  await waitForAnimations(page);
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("receipt-delivery-retry.png") });
  await page.getByRole("button", { name: "Retry conversation update" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  await expect(completionReceipt(page)).toHaveCount(1);
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "create_persona")).toBe(1);
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
  expect(commandCount(commands, "start_managed_agent")).toBe(1);
  expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(2);
});

test("room retry refreshes revoked membership before adding the resident or sending a receipt", async ({
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
  await requestOwnedNativeCreate(page);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toBeVisible();
  // Leave React Query stale: the owner action itself must refresh membership.
  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
        channelId,
        removeMemberPubkey: pubkey,
      });
    },
    { channelId: AGENTS_CHANNEL_ID, pubkey: OWNED_AGENT_PUBKEY },
  );
  await page.getByRole("button", { name: "Try conversation again" }).click();
  await expect(
    page.getByRole("region", {
      name: "Conversation attachment needs attention",
    }),
  ).toContainText("both still belong to");
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
  expect(commandCount(commands, "start_managed_agent")).toBe(0);
  expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(0);
});

test("receipt retry refreshes revoked ownership and leaves completed native work intact", async ({
  page,
}) => {
  await installDefaultBridge(page);
  await requestOwnedNativeCreate(page);
  await failFirstCompletionSend(page);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("region", { name: "Conversation update needs attention" }),
  ).toBeVisible();
  await page.evaluate(async (pubkey) => {
    await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("delete_managed_agent", {
      pubkey,
    });
  }, OWNED_AGENT_PUBKEY);
  await page.getByRole("button", { name: "Retry conversation update" }).click();
  await expect(
    page.getByRole("region", { name: "Conversation update needs attention" }),
  ).toContainText("owned agent");
  await expect(completionReceipt(page)).toHaveCount(0);
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
  expect(commandCount(commands, "add_channel_members")).toBe(1);
  expect(commandCount(commands, "start_managed_agent")).toBe(1);
  expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(0);
});

for (const recovery of ["Reconcile", "Roll back"] as const) {
  test(`a proposed native transaction ${recovery === "Reconcile" ? "returns its reconciled outcome" : "never reports success after rollback"}`, async ({
    page,
  }) => {
    await installMockBridge(page, {
      createManagedAgentErrors: [
        "Native identity exists; resident linking was interrupted.",
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
    await requestOwnedNativeCreate(page);
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(
      page.getByRole("button", { name: recovery, exact: true }),
    ).toBeVisible();
    await expect(completionReceipt(page)).toHaveCount(0);
    await page.getByRole("button", { name: recovery, exact: true }).click();
    if (recovery === "Roll back") {
      await expect(
        page.getByRole("region", { name: "Provisioning rolled back" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Done", exact: true }).click();
    }
    await expect(
      page.getByRole("heading", { name: "Create a native agent" }),
    ).not.toBeVisible();
    await expect(completionReceipt(page)).toHaveCount(
      recovery === "Reconcile" ? 1 : 0,
    );
    const commands = await page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__ ?? [],
    );
    expect(commandCount(commands, "create_persona")).toBe(1);
    expect(commandCount(commands, "execute_native_agent_provisioning")).toBe(1);
    expect(commandCount(commands, "send_managed_agent_channel_message")).toBe(
      recovery === "Reconcile" ? 1 : 0,
    );
  });
}
