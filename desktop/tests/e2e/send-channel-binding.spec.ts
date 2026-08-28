/**
 * E2E regression for the wrong-channel send bug.
 *
 * Repro: compose a message in channel A that tags a non-member managed agent,
 * submit, then immediately switch to channel B while the send is in flight.
 * Without the fix, the message lands in B's timeline; with the fix it must land
 * in A's.
 *
 * A mention is a temporary visit, not a permanent membership mutation. The
 * `sendMessageDelayMs` bridge knob holds `send_channel_message` open long
 * enough for the channel click to race the in-flight send without reviving the
 * old `add_channel_members` behavior.
 */

import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// A managed agent that is NOT a member of any channel in the seed data.
const OUT_OF_CHANNEL_BOT_PUBKEY =
  "ee00000000000000000000000000000000000000000000000000000000000001";

/** Locator scoped to the mention autocomplete dropdown inside the composer. */
function autocomplete(page: import("@playwright/test").Page) {
  return page
    .getByTestId("message-composer")
    .getByTestId("mention-autocomplete");
}

async function readCommandLog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    return (
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? []
    );
  });
}

function commandCount(commands: string[], command: string) {
  return commands.filter((c) => c === command).length;
}

// The channel timeline renders off a `useDeferredValue` snapshot; poll for the
// pending marker to clear before asserting on freshly-sent content.
async function waitForTimelineSettled(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-render-pending]")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Main regression: message always lands in the compose-time channel
// ---------------------------------------------------------------------------

test("message with agent mention lands in compose-time channel despite mid-send navigation", async ({
  page,
}) => {
  const MESSAGE_TEXT = `send-binding-repro-${Date.now()}`;

  // Install bridge with:
  //   - a managed agent that is NOT in general (the native command treats it
  //     as a temporary visitor)
  //   - a 500ms send delay to open the navigation race window
  await installMockBridge(page, {
    sendMessageDelayMs: 500,
    managedAgents: [
      {
        pubkey: OUT_OF_CHANNEL_BOT_PUBKEY,
        name: "BotA",
        status: "running",
        // No channelNames → agent is not a member of any channel
      },
    ],
  });

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  // Type a message that mentions the out-of-channel agent
  const input = page.getByTestId("message-input");
  await input.fill("@BotA");

  const dropdown = autocomplete(page);
  const botRow = dropdown.locator("button", { hasText: "BotA" });
  await expect(botRow).toBeVisible();
  await expect(botRow.getByText("not in channel")).toBeVisible();
  // Select BotA from the autocomplete
  await input.press("Enter");
  await page.keyboard.type(` ${MESSAGE_TEXT}`);

  // Verify the mention chip is present before submitting
  const composerChip = input.locator(".agent-mention-highlight", {
    hasText: "BotA",
  });
  await expect(composerChip).toBeVisible();

  // Snapshot the baseline command count before sending
  const baselineCommands = await readCommandLog(page);
  const baselineAddCount = commandCount(
    baselineCommands,
    "add_channel_members",
  );
  const baselineSendCount = commandCount(
    baselineCommands,
    "send_channel_message",
  );

  // Submit the message. Native delivery establishes visit authority from the
  // frozen mention set; the renderer must not permanently add the resident.
  await page.getByTestId("send-message").click();

  // Immediately switch to channel-agents BEFORE the 500ms delay resolves.
  // This is the race the fix closes.
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");

  // The command has entered the delayed send while the user is already in the
  // other channel.
  await expect
    .poll(async () =>
      commandCount(await readCommandLog(page), "send_channel_message"),
    )
    .toBeGreaterThan(baselineSendCount);

  // Let the in-flight send finish (500ms delay + buffer), and lock the visit
  // invariant: an explicit mention did not become permanent membership.
  await page.waitForTimeout(800);
  expect(commandCount(await readCommandLog(page), "add_channel_members")).toBe(
    baselineAddCount,
  );

  // --- Assert message landed in general (compose-time channel) ---
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForTimelineSettled(page);

  // The message must appear in general's timeline (not the switched-to channel).
  await expect(page.getByTestId("message-timeline")).toContainText(
    MESSAGE_TEXT,
  );

  // --- Assert message did NOT land in agents (switched-to channel) ---
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
  await waitForTimelineSettled(page);

  await expect(page.getByTestId("message-timeline")).not.toContainText(
    MESSAGE_TEXT,
  );
});

// ---------------------------------------------------------------------------
// Invariant: without mid-send navigation, normal agent-mention send still works
// ---------------------------------------------------------------------------

test("message with agent mention delivers correctly when no channel switch occurs", async ({
  page,
}) => {
  const MESSAGE_TEXT = `no-switch-verify-${Date.now()}`;

  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: OUT_OF_CHANNEL_BOT_PUBKEY,
        name: "BotA",
        status: "running",
      },
    ],
  });

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@BotA");
  const dropdown = autocomplete(page);
  await expect(dropdown.locator("button", { hasText: "BotA" })).toBeVisible();
  await input.press("Enter");
  await page.keyboard.type(` ${MESSAGE_TEXT}`);

  const baselineCommands = await readCommandLog(page);
  const baselineAddCount = commandCount(
    baselineCommands,
    "add_channel_members",
  );
  const baselineSendCount = commandCount(
    baselineCommands,
    "send_channel_message",
  );

  await page.getByTestId("send-message").click();

  // Wait for accepted delivery, then prove the renderer did not turn this
  // temporary mention into permanent membership.
  await expect
    .poll(async () =>
      commandCount(await readCommandLog(page), "send_channel_message"),
    )
    .toBeGreaterThan(baselineSendCount);
  expect(commandCount(await readCommandLog(page), "add_channel_members")).toBe(
    baselineAddCount,
  );

  await waitForTimelineSettled(page);
  await expect(page.getByTestId("message-timeline")).toContainText(
    MESSAGE_TEXT,
  );
});
