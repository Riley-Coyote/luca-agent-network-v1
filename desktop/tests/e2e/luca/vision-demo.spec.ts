import { expect, test } from "@playwright/test";

test("Mnemos vision foundation preserves the deterministic Network story", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?vision=demo");

  await expect(page.getByTestId("vision-demo-app")).toBeVisible();
  await expect(page.getByTestId("vision-network-thread")).toContainText(
    "What is the clearest launch story?",
  );
  await expect(
    page.getByTestId("vision-demo-disclosure-desktop"),
  ).toContainText("01/08");

  const lucaPatterns = await page
    .locator('[data-agent-name="Luca"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-pattern")),
    );
  expect(new Set(lucaPatterns).size).toBe(1);

  const residentPatterns = await page
    .locator(".mn-resident-row .mn-identity")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-pattern")),
    );
  expect(new Set(residentPatterns).size).toBe(3);

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-1").click();
  await expect(page.getByTestId("vision-message-m-02")).toContainText(
    "The conductor was intentionally removed",
  );
  await expect(page.getByTestId("vision-message-m-02")).toContainText(
    "RECEIPT",
  );

  await page.getByTestId("vision-message-m-02").getByRole("button").click();
  await expect(
    page.getByText("Memory provenance", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("7F21 A90C", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();

  const composer = page.getByLabel("Message the launch room");
  const composerHousing = page.locator(".mn-composer-input");
  const idleBackground = await composerHousing.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await composer.fill("A local note about the launch.");
  const focusedBackground = await composerHousing.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(focusedBackground).not.toBe(idleBackground);
  await composer.press("Enter");
  await expect(page.getByTestId("vision-network-thread")).toContainText(
    "A local note about the launch.",
  );

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-7").click();
  await expect(page.getByTestId("vision-message-m-10")).toContainText(
    "I kept one unresolved question",
  );

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByRole("button", { name: "Restart story" }).click();
  await expect(
    page.getByTestId("vision-demo-disclosure-desktop"),
  ).toContainText("01/08");
  await expect(page.getByTestId("vision-message-m-02")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("Mnemos vision foundation remains usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?vision=demo");

  await expect(page.getByTestId("vision-demo-app")).toBeVisible();
  await expect(page.getByLabel("Mobile destinations")).toBeVisible();
  await expect(page.getByLabel("Message the launch room")).toBeVisible();

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-1").click();
  await page.getByTestId("vision-message-m-02").getByRole("button").click();
  await expect(
    page.getByText("Memory provenance", { exact: true }),
  ).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});
