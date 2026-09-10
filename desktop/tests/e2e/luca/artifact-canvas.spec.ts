import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("Library opens shared Canvas with HTML safely paused and exportable", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/artifacts");

  await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
  const artifactButton = page
    .locator(".artifact-library-row__main")
    .filter({ hasText: "threshold-study.html" });
  await expect(artifactButton).toBeVisible();
  await expect(artifactButton).toContainText("alice · general");
  const listInvocation = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
      (entry) => entry.command === "list_artifacts",
    ),
  );
  expect(listInvocation?.payload).toEqual({
    input: { deleted: "active", limit: 80 },
  });
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/artifact-library.png" });
  await artifactButton.click();

  const canvas = page.getByTestId("artifact-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toContainText("threshold-study.html");
  await expect(
    canvas.getByText("HTML preview paused for safety"),
  ).toBeVisible();
  await expect(canvas.getByTestId("artifact-html-preview")).toHaveCount(0);
  await expect(
    canvas.getByRole("button", { name: "Export HTML" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.some(
        (entry) => entry.command === "prepare_artifact_preview",
      ),
    ),
  ).toBe(false);

  const nativePreviewDto = await page.evaluate(() =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("read_artifact_preview", {
      input: { artifactId: "threshold-study", version: 3 },
    }),
  );
  expect(nativePreviewDto).toMatchObject({
    previewType: "text",
    artifact: { id: "threshold-study", language: "html" },
    version: { id: "threshold-study:v3", number: 3 },
  });

  await page.getByRole("tab", { name: "preview" }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "source" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(canvas).toContainText("The threshold is not a screen.");
  await page.getByRole("tab", { name: "source" }).press("End");
  await expect(page.getByRole("tab", { name: /versions/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: /versions/ }).press("Home");

  await canvas.getByRole("button", { name: "Export HTML" }).click();
  await expect(canvas).toContainText("Artifact exported");

  await waitForAnimations(page);
  await canvas.screenshot({ path: "test-results/artifact-canvas-static.png" });
  await page.screenshot({ path: "test-results/artifact-canvas-shell.png" });

  await page.getByTestId("close-artifact-canvas").click();
  await expect(canvas).toBeHidden();
  await expect(artifactButton).toBeFocused();
});

test("app preview stays bounded and restart returns an unsent composer draft", async ({
  page,
}) => {
  await page.goto(`/?e2e=mock#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByTestId("message-input").fill("Keep this draft intact");
  await page.getByTestId("open-artifacts-view").click();
  await page.getByText("resident-field").click();

  const canvas = page.getByTestId("artifact-canvas");
  await expect(canvas).toContainText("http://127.0.0.1:4182");
  await expect(page.getByTestId("artifact-live-preview")).toHaveAttribute(
    "sandbox",
    "allow-forms allow-same-origin allow-scripts",
  );
  await expect(page.getByTestId("artifact-live-preview")).toHaveAttribute(
    "tabindex",
    "-1",
  );
  await expect(page.getByRole("textbox")).toHaveCount(1);

  await page.getByRole("button", { name: "Detach preview" }).click();
  await expect(canvas).toBeHidden();
  await page.getByText("resident-field").click();
  await expect(page.getByTestId("ask-agent-restart")).toBeVisible();
  await page.getByTestId("ask-agent-restart").click();

  await expect(page).toHaveURL(new RegExp(`/channels/${GENERAL_CHANNEL_ID}`));
  await expect(page.getByTestId("message-input")).toContainText(
    "Keep this draft intact",
  );
  await expect(
    page.getByTestId("message-row").filter({
      hasText: "Please restart the development server",
    }),
  ).toHaveCount(0);
});

test("live health polling recovers and only stops after repeated failures", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await page.goto("/?e2e=mock#/artifacts");
  await page.getByText("resident-field").click();
  await expect(page.getByTestId("artifact-live-preview")).toBeVisible();

  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_ARTIFACT_PREVIEW_STATUS__?.("unreachable"),
  );
  await expect(page.getByTestId("ask-agent-restart")).toContainText(
    "Ask agent to restart",
    { timeout: 12_000 },
  );
  await expect(page.getByText("Preview stopped")).toBeVisible();

  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_ARTIFACT_PREVIEW_STATUS__?.("ready"),
  );
  await expect(page.getByTestId("artifact-live-preview")).toBeVisible({
    timeout: 6_000,
  });
  await expect(page.getByTestId("ask-agent-restart")).toHaveCount(0);
});

test("Library delete and restore use native lifecycle filters", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/artifacts");
  await page
    .getByRole("button", {
      name: "Move conversation-model.md to Recently deleted",
    })
    .click();
  await expect(page.getByText("conversation-model.md")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Recently deleted", exact: true })
    .click();
  await expect(page.getByText("conversation-model.md")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Restore conversation-model.md",
    })
    .click();
  await expect(page.getByText("conversation-model.md")).toHaveCount(0);

  const deletedInvocation = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.findLast(
      (entry) => entry.command === "list_artifacts",
    ),
  );
  expect(deletedInvocation?.payload).toMatchObject({
    input: { deleted: "deleted", limit: 80 },
  });
});

test("only the active conversation can auto-present and dismissal is turn-stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto("/?e2e=mock#/artifacts");
  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "threshold-study",
      conversationId,
      residentPubkey:
        "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
      turnId: "background-turn",
    });
  }, GENERAL_CHANNEL_ID);
  await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);

  await page.getByTestId("channel-general").click();
  await expect(
    page.getByTestId("artifact-receipt-receipt-threshold-study"),
  ).toContainText("alice · Open in Canvas");
  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "threshold-study",
      conversationId,
      residentPubkey:
        "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
      turnId: "foreground-turn",
    });
  }, GENERAL_CHANNEL_ID);
  await expect(page.getByTestId("artifact-canvas")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/artifact-canvas-conversation.png",
  });

  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "conversation-model",
      conversationId,
      turnId: "queued-behind-active-canvas",
    });
  }, GENERAL_CHANNEL_ID);
  await page.getByTestId("close-artifact-canvas").click();
  await expect(page.getByTestId("artifact-canvas")).toBeHidden();

  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "conversation-model",
      conversationId,
      turnId: "queued-behind-active-canvas",
    });
  }, GENERAL_CHANNEL_ID);
  await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);

  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "conversation-model",
      conversationId,
      turnId: "foreground-turn",
    });
  }, GENERAL_CHANNEL_ID);
  await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);
});
