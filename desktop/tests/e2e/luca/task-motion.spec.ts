import { expect, test, type Page } from "@playwright/test";
import {
  MOTION_TASK,
  openMotionShell,
  openMotionTask,
} from "../../helpers/motionShell";

test.use({ video: "on", trace: "off" });

const pane = (page: Page) => page.getByTestId("task-chat-pane");
const reopen = (page: Page) =>
  page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent("polyphonic:open-task-chat", { detail: id }),
    );
  }, MOTION_TASK);

for (const theme of ["dark", "light"]) {
  test(`task reversals preserve the transcript, draft and execution: ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMotionShell(page, theme);
    const trigger = page.getByRole("button", {
      name: "Open conversation details",
      exact: true,
    });
    await trigger.focus();
    await openMotionTask(page);
    await pane(page).getByTestId("message-input").fill("Unsent task draft");
    // Close and reverse in the same rendering turn, before the retained pane
    // has unmounted. The node identity and draft must survive the reversal.
    const identity = await pane(page).evaluate((element) => {
      element.setAttribute("data-motion-identity", "retained");
      element
        .querySelector<HTMLButtonElement>(
          '[aria-label="Close task conversation"]',
        )
        ?.click();
      return element.getAttribute("data-motion-identity");
    });
    await expect(pane(page)).toHaveAttribute("inert", "");
    await reopen(page);
    await expect(pane(page)).toHaveAttribute(
      "data-motion-identity",
      identity ?? "",
    );
    await expect(pane(page)).toHaveAttribute("data-panel-open", "true");
    await expect(pane(page).getByTestId("message-input")).toHaveText(
      "Unsent task draft",
    );
    await pane(page)
      .getByRole("button", { name: "Close task conversation" })
      .click();
    await expect(trigger).toBeFocused();
    await expect(pane(page)).toHaveCount(0);
    const mutations = await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(({ command }) =>
        /^(?:send_agent_inbox|resolve_exchange|stop_|cancel_|open_chat_view)/.test(
          command,
        ),
      ),
    );
    expect(mutations).toEqual([]);
    await reopen(page);
    await expect(pane(page).getByTestId("message-input")).toHaveText(
      "Unsent task draft",
    );
  });

  test(`inspector opened under a task returns interactive: ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMotionShell(page, theme);
    await openMotionTask(page);
    await page
      .getByRole("button", { name: "Open conversation details", exact: true })
      .click();
    const inspector = page.locator("[data-luca-inspector]");
    await expect(inspector).toHaveAttribute("data-panel-open", "true");
    await expect(inspector).toHaveAttribute("inert", "");
    await expect(inspector).toHaveAttribute("aria-hidden", "true");
    await expect(inspector).toHaveCSS("visibility", "hidden");
    await pane(page)
      .getByRole("button", { name: "Close task conversation" })
      .click();
    await expect(pane(page)).toHaveCount(0);
    await expect(inspector).not.toHaveAttribute("inert");
    await expect(inspector).not.toHaveAttribute("aria-hidden", "true");
    await expect(inspector).toHaveCSS("visibility", "visible");
    await inspector
      .getByRole("button", { name: "Close panel", exact: true })
      .click();
    await expect(inspector).toHaveCount(0);
  });

  test(`task motion renders cleanly at desktop sizes and text zoom: ${theme}`, async ({
    page,
  }, info) => {
    await openMotionShell(page, theme);
    await openMotionTask(page);
    for (const width of [1440, 1280, 1024, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(pane(page).getByTestId("message-input")).toBeEditable();
      await page.waitForTimeout(600);
      expect(
        await pane(page).evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`task-${theme}-${width}.png`),
      });
    }
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "20px"),
    );
    await pane(page)
      .getByTestId("message-input")
      .fill("Larger text stays editable");
    await page.screenshot({ path: info.outputPath(`task-${theme}-zoom.png`) });
  });
}

test("reduced-motion task has no spatial transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMotionShell(page);
  await openMotionTask(page);
  await expect(pane(page)).toHaveCSS("transition-duration", "0s");
  await pane(page)
    .getByRole("button", { name: "Close task conversation" })
    .click();
  await expect(pane(page)).toHaveCount(0);
});
