import { expect, type Page, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const LUCA = "a".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RAW = 'find "/synthetic/projects/studio" -name "*.jsonl" -print';

async function boot(
  page: Page,
  { remember = false, light = false, shell = true } = {},
) {
  await page.addInitScript(
    ({ key, light, shell }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": shell }));
      localStorage.setItem("buzz-theme", light ? "paper" : "obsidian");
      localStorage.setItem("buzz-follow-system", "false");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light, shell },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: LUCA,
        status: "running",
        channelNames: ["general"],
      },
    ],
    managedPermissions: [
      {
        pendingId: "temporary-surface-test",
        offer: {
          deny: true,
          once: true,
          alwaysHere: remember,
          projectLabel: "studio",
          remembers: ["find"],
        },
        request: {
          protocol: "luca.managed.permission.v1",
          resident_pubkey: LUCA,
          conversation_id: GENERAL,
          session_epoch: 1,
          turn_id: "test-turn",
          acp_request_id: "test-ask",
          title: "Read recent session records in studio",
          action_preview: RAW,
          options: [
            { kind: "allow_once", name: "Allow once", option_id: "allow" },
            { kind: "reject_once", name: "Reject", option_id: "reject" },
          ],
        },
      },
    ],
  } as Parameters<typeof installMockBridge>[1]);
  await page.goto(`/#/channels/${GENERAL}`);
  await expect(page.getByTestId("message-composer")).toBeVisible();
  if (shell) {
    await expect(page.getByTestId("room-stack")).toHaveAttribute(
      "data-has-asks",
      "",
    );
    if (await page.getByTestId("pending-held").isVisible())
      await page.getByTestId("pending-held").click();
  }
}

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  video: "off",
});

for (const light of [false, true]) {
  test(`approval sheet keeps decisions and composer intact (${light ? "light" : "dark"})`, async ({
    page,
  }, testInfo) => {
    await boot(page, { remember: true, light });
    const stack = page.getByTestId("room-stack");
    const composer = page.getByTestId("message-composer");
    const composerPaint = () =>
      composer.evaluate((el) => {
        const st = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          width: el.getBoundingClientRect().width,
          radius: st.borderRadius,
          fill: st.backgroundColor,
        };
      });
    const before = await composerPaint();
    await expect(stack.locator("[data-permission-choice]")).toHaveText([
      "Deny",
      "Always here",
      "Allow once",
    ]);
    await stack.getByRole("button", { name: "Details", exact: true }).click();
    await expect(stack.getByTestId("needs-you-details")).toContainText(RAW);
    await expect(stack.getByTestId("needs-you-details")).toContainText(
      "studio",
    );
    await page.screenshot({
      path: testInfo.outputPath("approval-details.png"),
      animations: "disabled",
    });
    await stack
      .getByRole("button", { name: "Hide details", exact: true })
      .click();
    await stack.getByTestId("room-stack-hide").focus();
    await page.keyboard.press("Escape");
    const lip = stack.getByTestId("pending-held");
    await expect(lip).toBeFocused();
    await expect(lip).toContainText("Read recent session records in studio");
    await expect(stack.getByTestId("needs-you-permission-once")).toBeHidden();
    await lip.press("Enter");
    await expect(stack.getByTestId("room-stack-hide")).toBeFocused();
    await stack.getByTestId("needs-you-permission-once").click();
    await expect(page.getByTestId("managed-permission-card")).toHaveCount(0);
    await expect(page.getByTestId("message-input")).toBeFocused();
    expect(await composerPaint()).toEqual(before);
  });
}

test("narrow and reduced-motion sheet offers no invented durable permission", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 580 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  const stack = page.getByTestId("room-stack");
  await expect(stack.getByTestId("needs-you-permission-always")).toHaveCount(0);
  expect(
    await stack.evaluate(
      (el) => getComputedStyle(el, "::before").animationName,
    ),
  ).toBe("none");
  for (const id of ["needs-you-permission-deny", "needs-you-permission-once"]) {
    const button = stack.getByTestId(id);
    await expect(button).toBeInViewport();
    await button.click({ trial: true });
  }
  await page.screenshot({
    path: testInfo.outputPath("approval-narrow.png"),
    animations: "disabled",
  });
  await stack.getByTestId("needs-you-permission-deny").click();
  await expect(page.getByTestId("managed-permission-card")).toHaveCount(0);
});

test("standing access remains an explicit confirmation with Cancel focused", async ({
  page,
}, testInfo) => {
  await boot(page);
  await page.getByTestId("conversation-access-picker").click();
  await page
    .getByTestId("conversation-access-popover")
    .getByText("Don't ask me", { exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/luca-temporary-confirmation/);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText("deleting");
  const cancelFill = await dialog
    .getByRole("button", { name: "Cancel", exact: true })
    .evaluate((button) => getComputedStyle(button).backgroundColor);
  await expect(
    dialog.getByRole("button", { name: "Turn on", exact: true }),
  ).not.toHaveCSS("background-color", cancelFill);
  await page.screenshot({
    path: testInfo.outputPath("access-confirmation.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("conversation-access-picker")).toHaveAttribute(
    "aria-label",
    /Work in my project/,
  );
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_COMMANDS__?.filter(
        (command) => command === "set_resident_access_level",
      ),
    ),
  ).toEqual([]);
});

test("discovery notice retains signer checks and its review action", async ({
  page,
}, testInfo) => {
  await boot(page);
  await page.getByTestId("needs-you-permission-deny").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
        }),
      ),
    )
    .toBe(true);
  const emit = (pubkey: string) =>
    page.evaluate(
      ({ pubkey, channelId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId,
          pubkey,
          content: "Agents are available to review.",
          extraTags: [["client", "polyphonic-native-agent-notice.v1"]],
        });
      },
      { pubkey, channelId: GENERAL },
    );
  await emit("b".repeat(64));
  await expect(page.getByTestId("native-agent-notice")).toHaveCount(0);
  await emit(LUCA);
  const notice = page.getByTestId("native-agent-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Nothing imports automatically");
  await page.screenshot({
    path: testInfo.outputPath("discovery-notice.png"),
    animations: "disabled",
  });
  await notice.getByRole("button", { name: "Review agents" }).click();
  await expect(page).toHaveURL(/#\/agents/);
});

test("classic layout retains its existing permission card", async ({
  page,
}) => {
  await boot(page, { shell: false });
  await expect(page.getByTestId("room-stack")).toHaveCount(0);
  await expect(page.getByTestId("managed-permission-card")).toBeVisible();
  await expect(
    page
      .getByTestId("managed-permission-card")
      .getByRole("button", { name: "Once", exact: true }),
  ).toBeVisible();
});
