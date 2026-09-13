import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

test("Escape cancels a Canvas opening before native seating completes", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock#/artifacts");
  await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
  await page.evaluate(() => {
    const host = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => Promise<unknown> };
      releaseCanvasSeat: () => void;
      canvasSeats: boolean[];
    };
    const invoke = host.__TAURI_INTERNALS__.invoke;
    host.canvasSeats = [];
    host.__TAURI_INTERNALS__.invoke = async (...args) => {
      if (args[0] === "set_artifact_canvas_window_open") {
        const open = (args[1] as { open: boolean }).open;
        host.canvasSeats.push(open);
        if (open)
          await new Promise<void>((resolve) => {
            host.releaseCanvasSeat = resolve;
          });
      }
      return invoke(...args);
    };
  });
  const origin = page
    .locator(".artifact-library-row__main")
    .filter({ hasText: "threshold-study.html" });
  await origin.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { canvasSeats: boolean[] }).canvasSeats,
      ),
    )
    .toEqual([true]);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { canvasSeats: boolean[] }).canvasSeats,
      ),
    )
    .toEqual([true, false]);
  await page.evaluate(() =>
    (
      window as unknown as { releaseCanvasSeat: () => void }
    ).releaseCanvasSeat(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { canvasSeats: boolean[] }).canvasSeats,
      ),
    )
    .toEqual([true, false, false]);
  await expect(page.getByTestId("artifact-canvas")).toHaveCount(0);
  await expect(origin).toBeFocused();
});

for (const theme of ["buzz-dark", "paper", "obsidian"]) {
  test(`Notebook introduction and return in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.addInitScript((value) => {
      localStorage.setItem("buzz-theme", value);
      localStorage.setItem("buzz-follow-system", "false");
    }, theme);
    const resident = "a".repeat(64);
    await installMockBridge(page, {
      managedAgents: [
        {
          name: "Anima",
          pubkey: resident,
          agentCommand: "claude",
          status: "running",
        },
      ],
    });
    // installMockBridge already supplies the fixture. Match the native app's
    // hash-only URL so document query flags cannot contaminate route search.
    await page.goto("/#/agents");
    await page.getByTestId(`agent-library-row-${resident}`).click();
    await page
      .getByRole("navigation", { name: "Agent workspace" })
      .getByRole("button", { name: "Notebook", exact: true })
      .click();
    await expect(
      page.getByTestId("resident-notebook-growth-field"),
    ).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({ path: info.outputPath("notebook-wide.png") });
    await page.getByRole("tab", { name: /Journal Pages/ }).click();
    await page.reload();
    await expect(
      page.getByTestId(`agent-library-row-${resident}`),
    ).toBeVisible();
    await page.getByTestId(`agent-library-row-${resident}`).click();
    await expect(
      page.getByRole("tab", { name: /Journal Pages/ }),
    ).toHaveAttribute("aria-selected", "true");
    await page.setViewportSize({ width: 780, height: 720 });
    await page.keyboard.press("Meta+=");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await waitForAnimations(page);
    await page.screenshot({
      path: info.outputPath("notebook-narrow-zoom.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const notes = page.getByRole("tab", { name: /Continuity Notes/ });
    await notes.focus();
    await page.keyboard.press("Enter");
    await expect(notes).toHaveAttribute("aria-selected", "true");
    if (theme === "buzz-dark") {
      const item = page.locator("[data-notebook-list-anchor]").first();
      const itemId = await item.getAttribute("data-notebook-list-anchor");
      await item.click();
      await expect(page.getByTestId("resident-notebook-detail")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("resident-notebook-detail")).toBeVisible();
      await page.getByRole("button", { name: "Back to notebook" }).click();
      await expect(
        page.locator(`[data-notebook-list-anchor="${itemId}"]`),
      ).toBeFocused();
    }
  });
}
