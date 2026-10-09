import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { waitForAnimations } from "../../helpers/animations";

// The generated lab installs the normal E2E bridge before mounting the real
// component. Its companion API is deliberately in-memory, not native proof.
async function openSample(page: Page) {
  const lab = pathToFileURL(
    resolve(import.meta.dirname, "../../../../design-lab/shell-lab.html"),
  );
  lab.search = "experience=companion-setup&theme=obsidian";
  await page.goto(lab.href);
  const dialog = page.getByRole("dialog", { name: "With Luca" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Interactive sample only/)).toBeVisible();
  return dialog;
}

test("source selection keeps observation and each sharing destination off", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openSample(page);
  await dialog.getByRole("button", { name: "App activity" }).click();
  const select = dialog.getByRole("button", {
    name: "Select source · access stays off",
  });
  await expect(select).toBeDisabled();
  await dialog.getByLabel("VS Code", { exact: true }).check();
  await select.click();
  await expect(dialog.getByText("Selected · observation off")).toBeVisible();
  await dialog.getByRole("button", { name: "Review access" }).click();
  const observe = dialog.getByRole("switch", { name: "Observe new activity" });
  const sharing = dialog.getByRole("switch", {
    name: "Send selected context to the model",
  });
  const history = dialog.getByRole("switch", {
    name: "Use selected activity in conversations",
  });
  await expect(observe).not.toBeChecked();
  await expect(sharing).toBeDisabled();
  await expect(history).toBeDisabled();
  await observe.click();
  await expect(sharing).not.toBeChecked();
  await expect(history).toBeDisabled();
  await sharing.click();
  await expect(history).toBeEnabled();
  await expect(history).not.toBeChecked();
  await dialog.getByRole("button", { name: "Confirm these choices" }).click();
  await dialog.getByRole("button", { name: "Review access" }).click();
  await expect(history).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Turn background work off" }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await dialog.screenshot({ path: "test-results/companion-setup-access.png" });
  expect(errors).toEqual([]);
});

test("browser pairing does not grant access and disconnect removes all classes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const dialog = await openSample(page);
  await dialog.getByRole("button", { name: "Browser activity" }).click();
  await dialog
    .getByLabel("Allowed sites", { exact: true })
    .fill("https://example.com");
  await dialog.getByRole("button", { name: "Choose profile folder" }).click();
  await dialog
    .getByRole("button", {
      name: "Register connector and create pairing code",
    })
    .click();
  await expect(dialog.getByText("SAMPLE-ONLY", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Paired · access off", { exact: true }),
  ).toHaveCount(3);
  await expect(
    dialog.getByRole("button", { name: "Review access" }),
  ).toHaveCount(3);
  const size = await dialog.boundingBox();
  expect(size).not.toBeNull();
  expect(size?.x).toBeGreaterThanOrEqual(0);
  expect((size?.x ?? 0) + (size?.width ?? 0)).toBeLessThanOrEqual(480);
  await dialog.getByRole("button", { name: "Disconnect browser" }).click();
  await expect(
    dialog.getByRole("button", { name: "Review access" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText("Paired · access off", { exact: true }),
  ).toHaveCount(0);
});
