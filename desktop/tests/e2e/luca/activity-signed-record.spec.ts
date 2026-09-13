import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

test("signed activity receipts, resident selection and conversation navigation", async ({
  page,
}, info) => {
  const luca =
    "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";
  const vektor =
    "ad43e47d062c00612509b09043167cc56d9cdadd51caabb65a870ff2263a33b6";
  await page.setViewportSize({ width: 1280, height: 850 });
  await installMockBridge(page, {
    managedAgents: [
      { name: "Luca", pubkey: luca, status: "running" },
      { name: "Vektor", pubkey: vektor, status: "running" },
    ],
  });
  await page.goto("/?e2e=mock");
  await expect(page.getByTestId("open-activity-view")).toBeVisible();
  await page.evaluate(
    ({ luca, vektor }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        pubkey: luca,
        kind: 9,
        content: "Activity receipt from Luca",
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        pubkey: vektor,
        kind: 9,
        content: "Separate record from Vektor",
      });
    },
    { luca, vektor },
  );
  await page.getByTestId("open-activity-view").click();
  await page.getByTestId("activity-section-record").click();
  const lucaRow = page
    .locator('[data-testid^="provenance-row-"]')
    .filter({ hasText: "Activity receipt from Luca" });
  await expect(lucaRow).toBeVisible();
  await expect(
    lucaRow.getByRole("img", {
      name: "Signature verified against this resident's key",
    }),
  ).toBeVisible();
  await lucaRow.getByRole("button").first().focus();
  await page.keyboard.press("Enter");
  await expect(
    lucaRow.getByRole("button", { name: "Open in conversation" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("signed-record.png") });
  await page.getByRole("tab", { name: "Vektor", exact: true }).click();
  await expect(
    page.getByText("Separate record from Vektor", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Activity receipt from Luca", { exact: false }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 720, height: 780 });
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("signed-record-narrow.png") });
  await page.getByRole("tab", { name: "Luca", exact: true }).click();
  await lucaRow.getByRole("button").first().click();
  await lucaRow.getByRole("button", { name: "Open in conversation" }).click();
  await expect(page.getByTestId("activity-section-record")).toHaveCount(0);
  await expect(
    page.getByText("Activity receipt from Luca", { exact: true }).first(),
  ).toBeVisible();
});
