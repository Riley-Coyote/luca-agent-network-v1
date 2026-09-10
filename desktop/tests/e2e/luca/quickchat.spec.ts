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

for (const refreshBeforeAck of [false, true]) {
  test(`runtime effort acknowledgement survives ${refreshBeforeAck ? "a changed capability before acknowledgement" : "an in-flight capability refresh"}`, async ({
    page,
  }) => {
    await expect(page.getByTestId("quickchat-launcher")).toBeVisible();
    await page.evaluate((refreshBeforeAck) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke.bind(internals);
      const capabilities = {
        supported: true,
        configId: "thought_level",
        value: "low",
        pending: false,
        values: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      };
      let deferRefresh = false;
      let lastSend: Record<string, unknown> | undefined;
      const refreshResolvers: Array<(value: typeof capabilities) => void> = [];
      internals.invoke = async (command, args) => {
        if (command === "quickchat_get_effort") {
          if (!deferRefresh) return capabilities;
          document.body.dataset.effortRefreshWaiting = "true";
          return new Promise((resolve) => refreshResolvers.push(resolve));
        }
        const result = await original(command, args);
        if (command === "send_channel_message" && args?.quickChatEffort) {
          lastSend = {
            eventId: (result as { event_id: string }).event_id,
            conversationId: args.channelId,
            residentPubkey: "a".repeat(64),
            ...(args.quickChatEffort as { configId: string; value: string }),
          };
        }
        return result;
      };
      window.addEventListener("test-start-effort-refresh", () => {
        if (!lastSend) throw new Error("Expected a sent effort request");
        deferRefresh = true;
        window.dispatchEvent(
          new CustomEvent("quickchat-effort-capabilities", {
            detail: lastSend,
          }),
        );
      });
      window.addEventListener("test-ack-effort", () => {
        window.dispatchEvent(
          new CustomEvent("quickchat-effort-result", {
            detail: { ...lastSend, status: "applied" },
          }),
        );
      });
      window.addEventListener("test-finish-effort-refresh", () => {
        // A changed label proves React consumed the delayed result before the
        // assertion about the retained acknowledgement, avoiding a timing pass.
        const refreshed = {
          ...capabilities,
          value: refreshBeforeAck ? "high" : "low",
          values: [
            { value: "low", label: "Low refreshed" },
            { value: "high", label: "High refreshed" },
          ],
        };
        for (const resolve of refreshResolvers.splice(0)) resolve(refreshed);
      });
    }, refreshBeforeAck);
    await page.getByTestId("quickchat-launcher").click();
    const input = page.getByTestId("quickchat-input");
    await input.fill("Create a conversation for effort testing");
    await page.getByTestId("quickchat-send").click();
    await expect(input).toHaveValue("");
    await page.getByTestId("quickchat-agent-picker").click();
    const slider = page.getByTestId("quickchat-effort");
    await expect(slider).toHaveAttribute("aria-valuetext", "Low");
    await input.fill("Send with the selected effort");
    await page.getByTestId("quickchat-send").click();
    await expect(input).toHaveValue("");
    await expect(slider).toBeDisabled();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("test-start-effort-refresh")),
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-effort-refresh-waiting",
      "true",
    );
    const status = page
      .getByTestId("quickchat-panel")
      .getByText("Applied by runtime");
    if (refreshBeforeAck) {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("test-finish-effort-refresh")),
      );
      await expect(slider).toHaveAttribute("aria-valuetext", "High refreshed");
      await expect(slider).toBeDisabled();
      await page.evaluate(() =>
        window.dispatchEvent(new Event("test-ack-effort")),
      );
      // The low request settles without falsely confirming the now-displayed high level.
      await expect(slider).toBeEnabled();
      await expect(status).toHaveCount(0);
    } else {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("test-ack-effort")),
      );
      await expect(status).toBeVisible();
      await page.evaluate(() =>
        window.dispatchEvent(new Event("test-finish-effort-refresh")),
      );
      await expect(slider).toHaveAttribute("aria-valuetext", "Low refreshed");
      await expect(status).toBeVisible();
      await expect(slider).toBeEnabled();
    }
  });
}
