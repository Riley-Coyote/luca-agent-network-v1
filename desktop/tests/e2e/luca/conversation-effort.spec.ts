import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const LUCA = "a".repeat(64);
const SOL = "b".repeat(64);
const SCREENSHOT_DIR = "test-results/conversation-effort";
mkdirSync(SCREENSHOT_DIR, { recursive: true });
test.use({ video: "on" });

async function installEffortReports(page: Page, solSupported: boolean) {
  await page.evaluate(
    ({ solPubkey, solSupported }) => {
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
      internals.invoke = async (command, args) => {
        if (command === "quickchat_get_effort") {
          if (
            args?.residentPubkey === solPubkey &&
            !solSupported &&
            document.body.dataset.solEffortSupported !== "true"
          )
            return {
              supported: false,
              values: [],
              value: null,
              pending: false,
              awaitingFirstReply: false,
              reason: "Thinking effort is managed by Sol’s runtime.",
            };
          return {
            supported: true,
            configId: "thought_level",
            values: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "xhigh", label: "Extra high" },
            ],
            value: "low",
            pending: false,
            source: "remembered",
          };
        }
        return original(command, args);
      };
    },
    { solPubkey: SOL, solSupported },
  );
}

async function latestSend(page: Page) {
  return page.evaluate(() => {
    const sends = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "send_channel_message",
    );
    return sends.at(-1)?.payload as
      | {
          channelId: string;
          managedAudience?: { mode: string; resident_pubkeys?: string[] };
          conversationEfforts?: Array<{
            residentPubkey: string;
            configId: string;
            value: string;
          }>;
        }
      | undefined;
  });
}

async function sendMention(
  page: Page,
  name: string,
  pubkey: string,
  body: string,
) {
  const input = page.getByTestId("message-input");
  await input.fill(`${body} @${name}`);
  await page.getByTestId(`mention-suggestion-${pubkey}`).click();
  await page.getByTestId("send-message").click();
  const row = page.getByTestId("message-row").filter({ hasText: body }).last();
  await expect(row).toBeVisible();
  const eventId = await row.getAttribute("data-message-id");
  if (!eventId) throw new Error("Expected the sent owner's event ID.");
  return eventId;
}

test("conversation picker controls its own choice and waits for the exact runtime acknowledgement", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        status: "running",
        channelNames: ["general", "engineering"],
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey: LUCA }],
  });
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("quickchat-launcher")).toBeVisible();
  await installEffortReports(page, true);
  await page.getByTestId("channel-general").click();
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  if (!generalId) throw new Error("Expected general's conversation ID.");

  const picker = page.getByTestId("conversation-effort-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Thinking · Low");
  await picker.click();
  const popover = page.getByTestId("conversation-effort-popover");
  await expect(popover).toContainText("Luca");
  const slider = page.getByTestId("conversation-thinking-effort");
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Extra high");
  await slider.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "Low");

  // The real pointer moves continuously between named levels before release.
  const box = await slider.boundingBox();
  if (!box) throw new Error("Expected a laid-out range input.");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 12, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 12 + (box.width - 24) * 0.49, y, { steps: 8 });
  const scrubbed = Number(await slider.inputValue());
  expect(scrubbed).toBeGreaterThan(1.3);
  expect(scrubbed).toBeLessThan(1.7);
  await page.mouse.up();
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Extra high");
  await expect(popover).toContainText("Selected for next message");
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/conversation-effort-normal.png`,
  });

  // A different conversation starts from the runtime report; returning restores
  // the local choice without claiming the runtime has applied it.
  await page.getByTestId("channel-engineering").click();
  await page.getByTestId("conversation-effort-picker").click();
  await expect(
    page.getByTestId("conversation-thinking-effort"),
  ).toHaveAttribute("aria-valuetext", "Low");
  await page.getByTestId("channel-general").click();
  await page.getByTestId("conversation-effort-picker").click();
  await expect(
    page.getByTestId("conversation-thinking-effort"),
  ).toHaveAttribute("aria-valuetext", "Extra high");
  await expect(popover).not.toContainText("Applied by runtime");

  const eventId = await sendMention(page, "Luca", LUCA, "Use the chosen level");
  await expect
    .poll(() => latestSend(page))
    .toMatchObject({
      channelId: generalId,
      managedAudience: { mode: "directed", resident_pubkeys: [LUCA] },
      conversationEfforts: [
        { residentPubkey: LUCA, configId: "thought_level", value: "xhigh" },
      ],
    });
  await picker.click();
  await expect(popover).toContainText("Waiting for runtime confirmation");

  const acknowledge = async (change: Record<string, string>) => {
    await page.evaluate(
      (detail) =>
        window.dispatchEvent(
          new CustomEvent("quickchat-effort-result", { detail }),
        ),
      {
        conversationId: generalId,
        eventId,
        residentPubkey: LUCA,
        configId: "thought_level",
        value: "xhigh",
        status: "applied",
        ...change,
      },
    );
  };
  await acknowledge({ eventId: "wrong-event" });
  await acknowledge({ residentPubkey: SOL });
  await acknowledge({ configId: "wrong-config" });
  await acknowledge({ value: "low" });
  await expect(popover).toContainText("Waiting for runtime confirmation");
  await acknowledge({});
  await expect(popover).toContainText("Applied by runtime");
});

test("two resident settings keep unsupported truth and send only the explicitly addressed choice", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        status: "running",
        channelNames: ["general"],
      },
      {
        name: "Sol",
        pubkey: SOL,
        status: "running",
        channelNames: ["general"],
      },
    ],
    searchProfiles: [
      { displayName: "Luca", isAgent: true, pubkey: LUCA },
      { displayName: "Sol", isAgent: true, pubkey: SOL },
    ],
  });
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("quickchat-launcher")).toBeVisible();
  await installEffortReports(page, false);
  await page.getByTestId("channel-general").click();
  const generalId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  if (!generalId) throw new Error("Expected general's conversation ID.");
  await page.setViewportSize({ width: 720, height: 760 });
  await page.getByTestId("conversation-effort-picker").click();
  const popover = page.getByTestId("conversation-effort-popover");
  await expect(popover).toContainText("Settings apply to Luca");
  await popover.getByRole("button", { name: "Sol" }).click();
  await expect(popover).toContainText(
    "Thinking effort is managed by Sol’s runtime.",
  );
  await expect(page.getByTestId("conversation-thinking-effort")).toHaveCount(0);
  await page.evaluate(
    ({ conversationId, residentPubkey }) => {
      document.body.dataset.solEffortSupported = "true";
      window.dispatchEvent(
        new CustomEvent("quickchat-effort-capabilities", {
          detail: { conversationId, residentPubkey },
        }),
      );
    },
    { conversationId: generalId, residentPubkey: SOL },
  );
  const solSlider = page.getByTestId("conversation-thinking-effort");
  await expect(solSlider).toBeEnabled();
  await solSlider.press("Home");
  await solSlider.press("ArrowRight");
  await solSlider.press("ArrowRight");
  await expect(solSlider).toHaveAttribute("aria-valuetext", "High");
  const savedSol = await page.evaluate(
    ({ pubkey, conversationId }) => {
      const item = Object.entries(localStorage).find(
        ([key]) =>
          key.startsWith("luca.conversation-effort.v1:") &&
          key.includes(conversationId),
      );
      return item ? JSON.parse(item[1]).choices?.[pubkey] : null;
    },
    { pubkey: SOL, conversationId: generalId },
  );
  expect(savedSol).toMatchObject({ configId: "thought_level", value: "high" });
  await popover.getByRole("button", { name: "Luca" }).click();
  const slider = page.getByTestId("conversation-thinking-effort");
  await expect(slider).toBeEnabled();
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Extra high");
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/conversation-effort-narrow.png`,
  });

  await sendMention(
    page,
    "Luca",
    LUCA,
    "Only Luca should receive this setting",
  );
  await expect
    .poll(() => latestSend(page))
    .toMatchObject({
      managedAudience: { mode: "directed", resident_pubkeys: [LUCA] },
      conversationEfforts: [
        { residentPubkey: LUCA, configId: "thought_level", value: "xhigh" },
      ],
    });
});
