import { expect, test } from "@playwright/test";

test("vision demo runs the complete deterministic continuity story", async ({
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
  ).toBeVisible();

  await page.getByTestId("vision-story-step-7").click();
  await expect(page.getByTestId("vision-message-m-10")).toContainText(
    "I kept one unresolved question",
  );
  await expect(page.getByTestId("vision-message-m-09")).toContainText(
    "the same room reopens",
  );

  await page.getByTestId("vision-nav-agents").click();
  await expect(page.getByTestId("vision-agents-view")).toContainText(
    "Not sessions. Relationships.",
  );
  for (const fingerprint of [
    "fb01 26a4 · 2b0a caaf",
    "d929 1304 · 0912 7847",
    "97b9 8aa8 · 6409 b250",
  ]) {
    await expect(page.getByTestId("vision-agents-view")).toContainText(
      fingerprint,
    );
  }

  await page.getByTestId("vision-nav-brain").click();
  await expect(page.getByTestId("vision-brain-view")).toContainText(
    "visible and human-readable",
  );
  await expect(page.getByTestId("vision-brain-view")).toContainText(
    "Agents with access",
  );

  await page.getByTestId("vision-nav-continuity").click();
  await expect(page.getByTestId("vision-continuity-view")).toContainText(
    "The thread does not close.",
  );
  await expect(page.getByTestId("vision-continuity-view")).toContainText(
    "Identity returned intact",
  );
  await expect(page.getByTestId("vision-continuity-view")).toContainText(
    "Consolidation proposals require Riley's review",
  );

  expect(consoleErrors).toEqual([]);
});

test("vision demo remains usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?vision=demo");

  await expect(page.getByTestId("vision-demo-app")).toBeVisible();
  await expect(page.getByTestId("vision-nav-network")).toBeVisible();
  await expect(page.getByTestId("vision-nav-agents")).toBeVisible();
  await expect(page.getByTestId("vision-nav-brain")).toBeVisible();
  await expect(page.getByTestId("vision-nav-continuity")).toBeVisible();
  await expect(page.getByLabel("Message the launch room")).toBeVisible();
  await expect(page.getByTestId("vision-demo-disclosure-mobile")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});
