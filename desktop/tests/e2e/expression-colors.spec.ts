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

const STUDY = [
  "**Expression study** — preview text, not a live resident message.",
  "[A thought moving through several possibilities.](color:#ff7040~#ff3f9f~#955cff~#22cfff)",
  "[one quiet possibility\nanother, beside it\na sense of depth\nsomething taking shape](color:#28cfff~#aa5cff~#ff509e?axis=lines&tracking=0.025)",
  "[not quite one color](color:hsl(290,95%,65%)~hsl(190,95%,60%)?axis=letters&weight=550)",
  "[a small current through the words](color:#ff559e~#846aff~#32cfff?motion=wave)",
  "[∘ · ⋅ · ∘](color:#b575ff~#51dfff?motion=breathe&tracking=0.12)   [room to unfold](color:#ffab55?motion=drift&tracking=0.06)",
].join("\n\n");

for (const theme of ["dark", "light"]) {
  test(`precise paint, rows and motion in ${theme}`, async ({ page }) => {
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
      ({ content, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "engineering",
          content,
          pubkey,
        }),
      { content: STUDY, pubkey: TEST_IDENTITIES.alice.pubkey },
    );
    await page.getByRole("button", { name: "Show more", exact: true }).click();
    const gradient = page.locator("[data-expression-gradient]").first();
    await expect(gradient).toHaveCSS("background-image", /linear-gradient/);
    const glyph = page.locator("[data-expression-glyph]").first();
    await expect(glyph).toHaveCSS("animation-name", "expression-drift");
    // Demonstrate movement through computed positions, not a static screenshot.
    const first = await glyph.evaluate((el) => getComputedStyle(el).top);
    await expect
      .poll(() => glyph.evaluate((el) => getComputedStyle(el).top))
      .not.toBe(first);
    await waitForAnimations(page);
    await expect(glyph).toHaveCSS("top", "0px");
    await page.screenshot({
      path: `test-results/expression-study-${theme}.png`,
    });
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.getByText("room to unfold")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/expression-study-${theme}-narrow.png`,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(glyph).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(gradient).toHaveCSS("background-image", "none");
    await expect(gradient).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  });
}
