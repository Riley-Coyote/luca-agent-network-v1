import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("Library opens the shared premium Canvas with an opaque static preview", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/artifacts");

  await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
  const artifactButton = page
    .locator(".artifact-library-row__main")
    .filter({ hasText: "threshold-study.html" });
  await expect(artifactButton).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/artifact-library.png" });
  await artifactButton.click();

  const canvas = page.getByTestId("artifact-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toContainText("threshold-study.html");
  const frame = page.getByTestId("artifact-html-preview");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect
    .poll(() =>
      frame.evaluate((element) =>
        (element as HTMLIFrameElement).srcdoc.includes("connect-src 'none'"),
      ),
    )
    .toBe(true);

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
  await page.goto("/?e2e=mock#/artifacts");
  await page.getByText("resident-field").click();

  const canvas = page.getByTestId("artifact-canvas");
  await expect(canvas).toContainText("http://127.0.0.1:4182");
  await expect(page.getByTestId("artifact-live-preview")).toHaveAttribute(
    "sandbox",
    "allow-forms allow-same-origin allow-scripts",
  );
  await expect(page.getByRole("textbox")).toHaveCount(1);

  await page.getByRole("button", { name: "Detach preview" }).click();
  await expect(canvas).toBeHidden();
  await page.getByText("resident-field").click();
  await expect(page.getByTestId("ask-agent-restart")).toBeVisible();
  await page.getByTestId("ask-agent-restart").click();

  await expect(page).toHaveURL(new RegExp(`/channels/${GENERAL_CHANNEL_ID}`));
  await expect(page.getByTestId("message-input")).toContainText(
    "Please restart the development server",
  );
  await expect(
    page.getByTestId("message-row").filter({
      hasText: "Please restart the development server",
    }),
  ).toHaveCount(0);
});

test("only the active conversation can auto-present and dismissal is turn-stable", async ({
  page,
}) => {
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
  await page.getByTestId("close-artifact-canvas").click();
  await expect(page.getByTestId("artifact-canvas")).toBeHidden();

  await page.evaluate((conversationId) => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://canvas-present", {
      artifactId: "conversation-model",
      conversationId,
      turnId: "foreground-turn",
    });
  }, GENERAL_CHANNEL_ID);
  await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);
});
