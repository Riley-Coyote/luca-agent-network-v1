import { expect, test, type Page } from "@playwright/test";
import type { RuntimeTargetOptionV1 } from "../../../src/shared/api/tauriOperatorForge";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const runtime = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "available",
  command: "codex",
  binary_path: "/synthetic/bin/codex",
  default_args: [],
  mcp_command: null,
  install_hint: "Install Codex",
  install_instructions_url: "https://example.invalid/codex",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_out" },
  login_hint: "Sign in to Codex",
};
const locked: RuntimeTargetOptionV1 = {
  target: { kind: "managed", runtimeId: "codex" },
  label: "Codex",
  readiness: "setup_required",
  reason: "Sign in to continue.",
  recommended: true,
};
const ready: RuntimeTargetOptionV1 = {
  ...locked,
  readiness: "ready",
  reason: null,
};
const clean = { skipCommunitySeed: true, skipOnboardingSeed: true };
const auth = {
  codex: {
    methods: [
      { id: "chatgpt", name: "Sign in", command: ["codex"], args: ["login"] },
    ],
  },
};

async function begin(page: Page) {
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();
  await page.getByTestId("polyphonic-owner-name").fill("Jamie");
  await page.getByTestId("polyphonic-owner-name").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Choose what powers Luca" }),
  ).toBeFocused();
}

test("failed sign-in explains what happened beside a working retry", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [runtime],
      acpAuthMethods: auth,
      connectAcpRuntimeError: "Sign-in window could not open.",
      operatorForgeRuntimeOptionsSequence: [[locked]],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await begin(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in window could not open.",
  );
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeDisabled();
  await waitForAnimations(page);
  await page.screenshot({ path: "/tmp/luca-ux-audit/sign-in-recovery.png" });
});

test("returning from external sign-in refreshes the actual Continue gate", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [runtime],
      acpAuthMethods: auth,
      operatorForgeRuntimeOptionsSequence: [
        [locked],
        [locked],
        [locked],
        [ready],
      ],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await begin(page);
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeDisabled();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeEnabled({
    timeout: 10_000,
  });
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeChecked();
});

test("catalog failure replaces the spinner with a usable recovery state", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [runtime],
      operatorForgeSettingsError: "Discovery unavailable",
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await begin(page);
  await expect(page.getByRole("alert")).toContainText(
    "Couldn’t check the AI available on this Mac.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(page.getByRole("radiogroup")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeDisabled();
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 800, height: 500 },
]) {
  for (const scheme of ["dark", "light"] as const) {
    test(`setup to first conversation at ${size.width}x${size.height} ${scheme}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await installMockBridge(
        page,
        {
          acpRuntimesCatalog: [
            { ...runtime, auth_status: { status: "logged_in" } },
          ],
          operatorForgeRuntimeOptionsSequence: [[ready]],
          nativeResidentDiscovery: { runtimes: [] },
        },
        clean,
      );
      await begin(page);
      const footer = page.getByTestId("polyphonic-setup-continue");
      await expect(footer).toBeInViewport();
      await expect(page.getByRole("radio", { name: /Codex/ })).toBeInViewport();
      await waitForAnimations(page);
      await page.screenshot({
        path: `/tmp/luca-ux-audit/setup-${size.width}-${scheme}.png`,
      });
      await footer.click();
      await expect(page).toHaveURL(/#\/channels\//);
      await expect(page.getByTestId("message-input")).toBeFocused();
      await expect(
        page.getByText(
          "Hey Jamie — I’m Luca. Tell me what you’re working on, or choose a place to begin.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByTestId("luca-greeting-choices")).toBeVisible();
      await expect(page.getByTestId("message-input")).toBeInViewport();
      await expect(page.getByTestId("chat-title")).toHaveText("Luca");
      await waitForAnimations(page);
      const header = await page.getByTestId("chat-header").boundingBox();
      const greeting = await page
        .getByTestId("message-row")
        .first()
        .boundingBox();
      const divider = await page
        .getByTestId("message-timeline-day-divider")
        .boundingBox();
      if (!header || !greeting || !divider)
        throw new Error("First conversation geometry is missing");
      expect(greeting.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(greeting.y).toBeGreaterThanOrEqual(divider.y + divider.height);
      await page.screenshot({
        path: `/tmp/luca-ux-audit/first-chat-${size.width}-${scheme}.png`,
      });
    });
  }
}

test("a fast live reply catches up while the resident is still writing", async ({
  page,
}) => {
  const pubkey = TEST_IDENTITIES.alice.pubkey;
  await installMockBridge(page, {
    deepHistoryMessageCount: 20,
    managedAgents: [
      {
        channelNames: ["deep-history"],
        name: "Luca",
        pubkey,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-deep-history").click();
  await page
    .getByTestId("message-input")
    .fill("Please show me the next steps.");
  await page.keyboard.press("Enter");
  const ownerRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Please show me the next steps." });
  await expect(ownerRow).toBeVisible();
  await expect(ownerRow).not.toHaveAttribute("data-message-id", /optimistic/);
  const receiptId = await ownerRow.getAttribute("data-message-id");
  const body =
    "Keep the conversation simple and let the work happen here. ".repeat(30) +
    "Live reveal caught up.";
  const before = Date.now();
  await page.evaluate(
    ({ pubkey, receiptId, body }) => {
      const base = {
        protocol: "luca.managed.presentation.v1",
        resident_pubkey: pubkey,
        conversation_id: "feedf00d-0000-4000-8000-000000000007",
        turn_id: "audit-stream",
        dispatch_receipt_id: receiptId,
        session_epoch: 1,
      };
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
        ...base,
        kind: "turn_started",
        sequence: 1,
      });
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
        ...base,
        kind: "public_chunk",
        sequence: 2,
        public_chunk: body,
      });
    },
    { pubkey, receiptId, body },
  );
  const reply = page
    .getByTestId("message-row")
    .filter({ hasText: "Live reveal caught up." });
  await expect(reply).toBeVisible({ timeout: 1500 });
  expect(Date.now() - before).toBeLessThan(1500);
  await expect(reply).toHaveCount(1);
  await waitForAnimations(page);
  await page.screenshot({ path: "/tmp/luca-ux-audit/live-stream.png" });
});

test("recipient identity stays readable on hover and can be verified after selection", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/messages/new");
  await page.getByTestId("new-message-to-field").click();
  const search = page.getByTestId("new-dm-search");
  await search.fill("charlie");
  const key = TEST_IDENTITIES.charlie.pubkey;
  const name = page.getByTestId(`new-dm-name-${key}`);
  await name.hover();
  await expect(name).toHaveText("charlie");
  await expect(name).toHaveCSS("opacity", "1");
  await expect(name).toHaveAttribute("title", `charlie · ${key}`);
  await page.getByTestId(`new-dm-result-${key}`).click();
  await page.getByTestId(`new-dm-recipient-name-${key}`).click();
  await expect(
    page.getByTestId(`new-dm-selected-key-popover-${key}`),
  ).toContainText(key);
});

test("recipient picker leaves sidebar navigation accessible at narrow zoom", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 860, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("buzz:text-scale", "1.5");
    localStorage.setItem("buzz-theme", "buzz-dark");
  });
  await installMockBridge(page);
  await page.goto("/?e2e=mock#/messages/new");
  const field = page.getByTestId("new-message-to-field");
  await field.click();
  const picker = page.getByTestId("new-message-recipient-popover");
  await expect(picker).toBeVisible();
  await waitForAnimations(page);
  await expect
    .poll(async () => {
      const [anchor, popup] = await Promise.all([
        field.boundingBox(),
        picker.boundingBox(),
      ]);
      if (!anchor || !popup) return false;
      return (
        popup.width <= anchor.width + 1 &&
        popup.x >= anchor.x - 1 &&
        popup.x + popup.width <= 860
      );
    })
    .toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("recipient-picker-narrow-dark.png"),
  });
  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/#\/pulse$/);
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
});
