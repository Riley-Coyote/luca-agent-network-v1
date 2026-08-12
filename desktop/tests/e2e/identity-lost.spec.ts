import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test("normal first launch uses the already-persisted identity", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");

  const gate = page.getByTestId("machine-onboarding-gate");
  await expect(gate).toBeVisible();
  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(page.getByText("Polyphonic", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Begin setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeVisible();
  const commands = await page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
  expect(commands.some((entry) => entry.command === "get_identity")).toBe(true);
  expect(
    commands.some((entry) => entry.command === "persist_current_identity"),
  ).toBe(false);
});

test("lost boot opens the protected owner-recovery screen", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLost: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recover your owner identity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Relaunch Luca" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Recover from protected backup" }),
  ).toBeVisible();
});

test("lost mode offers protected recovery without plaintext key import", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLost: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Recover your owner identity" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover from protected backup" })
    .click();
  await expect(page.getByTestId("protected-owner-recovery")).toBeVisible();
  await expect(page.getByLabel("Backup passphrase")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByTestId("nostr-import-nsec-input")).toHaveCount(0);
});

test("lost recovery relaunch button records the process restart", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLost: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Recover your owner identity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Relaunch Luca" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
            }
          ).__BUZZ_E2E_COMMAND_PAYLOADS__?.some(
            (entry) => entry.command === "plugin:process|restart",
          ) ?? false,
      ),
    )
    .toBe(true);
});

test("cancelling protected recovery returns to the safe recovery actions", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLost: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Recover your owner identity" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover from protected backup" })
    .click();
  await expect(page.getByTestId("protected-owner-recovery")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("protected-owner-recovery")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Recover from protected backup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Relaunch Luca" }),
  ).toBeVisible();
});

test("locked boot shows the keyring-locked screen without the onboarding gate or key-import UI", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await expect(page.getByTestId("onboarding-gate")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Re-import your key" }),
  ).toHaveCount(0);
});

test("locked boot exposes explicit protected-backup recovery", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await page
    .getByRole("button", { name: "Recover from protected backup" })
    .click();
  await expect(page.getByTestId("protected-owner-recovery")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose and preview backup" }),
  ).toBeDisabled();
});

test("locked screen relaunch button records the process-restart invoke", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await page.getByTestId("relaunch-app").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
            }
          ).__BUZZ_E2E_COMMAND_PAYLOADS__?.some(
            (e) => e.command === "plugin:process|restart",
          ) ?? false,
      ),
    )
    .toBe(true);
});
