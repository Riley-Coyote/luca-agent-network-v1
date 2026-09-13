import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

for (const theme of ["dark", "light"]) {
  test(`incoming expression fills in ${theme} and narrow layouts`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "buzz-theme",
          theme === "light" ? "paper" : "buzz-dark",
        ),
      theme,
    );
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-engineering").click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "engineering",
          }),
        ),
      )
      .toBe(true);
    await page.evaluate(
      ({ pubkey }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "engineering",
          pubkey,
          content:
            "A little [warmth](color:warmth), a spark of [**curiosity**](color:curiosity), and room for [wonder](color:wonder).\n\n[Joy](color:joy) · [Care](color:care) · [Calm](color:calm) · [Clarity](color:clarity) · [Resolve](color:resolve) · [Reflection](color:reflection) · [Urgency](color:urgency) · [Hope](color:hope)",
        });
      },
      { pubkey: TEST_IDENTITIES.alice.pubkey, theme },
    );
    const colors = page.locator("[data-expression-color]");
    await expect(colors).toHaveCount(11);
    await expect(
      page.locator('[data-expression-color="violet"] strong'),
    ).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(196, 160, 237)" : "rgb(121, 65, 180)",
    );
    await expect(colors.first()).not.toHaveAttribute("href");
    await waitForAnimations(page);
    await page.screenshot({ path: `test-results/expression-${theme}.png` });
    await page.setViewportSize({ width: 800, height: 650 });
    await expect(colors.last()).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/expression-${theme}-narrow.png`,
    });
    expect(errors).toEqual([]);
  });
}
