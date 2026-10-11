import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const LUCA = TEST_IDENTITIES.bob.pubkey;
const REQUEST = "daaa5f62-adfa-46c0-83b0-6812b643a2e5";

// Real production components with fixture IPC. Rust tests separately exercise
// native lease authority; a browser response is not native end-to-end proof.
async function openChat(page: Page) {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await expect(page.getByTestId(`agent-library-row-${LUCA}`)).toBeVisible();
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: unknown,
          options?: unknown,
        ) => Promise<unknown>;
      };
      controlCalls: { requestId: string; action: string }[];
      rejectControl: boolean;
      releaseControl: (() => void) | null;
    };
    state.controlCalls = [];
    state.rejectControl = false;
    state.releaseControl = null;
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command !== "resolve_polyphonic_app_control")
        return invoke(command, args, options);
      const input = args as { requestId: string; action: string };
      state.controlCalls.push(input);
      if (input.action === "begin") {
        await new Promise<void>((done) => {
          state.releaseControl = done;
        });
        if (state.rejectControl)
          throw new Error("Expired native navigation lease");
        return "running";
      }
      return { complete: "completed", stop: "stopped", failed: "failed" }[
        input.action
      ];
    };
  });
}

async function emit(page: Page, override: Record<string, unknown> = {}) {
  await page.evaluate(
    ({ agent, channel, id, override }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
        "polyphonic-native-surface-request",
        {
          agentPubkey: agent,
          observerChannelId: channel,
          controlRequestId: id,
          request: {
            type: "polyphonic_surface_request",
            requestId: id,
            channelId: channel,
            surface: "appearance",
          },
          ...override,
        },
      );
    },
    { agent: LUCA, channel: CHANNEL, id: REQUEST, override },
  );
}

async function actions(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as { controlCalls: { action: string }[] }
    ).controlCalls.map((call) => call.action),
  );
}

async function release(page: Page, reject = false) {
  await page.evaluate((reject) => {
    const state = window as unknown as {
      rejectControl: boolean;
      releaseControl: (() => void) | null;
    };
    state.rejectControl = reject;
    state.releaseControl?.();
  }, reject);
}

test("approved halo identifies the resident, stays click-through, and clears after acknowledged navigation", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openChat(page);
  await emit(page);
  const edge = page.getByTestId("app-control-halo");
  const badge = page.getByTestId("app-control-badge");
  await expect(badge).toContainText("Luca is using Polyphonic");
  await expect(edge).toHaveCSS("pointer-events", "none");
  await expect.poll(() => actions(page)).toEqual(["begin"]);
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("soft-halo-production.png"),
  });
  await release(page);
  await expect.poll(() => actions(page)).toEqual(["begin", "complete"]);
  await expect(page).toHaveURL(/#\/settings\?.*section=appearance/);
  await expect(badge).toHaveCount(0);
  await expect(edge).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keyboard Stop prevents a late begin response from navigating and changes no companion grants", async ({
  page,
}) => {
  await openChat(page);
  const baseline = await page.evaluate(
    () => (window.__BUZZ_E2E_COMMANDS__ ?? []).length,
  );
  await emit(page);
  await expect.poll(() => actions(page)).toEqual(["begin"]);
  const stop = page.getByRole("button", { name: "Stop app navigation" });
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => actions(page)).toEqual(["begin", "stop"]);
  await release(page);
  await expect(page.getByTestId("app-control-badge")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/);
  expect(await actions(page)).toEqual(["begin", "stop"]);
  const calls = await page.evaluate(
    (offset) => (window.__BUZZ_E2E_COMMANDS__ ?? []).slice(offset),
    baseline,
  );
  expect(
    calls.some((command) =>
      /^(set_companion|select_companion|pick_companion|stop_managed_agent|cancel_managed)/.test(
        command,
      ),
    ),
  ).toBe(false);
});

test("host disconnect and failed authorization clear the signal without moving the owner", async ({
  page,
}) => {
  await openChat(page);
  await emit(page);
  await expect.poll(() => actions(page)).toEqual(["begin"]);
  await page.evaluate(
    (requestId) =>
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("polyphonic-app-control-ended", {
        requestId,
      }),
    REQUEST,
  );
  await expect(page.getByTestId("app-control-badge")).toHaveCount(0);
  await release(page);
  await expect.poll(() => actions(page)).toEqual(["begin", "failed"]);
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/);

  await emit(page, {
    controlRequestId: "other",
    request: {
      type: "polyphonic_surface_request",
      requestId: "other",
      channelId: CHANNEL,
      surface: "appearance",
    },
  });
  await expect.poll(() => actions(page)).toEqual(["begin", "failed", "begin"]);
  await release(page, true);
  await expect(page.getByTestId("app-control-badge")).toHaveCount(0);
  await expect(
    page.getByText("The requested view could not be opened.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/);
});

test("unauthorized requests and ordinary settings review never illuminate the app", async ({
  page,
}) => {
  await openChat(page);
  await emit(page, { agentPubkey: TEST_IDENTITIES.outsider.pubkey });
  await emit(page, { observerChannelId: "other-conversation" });
  await emit(page, { controlRequestId: "mismatched-id" });
  await page.getByTestId(`agent-library-row-${LUCA}`).click();
  await page
    .getByRole("navigation", { name: "Agent workspace" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByTestId("agent-companion-settings").click();
  await expect(page.getByRole("dialog", { name: "With Luca" })).toBeVisible();
  await expect(page.getByTestId("app-control-halo")).toHaveCount(0);
  expect(await actions(page)).toEqual([]);
});

test("compact reduced-motion signal remains readable and can be stopped before Begin", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 480, height: 800 });
  await openChat(page);
  await page.clock.install();
  await emit(page);
  const badge = page.getByTestId("app-control-badge");
  await expect(badge).toBeVisible();
  await expect(page.getByTestId("app-control-halo")).toHaveCSS(
    "animation-name",
    "none",
  );
  const box = await badge.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(480);
  await page.screenshot({ path: testInfo.outputPath("soft-halo-compact.png") });
  await page.getByRole("button", { name: "Stop app navigation" }).click();
  await page.clock.runFor(800);
  await expect(badge).toHaveCount(0);
  expect(await actions(page)).toEqual(["stop"]);
});
