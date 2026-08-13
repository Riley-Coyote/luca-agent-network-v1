import { expect, test, type Locator, type Page } from "@playwright/test";

async function drag(page: Page, locator: Locator, deltaX: number, deltaY: number, steps = 8) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drag target has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      startX + (deltaX * step) / steps,
      startY + (deltaY * step) / steps,
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
}

async function openPermissionThroughComposer(page: Page) {
  await expect(page.getByTestId("inline-composer")).toBeVisible();
  await page.getByLabel("Message Luca and Vektor").fill("Review the three launch files before we finalize the handoff.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("room-statement")).toContainText("reviewing what this would require");
  await expect(page.getByTestId("room-statement")).toContainText(
    "Vektor needs your approval to review three launch files.",
    { timeout: 3_000 },
  );
  await page.getByTestId("room-statement").click();
  await expect(page.getByTestId("permission-event")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("default Room is a conversation surface with a persistent composer", async ({ page }) => {
  await expect(page.getByTestId("room-place")).toBeVisible();
  await expect(page.getByTestId("room-statement")).toContainText("reviewing the launch plan");
  await expect(page.getByTestId("inline-composer")).toBeVisible();
  await expect(page.getByLabel("Message Luca and Vektor")).toBeVisible();
  await expect(page.locator(".mode-rail")).toHaveCount(0);
  await expect(page.getByTestId("voice-orb")).toHaveAccessibleName("Hold to speak");
  await expect(page.locator(".chat-turn")).toHaveCount(3);
});

test("back control and edge swipe return to Network", async ({ page }) => {
  await page.getByRole("button", { name: "Back to network" }).click();
  await expect(page.getByTestId("network-place")).toBeVisible();

  await page.getByRole("button", { name: "Enter the room with Luca" }).click();
  await expect(page.getByTestId("room-place")).toBeVisible();
  await drag(page, page.locator(".edge-back-zone"), 92, 0, 6);
  await expect(page.getByTestId("network-place")).toBeVisible();
});

test("resident row enters Room while its identity specimen opens detail", async ({ page }) => {
  await page.goto("/?scene=network");
  await page.getByRole("button", { name: "Open Vektor details" }).click();
  await expect(page.getByTestId("bottom-sheet")).toBeVisible();
  await expect(page.getByTestId("bottom-sheet")).toContainText("systems resident");
  await page.getByTestId("sheet-overlay").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("bottom-sheet")).toHaveCount(0, { timeout: 1_000 });

  await page.getByRole("button", { name: "Enter the room with Vektor" }).click();
  await expect(page.getByTestId("room-statement")).toContainText("I’m reviewing the launch plan");
});

test("Mac availability footer is the explicit Connection Detail trigger", async ({ page }) => {
  await page.goto("/?scene=network");
  await page.getByRole("button", { name: /Mac available/ }).click();
  await expect(page.getByTestId("bottom-sheet")).toContainText("signing stays on Mac");
});

test("composer is always present and focuses the keyboard-attached field", async ({ page }) => {
  await expect(page.getByTestId("inline-composer")).toBeVisible();
  await page.getByLabel("Message Luca and Vektor").click();
  await expect(page.getByLabel("Message Luca and Vektor")).toBeFocused();
  await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "true");
});

test("orb hold enters listening and release sends a voice turn", async ({ page }) => {
  const orb = page.getByTestId("voice-orb");
  const box = await orb.boundingBox();
  if (!box) throw new Error("Voice orb has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(220);
  await expect(page.getByTestId("room-statement")).toContainText("Listening…");
  await page.mouse.up();
  await expect(page.getByTestId("inline-composer")).toBeVisible();
  await expect(page.getByTestId("room-statement")).toContainText(
    "Vektor needs your approval to review three launch files.",
    { timeout: 3_000 },
  );
});

test("typed send exposes the exact Room-owned request over the mounted Room", async ({ page }) => {
  await openPermissionThroughComposer(page);
  await expect(page.getByTestId("room-place")).toBeAttached();
  await expect(page.getByTestId("room-place")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Back to network" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Review three launch files?" })).toBeFocused();
  await expect(page.getByTestId("permission-event")).toContainText("this request only");
  await expect(page.getByTestId("permission-event")).toContainText("Launch brief.md");
  await expect(page.getByTestId("permission-event")).toContainText("Onboarding notes.md");
  await expect(page.getByTestId("permission-event")).toContainText("Mobile handoff.md");
});

test("approval recedes directly to the bounded consequence statement", async ({ page }) => {
  await page.goto("/?scene=permission");
  const slider = page.getByTestId("approval-control");
  await slider.evaluate((element: HTMLInputElement) => {
    element.value = "100";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByTestId("permission-event")).toHaveCount(0, { timeout: 1_000 });
  await expect(page.getByTestId("room-statement")).toContainText(
    "Vektor can read the three files. No standing access was created.",
  );
  await expect(page.getByRole("button", { name: /Return to the room/i })).toHaveCount(0);
});

test("decline dissolves directly to the non-action consequence statement", async ({ page }) => {
  await page.goto("/?scene=permission");
  await page.getByRole("button", { name: "Decline request" }).click();
  await expect(page.getByTestId("permission-event")).toHaveCount(0, { timeout: 1_000 });
  await expect(page.getByTestId("room-statement")).toContainText(
    "Vektor remains available. The files were not opened.",
  );
  await expect(page.getByRole("button", { name: /Return to the room/i })).toHaveCount(0);
});

test("reduced motion removes spatial travel while preserving place changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scene=network");
  await page.getByRole("button", { name: "Enter the room with Luca" }).click();
  await expect(page.getByTestId("room-place")).toBeVisible();
  const state = await page.evaluate(() => {
    const room = document.querySelector<HTMLElement>('[data-testid="room-place"]')!;
    const movingCanvases = Array.from(document.querySelectorAll("canvas")).filter(
      (canvas) => canvas.getAnimations().length > 0,
    );
    return {
      transform: getComputedStyle(room).transform,
      movingCanvasCount: movingCanvases.length,
      sharedLayoutNodes: document.querySelectorAll('[data-projection-id]').length,
    };
  });
  expect(state.transform).toBe("none");
  expect(state.movingCanvasCount).toBe(0);
  expect(state.sharedLayoutNodes).toBe(0);
});

for (const device of ["iphone", "pixel-10"] as const) {
  test(`${device} keeps canonical Room and Permission controls inside the device screen`, async ({ page }) => {
    if (device === "pixel-10") {
      await page.getByTestId("device-picker").click();
      await page.getByTestId("device-option-pixel-10").click();
    }

    const roomLayout = await page.evaluate(() => {
      const screen = document.querySelector<HTMLElement>('[data-testid="device-screen"]')!.getBoundingClientRect();
      const back = document.querySelector<HTMLElement>('.room-back')!.getBoundingClientRect();
      const orb = document.querySelector<HTMLElement>('[data-testid="voice-orb"]')!.getBoundingClientRect();
      return { screen: { top: screen.top, right: screen.right, bottom: screen.bottom, left: screen.left }, back, orb };
    });
    expect(roomLayout.back.top).toBeGreaterThanOrEqual(roomLayout.screen.top);
    expect(roomLayout.back.left).toBeGreaterThanOrEqual(roomLayout.screen.left);
    expect(roomLayout.orb.right).toBeLessThanOrEqual(roomLayout.screen.right);
    expect(roomLayout.orb.bottom).toBeLessThanOrEqual(roomLayout.screen.bottom);

    await page.goto("/?scene=permission");
    if (device === "pixel-10") {
      await page.getByTestId("device-picker").click();
      await page.getByTestId("device-option-pixel-10").click();
    }
    const decision = page.locator(".approval-zone");
    await expect(decision).toBeInViewport();
    const sizes = await page.evaluate(() => {
      const selectors = [
        ".room-back",
        ".voice-orb",
        ".approval-control",
        ".decline-button",
      ];
      return selectors.map((selector) => {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { selector, width: rect.width, height: rect.height };
      });
    });
    for (const size of sizes) {
      expect(Math.min(size.width, size.height), size.selector).toBeGreaterThanOrEqual(44);
    }
  });
}

test("enlarged readable text reflows without horizontal clipping", async ({ page }) => {
  await page.goto("/?scene=permission");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "125%";
  });
  const clipping = await page.evaluate(() => {
    const plane = document.querySelector<HTMLElement>(".permission-plane")!;
    const screen = document.querySelector<HTMLElement>('[data-testid="device-screen"]')!;
    return {
      planeScrollWidth: plane.scrollWidth,
      screenWidth: screen.clientWidth,
      titleScrollWidth: document.querySelector<HTMLElement>("#permission-title")!.scrollWidth,
      titleClientWidth: document.querySelector<HTMLElement>("#permission-title")!.clientWidth,
    };
  });
  expect(clipping.planeScrollWidth).toBeLessThanOrEqual(clipping.screenWidth);
  expect(clipping.titleScrollWidth).toBeLessThanOrEqual(clipping.titleClientWidth + 1);
});
