import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

for (const scale of [1, 2]) {
  test.describe(`DPR ${scale}`, () => {
    test.use({ deviceScaleFactor: scale });
    for (const theme of ["dark", "light"] as const) {
      for (const width of [1440, 1280, 1024, 390]) {
        test(`starter examples ${theme} ${width}: readable, keyboard reachable and copy only`, async ({
          page,
          context,
        }) => {
          await context.grantPermissions(["clipboard-read", "clipboard-write"]);
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          await page.emulateMedia({
            colorScheme: theme,
            reducedMotion: "reduce",
          });
          await page.addInitScript((theme) => {
            localStorage.setItem(
              "buzz-theme",
              theme === "light" ? "paper" : "vitesse-black",
            );
            localStorage.setItem("buzz-follow-system", "false");
          }, theme);
          await installMockBridge(page);
          await page.goto(width === 390 ? "/#/agents" : "/", {
            waitUntil: "domcontentloaded",
          });
          if (width !== 390) await page.getByTestId("open-agents-view").click();
          await page
            .getByRole("button", { name: "Add agent", exact: true })
            .first()
            .click();
          await page.getByTestId("open-starter-agent-catalog").click();
          const dialog = page.getByTestId("persona-catalog-dialog");
          await page
            .getByTestId("persona-catalog-list-item-builtin:mira")
            .click();
          await expect(
            dialog.getByText("Research & evidence", { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByText("Compare my options", { exact: true }),
          ).toBeVisible();
          const copy = dialog.getByRole("button", {
            name: "Copy prompt: Compare my options",
          });
          await copy.focus();
          await expect(copy).toBeFocused();
          await copy.press("Enter");
          await expect(
            page.getByText("Prompt copied. Send it when you’re ready.", {
              exact: true,
            }),
          ).toBeVisible();
          // Copy must leave the specialist unselected: no creation or model work.
          await expect(
            page.getByTestId("persona-catalog-use-agent-target-builtin:mira"),
          ).toBeEnabled();
          await page
            .getByTestId("persona-catalog-list-item-builtin:coda")
            .click();
          await expect(
            dialog.getByText("Writing & editing", { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByText("Make this sound like me", { exact: true }),
          ).toBeVisible();
          const instructions = dialog.locator("details");
          await expect(instructions).not.toHaveAttribute("open", "");
          await instructions.locator("summary").focus();
          await page.keyboard.press("Enter");
          await expect(instructions).toHaveAttribute("open", "");
          await instructions.locator("summary").click();
          await expect(dialog).toBeInViewport();
          const overflows = await dialog.evaluate(
            (el) => el.scrollWidth > el.clientWidth + 1,
          );
          expect(overflows).toBe(false);
          await waitForAnimations(page);
          await page.screenshot({
            path: `test-results/starter-specialists/${theme}-${width}-${scale}x.png`,
          });
        });
      }
    }
  });
}
