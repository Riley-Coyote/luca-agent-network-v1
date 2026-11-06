import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

async function openConnections(page: Page) {
  await page.goto("/?e2e=mock#/settings");
  await page.getByTestId("settings-nav-connections").click();
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript((featureKey) => {
    localStorage.setItem(featureKey, JSON.stringify({ "shell-frame": true }));
  }, FEATURE_OVERRIDES_STORAGE_KEY);
});

test("one masked entry connects, clears the field, and offers an explicit return to login", async ({
  page,
}) => {
  await openConnections(page);
  const panel = page.getByTestId("claude-api-connection");
  const input = panel.getByLabel("Anthropic API key");
  await expect(input).toHaveAttribute("type", "password");
  await expect(
    panel.getByRole("button", { name: "Connect", exact: true }),
  ).toBeDisabled();
  await input.fill("test-only-placeholder");
  await input.press("Enter");
  await expect(
    panel.getByText("API billing connected", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(panel.getByRole("status")).toContainText(
    "busy agents switch after their work finishes",
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-only-placeholder",
  );
  await panel.getByRole("button", { name: "Use Claude login" }).click();
  await expect(
    panel.getByText("Using Claude login", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
});

test("an invalid replacement does not claim success or leave the key in the form", async ({
  page,
}) => {
  await openConnections(page);
  const panel = page.getByTestId("claude-api-connection");
  await expect(panel.getByLabel("Anthropic API key")).toBeEnabled();
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke.bind(internals);
    internals.invoke = async (cmd, args) => {
      if (cmd === "connect_claude_api_key")
        throw "Anthropic didn’t accept that key. Check it and try again.";
      return original(cmd, args);
    };
  });
  await panel.getByLabel("Anthropic API key").fill("test-only-invalid");
  await panel.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "didn’t accept that key",
  );
  await expect(
    panel.getByText("Using Claude login", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Anthropic API key")).toHaveValue("");
  await expect(panel.getByRole("status")).toHaveCount(0);
});

for (const mode of ["dark", "light"] as const) {
  for (const width of [1440, 1280, 1024, 390]) {
    test(`API connection stays usable at ${width} in ${mode}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.addInitScript(
        (theme) => localStorage.setItem("buzz-theme", theme),
        mode === "dark" ? "vitesse-black" : "paper",
      );
      await openConnections(page);
      await page.setViewportSize({ width, height: 900 });
      const panel = page.getByTestId("claude-api-connection");
      await expect(panel.getByLabel("Anthropic API key")).toBeEnabled();
      await panel.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
        width + 1,
      );
      await page.screenshot({
        path: info.outputPath(`api-${mode}-${width}.png`),
      });
      await panel.getByLabel("Anthropic API key").focus();
      await expect(panel.getByLabel("Anthropic API key")).toBeFocused();
    });
  }
}
