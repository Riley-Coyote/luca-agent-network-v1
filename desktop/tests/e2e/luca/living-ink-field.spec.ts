import { expect, test, type Page } from "@playwright/test";

const ROOM = "2dc1e09a-56af-4a34-96f2-5b76d9f12082";
const LUCA = "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";
const ENTRY = "/_shell-lab/scripts/shell-lab.template.html";

async function open(page: Page, theme = "vitesse-black") {
  await page.goto(
    `${ENTRY}?experience=conversation-polish&canvas=1&direction=after&scene=ink&theme=${theme}#/channels/${ROOM}`,
  );
  await expect(page.locator("[data-ink-field-ready]")).toHaveCount(5);
  await page.locator("[data-ink-field]").first().scrollIntoViewIfNeeded();
}

test("settled gestures survive chat switching; only explicit replay restarts them", async ({
  page,
}) => {
  await open(page);
  const gesture = page.locator("[data-ink-gesture]").first();
  await expect(gesture).toHaveAttribute("data-ink-gesture", "done", {
    timeout: 6000,
  });
  const words = await gesture.textContent();
  const draft = page.getByTestId("message-input").last();
  await draft.fill("Unsent polish check");
  await page.evaluate(() => {
    location.hash = "#/channels/c71e4a35-8b02-4d69-9f18-3a6c0e5b2d47";
  });
  await expect(page.locator("[data-ink-gesture]")).toHaveCount(0);
  await page.evaluate((room) => {
    location.hash = `#/channels/${room}`;
  }, ROOM);
  await expect(gesture).toHaveText(words ?? "");
  await expect(gesture).toHaveAttribute("data-ink-gesture", "done");
  expect(
    await gesture.evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(draft).toHaveText("Unsent polish check");
  const row = gesture.locator("xpath=ancestor::*[@data-message-id][1]");
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Replay expression" }).click();
  await expect(gesture).toHaveAttribute("data-ink-gesture", "playing");
});

for (const theme of ["vitesse-black", "paper"]) {
  test(`real Markdown keeps readable, selectable, moving ink in ${theme}`, async ({
    page,
  }) => {
    await open(page, theme);
    const part = page.locator("[data-ink-painted]").first();
    const paint = await part.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--ink-paint"),
    );
    await expect
      .poll(() =>
        part.evaluate((el) =>
          (el as HTMLElement).style.getPropertyValue("--ink-paint"),
        ),
      )
      .not.toBe(paint);
    expect(
      await part.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return selection?.toString() === el.textContent;
      }),
    ).toBe(true);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const row = part.locator("xpath=ancestor::*[@data-message-id][1]");
    const count = await page.getByTestId("message-row").count();
    await row.hover();
    await row
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Replay expression" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      row.getByRole("button", { name: "More actions", exact: true }),
    ).toBeFocused();
    await expect
      .poll(() =>
        row
          .locator("[data-expression-motion]")
          .evaluate((el) =>
            el.getAnimations().some((a) => a.playState === "running"),
          ),
      )
      .toBe(true);
    expect(await page.getByTestId("message-row").count()).toBe(count);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("[data-expression-motion]").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.waitForTimeout(100);
    const still = await part.getAttribute("style");
    await page.waitForTimeout(350);
    expect(await part.getAttribute("style")).toBe(still);
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.locator("[data-ink-painted]")).toHaveCount(0);
    await expect(page.locator("[data-ink-field]").first()).not.toHaveCSS(
      "color",
      "rgba(0, 0, 0, 0)",
    );
  });
}

test("a hidden passage sleeps, wakes without remounting, and rests at the native rate", async ({
  page,
}) => {
  await open(page);
  const measured = await page.evaluate(async () => {
    const field = document.querySelector<HTMLElement>("[data-ink-field]");
    const part = field?.querySelector<HTMLElement>("[data-ink-painted]");
    if (!field || !part)
      throw new Error("The visible pigment fixture is missing");
    const original = CSSStyleDeclaration.prototype.setProperty;
    const clock = Date.now;
    let ticks = 0;
    CSSStyleDeclaration.prototype.setProperty = function (
      name,
      value,
      priority,
    ) {
      if (this === part.style && name === "--ink-paint") ticks++;
      return original.call(this, name, value, priority);
    };
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    try {
      ticks = 0;
      await wait(1100);
      const active = ticks;
      field.style.visibility = "hidden";
      await wait(400);
      ticks = 0;
      await wait(600);
      const hidden = ticks;
      field.style.removeProperty("visibility");
      await wait(500);
      ticks = 0;
      await wait(600);
      const awake = ticks;
      Date.now = () => clock() + 110_000;
      await wait(400);
      ticks = 0;
      await wait(1100);
      const resting = ticks;
      return { active, hidden, awake, resting };
    } finally {
      Date.now = clock;
      field.style.removeProperty("visibility");
      CSSStyleDeclaration.prototype.setProperty = original;
    }
  });
  expect(measured.active).toBeGreaterThan(5);
  expect(measured.active).toBeLessThanOrEqual(14);
  expect(measured.hidden).toBe(0);
  expect(measured.awake).toBeGreaterThan(2);
  expect(measured.resting).toBeGreaterThan(0);
  expect(measured.resting).toBeLessThanOrEqual(4);
});

test("a press gives only its same-line neighbours room and settles without reflow", async ({
  page,
}) => {
  await open(page);
  const land = page.locator('[data-expression-pressure="land"]').first();
  const row = land.locator("xpath=ancestor::*[@data-message-id][1]");
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Replay expression" }).click();
  const neighbour = row.locator("[data-ink-giving]").first();
  await expect(neighbour).toHaveCount(1);
  await expect
    .poll(() =>
      neighbour.evaluate((el) =>
        Math.abs(Number.parseFloat(getComputedStyle(el).left)),
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => land.evaluate((el) => getComputedStyle(el).filter))
    .not.toBe("none");
  await expect
    .poll(() => land.evaluate((el) => getComputedStyle(el).filter))
    .toBe("none");
  await expect(neighbour).toHaveCSS("left", "0px");
  const settled = await row.boundingBox();
  // Opening the off-edge action menu may scroll the row into view, which is
  // navigation, not a change to its text wrapping or layout dimensions.
  expect({ width: settled?.width, height: settled?.height }).toEqual({
    width: box?.width,
    height: box?.height,
  });
});

test("streamed edits keep ink and code distinct and do not expose the notation", async ({
  page,
}) => {
  await open(page);
  let sequence = 0;
  const emit = (content: string, target?: string) =>
    page.evaluate(
      ({ content, target, room, luca, sequence }) => {
        return window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId: room,
          pubkey: luca,
          content,
          createdAt: Math.floor(Date.now() / 1000) + sequence,
          ...(target ? { kind: 40003, extraTags: [["e", target]] } : {}),
        })?.id;
      },
      { content, target, room: ROOM, luca: LUCA, sequence: sequence++ },
    );
  const id = await emit("A thought: [Still finding the");
  expect(id).toBeTruthy();
  await emit(
    "A thought: [Still finding the words.](ink:care~calm?wet&linger)\n\n`[literal](ink:care)`",
    id,
  );
  const row = page.locator(`[data-message-id="${id}"]`);
  await expect(row.locator("[data-ink-field]")).toHaveCount(1);
  await expect(row.locator("code")).toHaveText("[literal](ink:care)");
  await expect(row.locator("[data-ink-field]")).toHaveText(
    "Still finding the words.",
  );
  await expect(row.locator("[data-ink-painted]").first()).toBeVisible();
  await emit(
    "A thought: [Still finding the words, together.](ink:care~calm?wet&linger)\n\n`[literal](ink:care)`",
    id,
  );
  await expect(row.locator("[data-ink-field]")).toHaveText(
    "Still finding the words, together.",
  );
  await expect(row.locator("[data-ink-painted]").first()).toBeVisible();
});
