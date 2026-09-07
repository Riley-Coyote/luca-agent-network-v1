import { expect, test, type Page } from "@playwright/test";

import type {
  NativeImportResult,
  NativeImportSelection,
  ResidentProposal,
  ResidentProposalCompletion,
} from "../../../src/shared/api/tauriResidentProposals";
import type { DiscoveredResidentCandidate } from "../../../src/shared/api/types";
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
  nativeCandidates: DiscoveredResidentCandidate[];
  imports: Record<
    string,
    {
      selection: NativeImportSelection;
      result: NativeImportResult;
      preferencesApplied: boolean;
    }
  >;
  startupFailures: number;
  importFailures: number;
  preferenceFailures: number;
  closeFailures: number;
  importHeld: boolean;
  rejectImport: boolean;
  operatorSettingsUnavailable: boolean;
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
    nativeCandidates?: DiscoveredResidentCandidate[];
    startupFailures?: number;
    importFailures?: number;
    preferenceFailures?: number;
    closeFailures?: number;
    holdImport?: boolean;
    reuseProfile?: DiscoveredResidentCandidate;
    operatorSettingsUnavailable?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({
      snapshot,
      finishFailures,
      acceptBeforeFailure,
      revokeAfterStart,
      nativeCandidates,
      startupFailures,
      importFailures,
      preferenceFailures,
      closeFailures,
      holdImport,
      operatorSettingsUnavailable,
    }) => {
      const state: HostState = {
        calls: [],
        pending: Object.fromEntries(
          snapshot.map((entry) => [entry.requestId, entry]),
        ),
        results: [],
        revoked: false,
        finishFailures,
        acceptBeforeFailure,
        nativeCandidates: nativeCandidates ?? [],
        imports: {},
        startupFailures,
        importFailures,
        preferenceFailures,
        closeFailures,
        importHeld: holdImport,
        rejectImport: false,
        operatorSettingsUnavailable,
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
            if (
              command === "get_operator_forge_settings" &&
              state.operatorSettingsUnavailable
            ) {
              throw new Error("Runtime defaults unavailable");
            }
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
            if (
              command === "discover_native_residents" &&
              nativeCandidates !== null
            ) {
              return {
                runtimes: [
                  {
                    nativeType: "hermes",
                    status: "available",
                    candidates: state.nativeCandidates,
                  },
                ],
              };
            }
            if (command === "import_resident_proposal") {
              const input = payload as {
                requestId: string;
                selection?: NativeImportSelection;
                retryStart: boolean;
                retrySettings?: boolean;
              };
              if (
                state.revoked ||
                !state.pending[input.requestId] ||
                state.rejectImport
              )
                throw new Error(
                  "The selected Hermes profile changed or this request is no longer authorized.",
                );
              const ipc = async (command: string, payload: unknown) => {
                if (!realInvoke) throw new Error("Mock IPC missing");
                const operation: Call = {
                  command,
                  payload: structuredClone(payload),
                };
                state.calls.push(operation);
                const result = await realInvoke(command, payload);
                operation.result = structuredClone(result);
                return result;
              };
              let saved = state.imports[input.requestId];
              const first = !saved;
              if (first) {
                const selected = input.selection;
                const candidate = state.nativeCandidates.find(
                  (entry) =>
                    entry.semanticId === selected?.semanticId &&
                    entry.bindingFingerprint === selected.bindingFingerprint,
                );
                if (!selected || !candidate)
                  throw new Error("Review the exact discovered profile first.");
                const residents = (await realInvoke?.(
                  "list_managed_agents",
                )) as Array<{
                  pubkey: string;
                  native_runtime_binding: {
                    hermesHome?: string;
                    profileName?: string;
                  } | null;
                  status: string;
                }>;
                const existing = residents.find(
                  (resident) =>
                    resident.native_runtime_binding?.hermesHome ===
                      candidate.canonicalLocation &&
                    resident.native_runtime_binding.profileName ===
                      candidate.nativeId,
                );
                const created = existing
                  ? null
                  : ((await ipc("create_luca_resident", {
                      input: {
                        name: candidate.displayName,
                        agentCommand: candidate.bindingPreview.executablePath,
                        agentArgs: ["acp"],
                        harnessOverride: true,
                        parallelism: 1,
                        nativeRuntimeBinding: candidate.bindingPreview,
                        spawnAfterCreate: false,
                        startOnAppLaunch: false,
                      },
                    })) as { resident: { residentPubkey: string } } | null);
                const residentPubkey =
                  existing?.pubkey ?? created?.resident.residentPubkey;
                if (!residentPubkey) throw new Error("Saved resident missing");
                saved = {
                  selection: structuredClone(selected),
                  preferencesApplied: !!existing,
                  result: {
                    residentPubkey,
                    displayName: candidate.displayName,
                    nativeProfileName: candidate.nativeId,
                    reused: !!existing,
                    processRunning: existing?.status === "running",
                    authenticatedReady: false,
                    startupError: null,
                    warning: null,
                    preferencesError: null,
                  },
                };
                state.imports[input.requestId] = saved;
              }
              while (state.importHeld)
                await new Promise((resolve) => setTimeout(resolve, 10));
              if (!state.pending[input.requestId])
                throw new Error("The import request has ended.");
              if ((first || input.retrySettings) && !saved.preferencesApplied) {
                const payload = {
                  residentPubkey: saved.result.residentPubkey,
                  enabled: saved.selection.continuityEnabled,
                };
                if (state.preferenceFailures > 0) {
                  state.preferenceFailures -= 1;
                  state.calls.push({
                    command: "set_resident_continuity_enabled",
                    payload,
                  });
                  saved.result.preferencesError = "Consent store unavailable";
                } else {
                  await ipc("set_resident_continuity_enabled", payload);
                  await ipc("set_managed_agent_start_on_app_launch", {
                    pubkey: saved.result.residentPubkey,
                    startOnAppLaunch: saved.selection.startOnAppLaunch,
                  });
                  saved.preferencesApplied = true;
                  saved.result.preferencesError = null;
                }
              }
              if (state.importFailures > 0) {
                state.importFailures -= 1;
                throw new Error(
                  "Import acknowledgment interrupted after save.",
                );
              }
              if (
                saved.preferencesApplied &&
                ((first && saved.selection.startNow) || input.retryStart) &&
                !saved.result.processRunning
              ) {
                if (state.startupFailures > 0) {
                  state.startupFailures -= 1;
                  saved.result.startupError = "Hermes could not start.";
                } else {
                  await ipc("start_managed_agent", {
                    pubkey: saved.result.residentPubkey,
                  });
                  saved.result.processRunning = true;
                  saved.result.startupError = null;
                }
              }
              return structuredClone(saved.result);
            }
            if (command === "finish_resident_proposal") {
              const result = payload as HostResult;
              const accept = () => {
                if (!state.pending[result.requestId]) {
                  if (
                    result.completion.status === "native_imported" &&
                    !state.results.some(
                      (saved) =>
                        saved.requestId === result.requestId &&
                        saved.completion.status === "native_imported",
                    )
                  )
                    throw new Error("The import request has ended.");
                  return false;
                }
                if (
                  result.completion.status === "native_imported" &&
                  !state.imports[result.requestId]?.preferencesApplied
                )
                  throw new Error("No bound imported resident.");
                if (state.revoked && result.completion.status !== "closed") {
                  throw new Error(
                    "The host setup request is no longer authorized.",
                  );
                }
                state.results.push(structuredClone(result));
                delete state.pending[result.requestId];
                if (result.completion.status === "native_imported")
                  window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
                    "luca://resident-proposal-resolved",
                    { requestId: result.requestId },
                  );
                return true;
              };
              if (
                state.closeFailures > 0 &&
                result.completion.status === "closed"
              ) {
                state.closeFailures -= 1;
                if (state.acceptBeforeFailure) accept();
                throw new Error("The close acknowledgment was interrupted.");
              }
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
      nativeCandidates: options.nativeCandidates ?? null,
      startupFailures: options.startupFailures ?? 0,
      importFailures: options.importFailures ?? 0,
      preferenceFailures: options.preferenceFailures ?? 0,
      closeFailures: options.closeFailures ?? 0,
      holdImport: options.holdImport ?? false,
      operatorSettingsUnavailable: options.operatorSettingsUnavailable ?? false,
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
      ...(options.reuseProfile
        ? [
            {
              pubkey: "8".repeat(64),
              name: options.reuseProfile.displayName,
              status: "stopped" as const,
              nativeRuntimeBinding: options.reuseProfile.bindingPreview,
            },
          ]
        : []),
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

test("an implicit proposal blocks on runtime-default failure and retries the same review into Hermes", async ({
  page,
}, testInfo) => {
  const request = proposal({ runtimeFamily: undefined });
  await installProposalHost(page, {
    snapshot: [request],
    operatorSettingsUnavailable: true,
  });
  await openHost(page);

  await expect(page.getByRole("alert")).toHaveText(
    "Your runtime default could not be loaded. Try again to continue this review.",
  );
  await expect(page.getByTestId("persona-dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toHaveCount(0);
  for (const command of [
    "preview_native_agent_provisioning",
    "create_persona",
    "execute_native_agent_provisioning",
    "create_luca_resident",
  ]) {
    expect(await calls(page, command)).toHaveLength(0);
  }
  await waitForAnimations(page);
  await page.getByRole("dialog").screenshot({
    path: testInfo.outputPath("implicit-runtime-default-recovery.png"),
  });

  await page.evaluate(() => {
    const state = window.__RESIDENT_PROPOSAL_TEST__;
    if (!state) throw new Error("Proposal host is unavailable.");
    state.operatorSettingsUnavailable = false;
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await expect(page.getByLabel("Runtime")).toHaveValue("hermes");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    request.displayName,
  );
  expect(await calls(page, "create_persona")).toHaveLength(0);
  expect(await calls(page, "execute_native_agent_provisioning")).toHaveLength(
    0,
  );
});

for (const runtimeFamily of ["hermes", "codex"] as const) {
  test(`an explicit ${runtimeFamily} proposal ignores an unrelated runtime-default failure`, async ({
    page,
  }) => {
    const request = proposal({
      runtimeFamily,
      provisioningIntent: runtimeFamily === "hermes" ? "fresh" : null,
    });
    await installProposalHost(page, {
      snapshot: [request],
      managedRuntimeReady: runtimeFamily === "codex",
      operatorSettingsUnavailable: true,
    });
    await openHost(page);

    if (runtimeFamily === "hermes") {
      await expect(
        page.getByRole("heading", { name: "Create a native agent" }),
      ).toBeVisible();
      await expect(page.getByLabel("Runtime")).toHaveValue("hermes");
    } else {
      await expect(page.getByTestId("persona-dialog")).toBeVisible();
      await expect(
        page.getByLabel("Agent harness", { exact: true }),
      ).toContainText("Codex");
    }
    expect(await calls(page, "create_persona")).toHaveLength(0);
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

function hermesProfile(home: string): DiscoveredResidentCandidate {
  return {
    nativeType: "hermes",
    nativeId: "research",
    semanticId: `hermes:${home}:research`,
    bindingFingerprint: `fingerprint:${home}`,
    displayName: "Research",
    canonicalLocation: home,
    workspace: "/fixture/project",
    runtimeVersion: "fixture-1",
    readiness: {
      status: "discovered",
      message: "Native connection not checked yet.",
    },
    warnings: [],
    bindingPreview: {
      kind: "hermes",
      schemaVersion: 1,
      profileName: "research",
      hermesHome: home,
      executablePath: "/fixture/bin/hermes",
      runtimeVersion: "fixture-1",
      defaultWorkspace: "/fixture/project",
    },
  };
}
const HERMES_PROFILES = [
  hermesProfile("/fixture/personal/hermes"),
  hermesProfile("/fixture/project/hermes"),
];
function importProposal(overrides: Partial<ResidentProposal> = {}) {
  return proposal({
    provisioningIntent: "import",
    nativeProfileName: "research",
    displayName: "",
    systemPrompt: "",
    ...overrides,
  });
}
async function selectHermes(page: Page) {
  await page
    .getByRole("radio", {
      name: "Select research at /fixture/project/hermes",
      exact: true,
    })
    .check();
}
async function importCalls(page: Page) {
  return calls(page, "import_resident_proposal");
}

test("Hermes import selects the exact owner-reviewed profile and preserves the Luca DM", async ({
  page,
}) => {
  await installProposalHost(page, { nativeCandidates: HERMES_PROFILES });
  await openHost(page);
  const origin = await openLucaDm(page);
  const request = importProposal({ conversationId: origin.id });
  await emitProposal(page, request);
  await expect(page.getByRole("radio")).toHaveCount(2);
  await emitProposal(page, request);
  await expect(page.getByTestId("hermes-import-review")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Import and start", exact: true }),
  ).toBeDisabled();
  expect(await importCalls(page)).toHaveLength(0);
  await selectHermes(page);
  await page.getByRole("switch", { name: "Start this profile now" }).uncheck();
  await page.getByRole("switch", { name: "Encrypted Luca handoff" }).uncheck();
  await waitForAnimations(page);
  await page.screenshot({ path: "hermes-exact-profile-review.png" });
  await page
    .getByRole("button", { name: "Import profile", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect((await importCalls(page))[0].payload).toEqual({
    requestId: request.requestId,
    selection: {
      semanticId: HERMES_PROFILES[1].semanticId,
      bindingFingerprint: HERMES_PROFILES[1].bindingFingerprint,
      startNow: false,
      startOnAppLaunch: false,
      continuityEnabled: false,
    },
    retryStart: false,
  });
  expect(await results(page)).toEqual([
    { requestId: request.requestId, completion: { status: "native_imported" } },
  ]);
  const residents = (await page.evaluate(() =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("list_managed_agents"),
  )) as Array<{
    pubkey: string;
    native_runtime_binding: unknown;
    system_prompt: unknown;
    start_on_app_launch: boolean;
  }>;
  const saved = residents.find((resident) => resident.pubkey !== LUCA);
  expect(saved?.native_runtime_binding).toEqual(
    HERMES_PROFILES[1].bindingPreview,
  );
  expect(saved?.system_prompt).toBeNull();
  expect(saved?.start_on_app_launch).toBe(false);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  for (const command of [
    "execute_native_agent_provisioning",
    "create_persona",
    "start_managed_agent",
    "add_channel_members",
    "send_managed_agent_channel_message",
  ])
    expect(await calls(page, command)).toHaveLength(0);
  const reopened = await openLucaDm(page);
  expect(reopened).toEqual(origin);
});

for (const empty of [true, false]) {
  test(`Hermes import ${empty ? "missing discovery" : "owner close"} cannot create a resident`, async ({
    page,
  }) => {
    await installProposalHost(page, {
      snapshot: [importProposal()],
      nativeCandidates: empty ? [] : HERMES_PROFILES,
    });
    await openHost(page);
    if (empty)
      await expect(
        page.getByText(/No exact matching Hermes profile/),
      ).toBeVisible();
    else await selectHermes(page);
    await page
      .getByTestId("hermes-import-review")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect
      .poll(() => results(page))
      .toEqual([
        {
          requestId: "host-resident-1",
          completion: { status: "closed", busy: false },
        },
      ]);
    expect(await importCalls(page)).toHaveLength(0);
    expect(await calls(page, "create_luca_resident")).toHaveLength(0);
  });
}

test("Hermes startup failure keeps the saved key and retries only its start at compact zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installProposalHost(page, {
    snapshot: [importProposal()],
    nativeCandidates: HERMES_PROFILES,
    startupFailures: 1,
  });
  await openHost(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await selectHermes(page);
  const confirm = page.getByRole("button", {
    name: "Import and start",
    exact: true,
  });
  await expect(confirm).toBeInViewport();
  await waitForAnimations(page);
  await page.screenshot({ path: "hermes-import-zoom150.png" });
  await confirm.click();
  await expect(page.getByTestId("hermes-import-result")).toContainText(
    "Startup failed: Hermes could not start.",
  );
  expect(await results(page)).toHaveLength(0);
  const saved = await page.evaluate(
    () =>
      window.__RESIDENT_PROPOSAL_TEST__?.imports["host-resident-1"].result
        .residentPubkey,
  );
  if (!saved) throw new Error("The host did not retain the imported identity.");
  await expect(page.getByTestId("hermes-import-result")).toContainText(saved);
  const savedResult = page.getByTestId("hermes-import-result");
  await expect(savedResult).toBeFocused();
  expect(
    await savedResult.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = element.parentElement?.getBoundingClientRect();
      return (
        !!viewport &&
        bounds.top >= viewport.top - 1 &&
        bounds.bottom <= viewport.bottom + 1
      );
    }),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({ path: "hermes-import-start-failure.png" });
  await page.getByRole("button", { name: "Retry start", exact: true }).click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect((await importCalls(page))[1].payload).toEqual({
    requestId: "host-resident-1",
    retryStart: true,
  });
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect((await calls(page, "start_managed_agent"))[0].payload).toEqual({
    pubkey: saved,
  });
});

for (const failure of ["import-ack", "finish-ack"] as const) {
  test(`Hermes ${failure} retry returns the saved identity without another import`, async ({
    page,
  }) => {
    await installProposalHost(page, {
      snapshot: [importProposal()],
      nativeCandidates: HERMES_PROFILES,
      importFailures: failure === "import-ack" ? 1 : 0,
      finishFailures: failure === "finish-ack" ? 1 : 0,
      acceptBeforeFailure: true,
    });
    await openHost(page);
    await selectHermes(page);
    await page
      .getByRole("button", { name: "Import and start", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(/acknowledgment/);
    await page
      .getByRole("button", {
        name:
          failure === "import-ack"
            ? "Verify saved result"
            : "Retry returning result",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
    expect(await calls(page, "create_luca_resident")).toHaveLength(1);
    expect(await results(page)).toEqual([
      {
        requestId: "host-resident-1",
        completion: { status: "native_imported" },
      },
    ]);
    expect(await calls(page, "start_managed_agent")).toHaveLength(
      failure === "import-ack" ? 0 : 1,
    );
    if (failure === "import-ack")
      expect((await importCalls(page))[1].payload).toEqual({
        requestId: "host-resident-1",
        retryStart: false,
      });
    else expect(await importCalls(page)).toHaveLength(1);
  });
}

test("Hermes reuse preserves the resident and hides changes to existing launch and handoff preferences", async ({
  page,
}) => {
  await installProposalHost(page, {
    snapshot: [importProposal()],
    nativeCandidates: HERMES_PROFILES,
    reuseProfile: HERMES_PROFILES[1],
  });
  await openHost(page);
  await selectHermes(page);
  await expect(
    page.getByText(/launch and handoff preferences will be preserved/),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Encrypted Luca handoff" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Use existing resident", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect(await calls(page, "create_luca_resident")).toHaveLength(0);
  expect(await calls(page, "set_resident_continuity_enabled")).toHaveLength(0);
  expect((await calls(page, "start_managed_agent"))[0].payload).toEqual({
    pubkey: "8".repeat(64),
  });
});

for (const invalidation of ["revoked", "changed", "expired"] as const) {
  test(`Hermes ${invalidation} review cannot import or revive the request`, async ({
    page,
  }) => {
    await installProposalHost(page, {
      snapshot: [importProposal()],
      nativeCandidates: HERMES_PROFILES,
    });
    await openHost(page);
    await selectHermes(page);
    await page.evaluate((invalidation) => {
      const state = window.__RESIDENT_PROPOSAL_TEST__;
      if (!state) throw new Error("Host fixture missing.");
      if (invalidation === "revoked") state.revoked = true;
      if (invalidation === "changed") state.rejectImport = true;
      if (invalidation === "expired") {
        delete state.pending["host-resident-1"];
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
          "luca://resident-proposal-resolved",
          { requestId: "host-resident-1" },
        );
      }
    }, invalidation);
    if (invalidation === "expired")
      await expect(
        page.getByRole("button", { name: "Import and start", exact: true }),
      ).toBeDisabled();
    else {
      await page
        .getByRole("button", { name: "Import and start", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(/authorized|changed/);
    }
    expect(await calls(page, "create_luca_resident")).toHaveLength(0);
    expect(await results(page)).toHaveLength(0);
  });
}

test("a conversational Ziggy request reviews the actual lowercase Hermes profile", async ({
  page,
}) => {
  const ziggy = hermesProfile("/fixture/CasePreserved/Hermes");
  ziggy.nativeId = "ziggy";
  ziggy.displayName = "Ziggy";
  ziggy.semanticId = "hermes:/fixture/CasePreserved/Hermes:ziggy";
  if (ziggy.bindingPreview.kind !== "hermes")
    throw new Error("Hermes fixture expected");
  ziggy.bindingPreview.profileName = "ziggy";
  await installProposalHost(page, {
    snapshot: [importProposal({ nativeProfileName: "Ziggy" })],
    nativeCandidates: [ziggy],
  });
  await openHost(page);
  await page
    .getByRole("radio", {
      name: "Select ziggy at /fixture/CasePreserved/Hermes",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import and start", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect((await importCalls(page))[0].payload).toMatchObject({
    selection: {
      semanticId: ziggy.semanticId,
      bindingFingerprint: ziggy.bindingFingerprint,
    },
  });
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
});

test("an expired Hermes import retains its saved key without allowing late startup or success", async ({
  page,
}) => {
  await installProposalHost(page, {
    snapshot: [importProposal()],
    nativeCandidates: HERMES_PROFILES,
    startupFailures: 1,
  });
  await openHost(page);
  await selectHermes(page);
  await page
    .getByRole("button", { name: "Import and start", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-result")).toContainText(
    "Startup failed",
  );
  const saved = await page.getByTestId("hermes-import-result").textContent();
  await page.evaluate(() => {
    const state = window.__RESIDENT_PROPOSAL_TEST__;
    if (!state) throw new Error("Host fixture missing");
    delete state.pending["host-resident-1"];
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
      "luca://resident-proposal-resolved",
      { requestId: "host-resident-1" },
    );
  });
  await expect(
    page.getByRole("button", { name: "Retry start", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Continue without starting", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("request has ended");
  expect(await page.getByTestId("hermes-import-result").textContent()).toBe(
    saved,
  );
  expect(await results(page)).toHaveLength(0);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect(await calls(page, "start_managed_agent")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
});

for (const alreadyAccepted of [false, true]) {
  test(`Hermes failed close acknowledgment ${alreadyAccepted ? "after" : "before"} host acceptance retains a permanent closing fence`, async ({
    page,
  }) => {
    await installProposalHost(page, {
      snapshot: [importProposal()],
      nativeCandidates: HERMES_PROFILES,
      closeFailures: 1,
      acceptBeforeFailure: alreadyAccepted,
    });
    await openHost(page);
    await selectHermes(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alert")).toContainText(
      "has not acknowledged closing",
    );
    await expect(
      page.getByRole("button", { name: "Import and start", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("radio").last()).toBeDisabled();
    await page
      .getByRole("button", { name: "Retry closing", exact: true })
      .click();
    await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
    expect(
      (await calls(page, "finish_resident_proposal")).map(
        (call) => call.payload,
      ),
    ).toEqual(
      Array(2).fill({
        requestId: "host-resident-1",
        completion: { status: "closed", busy: false },
      }),
    );
    expect(await importCalls(page)).toHaveLength(0);
    expect(await calls(page, "create_luca_resident")).toHaveLength(0);
    expect(await results(page)).toHaveLength(1);
  });
}

test("Hermes close during an uncertain import prevents a late success callback", async ({
  page,
}) => {
  await installProposalHost(page, {
    snapshot: [importProposal()],
    nativeCandidates: HERMES_PROFILES,
    closeFailures: 1,
    holdImport: true,
  });
  await openHost(page);
  await selectHermes(page);
  await page
    .getByRole("button", { name: "Import and start", exact: true })
    .click();
  await expect
    .poll(async () => (await calls(page, "create_luca_resident")).length)
    .toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText(
    "has not acknowledged closing",
  );
  await page.evaluate(() => {
    const state = window.__RESIDENT_PROPOSAL_TEST__;
    if (state) {
      state.importHeld = false;
    }
  });
  await page.waitForFunction(
    () =>
      window.__RESIDENT_PROPOSAL_TEST__?.imports["host-resident-1"].result
        .processRunning,
  );
  expect(
    (await calls(page, "finish_resident_proposal")).every(
      (call) => (call.payload as HostResult).completion.status === "closed",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Retry closing", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect(await results(page)).toEqual([
    {
      requestId: "host-resident-1",
      completion: { status: "closed", busy: false },
    },
  ]);
  expect(
    (await calls(page, "finish_resident_proposal")).every(
      (call) => (call.payload as HostResult).completion.status === "closed",
    ),
  ).toBe(true);
});

test("Hermes failed opt-out persistence blocks immediate and restart startup until explicit same-key settings retry", async ({
  page,
}) => {
  await installProposalHost(page, {
    snapshot: [importProposal()],
    nativeCandidates: HERMES_PROFILES,
    preferenceFailures: 2,
  });
  await openHost(page);
  await selectHermes(page);
  await page.getByRole("switch", { name: "Encrypted Luca handoff" }).uncheck();
  await page
    .getByRole("switch", { name: "Start when Polyphonic opens" })
    .check();
  await page
    .getByRole("button", { name: "Import and start", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-result")).toContainText(
    "Reviewed settings need attention",
  );
  await expect(
    page.getByRole("button", { name: "Retry start", exact: true }),
  ).toHaveCount(0);
  const current = async () =>
    page.evaluate(
      () =>
        window.__RESIDENT_PROPOSAL_TEST__?.imports["host-resident-1"].result,
    );
  const saved = await current();
  if (!saved) throw new Error("Saved identity missing");
  const record = async () =>
    page.evaluate(
      async (key) =>
        (
          (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
            "list_managed_agents",
          )) as Array<{ pubkey: string; start_on_app_launch: boolean }>
        ).find((entry) => entry.pubkey === key),
      saved.residentPubkey,
    );
  expect((await record())?.start_on_app_launch).toBe(false);
  await waitForAnimations(page);
  await page.screenshot({ path: "hermes-import-consent-retry.png" });
  expect(
    await calls(page, "set_managed_agent_start_on_app_launch"),
  ).toHaveLength(0);
  expect(await calls(page, "start_managed_agent")).toHaveLength(0);
  expect(await results(page)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Retry reviewed settings", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-result")).toContainText(
    "Consent store unavailable",
  );
  expect((await record())?.start_on_app_launch).toBe(false);
  expect(await calls(page, "start_managed_agent")).toHaveLength(0);
  expect(await results(page)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Retry reviewed settings", exact: true })
    .click();
  await expect(page.getByTestId("hermes-import-review")).not.toBeVisible();
  expect((await current())?.residentPubkey).toBe(saved.residentPubkey);
  expect(await calls(page, "create_luca_resident")).toHaveLength(1);
  expect((await calls(page, "start_managed_agent"))[0].payload).toEqual({
    pubkey: saved.residentPubkey,
  });
  expect((await record())?.start_on_app_launch).toBe(true);
  expect(
    (await importCalls(page)).slice(1).map((call) => call.payload),
  ).toEqual(
    Array(2).fill({
      requestId: "host-resident-1",
      retryStart: true,
      retrySettings: true,
    }),
  );
  expect(
    (await calls(page, "set_resident_continuity_enabled")).map(
      (call) => call.payload,
    ),
  ).toEqual(
    Array(3).fill({ residentPubkey: saved.residentPubkey, enabled: false }),
  );
});
