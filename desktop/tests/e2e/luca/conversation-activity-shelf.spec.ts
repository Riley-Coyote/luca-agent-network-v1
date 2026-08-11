import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RESIDENTS = [
  { name: "Claude Code", pubkey: TEST_IDENTITIES.alice.pubkey },
  { name: "Codex", pubkey: TEST_IDENTITIES.charlie.pubkey },
  { name: "Luca", pubkey: TEST_IDENTITIES.bob.pubkey },
  { name: "Mara", pubkey: "a".repeat(64) },
] as const;

async function openConversation(page: Page) {
  await installMockBridge(page, {
    managedAgents: RESIDENTS.map((resident) => ({
      channelNames: ["general"],
      name: resident.name,
      pubkey: resident.pubkey,
      status: "running" as const,
    })),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function seedResidentActivity(page: Page) {
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ channelId, residents }) => {
      for (const [index, resident] of residents.entries()) {
        const turnId = `activity-shelf-turn-${index}`;
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: resident.pubkey,
          channelId,
          turnId,
        });
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: resident.pubkey,
          channelId,
          turnId,
          kind: "acp_read",
          payload: {
            method: "session/update",
            params: {
              update: {
                sessionUpdate:
                  index === 0
                    ? "agent_thought_chunk"
                    : index === 1
                      ? "tool_call"
                      : "agent_message_chunk",
                ...(index === 1 ? { kind: "search" } : {}),
              },
            },
          },
        });
      }
    },
    { channelId: CHANNEL_ID, residents: RESIDENTS },
  );
}

test("activity shelf keeps three stable residents and discloses the rest", async ({
  page,
}) => {
  await openConversation(page);
  await seedResidentActivity(page);

  const shelf = page.getByTestId("conversation-activity-shelf");
  await expect(shelf).toHaveAttribute("data-active-count", "4");
  await expect(
    page.getByTestId(
      "resident-activity-953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
    ),
  ).toHaveAttribute("data-activity-state", "thinking");
  await expect(page.getByText("+1 working", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop Claude Code" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Stop all active residents in this conversation",
    }),
  ).toHaveCount(0);

  const disclosure = page.getByRole("button", {
    name: "+1 working. View all resident activity.",
  });
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "All resident activity" }),
  ).toContainText("Mara");
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
});

test("activity shelf collapses and settles motion at compact Mac size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConversation(page);
  await seedResidentActivity(page);

  await expect(
    page.getByRole("button", {
      name: "4 residents working. View all resident activity.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "+1 working. View all resident activity.",
    }),
  ).toBeHidden();

  const animationName = await page
    .locator(".luca-activity-lattice__cell")
    .first()
    .evaluate((cell) => getComputedStyle(cell).animationName);
  expect(animationName).toBe("none");
  await expect(page.getByTestId("message-input")).toBeVisible();
});
