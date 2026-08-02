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

  await expect(page.locator(".mn-room-row svg")).toHaveCount(0);

  const threadScrollbar = await page
    .getByTestId("vision-network-thread")
    .evaluate((element) => ({
      colorScheme: getComputedStyle(element).colorScheme,
      trackBackground: getComputedStyle(element, "::-webkit-scrollbar-track")
        .backgroundColor,
    }));
  expect(threadScrollbar.colorScheme).toContain("light");
  expect(threadScrollbar.trackBackground).not.toBe("rgb(0, 0, 0)");

  for (const [destination, lucideName] of [
    ["network", "messages-square"],
    ["agents", "users-round"],
    ["brain", "brain"],
    ["continuity", "history"],
  ] as const) {
    await expect(
      page
        .getByTestId(`vision-nav-${destination}`)
        .locator(
          `svg[data-icon-library="lucide"][data-mnemos-icon="${destination}"][data-lucide-icon="${lucideName}"]`,
        ),
    ).toHaveCount(1);
  }

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
    "Signed receipt",
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
  await expect
    .poll(() =>
      composerHousing.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .not.toBe(idleBackground);
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const) {
  test(`Mnemos vision shell stays contained at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?vision=demo");

    await expect(page.getByTestId("vision-demo-app")).toBeVisible();
    await expect(page.getByLabel("Message the launch room")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
  });
}

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

test("Mnemos dark mode uses the Luca tonal system and persists", async ({
  page,
}) => {
  await page.goto("/?vision=demo");

  const app = page.getByTestId("vision-demo-app");
  await expect(app).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(app).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page
        .locator(".mn-conversation-card")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(28, 28, 28)");

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-1").click();

  const darkSurfaces = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-mnemos-vision]");
    const card = document.querySelector<HTMLElement>(".mn-conversation-card");
    const thread = document.querySelector<HTMLElement>(".mn-thread-scroll");
    const display = document.querySelector<HTMLElement>(
      '[data-material="display"]',
    );
    if (!root || !card || !thread || !display) {
      throw new Error("Expected dark mode surfaces were not rendered");
    }
    return {
      root: getComputedStyle(root).backgroundColor,
      card: getComputedStyle(card).backgroundColor,
      display: getComputedStyle(display).backgroundColor,
      colorScheme: getComputedStyle(root).colorScheme,
      track: getComputedStyle(thread, "::-webkit-scrollbar-track")
        .backgroundColor,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

  expect(darkSurfaces).toMatchObject({
    root: "rgb(20, 20, 20)",
    card: "rgb(28, 28, 28)",
    display: "rgb(17, 17, 17)",
    colorScheme: "dark",
  });
  expect(darkSurfaces.track).toBe(darkSurfaces.card);
  expect(darkSurfaces.display).not.toBe("rgb(0, 0, 0)");
  expect(darkSurfaces.scrollWidth).toBe(darkSurfaces.clientWidth);

  await page.reload();
  await expect(app).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(app).toHaveAttribute("data-theme", "light");
});

test("Agents, Brain, and Continuity remain explorable at every story beat", async ({
  page,
}) => {
  await page.goto("/?vision=demo");

  await page.getByTestId("vision-nav-agents").click();
  await expect(page.getByTestId("vision-agents-surface")).toBeVisible();
  await page.getByTestId("vision-agent-row-mara").click();
  await expect(page.getByTestId("vision-agent-dossier")).toContainText("Mara");
  await expect(page.getByTestId("vision-agent-dossier")).toContainText(
    "11 months",
  );

  await page.getByTestId("vision-nav-brain").click();
  await expect(page.getByTestId("vision-brain-surface")).toBeVisible();
  await page.getByTestId("vision-memory-row-memory-truth").click();
  await expect(page.getByTestId("vision-memory-detail")).toContainText(
    "Never blur the line",
  );
  await expect(page.getByTestId("vision-memory-detail")).toContainText(
    "Vision-demo brief",
  );

  await page.getByTestId("vision-nav-continuity").click();
  await expect(page.getByTestId("vision-continuity-surface")).toBeVisible();
  await expect(page.getByText("Human review retained")).toBeVisible();
});

test("Later beats expose active recall, private reflection, and return evidence", async ({
  page,
}) => {
  await page.goto("/?vision=demo");

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-5").click();
  await page.getByTestId("vision-nav-agents").click();
  await expect(page.getByText("LIVE COGNITION")).toBeVisible();

  await page.getByTestId("vision-nav-brain").click();
  await expect(page.getByText("IN ACTIVE RECALL")).toBeVisible();

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-6").click();
  await page.getByTestId("vision-nav-continuity").click();
  await expect(page.getByTestId("vision-continuity-event-c-02")).toContainText(
    "Private reflection",
  );
  await expect(page.getByTestId("vision-continuity-event-c-04")).toContainText(
    "awaiting Riley",
  );

  await page.getByTestId("vision-demo-disclosure-desktop").click();
  await page.getByTestId("vision-story-step-7").click();
  await page.getByTestId("vision-nav-continuity").click();
  await expect(page.getByTestId("vision-continuity-event-c-05")).toContainText(
    "Identity returned intact",
  );
});

test("Inspector supports receipt and continuity evidence", async ({ page }) => {
  await page.goto("/?vision=demo");
  await page.getByTestId("vision-nav-agents").click();
  await page.getByRole("button", { name: "Inspect receipt" }).click();
  await expect(
    page
      .locator(".mn-inspector > header")
      .getByText("Continuity receipt", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Chain verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pin inspector" }).click();
  await expect(page.locator(".mn-inspector")).toHaveAttribute(
    "data-pinned",
    "true",
  );
  await page.getByRole("button", { name: "Close inspector" }).click();

  await page.getByTestId("vision-nav-continuity").click();
  await page.getByTestId("vision-continuity-event-c-01").click();
  await expect(
    page.getByText("Signed continuity event", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".mn-inspector").getByText("evt · 8c7f…1a92", { exact: true }),
  ).toBeVisible();
});

test("Reduced motion preserves all product state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?vision=demo");
  await page.getByTestId("vision-nav-agents").click();
  await expect(page.getByTestId("vision-agent-dossier")).toBeVisible();
  const animationName = await page
    .locator(".mn-identity")
    .first()
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe("none");
});
