import { expect, test, type Page } from "@playwright/test";

import type {
  ResidentProposal,
  ResidentProposalCompletion,
} from "../../../src/shared/api/tauriResidentProposals";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const ROOM_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const OWNER = "deadbeef".repeat(8);
const LUCA = "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";

type Call = { command: string; payload: unknown; result?: unknown };
type HostResult = { requestId: string; completion: ResidentProposalCompletion };
type HostState = {
  calls: Call[];
  pending: Record<string, ResidentProposal>;
  results: HostResult[];
  revoked: boolean;
  finishFailures: number;
  acceptBeforeFailure: boolean;
};

declare global {
  interface Window {
    __RESIDENT_PROPOSAL_TEST__?: HostState;
  }
}

function proposal(overrides: Partial<ResidentProposal> = {}): ResidentProposal {
  return {
    requestId: "host-resident-1",
    ownerPubkey: OWNER,
    residentPubkey: LUCA,
    conversationId: ROOM_ID,
    displayName: "Host Scout",
    systemPrompt: "Investigate this project and report sourced findings.",
    runtimeFamily: "hermes",
    provisioningIntent: "fresh",
    createdAt: "2026-09-05T10:00:00Z",
    ...overrides,
  };
}

// The real frontend receives typed host events and startup replay. Only the
// pending-host lifecycle is simulated here; production review/provisioning IPC
// continues through the existing mock bridge. No observer request is injected.
async function installProposalHost(
  page: Page,
  options: {
    snapshot?: ResidentProposal[];
    finishFailures?: number;
    acceptBeforeFailure?: boolean;
    revokeAfterStart?: boolean;
    managedRuntimeReady?: boolean;
    createManagedAgentErrors?: string[];
  } = {},
) {
  await page.addInitScript(
    ({ snapshot, finishFailures, acceptBeforeFailure, revokeAfterStart }) => {
      const state: HostState = {
        calls: [],
        pending: Object.fromEntries(
          snapshot.map((entry) => [entry.requestId, entry]),
        ),
        results: [],
        revoked: false,
        finishFailures,
        acceptBeforeFailure,
      };
      window.__RESIDENT_PROPOSAL_TEST__ = state;
      type Invoke = (
        command: string,
        payload?: unknown,
        options?: unknown,
      ) => Promise<unknown>;
      let realInvoke: Invoke | undefined;
      const target = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = target.__TAURI_INTERNALS__ ?? {};
      target.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke: Invoke) => {
          realInvoke = invoke;
        },
        get:
          () =>
          async (
            command: string,
            payload?: unknown,
            invokeOptions?: unknown,
          ) => {
            const call: Call = {
              command,
              payload: JSON.parse(JSON.stringify(payload ?? null)),
            };
            state.calls.push(call);
            if (command === "list_resident_proposals")
              return Object.values(state.pending);
            if (command === "authorize_resident_proposal") {
              const { requestId } = payload as { requestId: string };
              if (state.revoked || !state.pending[requestId]) {
                throw new Error(
                  "The host setup request is no longer authorized.",
                );
              }
              return null;
            }
            if (command === "finish_resident_proposal") {
              const result = payload as HostResult;
              const accept = () => {
                if (!state.pending[result.requestId]) return false;
                if (state.revoked && result.completion.status !== "closed") {
                  throw new Error(
                    "The host setup request is no longer authorized.",
                  );
                }
                state.results.push(structuredClone(result));
                delete state.pending[result.requestId];
                return true;
              };
              if (
                state.finishFailures > 0 &&
                result.completion.status !== "closed"
              ) {
                state.finishFailures -= 1;
                if (state.acceptBeforeFailure) accept();
                throw new Error(
                  "The host result acknowledgment was interrupted.",
                );
              }
              return accept();
            }
            if (!realInvoke) throw new Error("Mock IPC has not initialized.");
            const result = await realInvoke(command, payload, invokeOptions);
            if (command === "start_managed_agent" && revokeAfterStart)
              state.revoked = true;
            if (
              [
                "preview_native_agent_provisioning",
                "execute_native_agent_provisioning",
                "create_persona",
                "create_luca_resident",
              ].includes(command)
            ) {
              call.result = structuredClone(result);
            }
            return result;
          },
      });
    },
    {
      snapshot: options.snapshot ?? [],
      finishFailures: options.finishFailures ?? 0,
      acceptBeforeFailure: options.acceptBeforeFailure ?? false,
      revokeAfterStart: options.revokeAfterStart ?? false,
    },
  );
  await installMockBridge(page, {
    ...(options.managedRuntimeReady
      ? {
          acpRuntimesCatalog: [
            {
              id: "codex",
              label: "Codex",
              avatar_url: "",
              availability: "available",
              command: "codex-acp",
              binary_path: "/fixture/codex-acp",
              default_args: [],
              mcp_command: null,
              install_hint: "Install Codex",
              install_instructions_url: "https://example.invalid/runtime",
              can_auto_install: false,
              underlying_cli_path: null,
              node_required: false,
              auth_status: { status: "logged_in" },
              login_hint: null,
            },
          ],
        }
      : {}),
    ...(options.createManagedAgentErrors
      ? { createManagedAgentErrors: options.createManagedAgentErrors }
      : {}),
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
}

async function openHost(page: Page) {
  await page.goto(`/?e2e=mock#/channels/${ROOM_ID}`);
  await page.waitForFunction(() =>
    window.__RESIDENT_PROPOSAL_TEST__?.calls.some(
      (call) => call.command === "list_resident_proposals",
    ),
  );
}

async function emitProposal(page: Page, request: ResidentProposal) {
  await page.evaluate((request) => {
    const state = window.__RESIDENT_PROPOSAL_TEST__;
    if (!state || !window.__BUZZ_E2E_EMIT_TAURI_EVENT__)
      throw new Error("Host test bridge is unavailable.");
    state.pending[request.requestId] = request;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__("luca://resident-proposal", request);
  }, request);
}

async function calls(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      window.__RESIDENT_PROPOSAL_TEST__?.calls.filter(
        (call) => call.command === command,
      ) ?? [],
    command,
  );
}

async function results(page: Page) {
  return page.evaluate(() => window.__RESIDENT_PROPOSAL_TEST__?.results ?? []);
}

async function reviewNative(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toBeVisible();
}

async function openLucaDm(page: Page) {
  const origin = await page.evaluate(async (pubkey) => {
    const channel = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "open_dm",
      { pubkeys: [pubkey] },
    )) as { id: string; name: string; participant_pubkeys: string[] };
    await window.__BUZZ_E2E_INVALIDATE_CHANNELS__?.();
    window.location.hash = `/channels/${channel.id}`;
    return channel;
  }, LUCA);
  await page.waitForFunction(
    (channelName) =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }),
    origin.name,
  );
  return origin;
}

for (const ingress of ["event", "snapshot"] as const) {
  test(`${ingress} proposal opens the existing review without creating and reports owner close`, async ({
    page,
  }) => {
    const request = proposal();
    await installProposalHost(page, {
      snapshot: ingress === "snapshot" ? [request] : [],
    });
    await openHost(page);
    if (ingress === "event") await emitProposal(page, request);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      request.displayName,
    );
    await expect(page.getByLabel("Purpose and instructions")).toHaveValue(
      request.systemPrompt,
    );
    await expect(page.getByLabel("Runtime")).toHaveValue("hermes");
    for (const command of [
      "preview_native_agent_provisioning",
      "create_persona",
      "execute_native_agent_provisioning",
      "create_luca_resident",
      "finish_resident_proposal",
    ]) {
      expect(await calls(page, command)).toHaveLength(0);
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .poll(() => results(page))
      .toEqual([
        {
          requestId: request.requestId,
          completion: { status: "closed", busy: false },
        },
      ]);
    await expect(
      page.getByRole("heading", { name: "Create a native agent" }),
    ).not.toBeVisible();
    expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
      0,
    );
  });
}

test("another host proposal receives busy while the active review keeps its original request", async ({
  page,
}) => {
  const first = proposal();
  const second = proposal({
    requestId: "host-resident-2",
    displayName: "Second Scout",
  });
  await installProposalHost(page, { snapshot: [first] });
  await openHost(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    first.displayName,
  );
  await emitProposal(page, first);
  await emitProposal(page, second);
  await expect
    .poll(() => results(page))
    .toEqual([
      {
        requestId: second.requestId,
        completion: { status: "closed", busy: true },
      },
    ]);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    first.displayName,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(async () => (await results(page)).length).toBe(2);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    0,
  );
});

test("typed native proposal binds its actual transaction and expanded target to the initiating Luca DM", async ({
  page,
}, testInfo) => {
  await installProposalHost(page);
  await openHost(page);
  const origin = await openLucaDm(page);
  expect(new Set(origin.participant_pubkeys)).toEqual(new Set([OWNER, LUCA]));
  await page.evaluate(
    (channelName) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: "Original Luca conversation history stays here.",
      }),
    origin.name,
  );
  await expect(
    page.getByText("Original Luca conversation history stays here.", {
      exact: true,
    }),
  ).toBeVisible();
  const request = proposal({ conversationId: origin.id });
  await emitProposal(page, request);
  await reviewNative(page);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    0,
  );
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect.poll(async () => (await results(page)).length).toBe(1);
  const executed = await calls(page, "execute_native_agent_provisioning");
  expect(executed).toHaveLength(1);
  expect(executed[0].payload).toMatchObject({
    input: { residentProposalId: request.requestId },
  });
  const nativeReceipt = executed[0].result as {
    transactionId: string;
    residentPubkey: string;
  };
  const channels = await page.evaluate(
    async () =>
      (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "get_channels",
      )) as Array<{ id: string; participant_pubkeys: string[] }>,
  );
  expect(
    channels.find((channel) => channel.id === origin.id)?.participant_pubkeys,
  ).toEqual(origin.participant_pubkeys);
  const target = channels.filter((channel) =>
    channel.participant_pubkeys.includes(nativeReceipt.residentPubkey),
  );
  expect(target).toHaveLength(1);
  expect(new Set(target[0].participant_pubkeys)).toEqual(
    new Set([...origin.participant_pubkeys, nativeReceipt.residentPubkey]),
  );
  expect(target[0].id).not.toBe(origin.id);
  expect(await results(page)).toEqual([
    {
      requestId: request.requestId,
      completion: {
        status: "native_created",
        transactionId: nativeReceipt.transactionId,
        attachedConversationId: target[0].id,
      },
    },
  ]);
  expect(await calls(page, "add_channel_members")).toHaveLength(0);
  expect(
    (await calls(page, "authorize_resident_proposal")).every(
      (call) =>
        (call.payload as { requestId: string }).requestId === request.requestId,
    ),
  ).toBe(true);
  expect(
    (await calls(page, "authorize_resident_proposal")).length,
  ).toBeGreaterThanOrEqual(4);
  expect(
    (await calls(page, "send_managed_agent_channel_message"))[0].payload,
  ).toMatchObject({ channelId: origin.id });
  await expect(
    page.getByText("Original Luca conversation history stays here.", {
      exact: true,
    }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: "Open group conversation" });
  await expect(link).toHaveAttribute(
    "href",
    `buzz://channel?channel=${target[0].id}`,
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("host-native-dm-result.png"),
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/channels/${target[0].id}$`));
  await expect(
    page.getByText("Original Luca conversation history stays here.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

for (const phase of ["review", "create"] as const) {
  test(`host revocation before ${phase} blocks the next native side effect`, async ({
    page,
  }) => {
    const request = proposal();
    await installProposalHost(page, { snapshot: [request] });
    await openHost(page);
    await expect(
      page.getByRole("heading", { name: "Create a native agent" }),
    ).toBeVisible();
    if (phase === "create") await reviewNative(page);
    await page.evaluate(() => {
      if (window.__RESIDENT_PROPOSAL_TEST__)
        window.__RESIDENT_PROPOSAL_TEST__.revoked = true;
    });
    await page
      .getByRole("button", {
        name: phase === "review" ? "Review changes" : "Create agent",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText("no longer authorized");
    expect(await calls(page, "preview_native_agent_provisioning")).toHaveLength(
      phase === "review" ? 0 : 1,
    );
    expect(await calls(page, "create_persona")).toHaveLength(0);
    expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
      0,
    );
    expect(await results(page)).toHaveLength(0);
  });
}

test("a lost native host-result acknowledgment retries the same result without creation or attachment", async ({
  page,
}) => {
  const request = proposal();
  await installProposalHost(page, {
    snapshot: [request],
    finishFailures: 1,
    acceptBeforeFailure: true,
  });
  await openHost(page);
  await reviewNative(page);
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Conversation update needs attention" }),
  ).toContainText("acknowledgment was interrupted");
  const first = await calls(page, "finish_resident_proposal");
  expect(first).toHaveLength(1);
  await page.getByRole("button", { name: "Retry conversation update" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).not.toBeVisible();
  expect(
    (await calls(page, "finish_resident_proposal")).map((call) => call.payload),
  ).toEqual([first[0].payload, first[0].payload]);
  expect(await results(page)).toHaveLength(1);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    1,
  );
  expect(await calls(page, "create_persona")).toHaveLength(1);
  expect(await calls(page, "add_channel_members")).toHaveLength(1);
  expect(await calls(page, "start_managed_agent")).toHaveLength(1);
  await expect(page.getByText(/^Polyphonic setup update:/)).toHaveCount(1);
});

test("host rejection after native startup prevents a success receipt and preserves the existing result for retry", async ({
  page,
}) => {
  const request = proposal();
  await installProposalHost(page, {
    snapshot: [request],
    revokeAfterStart: true,
  });
  await openHost(page);
  await reviewNative(page);
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Conversation update needs attention" }),
  ).toContainText("no longer authorized");
  expect(await calls(page, "send_managed_agent_channel_message")).toHaveLength(
    0,
  );
  expect(await results(page)).toHaveLength(0);
  const original = (await calls(page, "finish_resident_proposal"))[0];
  await page.getByRole("button", { name: "Retry conversation update" }).click();
  await expect
    .poll(async () => (await calls(page, "finish_resident_proposal")).length)
    .toBe(2);
  expect(
    (await calls(page, "finish_resident_proposal")).map((call) => call.payload),
  ).toEqual([original.payload, original.payload]);
  expect(await calls(page, "send_managed_agent_channel_message")).toHaveLength(
    0,
  );
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    1,
  );
  expect(await calls(page, "add_channel_members")).toHaveLength(1);
  expect(await calls(page, "start_managed_agent")).toHaveLength(1);
});

test("a managed proposal returns its actual resident, definition and conversation", async ({
  page,
}) => {
  const request = proposal({
    runtimeFamily: "codex",
    provisioningIntent: null,
  });
  await installProposalHost(page, {
    snapshot: [request],
    managedRuntimeReady: true,
  });
  await openHost(page);
  const submit = page.getByTestId("persona-dialog-submit");
  await expect(submit).toBeEnabled();
  expect(await calls(page, "create_persona")).toHaveLength(0);
  await submit.click();
  await expect.poll(async () => (await results(page)).length).toBe(1);
  const residents = await page.evaluate(
    async () =>
      (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "list_managed_agents",
      )) as Array<{ name: string; pubkey: string; persona_id: string }>,
  );
  const created = residents.filter(
    (resident) => resident.name === request.displayName,
  );
  expect(created).toHaveLength(1);
  expect(await results(page)).toEqual([
    {
      requestId: request.requestId,
      completion: {
        status: "managed_created",
        residentPubkey: created[0].pubkey,
        personaId: created[0].persona_id,
        attachedConversationId: ROOM_ID,
      },
    },
  ]);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    0,
  );
});

test("a managed creation failure returns only the definition that was actually saved", async ({
  page,
}) => {
  const request = proposal({
    runtimeFamily: "codex",
    provisioningIntent: null,
  });
  await installProposalHost(page, {
    snapshot: [request],
    managedRuntimeReady: true,
    createManagedAgentErrors: ["The managed runtime is unavailable."],
  });
  await openHost(page);
  await expect(page.getByTestId("persona-dialog-submit")).toBeEnabled();
  await page.getByTestId("persona-dialog-submit").click();
  await expect.poll(async () => (await results(page)).length).toBe(1);
  const saved = (await calls(page, "create_persona"))[0].result as {
    id: string;
  };
  expect(await results(page)).toEqual([
    {
      requestId: request.requestId,
      completion: { status: "definition_saved", personaId: saved.id },
    },
  ]);
  expect(await calls(page, "create_persona")).toHaveLength(1);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect(await calls(page, "add_channel_members")).toHaveLength(0);
  await expect(
    page.getByText(/was saved.*managed runtime is unavailable/),
  ).toBeVisible();
});

test("managed result delivery retry uses the cached completion and never creates a second resident", async ({
  page,
}) => {
  const request = proposal({
    runtimeFamily: "codex",
    provisioningIntent: null,
  });
  await installProposalHost(page, {
    snapshot: [request],
    managedRuntimeReady: true,
    finishFailures: 2,
    acceptBeforeFailure: true,
  });
  await openHost(page);
  const submit = page.getByTestId("persona-dialog-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(
    page.getByText(/was saved, but its result could not be returned to Luca/),
  ).toBeVisible();
  const first = (await calls(page, "finish_resident_proposal"))[0];
  await submit.click();
  await expect(page.getByTestId("persona-dialog")).not.toBeVisible();
  expect(
    (await calls(page, "finish_resident_proposal")).map((call) => call.payload),
  ).toEqual([first.payload, first.payload, first.payload]);
  expect(await results(page)).toHaveLength(1);
  expect(await calls(page, "create_persona")).toHaveLength(1);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect(await calls(page, "add_channel_members")).toHaveLength(1);
});

test("an unavailable managed runtime leaves the proposal reviewable and cannot create", async ({
  page,
}) => {
  const request = proposal({
    runtimeFamily: "codex",
    provisioningIntent: null,
  });
  await installProposalHost(page, { snapshot: [request] });
  await openHost(page);
  await expect(page.getByTestId("persona-dialog-submit")).toBeDisabled();
  await expect(page.getByTestId("persona-dialog-submit-reason")).toContainText(
    "selected runtime isn't available",
  );
  expect(await calls(page, "create_persona")).toHaveLength(0);
  expect(await calls(page, "create_luca_resident")).toHaveLength(0);
  expect(await results(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => results(page))
    .toEqual([
      {
        requestId: request.requestId,
        completion: { status: "closed", busy: false },
      },
    ]);
});

test("a typed proposal from an unowned resident closes without opening a creation surface", async ({
  page,
}) => {
  const request = proposal({ residentPubkey: "9".repeat(64) });
  await installProposalHost(page, { snapshot: [request] });
  await openHost(page);
  await expect
    .poll(() => results(page))
    .toEqual([
      {
        requestId: request.requestId,
        completion: { status: "closed", busy: false },
      },
    ]);
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toHaveCount(0);
  expect(await calls(page, "authorize_resident_proposal")).toHaveLength(0);
  expect(await calls(page, "create_persona")).toHaveLength(0);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    0,
  );
});
