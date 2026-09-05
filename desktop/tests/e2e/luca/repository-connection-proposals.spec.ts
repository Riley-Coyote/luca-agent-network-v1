import { expect, test, type Page } from "@playwright/test";

import type { RepositoryConnectionProposalV1 } from "../../../src/shared/api/tauriRepositoryConnectionProposals";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const ROOM = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const OWNER = "deadbeef".repeat(8);
const LUCA = "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";
type Call = { command: string; payload: unknown };
type Attempt = {
  request: RepositoryConnectionProposalV1;
  discoveryId: string;
  sourceId?: string;
  operationConfirmed: boolean;
};
type HostState = {
  calls: Call[];
  pending: Record<string, RepositoryConnectionProposalV1>;
  attempts: Record<string, Attempt>;
  completed: Record<string, Attempt>;
  results: Array<{
    requestId: string;
    outcome: string;
    sourceId?: string;
    operationConfirmed?: boolean;
  }>;
  revoked: boolean;
  finishFailures: number;
  releaseDiscovery?: () => void;
  releaseConnect?: () => void;
  releaseFinish?: () => void;
};
declare global {
  interface Window {
    __REPOSITORY_PROPOSAL_TEST__?: HostState;
  }
}

function proposal(
  overrides: Partial<RepositoryConnectionProposalV1> = {},
): RepositoryConnectionProposalV1 {
  return {
    requestId: "repository-request-1",
    ownerPubkey: OWNER,
    residentPubkey: LUCA,
    conversationId: ROOM,
    purpose:
      "Connect this project's repository so I can review its design decisions.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Only host request/result bookkeeping is simulated. Discovery, source creation
// and the resulting inventory/grants run through the existing real mock bridge.
async function installHost(
  page: Page,
  options: {
    snapshot?: RepositoryConnectionProposalV1[];
    connectError?: "before" | "after";
    finishFailures?: number;
    acceptBeforeFailure?: boolean;
    holdDiscovery?: boolean;
    holdConnect?: boolean;
    holdFinish?: boolean;
    closeFailures?: number;
  } = {},
) {
  await page.addInitScript((options) => {
    const state: HostState = {
      calls: [],
      pending: Object.fromEntries(
        (options.snapshot ?? []).map((p) => [p.requestId, p]),
      ),
      attempts: {},
      completed: {},
      results: [],
      revoked: false,
      finishFailures: options.finishFailures ?? 0,
    };
    window.__REPOSITORY_PROPOSAL_TEST__ = state;
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
        async (command: string, payload?: unknown, invokeOptions?: unknown) => {
          state.calls.push({
            command,
            payload: structuredClone(payload ?? null),
          });
          if (command === "list_repository_connection_proposals")
            return Object.values(state.pending);
          if (command === "authorize_repository_connection_proposal") {
            if (
              state.revoked ||
              !state.pending[(payload as { requestId: string }).requestId]
            )
              throw new Error(
                "This repository request is no longer authorized.",
              );
            return null;
          }
          if (!realInvoke) throw new Error("Mock bridge is unavailable.");
          if (
            command === "discover_connected_brain_sources" &&
            options.holdDiscovery
          ) {
            options.holdDiscovery = false;
            await new Promise<void>((resolve) => {
              state.releaseDiscovery = resolve;
            });
          }
          if (command === "connect_connected_brain_source") {
            const input = (
              payload as {
                input: {
                  discoveryIds: string[];
                  consentAccepted: boolean;
                  proposalRequestId: string;
                };
              }
            ).input;
            const request = state.pending[input.proposalRequestId];
            if (
              !request ||
              state.revoked ||
              !input.consentAccepted ||
              input.discoveryIds.length !== 1
            )
              throw new Error("The repository proposal is not authorized.");
            if (state.attempts[input.proposalRequestId])
              throw new Error(
                "A connection was already attempted for this request.",
              );
            const attempt: Attempt = {
              request,
              discoveryId: input.discoveryIds[0],
              operationConfirmed: false,
            };
            state.attempts[request.requestId] = attempt;
            if (options.connectError === "before")
              throw new Error(
                "The connection stopped before a source was saved.",
              );
            const result = (await realInvoke(
              command,
              payload,
              invokeOptions,
            )) as { sources: Array<{ sourceId: string }> };
            attempt.sourceId = result.sources[0]?.sourceId;
            if (options.holdConnect)
              await new Promise<void>((resolve) => {
                state.releaseConnect = resolve;
              });
            if (options.connectError === "after")
              throw new Error(
                "The connection command ended after saving the source.",
              );
            attempt.operationConfirmed = true;
            return result;
          }
          if (command === "finish_repository_connection_proposal") {
            const { requestId, outcome } = payload as {
              requestId: string;
              outcome: string;
            };
            if (outcome !== "connected") {
              if (!state.pending[requestId]) return false;
              state.results.push({ requestId, outcome });
              delete state.pending[requestId];
              if ((options.closeFailures ?? 0) > 0) {
                options.closeFailures = (options.closeFailures ?? 0) - 1;
                throw new Error("The close acknowledgment was interrupted.");
              }
              return true;
            }
            if (options.holdFinish) {
              options.holdFinish = false;
              await new Promise<void>((resolve) => {
                state.releaseFinish = resolve;
              });
            }
            const attempt =
              state.attempts[requestId] ?? state.completed[requestId];
            if (
              state.revoked ||
              !attempt?.sourceId ||
              (!state.pending[requestId] && !state.completed[requestId])
            )
              throw new Error(
                "The saved repository result cannot be verified for this request.",
              );
            const inventory = (await realInvoke(
              "list_connected_brain_sources",
            )) as {
              sources: Array<{
                sourceId: string;
                sourceKind: string;
                status: string;
                entryCount: number;
              }>;
              recallGrants: Array<{
                sourceId: string;
                residentPubkey: string;
                state: string;
              }>;
              repositoryGrants: Array<{
                sourceId: string;
                residentPubkey: string;
                state: string;
              }>;
            };
            const source = inventory.sources.find(
              (s) => s.sourceId === attempt.sourceId,
            );
            const allowed = (grants: typeof inventory.recallGrants) =>
              grants.some(
                (g) =>
                  g.sourceId === attempt.sourceId &&
                  g.residentPubkey === attempt.request.residentPubkey &&
                  g.state === "active",
              );
            if (
              source?.sourceKind !== "repository" ||
              source.status !== "current" ||
              !source.entryCount ||
              !allowed(inventory.recallGrants) ||
              !allowed(inventory.repositoryGrants)
            )
              throw new Error(
                "The saved repository is not currently available to this agent.",
              );
            const accept = () => {
              if (state.completed[requestId]) return false;
              state.results.push({
                requestId,
                outcome,
                sourceId: attempt.sourceId,
                operationConfirmed: attempt.operationConfirmed,
              });
              state.completed[requestId] = attempt;
              delete state.pending[requestId];
              return true;
            };
            if (state.finishFailures > 0) {
              state.finishFailures -= 1;
              if (options.acceptBeforeFailure) accept();
              throw new Error("The result acknowledgment was interrupted.");
            }
            return accept();
          }
          return realInvoke(command, payload, invokeOptions);
        },
    });
  }, options);
  await installMockBridge(
    page,
    {
      managedAgents: [
        {
          pubkey: LUCA,
          name: "Luca",
          status: "running",
          channelNames: ["agents"],
        },
      ],
    },
    { seedPreviewFeatures: false, inboxSurface: false },
  );
}

async function open(page: Page) {
  await page.goto(`/?e2e=mock#/channels/${ROOM}`);
  await page.waitForFunction(() =>
    window.__REPOSITORY_PROPOSAL_TEST__?.calls.some(
      (c) => c.command === "list_repository_connection_proposals",
    ),
  );
}
async function emit(page: Page, request: RepositoryConnectionProposalV1) {
  await page.evaluate((request) => {
    const state = window.__REPOSITORY_PROPOSAL_TEST__;
    if (!state || !window.__BUZZ_E2E_EMIT_TAURI_EVENT__)
      throw new Error("No host event boundary.");
    state.pending[request.requestId] = request;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__(
      "luca://repository-connection-proposal",
      request,
    );
  }, request);
}
async function recorded(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      window.__REPOSITORY_PROPOSAL_TEST__?.calls.filter(
        (c) => c.command === command,
      ) ?? [],
    command,
  );
}
async function choose(page: Page) {
  await expect(page.getByTestId("brain-connection-dialog")).toBeVisible();
  await page
    .getByRole("radio", { name: "Select atlas-notes", exact: true })
    .check();
}
async function connect(page: Page) {
  await choose(page);
  await page
    .getByRole("button", { name: "Connect 1 source", exact: true })
    .click();
}

for (const ingress of ["event", "snapshot"] as const) {
  test(`${ingress} proposal uses the existing one-repository consent review without creating`, async ({
    page,
  }) => {
    const request = proposal();
    await installHost(page, {
      snapshot: ingress === "snapshot" ? [request] : [],
    });
    await open(page);
    if (ingress === "event") {
      await emit(page, request);
      await emit(page, request);
    }
    const dialog = page.getByTestId("brain-connection-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(request.purpose);
    await expect(dialog).toContainText(
      "Current and future eligible agents receive access under your Brain policy",
    );
    await expect(dialog).toContainText(
      "Repository edits and commands always ask first",
    );
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(
      dialog.getByRole("button", { name: "Select all" }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Connect selected sources" }),
    ).toBeDisabled();
    expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
      0,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(
      await recorded(page, "finish_repository_connection_proposal"),
    ).toEqual([
      {
        command: "finish_repository_connection_proposal",
        payload: { requestId: request.requestId, outcome: "closed" },
      },
    ]);
  });
}

test("one owner-selected repository returns its actual host-correlated result to the same request", async ({
  page,
}, info) => {
  const request = proposal();
  await installHost(page);
  await open(page);
  await emit(page, request);
  await choose(page);
  const first = page.getByRole("radio", {
    name: "Select atlas-notes",
    exact: true,
  });
  await first.focus();
  await first.press("ArrowDown");
  await expect(
    page.getByRole("radio", { name: "Select field-kit", exact: true }),
  ).toBeChecked();
  await expect(first).not.toBeChecked();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("repository-review.png") });
  await page
    .getByRole("button", { name: "Connect 1 source", exact: true })
    .click();
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/channels/${ROOM}$`));
  expect(await recorded(page, "connect_connected_brain_source")).toEqual([
    {
      command: "connect_connected_brain_source",
      payload: {
        input: {
          discoveryIds: ["discovery-repository-field-kit"],
          consentAccepted: true,
          proposalRequestId: request.requestId,
        },
      },
    },
  ]);
  const state = await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__);
  expect(state?.results).toEqual([
    {
      requestId: request.requestId,
      outcome: "connected",
      sourceId: "connected-discovery-repository-field-kit",
      operationConfirmed: true,
    },
  ]);
  const sequence =
    state?.calls
      .filter((c) =>
        [
          "authorize_repository_connection_proposal",
          "discover_connected_brain_sources",
          "connect_connected_brain_source",
          "finish_repository_connection_proposal",
        ].includes(c.command),
      )
      .map((c) => c.command) ?? [];
  const auth = sequence.indexOf("authorize_repository_connection_proposal");
  expect(sequence.slice(auth)).toEqual([
    "authorize_repository_connection_proposal",
    "discover_connected_brain_sources",
    "authorize_repository_connection_proposal",
    "connect_connected_brain_source",
    // The existing connected-inventory query refreshes after this mutation.
    "discover_connected_brain_sources",
    "finish_repository_connection_proposal",
  ]);
  expect(
    await recorded(page, "send_managed_agent_channel_message"),
  ).toHaveLength(0);
});

test("a second proposal reports busy while preserving the first review", async ({
  page,
}) => {
  const first = proposal();
  const second = proposal({
    requestId: "repository-request-2",
    purpose: "Another project",
  });
  await installHost(page);
  await open(page);
  await emit(page, first);
  await choose(page);
  await emit(page, second);
  await expect
    .poll(() => recorded(page, "finish_repository_connection_proposal"))
    .toContainEqual({
      command: "finish_repository_connection_proposal",
      payload: { requestId: second.requestId, outcome: "busy" },
    });
  await expect(page.getByTestId("brain-connection-dialog")).toContainText(
    first.purpose,
  );
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    0,
  );
});

test("an expired snapshot cannot discover or connect a repository", async ({
  page,
}) => {
  const request = proposal({
    createdAt: new Date(Date.now() - 16 * 60_000).toISOString(),
  });
  await installHost(page, { snapshot: [request] });
  await open(page);
  await expect
    .poll(() => recorded(page, "finish_repository_connection_proposal"))
    .toContainEqual({
      command: "finish_repository_connection_proposal",
      payload: { requestId: request.requestId, outcome: "closed" },
    });
  expect(
    await recorded(page, "authorize_repository_connection_proposal"),
  ).toHaveLength(0);
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    0,
  );
  await expect(page.getByTestId("brain-connection-dialog")).toHaveCount(0);
});

test("host resolution during discovery fences the late review result", async ({
  page,
}) => {
  const request = proposal();
  await installHost(page, { holdDiscovery: true });
  await open(page);
  await emit(page, request);
  await page.waitForFunction(
    () => !!window.__REPOSITORY_PROPOSAL_TEST__?.releaseDiscovery,
  );
  await page.evaluate((requestId) => {
    const state = window.__REPOSITORY_PROPOSAL_TEST__;
    if (!state) throw new Error("Missing host");
    delete state.pending[requestId];
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
      "luca://repository-connection-proposal-resolved",
      { requestId },
    );
    state.releaseDiscovery?.();
  }, request.requestId);
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  await expect(page.getByTestId("brain-connection-dialog")).toHaveCount(0);
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    0,
  );
});

test("revocation after review blocks the first connect mutation", async ({
  page,
}) => {
  await installHost(page);
  await open(page);
  await emit(page, proposal());
  await choose(page);
  await page.evaluate(() => {
    const state = window.__REPOSITORY_PROPOSAL_TEST__;
    if (state) state.revoked = true;
  });
  await page
    .getByRole("button", { name: "Connect 1 source", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("no longer authorized");
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Try review again" }),
  ).toBeVisible();
});

test("partial connection recovery verifies only the saved result at compact 150 percent", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem("buzz:text-scale", "1.5"),
  );
  await installHost(page, { connectError: "after" });
  await open(page);
  await emit(page, proposal());
  await choose(page);
  await expect(
    page.getByText(
      "Current and future eligible agents receive access under your Brain policy.",
      { exact: false },
    ),
  ).toBeInViewport({ ratio: 1 });
  const confirm = page.getByRole("button", {
    name: "Connect 1 source",
    exact: true,
  });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await waitForAnimations(page);
  await expect(
    page.getByTestId("brain-connection-source-discovery-repository-atlas"),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: info.outputPath("repository-review-zoom150.png"),
  });
  await confirm.click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText(
    "may already be connected",
  );
  const retry = page.getByRole("button", {
    name: "Verify saved connection",
    exact: true,
  });
  await expect(retry).toBeInViewport({ ratio: 1 });
  await waitForAnimations(page);
  await page.screenshot({
    path: info.outputPath("repository-partial-result-zoom150.png"),
  });
  await retry.click();
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
  ).toEqual([
    {
      requestId: "repository-request-1",
      outcome: "connected",
      sourceId: "connected-discovery-repository-atlas",
      operationConfirmed: false,
    },
  ]);
});

test("a lost finish acknowledgment retries the verified result without reconnecting", async ({
  page,
}) => {
  await installHost(page, { finishFailures: 1, acceptBeforeFailure: true });
  await open(page);
  await emit(page, proposal());
  await connect(page);
  await expect(page.getByRole("alert")).toContainText(
    "acknowledgment was interrupted",
  );
  const before =
    (await page.evaluate(
      () => window.__REPOSITORY_PROPOSAL_TEST__?.calls.length,
    )) ?? 0;
  await page.getByRole("button", { name: "Verify saved connection" }).click();
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  expect(
    await page.evaluate(
      (before) =>
        window.__REPOSITORY_PROPOSAL_TEST__?.calls
          .slice(before)
          // The workspace may finish its independent read-only catalog query.
          .filter((c) => c.command !== "list_channel_templates")
          .map((c) => c.command),
      before,
    ),
  ).toEqual(["finish_repository_connection_proposal"]);
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
  ).toHaveLength(1);
});

test("an unsuccessful attempt cannot become a second connection through Retry", async ({
  page,
}) => {
  await installHost(page, { connectError: "before" });
  await open(page);
  await emit(page, proposal());
  await connect(page);
  await expect(page.getByRole("alert")).toContainText(
    "before a source was saved",
  );
  await page.getByRole("button", { name: "Verify saved connection" }).click();
  await expect(page.getByRole("alert")).toContainText("cannot be verified");
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
});

test("host resolution during an in-flight connection cannot reopen or finish a replacement review", async ({
  page,
}) => {
  const request = proposal();
  await installHost(page, { holdConnect: true });
  await open(page);
  await emit(page, request);
  await connect(page);
  await page.waitForFunction(
    () => !!window.__REPOSITORY_PROPOSAL_TEST__?.releaseConnect,
  );
  await expect(
    page.getByRole("button", { name: "Close", exact: true }),
  ).toBeEnabled();
  await page.evaluate((requestId) => {
    const state = window.__REPOSITORY_PROPOSAL_TEST__;
    if (!state) throw new Error("Missing host");
    delete state.pending[requestId];
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
      "luca://repository-connection-proposal-resolved",
      { requestId },
    );
    state.releaseConnect?.();
  }, request.requestId);
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  await emit(page, proposal({ requestId: "replacement-review" }));
  await expect(page.getByTestId("brain-connection-dialog")).toBeVisible();
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    1,
  );
  expect(
    (await recorded(page, "finish_repository_connection_proposal")).filter(
      (call) => (call.payload as { outcome: string }).outcome === "connected",
    ),
  ).toHaveLength(0);
});

for (const phase of ["connecting", "verifying"] as const) {
  test(`owner can close while ${phase} and a late result cannot finish another review`, async ({
    page,
  }) => {
    const request = proposal();
    await installHost(page, {
      holdConnect: phase === "connecting",
      holdFinish: phase === "verifying",
    });
    await open(page);
    await emit(page, request);
    await connect(page);
    await page.waitForFunction((phase) => {
      const state = window.__REPOSITORY_PROPOSAL_TEST__;
      return phase === "connecting"
        ? !!state?.releaseConnect
        : !!state?.releaseFinish;
    }, phase);
    await expect(
      page.getByTestId("repository-connection-proposal"),
    ).toContainText("Connection work already started may finish");
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeEnabled();
    if (phase === "connecting")
      await page.getByRole("button", { name: "Close", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(
      page.getByTestId("repository-connection-proposal"),
    ).toBeHidden();
    expect(
      await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
    ).toEqual([{ requestId: request.requestId, outcome: "closed" }]);
    await emit(page, proposal({ requestId: "replacement-review" }));
    await expect(page.getByTestId("brain-connection-dialog")).toBeVisible();
    await page.evaluate(() => {
      window.__REPOSITORY_PROPOSAL_TEST__?.releaseConnect?.();
      window.__REPOSITORY_PROPOSAL_TEST__?.releaseFinish?.();
    });
    await expect(page.getByTestId("brain-connection-dialog")).toBeVisible();
    expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
      1,
    );
    expect(
      await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
    ).toEqual([{ requestId: request.requestId, outcome: "closed" }]);
  });
}

test("a lost close acknowledgment keeps the earlier operation fenced", async ({
  page,
}) => {
  await installHost(page, { holdConnect: true, closeFailures: 1 });
  await open(page);
  await emit(page, proposal());
  await connect(page);
  await page.waitForFunction(
    () => !!window.__REPOSITORY_PROPOSAL_TEST__?.releaseConnect,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "close acknowledgment was interrupted",
  );
  await expect(
    page.getByRole("button", { name: "Verify saved connection" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.__REPOSITORY_PROPOSAL_TEST__?.releaseConnect?.(),
  );
  await page.getByRole("button", { name: "Retry closing" }).click();
  await expect(page.getByTestId("repository-connection-proposal")).toBeHidden();
  expect(await recorded(page, "connect_connected_brain_source")).toHaveLength(
    1,
  );
  expect(
    (await recorded(page, "finish_repository_connection_proposal")).map(
      (call) => (call.payload as { outcome: string }).outcome,
    ),
  ).toEqual(["closed", "closed"]);
  expect(
    await page.evaluate(() => window.__REPOSITORY_PROPOSAL_TEST__?.results),
  ).toEqual([{ requestId: "repository-request-1", outcome: "closed" }]);
});
