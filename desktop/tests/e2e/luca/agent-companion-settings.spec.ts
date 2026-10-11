import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const LUCA = "11".repeat(32);
const MARA = "22".repeat(32);
const READS = [
  "get_companion_awareness",
  "get_companion_initiative",
  "list_companion_selected_sources",
  "list_companion_native_profiles",
  "list_companion_machine_sources",
  "list_companion_browser_profiles",
];

async function openSettings(page: Page, resident = MARA) {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: LUCA,
        name: "Luca",
        status: "running",
        agentCommand: "claude-code-acp",
        channelIds: [],
      },
      {
        pubkey: MARA,
        name: "Mara",
        status: "stopped",
        agentCommand: "codex-acp",
        channelIds: [],
      },
    ],
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await page.getByTestId(`agent-library-row-${resident}`).click();
  await page
    .getByRole("navigation", { name: "Agent workspace" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("agent-companion-settings")).toBeVisible();
}

async function companionCalls(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(({ command }) =>
      command.includes("companion"),
    ),
  );
}

test("agent settings opens companion controls for a stopped agent without a chat or granting access", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openSettings(page);
  expect(await companionCalls(page)).toEqual([]);
  const before = await page.evaluate(
    () => (window.__BUZZ_E2E_COMMANDS__ ?? []).length,
  );
  const entry = page.getByRole("button", { name: "Companion settings" });
  const settingsUrl = page.url();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "With Mara" });
  await expect(dialog.getByText("Keep up with your work")).toBeVisible();
  await expect(dialog.getByText("While you’re away")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Back to agent" }),
  ).toBeVisible();
  const calls = await companionCalls(page);
  expect(calls.map(({ command }) => command).sort()).toEqual([...READS].sort());
  expect(
    calls.every(
      ({ payload }) =>
        (payload as { residentPubkey: string }).residentPubkey === MARA,
    ),
  ).toBe(true);
  const commands = await page.evaluate(
    (offset) => (window.__BUZZ_E2E_COMMANDS__ ?? []).slice(offset),
    before,
  );
  expect(
    commands.some((command) =>
      /^(start_managed_agent|create_dm|open_dm|send_|publish_|set_companion|pick_companion|select_companion)/.test(
        command,
      ),
    ),
  ).toBe(false);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("companion-settings.png"),
  });
  await dialog.getByRole("button", { name: "Back to agent" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(page).toHaveURL(settingsUrl);
  expect(errors).toEqual([]);
});

test("keyboard entry follows the selected resident and restores focus at compact width", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("agent-companion-settings").press("Enter");
  await expect(page.getByRole("dialog", { name: "With Mara" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("agent-companion-settings")).toBeFocused();

  await page.getByTestId(`agent-library-row-${LUCA}`).click();
  await page
    .getByRole("navigation", { name: "Agent workspace" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.setViewportSize({ width: 480, height: 800 });
  const entry = page.getByTestId("agent-companion-settings");
  await entry.press("Enter");
  const dialog = page.getByRole("dialog", { name: "With Luca" });
  await expect(dialog.getByText("Keep up with your work")).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(480);
  const calls = await companionCalls(page);
  const currentReads = calls.slice(-READS.length);
  expect(
    currentReads.every(
      ({ payload }) =>
        (payload as { residentPubkey: string }).residentPubkey === LUCA,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("an unavailable companion can be dismissed and reopened without losing the agent page", async ({
  page,
}) => {
  await openSettings(page);
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    let fail = true;
    internals.invoke = async (command, ...args) => {
      if (command === "get_companion_awareness" && fail) {
        fail = false;
        throw new Error("Companion unavailable in test");
      }
      return invoke(command, ...args);
    };
  });
  const entry = page.getByTestId("agent-companion-settings");
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "With Mara" });
  await expect(dialog.getByRole("alert")).toContainText(
    "Companion controls are unavailable",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(dialog.getByText("Keep up with your work")).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
