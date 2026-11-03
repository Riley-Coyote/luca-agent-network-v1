import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

for (const mode of ["dark", "light"] as const) {
  test(`${mode}: mini chat uses the shared reading rhythm`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      ({ key, mode }) => {
        localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
        localStorage.setItem(
          "buzz-theme",
          mode === "dark" ? "vitesse-black" : "paper",
        );
        localStorage.setItem("buzz-follow-system", "false");
      },
      { key: FEATURE_OVERRIDES_STORAGE_KEY, mode },
    );
    const resident = "a".repeat(64);
    await installMockBridge(page, {
      managedAgents: [
        {
          name: "Luca",
          personaId: "builtin:fizz",
          pubkey: resident,
          status: "running",
        },
      ],
    });
    await page.goto("/");
    await page.getByTestId("quickchat-launcher").click();
    await page.getByTestId("quickchat-input").fill("Review the result");
    await page.getByTestId("quickchat-send").click();
    await expect(page.getByTestId("quickchat-input")).toHaveValue("");
    const channelId = await page.evaluate((resident) => {
      const value = Object.entries(localStorage).find(([key]) =>
        key.startsWith("luca:quickchat:v1:"),
      )?.[1];
      const state = JSON.parse(value ?? "{}");
      return (state.companionRooms[resident] ?? state.rooms[resident])
        .channelId as string;
    }, resident);
    await page.evaluate(
      ({ channelId, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelId,
          pubkey,
          content:
            "The result is ready.\n\n## Two useful details\n\n- **Reading first:** the reply stays readable.\n- A second point with `inline code`.\n\n1. Review the result.\n\n   Supporting detail stays in its own paragraph.\n\n2. Continue when ready.\n\n```js\nconst ready = true;\n```",
        }),
      { channelId, pubkey: resident },
    );
    const prose = page
      .locator(".qc-prose")
      .filter({ hasText: "Two useful details" });
    await expect(prose).toBeVisible();
    expect(
      await prose
        .locator("li code")
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    await expect(prose.locator("ol > li").first().locator("p")).toHaveCount(2);
    expect(
      await prose.evaluate(
        (el) =>
          Number.parseFloat(getComputedStyle(el).lineHeight) /
          Number.parseFloat(getComputedStyle(el).fontSize),
      ),
    ).toBeCloseTo(1.6, 1);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await prose.locator("h2").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`mini-${mode}-${width}.png`),
        animations: "disabled",
      });
      expect(
        await prose.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
  });
}
