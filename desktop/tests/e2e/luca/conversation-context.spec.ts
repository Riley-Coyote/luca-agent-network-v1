import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

async function openAddContext(page: import("@playwright/test").Page) {
  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Add context" }).click();
  await expect(page.getByTestId("conversation-context-drawer")).toBeVisible();
}

test("a loose room stays visually unchanged until context is attached", async ({
  page,
}) => {
  await installMockBridge(page, { conversationContextFixture: "multiple" });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();

  await expect(page.getByTestId("conversation-context-chip")).toHaveCount(0);
  const editor = page
    .getByTestId("message-composer")
    .locator("[contenteditable='true']");
  await editor.fill("send before adding context");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("send before adding context")).toBeVisible();
  await openAddContext(page);

  const drawer = page.getByTestId("conversation-context-drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId("message-composer-add")).toBeFocused();
  await openAddContext(page);
  await expect(
    drawer.getByText("Working folder", { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByText("Additional sources", { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByText("MCPs, skills, and plugins", { exact: true }),
  ).not.toBeVisible();

  await drawer.getByRole("radio", { name: /luca-agent-network/i }).check();
  await drawer.getByLabel(/Codex history/).check();
  await drawer.getByLabel(/Claude Code history/).check();
  await drawer.getByRole("button", { name: "Save for this room" }).click();
  await expect(drawer).toBeHidden();
  await waitForAnimations(page);

  const chip = page.getByTestId("conversation-context-chip");
  await expect(chip).toContainText("luca-agent-network");
  await expect(chip).toContainText("+2");
  await expect(page.getByTestId("conversation-context-marker")).toContainText(
    "Working in luca-agent-network from here.",
  );
  await chip.click();
  await expect(drawer).toBeVisible();
  await waitForAnimations(page);
  await drawer.getByText("Available here", { exact: true }).click();
  await expect(
    drawer.getByText(/Available · Used as the native/),
  ).toBeVisible();
  await expect(
    drawer.getByText(/Runtime managed · Uses the runtime's existing/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(chip).toBeFocused();
});

test("a project room inherits context without asking the user to set it up", async ({
  page,
}) => {
  await installMockBridge(page, { conversationContextFixture: "multiple" });
  await page.goto("/?e2e=mock");
  const general = page.getByTestId("channel-general");
  const channelId = await general.getAttribute("data-channel-id");
  if (!channelId) throw new Error("Expected the general channel id.");

  await general.click();

  await page.evaluate((roomId) => {
    const pubkey = "deadbeef".repeat(8);
    const relay = "ws://localhost:3000";
    const key = `luca-room-projects.v1:${encodeURIComponent(pubkey)}:${encodeURIComponent(relay)}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: "polyphonic-context",
            label: "Polyphonic",
            sourceIds: [
              "connected-repository-luca",
              "connected-codex-history",
              "connected-claude-history",
            ],
            workingContextStatus: "attached",
          },
        ],
        assignments: { [roomId]: "polyphonic-context" },
      }),
    );
    window.dispatchEvent(new Event("luca:room-projects-changed"));
  }, channelId);

  const chip = page.getByTestId("conversation-context-chip");
  await expect(chip).toContainText("luca-agent-network");
  await expect(chip).toContainText("+2");
  await chip.click();
  const drawer = page.getByTestId("conversation-context-drawer");
  await expect(drawer).toBeVisible();
  await waitForAnimations(page);
  await expect(
    drawer.getByRole("radio", { name: /Use Polyphonic default/i }),
  ).toBeChecked();
  await expect(drawer.getByText("From project").first()).toBeVisible();
});

test("a missing primary folder protects the draft and offers inline recovery", async ({
  page,
}) => {
  await installMockBridge(page, { conversationContextFixture: "missing" });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await page.setViewportSize({ width: 760, height: 720 });
  await openAddContext(page);

  const drawer = page.getByTestId("conversation-context-drawer");
  await drawer.getByRole("radio", { name: /luca-agent-network/i }).check();
  await drawer.getByRole("button", { name: "Save for this room" }).click();

  const recovery = page.getByTestId("conversation-context-missing-primary");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Relink" })).toBeVisible();
  await expect(
    recovery.getByRole("button", { name: "Continue without it" }),
  ).toBeVisible();

  const composer = page.getByTestId("message-composer");
  const editor = composer.locator("[contenteditable='true']");
  await editor.fill("keep this draft");
  await expect(page.getByTestId("send-message")).toBeDisabled();
  await recovery.getByRole("button", { name: "Continue without it" }).click();
  await expect(editor).toContainText("keep this draft");
  await expect(recovery).toHaveCount(0);
  await expect(page.getByTestId("send-message")).toBeEnabled();
});

test("a folder that moves during send refreshes recovery while preserving the draft", async ({
  page,
}) => {
  await installMockBridge(page, {
    conversationContextFixture: "ready",
    sendChannelMessageErrors: ["conversation_context:missing_primary"],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await openAddContext(page);

  const drawer = page.getByTestId("conversation-context-drawer");
  await drawer.getByRole("radio", { name: /luca-agent-network/i }).check();
  await drawer.getByRole("button", { name: "Save for this room" }).click();
  await expect(drawer).toBeHidden();

  const editor = page
    .getByTestId("message-composer")
    .locator("[contenteditable='true']");
  await editor.fill("keep this moving-folder draft");
  await page.evaluate(() => {
    const config = window.__BUZZ_E2E__ as
      | { mock?: { conversationContextFixture?: string } }
      | undefined;
    if (config?.mock) config.mock.conversationContextFixture = "missing";
  });
  await page.getByTestId("send-message").click();

  const recovery = page.getByTestId("conversation-context-missing-primary");
  await expect(recovery).toBeVisible();
  await expect(editor).toContainText("keep this moving-folder draft");
  await expect(page.getByTestId("send-message")).toBeDisabled();
});
