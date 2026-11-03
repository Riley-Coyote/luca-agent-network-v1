import { expect, type Page, test } from "@playwright/test";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const LUCA = "a".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PENDING = "companion-combined-review-fixture";
const OPERATION =
  "Follow Claude Code and Codex until paused (also on launch). Add recent sample: yes; notes: yes; background work: yes; proactive returns: yes. Unselected options preserve current settings. Excerpts go to your model and may stay in provider/harness history. Notes stay with this companion. Returns enter your Polyphonic chat, readable by its relay (max 1/day; quiet 22:00–08:00 local). Background uses your subscription. No raw archive, Brain, browser or screen access. Decline or ask Luca to customize.";

function request(combined = true) {
  return {
    protocol: "luca.managed.permission.v2",
    resident_pubkey: LUCA,
    conversation_id: GENERAL,
    session_epoch: 1,
    turn_id: "synthetic-companion-setup-turn",
    request_id: "synthetic-companion-setup-review",
    capability: "harness_manage",
    risk: "high_impact",
    operation: combined
      ? OPERATION
      : "Follow new and changed Claude Code activity with Luca's current model.",
    operation_fingerprint: `sha256:${"b".repeat(64)}`,
    resource: {
      kind: combined ? "companion_setup_combined" : "companion_setup",
      resource_ref: LUCA,
      display_name: combined ? "Companion setup" : "Follow Claude Code",
    },
    // The existing fixture bridge uses these to simulate resolution events.
    // Production V2 IPC has no runtime options; its host selects fixed decisions.
    options: [
      { option_id: "allow_once", kind: "allow_once", name: "Approve" },
      { option_id: "customize", kind: "reject_once", name: "Customize" },
    ],
  };
}

async function boot(page: Page, { day = false, combined = true } = {}) {
  await page.addInitScript(
    ({ key, day }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
      localStorage.setItem("buzz-theme", day ? "paper" : "obsidian");
      localStorage.setItem("buzz-follow-system", "false");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, day },
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
    managedPermissions: [{ pendingId: PENDING, request: request(combined) }],
  } as unknown as Parameters<typeof installMockBridge>[1]);
  await page.goto(`/#/channels/${GENERAL}`);
  await expect(page.getByTestId("message-composer")).toBeVisible();
  // At phone-width proof, collapse navigation through its real control; the
  // desktop rail itself is not the subject of this review's overflow checks.
  if ((page.viewportSize()?.width ?? 1440) < 600) {
    const toggle = page.getByTestId("shell-lip-toggle");
    if ((await toggle.getAttribute("aria-expanded")) === "true")
      await toggle.click();
  }
  const stack = page.getByTestId("room-stack");
  await expect(stack).toHaveAttribute("data-has-asks", "");
  const held = stack.getByTestId("pending-held");
  if (await held.isVisible()) await held.click();
  await expect(stack.getByTestId("needs-you-permission-once")).toBeVisible();
  return stack;
}

async function resolution(page: Page) {
  return page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).findLast(
        (entry) => entry.command === "resolve_managed_permission",
      )?.payload,
  );
}

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  video: "off",
});

for (const [label, optionId] of [
  ["Customize", "customize"],
  ["Not now", null],
  ["Approve", "allow_once"],
] as const) {
  test(`${label} uses its exact setup decision without configuring anything in the renderer`, async ({
    page,
  }) => {
    const stack = await boot(page);
    await expect(stack.locator("[data-permission-choice]")).toHaveText([
      "Not now",
      "Customize",
      "Approve",
    ]);
    const offset = await page.evaluate(
      () => (window.__BUZZ_E2E_COMMANDS__ ?? []).length,
    );
    await stack.getByRole("button", { name: label, exact: true }).click();
    await expect
      .poll(() => resolution(page))
      .toEqual({
        pendingId: PENDING,
        optionId,
        tense: null,
      });
    await expect(page.getByTestId("managed-permission-card")).toHaveCount(0);
    const commands = await page.evaluate(
      (start) => (window.__BUZZ_E2E_COMMANDS__ ?? []).slice(start),
      offset,
    );
    expect(
      commands.filter((command) =>
        /^(set_companion|select_companion|follow_companion|pick_companion|set_resident_access|send_message|publish)/.test(
          command,
        ),
      ),
    ).toEqual([]);
    // This proves renderer transport, not native approval authority. Rust
    // separately proves Customize resolves Deny, including cancellation races.
  });
}

test("minimal following keeps its existing Deny and Allow once choices", async ({
  page,
}) => {
  const stack = await boot(page, { combined: false });
  await expect(stack.locator("[data-permission-choice]")).toHaveText([
    "Deny",
    "Allow once",
  ]);
  await expect(stack.getByRole("button", { name: "Customize" })).toHaveCount(0);
  await stack.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect
    .poll(() => resolution(page))
    .toEqual({
      pendingId: PENDING,
      optionId: "allow_once",
      tense: null,
    });
});

for (const day of [false, true]) {
  for (const width of [1440, 1280, 1024, 390]) {
    test(`setup review stays legible and keyboard ordered at ${width}px (${day ? "day" : "night"})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const stack = await boot(page, { day });
      const card = stack.getByTestId("managed-permission-card");
      await expect(card).toContainText(OPERATION);
      const bounds = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(
        (bounds?.x ?? 0) + (bounds?.width ?? width + 1),
      ).toBeLessThanOrEqual(width + 1);
      expect(
        await card.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      const title = await card.locator(".luca-place-row-title").boundingBox();
      const summary = await card
        .locator(".luca-place-row-summary")
        .boundingBox();
      const answers = await card.locator(".luca-ask-answers").boundingBox();
      expect(title).not.toBeNull();
      expect(summary).not.toBeNull();
      expect(answers).not.toBeNull();
      expect((title?.y ?? 0) + (title?.height ?? 0)).toBeLessThanOrEqual(
        (summary?.y ?? 0) + 1,
      );
      expect((summary?.y ?? 0) + (summary?.height ?? 0)).toBeLessThanOrEqual(
        (answers?.y ?? 0) + 1,
      );
      for (const choice of ["deny", "customize", "once"]) {
        const button = stack.getByTestId(`needs-you-permission-${choice}`);
        await expect(button).toBeInViewport();
        await button.click({ trial: true });
      }
      const deny = stack.getByRole("button", { name: "Not now", exact: true });
      const customize = stack.getByRole("button", {
        name: "Customize",
        exact: true,
      });
      const approve = stack.getByRole("button", {
        name: "Approve",
        exact: true,
      });
      await deny.focus();
      await page.keyboard.press("Tab");
      await expect(customize).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(approve).toBeFocused();
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `companion-review-${day ? "day" : "night"}-${width}.png`,
        ),
        scale: "css",
      });
      await page.keyboard.press("Shift+Tab");
      await expect(customize).toBeFocused();
      await page.keyboard.press("Enter");
      await expect
        .poll(() => resolution(page))
        .toMatchObject({ optionId: "customize" });
      await expect(page.getByTestId("message-input")).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
