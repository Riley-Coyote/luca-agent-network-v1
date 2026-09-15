import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

for (const theme of ["buzz-dark", "paper"]) {
  test(`baseline surfaces and keyboard focus in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    // Each palette is named outright. Leaving one to the empty store made the
    // baseline mean "whatever ships", and the shipped default is Vitesse Black
    // now — a palette change would silently re-point a named baseline.
    await page.addInitScript((value) => {
      localStorage.setItem("buzz-theme", value);
      localStorage.setItem("buzz-follow-system", "false");
    }, theme);
    await installMockBridge(page, {
      managedAgents: [
        { name: "Luca", pubkey: "a".repeat(64), status: "running" },
      ],
    });
    await page.goto("/?e2e=mock");
    const shot = async (name: string) => {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await waitForAnimations(page);
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
    };
    await expect(page.locator("html")).toHaveAttribute(
      "data-luca-theme",
      theme,
    );
    const rail = page.getByTestId("agent-rail-luca");
    await rail.click();
    await page.getByTestId("agent-column-new-chat").click();
    await page
      .getByRole("button", { name: "Open conversation details", exact: true })
      .click();
    await shot("conversation-cards");
    // Keyboard focus must remain visible without changing the control's size.
    const before = await rail.boundingBox();
    await rail.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(rail).toBeFocused();
    const focus = await rail.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        visible: el.matches(":focus-visible"),
        outline: s.outlineStyle,
        outlineColor: s.outlineColor,
        border: s.borderColor,
        shadow: s.boxShadow,
      };
    });
    expect(focus.visible).toBe(true);
    expect(
      focus.outline !== "none" ||
        focus.shadow !== "none" ||
        focus.border !== "rgba(0, 0, 0, 0)",
    ).toBe(true);
    const after = await rail.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    await info.attach("focus-styles", {
      body: JSON.stringify(focus),
      contentType: "application/json",
    });
    await shot("rail-focus");
    await page.getByTestId("open-settings-view").click();
    await expect(
      page.getByRole("heading", { name: "Profile", exact: true }),
    ).toBeVisible();
    await shot("settings");
    await page.getByTestId("quickchat-launcher").click();
    await expect(page.getByTestId("quickchat-input")).toBeFocused();
    await shot("quickchat");
    await page.getByTestId("quickchat-minimize").click();
    await page.getByTestId("settings-back-to-app").click();
    await page.getByTestId("open-artifacts-view").click();
    await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
    await shot("library");
    await page.setViewportSize({ width: 800, height: 700 });
    await page.keyboard.press("Meta+=");
    await shot("narrow-zoom");
  });
}

test("onboarding uses the default baseline", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("buzz-theme", "buzz-dark");
    localStorage.setItem("buzz-follow-system", "false");
  });
  await installMockBridge(
    page,
    {},
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("onboarding.png") });
});
