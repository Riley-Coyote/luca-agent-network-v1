import { expect, type Locator, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { waitForAnimations } from "../../helpers/animations";

test.use({ viewport: { width: 1372, height: 835 }, deviceScaleFactor: 2 });

async function measure(composer: Locator) {
  return composer.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const send = element.querySelector(
      '[data-testid="send-message"], .qc-send',
    );
    const add = element.querySelector(
      '[data-testid="message-composer-add"], .qc-add',
    );
    const field = element.querySelector(
      '[data-testid="message-input-scroll"], textarea',
    );
    if (!send || !add || !field) throw new Error("Missing composer controls");
    const fieldBox = field.getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.backgroundColor = "hsl(var(--mn-raised))";
    element.append(probe);
    const raised = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      height: box.height,
      radius: style.borderRadius,
      padding: style.padding,
      fill: style.backgroundColor,
      shadow: style.boxShadow,
      border: style.borderTopColor,
      raised,
      surface: style.getPropertyValue("--mn-surface"),
      sendBottom: box.bottom - send.getBoundingClientRect().bottom,
      addBottom: box.bottom - add.getBoundingClientRect().bottom,
      fieldLeft: fieldBox.left - box.left,
      fieldRight: box.right - fieldBox.right,
      fieldBottom: fieldBox.bottom,
      addTop: add.getBoundingClientRect().top,
    };
  });
}

for (const theme of ["obsidian", "paper"]) {
  for (const surface of ["chat", "new-chat", "mini-chat"] as const) {
    test(`${theme}: ${surface} keeps the preview capsule and anchored expanded row`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ key, theme }) => {
          localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
          localStorage.setItem("buzz-theme", theme);
          localStorage.setItem("buzz-follow-system", "false");
        },
        { key: FEATURE_OVERRIDES_STORAGE_KEY, theme },
      );
      await installMockBridge(page, {
        managedAgents: [
          {
            name: "Luca",
            personaId: "builtin:fizz",
            pubkey: "a".repeat(64),
            status: "running",
            channelNames: ["general"],
          },
          { name: "Sol", pubkey: "b".repeat(64), status: "running" },
        ],
      });
      await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
      await expect(page.getByTestId("message-composer")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-luca-frame");
      if (surface === "new-chat") {
        await page.keyboard.press("Meta+n");
        await expect(page.getByTestId("new-message-body")).toBeVisible();
        await page
          .getByRole("combobox", { name: "To", exact: true })
          .fill("Sol");
        await page.getByRole("option", { name: /Sol/ }).click();
      } else if (surface === "mini-chat") {
        await page.getByTestId("quickchat-launcher").click();
      }
      const mini = surface === "mini-chat";
      const composer = mini
        ? page.locator(".qc-composer")
        : page.getByTestId("message-composer");
      const input = page.getByTestId(
        mini ? "quickchat-input" : "message-input",
      );
      await expect(composer).toBeVisible();
      await expect
        .poll(async () => (await measure(composer)).height)
        .toBe(mini ? 36 : 46);
      const idle = await measure(composer);
      expect(idle).toMatchObject({
        radius: mini ? "18px 18px 8px 8px" : "23px",
        padding: mini ? "3px 3px 3px 4px" : "5px 5px 5px 6px",
        shadow: "none",
      });
      if (!mini) expect(idle.fill).toBe(idle.raised);
      else {
        await expect(page.getByTestId("quickchat-send")).toBeDisabled();
        await expect(page.getByTestId("quickchat-send")).toHaveCSS(
          "opacity",
          "1",
        );
      }
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath("idle.png"),
        animations: "disabled",
      });
      await input.click();
      const focused = await measure(composer);
      if (!mini) expect(focused.fill).toBe(idle.fill);
      expect(focused.shadow).toBe("none");
      await input.fill(
        "A longer draft that opens the full-width writing area while keeping both controls in their bottom row. ".repeat(
          4,
        ),
      );
      await expect(composer).toHaveAttribute("data-composer-open", "");
      await waitForAnimations(page);
      const expanded = await measure(composer);
      expect(expanded.height).toBeGreaterThan(46);
      expect(expanded.sendBottom).toBeCloseTo(idle.sendBottom, 0);
      expect(expanded.addBottom).toBeCloseTo(idle.addBottom, 0);
      expect(expanded.fieldLeft).toBeLessThan(9);
      expect(expanded.fieldRight).toBeLessThan(9);
      expect(expanded.fieldBottom).toBeLessThanOrEqual(expanded.addTop);
      await page.screenshot({
        path: testInfo.outputPath("expanded.png"),
        animations: "disabled",
      });
      await input.press("ControlOrMeta+a");
      await input.press("Backspace");
      await expect(composer).not.toHaveAttribute("data-composer-open", "");
      await expect
        .poll(async () => (await measure(composer)).height)
        .toBe(mini ? 36 : 46);
      await testInfo.attach("composer-measurements", {
        body: JSON.stringify({ idle, focused, expanded }, null, 2),
        contentType: "application/json",
      });
    });
  }
}
