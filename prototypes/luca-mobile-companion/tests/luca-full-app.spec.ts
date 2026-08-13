import { expect, test, type Page } from "@playwright/test";

async function selectPixel(page: Page) {
  await page.getByTestId("device-picker").click();
  await page.getByTestId("device-option-pixel-10").click();
}

test("Network menu presents the companion records without a tab bar", async ({ page }) => {
  await page.goto("/?scene=network");
  await page.getByRole("button", { name: "Open companion menu" }).click();
  const menu = page.getByRole("dialog", { name: "Luca Companion" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /Conversations/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Activity/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Notifications/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Settings/ })).toBeVisible();
  await expect(page.locator("[role=tablist], .mode-rail, nav[aria-label='Tab bar']")).toHaveCount(0);

  await menu.getByRole("button", { name: /Conversations/ }).click();
  await expect(page.getByTestId("record-conversations")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeFocused();
});

test("pairing moves from a plain-language welcome through verification into the Room", async ({ page }) => {
  await page.goto("/?scene=onboarding");
  await expect(page.getByRole("heading", { name: "Your residents, within reach." })).toBeVisible();
  await expect(page.getByText("No resident secrets move to this phone.")).toBeVisible();

  await page.getByRole("button", { name: "Pair with my Mac" }).click();
  await expect(page.getByRole("heading", { name: "Find your Mac." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Paste pairing code" })).toBeVisible();
  await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "false");
  expect(await page.getByTestId("device-screen").evaluate((element) => element.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.getByText("MICA")).toBeVisible();
  await expect(page.getByText("47", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "They match" }).click();
  await expect(page.getByRole("heading", { name: "Your network is within reach." })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole("switch", { name: "Allow useful notifications" })).toBeChecked();

  await page.getByRole("button", { name: "Enter the room" }).click();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.getByTestId("room-place")).toBeVisible();
});

test("paste pairing is a keyboard-attached accessible alternative", async ({ page }) => {
  await page.goto("/?scene=pairing");
  await page.getByRole("button", { name: "Paste pairing code" }).click();
  const input = page.getByRole("textbox", { name: "One-time pairing code" });
  await expect(input).toBeFocused();
  await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "true");
  await input.fill("LUCA-ONE-TIME-CODE");
  await page.getByRole("button", { name: "Continue with pairing code" }).click();
  await expect(page.getByRole("heading", { name: "Same words on both?" })).toBeVisible();
});

test("conversation search preserves the focused room model", async ({ page }) => {
  await page.goto("/?scene=conversations");
  await page.getByRole("button", { name: "Search conversations" }).click();
  const search = page.getByRole("textbox", { name: "Search conversations" });
  await search.fill("Vektor");
  const rows = page.getByTestId("record-conversations").locator(".conversation-row");
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: /Vektor Reviewing the launch plan/ }).click();
  await expect(page.getByTestId("room-statement")).toContainText("reviewing the launch plan");
});

test("Activity exposes exact pending context and a bounded stop outcome", async ({ page }) => {
  await page.goto("/?scene=activity");
  await expect(page.getByRole("button", { name: /Review three launch files/ })).toContainText("has not opened any files");
  await page.getByRole("button", { name: "Stop Vektor’s current work" }).click();
  await expect(page.getByRole("heading", { name: "Launch review stopped" })).toBeVisible();
  await expect(page.getByText("No further work is running from this turn.")).toBeVisible();

  await page.getByRole("button", { name: /Review three launch files/ }).click();
  await expect(page.getByTestId("permission-event")).toBeVisible();
  await expect(page.getByTestId("room-place")).toBeAttached();
});

test("Settings, privacy, notifications, and back preserve a native record stack", async ({ page }) => {
  await page.goto("/?scene=settings");
  await page.getByRole("button", { name: /Privacy & Security/ }).click();
  const shield = page.getByRole("switch", { name: /Shield app switcher/ });
  await expect(shield).toHaveAttribute("aria-checked", "true");
  await shield.click();
  await expect(shield).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: /Notification previews/ }).click();
  await page.getByRole("button", { name: /Generic Show only/ }).click();
  await expect(page.getByText("Luca has an update", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("record-privacy")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("record-settings")).toBeVisible();
});

test("device removal names the consequence and keeps Mac residents intact", async ({ page }) => {
  await page.goto("/?scene=devices");
  await page.getByRole("button", { name: "Remove this phone" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove this phone?" });
  await expect(dialog).toContainText("Residents on Riley’s Mac keep running");
  await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "false");
  expect(await page.getByTestId("device-screen").evaluate((element) => element.scrollTop)).toBe(0);

  await dialog.getByRole("button", { name: "Remove Luca access from this phone" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("This phone was removed")).toBeVisible();
  await expect(page.getByText("Pair again from Luca on your Mac to restore access.")).toBeVisible();
});

test("offline scene preserves the Room and explains what will wait", async ({ page }) => {
  await page.goto("/?scene=offline");
  await expect(page.getByTestId("room-statement")).toContainText("The room is preserved here");
  await page.getByRole("button", { name: "Back to network" }).click();
  await page.getByRole("button", { name: "Open companion menu" }).click();
  await page.getByRole("button", { name: /Conversations/ }).click();
  await expect(page.getByRole("button", { name: /Phone offline/ })).toContainText("New messages will wait");
});

for (const device of ["iphone", "pixel-10"] as const) {
  test(`${device} keeps new app controls at least 44 points and canonical records unclipped`, async ({ page }) => {
    await page.goto("/?scene=settings");
    if (device === "pixel-10") await selectPixel(page);
    await page.waitForTimeout(340);
    const geometry = await page.evaluate(() => {
      const screen = document.querySelector<HTMLElement>('[data-testid="device-screen"]')!.getBoundingClientRect();
      const targets = [".record-back", ".record-row"].flatMap((selector) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 4).map((element) => {
          const rect = element.getBoundingClientRect();
          return { selector, width: rect.width, height: rect.height };
        }),
      );
      const record = document.querySelector<HTMLElement>(".app-record")!.getBoundingClientRect();
      return { screen, record, targets };
    });
    expect(geometry.record.left).toBeGreaterThanOrEqual(geometry.screen.left);
    expect(geometry.record.right).toBeLessThanOrEqual(geometry.screen.right);
    expect(geometry.record.bottom).toBeLessThanOrEqual(geometry.screen.bottom);
    for (const target of geometry.targets) {
      expect(Math.min(target.width, target.height), target.selector).toBeGreaterThanOrEqual(44);
    }
  });
}

test("reduced motion presents records without spatial travel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scene=network");
  await page.getByRole("button", { name: "Open companion menu" }).click();
  await page.getByRole("button", { name: /Settings/ }).click();
  const transform = await page.getByTestId("record-settings").evaluate((element) => getComputedStyle(element).transform);
  expect(transform).toBe("none");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
