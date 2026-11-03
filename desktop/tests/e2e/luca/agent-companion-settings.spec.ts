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
  await page
    .getByTestId(`place-row-mind:${resident}`)
    .locator(".luca-rail-row-hit")
    .click();
  await page.getByTestId("mind-open-settings").click();
  await expect(page.getByTestId("mind-row-keeps")).toBeVisible();
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
  const before = await page.evaluate(
    () => (window.__BUZZ_E2E_COMMANDS__ ?? []).length,
  );
  const entry = page.getByTestId("mind-row-keeps");
  await entry.click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  await expect(
    dialog.getByRole("heading", { name: "Keeps up with" }),
  ).toBeVisible();
  await expect(page.getByTestId("mind-back")).toHaveText("Settings");
  const calls = await companionCalls(page);
  expect([...new Set(calls.map(({ command }) => command))].sort()).toEqual(
    [...READS].sort(),
  );
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
  await page.getByTestId("mind-back").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("mind-open-settings")).toBeVisible();
  await expect(page.getByTestId("mind-page-title")).toBeFocused();
  await expect(page).toHaveURL(
    new RegExp(`profile=(?:%22)?${MARA}(?:%22)?(?:&|$)`),
  );
  expect(errors).toEqual([]);
});

test("keyboard entry follows the selected resident and restores focus at compact width", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").press("Enter");
  await expect(page.getByTestId("mind-keeps-up-with")).toBeVisible();
  await page.getByTestId("mind-back").press("Enter");
  await expect(page.getByTestId("mind-page-title")).toBeFocused();

  await page
    .getByTestId(`place-row-mind:${LUCA}`)
    .locator(".luca-rail-row-hit")
    .click();
  await page.getByTestId("mind-open-settings").click();
  await page.setViewportSize({ width: 480, height: 800 });
  const entry = page.getByTestId("mind-row-keeps");
  await entry.press("Enter");
  const dialog = page.getByTestId("mind-keeps-up-with");
  await expect(
    dialog.getByRole("heading", { name: "Keeps up with" }),
  ).toBeVisible();
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
  await page.getByTestId("mind-back").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("mind-page-title")).toBeFocused();
});

test("work buttons request native discovery; manual folder selection stays explicit", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  await dialog
    .getByRole("switch", { name: "Follow Codex work", exact: true })
    .click();
  await expect(
    dialog.getByRole("switch", {
      name: "Follow Claude Code work",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("switch", { name: "Follow Claude Code work", exact: true })
    .click();
  await expect(
    dialog.getByRole("switch", { name: "Follow Codex work", exact: true }),
  ).toBeEnabled();
  const calls = await companionCalls(page);
  expect(
    calls
      .filter(({ command }) => command === "follow_companion_work")
      .map(({ payload }) => payload),
  ).toEqual([
    { residentPubkey: MARA, kind: "codex_sessions" },
    { residentPubkey: MARA, kind: "claude_projects" },
  ]);
  expect(
    calls.some(({ command }) => /^(pick_|set_|select_|resume_)/.test(command)),
  ).toBe(false);
  await expect(
    dialog.getByRole("button", { name: "Choose Codex folder" }),
  ).toBeHidden();
  await dialog
    .getByRole("button", {
      name: "Use a different profile folder",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Choose Codex folder" }).click();
  const manual = (await companionCalls(page)).find(
    ({ command }) => command === "pick_companion_native_profile",
  );
  expect(manual?.payload).toMatchObject({
    residentPubkey: MARA,
    kind: "codex_sessions",
    choices: {
      observe: false,
      promote: false,
      providerEgress: false,
      retainRaw: false,
    },
  });
});

test("unavailable work discovery can be dismissed and retried without losing the agent page", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByTestId("mind-row-keeps").click();
  const dialog = page.getByTestId("mind-keeps-up-with");
  const follow = dialog.getByRole("switch", { name: "Follow Codex work" });
  await expect(follow).toBeVisible();
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
      if (command === "follow_companion_work" && fail) {
        fail = false;
        throw new Error("Companion unavailable in test");
      }
      return invoke(command, ...args);
    };
  });
  await follow.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Companion unavailable in test",
  );
  await page.getByTestId("mind-back").click();
  await expect(page.getByTestId("mind-open-settings")).toBeVisible();
  await page.getByTestId("mind-open-settings").click();
  await page.getByTestId("mind-row-keeps").click();
  await expect(follow).toBeVisible();
  await follow.click();
  await expect(follow).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
