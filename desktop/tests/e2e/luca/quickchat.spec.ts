import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      { name: "Luca", pubkey: "a".repeat(64), status: "running" },
      { name: "Sol", pubkey: "b".repeat(64), status: "running" },
    ],
  });
  await page.goto("/?e2e=mock");
});

test("persistent utility keeps independent resident drafts across Settings and minimize", async ({
  page,
}) => {
  await page.getByTestId("quickchat-launcher").click();
  const panel = page.getByTestId("quickchat-panel");
  await expect(panel).toContainText("Luca");
  await page.getByTestId("quickchat-input").fill("Luca draft");
  await page.getByTestId("quickchat-agent-picker").click();
  await panel.getByRole("button", { name: /^Sol/ }).click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue("");
  await page.getByTestId("quickchat-input").fill("Sol draft");
  await page.getByTestId("quickchat-minimize").click();
  await page.getByTestId("open-settings-view").click();
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue("Sol draft");
  await page.getByTestId("quickchat-agent-picker").click();
  await panel.getByRole("button", { name: /^Luca/ }).click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue("Luca draft");
  await waitForAnimations(page);
  await panel.screenshot({ path: "test-results/quickchat-settings.png" });
});

test("a dedicated conversation sends without navigating the main pane", async ({
  page,
}) => {
  await page.getByTestId("quickchat-launcher").click();
  const original = page.url();
  await page.getByTestId("quickchat-input").fill("A quick side question");
  await page.getByTestId("quickchat-send").click();
  await expect(page.getByTestId("quickchat-panel")).toContainText(
    "A quick side question",
  );
  expect(page.url()).toBe(original);
  await expect(page.getByTestId("quickchat-input")).toHaveValue("");
  await page.getByTestId("quickchat-minimize").click();
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-panel")).toContainText(
    "A quick side question",
  );
});

test("Quick Chat remains keyboard-interactive inside a modal focus scope", async ({
  page,
}) => {
  await page.getByTestId("open-new-conversation").click();
  // The shared create-agent dialog is a real Radix modal in the mock app.
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("quickchat-launcher").click();
  const input = page.getByTestId("quickchat-input");
  await input.fill("Help with this dialog");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByTestId("quickchat-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("new chat keeps the previous room and full conversation opens the current room", async ({
  page,
}) => {
  await page.getByTestId("quickchat-launcher").click();
  await page.getByTestId("quickchat-input").fill("First private quick chat");
  await page.getByTestId("quickchat-send").click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue("");
  const first = await page.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("luca:quickchat:v1:"),
      )?.[1],
  );
  const firstId = JSON.parse(first ?? "{}").rooms["a".repeat(64)].channelId;
  await page
    .getByRole("button", { name: "Quick Chat options", exact: true })
    .click();
  await page.getByTestId("quickchat-new-chat").click();
  await expect(page.getByTestId("quickchat-panel")).not.toContainText(
    "First private quick chat",
  );
  await page.getByTestId("quickchat-input").fill("Second private quick chat");
  await page.getByTestId("quickchat-send").click();
  await expect(page.getByTestId("quickchat-input")).toHaveValue("");
  const second = await page.evaluate(
    () =>
      Object.entries(localStorage).find(([k]) =>
        k.startsWith("luca:quickchat:v1:"),
      )?.[1],
  );
  expect(JSON.parse(second ?? "{}").rooms["a".repeat(64)].channelId).not.toBe(
    firstId,
  );
  await page
    .getByRole("button", { name: "Quick Chat options", exact: true })
    .click();
  await page.getByTestId("quickchat-open-full").click();
  await expect(page.getByTestId("quickchat-panel")).toHaveCount(0);
  await expect(
    page.getByText("Second private quick chat", { exact: true }).first(),
  ).toBeVisible();
});

test("context is inspectable and excludes the utility draft and hidden credentials", async ({
  page,
}) => {
  await page.getByTestId("open-settings-view").click();
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.hidden = true;
    p.textContent = "hidden-credential-sentinel";
    document.body.append(p);
  });
  await page.getByTestId("quickchat-launcher").click();
  await page.getByTestId("quickchat-input").fill("private-draft-sentinel");
  await page.getByTestId("quickchat-context").click();
  const detail = page.getByRole("region", { name: "Included app context" });
  await expect(detail).toBeVisible();
  await expect(detail).not.toContainText("private-draft-sentinel");
  await expect(detail).not.toContainText("hidden-credential-sentinel");
  await detail.getByRole("checkbox").uncheck();
  await expect(page.getByTestId("quickchat-context")).toContainText("Off");
  await page.getByTestId("quickchat-input").press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(page.getByTestId("quickchat-panel")).toBeVisible();
});

test("Escape dismisses the resident picker even when native buttons leave focus on the page", async ({
  page,
}) => {
  await page.getByTestId("quickchat-launcher").click();
  await page.getByTestId("quickchat-agent-picker").click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("quickchat-agent-picker")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByTestId("quickchat-panel")).toBeVisible();
});
