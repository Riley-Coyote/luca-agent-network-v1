import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { waitForAnimations } from "../../helpers/animations";

test.use({ viewport: { width: 1372, height: 835 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: "a".repeat(64),
        status: "running",
      },
    ],
  });
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  await expect(page.getByTestId("message-composer")).toBeVisible();
  await waitForAnimations(page);
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-input")).toBeFocused();
});

test("IME Enter and Escape cannot send or dismiss; ordinary keys still work", async ({
  page,
}) => {
  const field = page.getByTestId("quickchat-input");
  await field.fill("日本語");
  await field.dispatchEvent("compositionstart");
  // These keys belong to the input method, not textarea default insertion.
  await field.dispatchEvent("keydown", { key: "Enter", bubbles: true });
  await field.dispatchEvent("keydown", { key: "Escape", bubbles: true });
  await expect(field).toHaveValue("日本語");
  await field.dispatchEvent("compositionend");
  for (const key of ["Enter", "Escape"]) {
    await field.dispatchEvent("keydown", { key, keyCode: 229, bubbles: true });
    await field.dispatchEvent("keydown", {
      key,
      isComposing: true,
      bubbles: true,
    });
  }
  await expect(field).toHaveValue("日本語");
  await field.press("Shift+Enter");
  await expect(field).toHaveValue("日本語\n");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("quickchat-panel")).toContainText("日本語");
});

test("menus dismiss before the panel and each close path restores the launcher", async ({
  page,
}) => {
  const launcher = page.getByTestId("quickchat-launcher");
  const options = page.getByRole("button", {
    name: "Quick Chat options",
    exact: true,
  });
  await options.click();
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();
  await expect(page.locator(".qc-menu")).toHaveCount(0);
  await options.click();
  await page.getByTestId("quickchat-input").click();
  await expect(page.locator(".qc-menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(launcher).toBeFocused();
  for (const name of ["Minimize Quick Chat", "Close Quick Chat"]) {
    await launcher.click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(launcher).toBeFocused();
  }
});

test("Lens has unmasked nested backdrops and a solid fallback", async ({
  page,
}) => {
  // Browser structural simulation only; native captures prove actual frost.
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-luca-frame-glass", ""),
  );
  await expect(page.locator(".qc-glass-lens")).toHaveCount(3);
  await expect(page.locator(".qc-glass")).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".qc-glass")).toHaveCSS("mask-image", "none");
  await expect
    .poll(() =>
      page
        .locator(".qc-glass")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--qc-glass-r"),
        ),
    )
    .toBe("16px");
  await expect(page.locator(".qc-header")).toHaveCSS("height", "18px");
  await expect(page.locator(".qc-resize").first()).toHaveAttribute(
    "tabindex",
    "-1",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("quickchat-input").fill("one\ntwo");
  await expect(page.locator(".qc-composer")).toHaveAttribute(
    "data-composer-open",
    "",
  );
  await expect
    .poll(() =>
      page
        .locator(".qc-composer")
        .evaluate(
          (el) =>
            el.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  await page.evaluate(() =>
    document.documentElement.removeAttribute("data-luca-frame-glass"),
  );
  await expect(page.locator(".qc-glass")).toHaveCount(0);
  await expect(page.getByTestId("quickchat-panel")).toHaveCSS(
    "background-color",
    "rgb(14, 14, 15)",
  );
});

test("a reader stays put while content grows, then newest resumes following", async ({
  page,
}) => {
  const field = page.getByTestId("quickchat-input");
  await field.fill("A long message for scroll verification. ".repeat(70));
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const transcript = page.locator(".qc-transcript");
  await waitForAnimations(page);
  await transcript.focus();
  await transcript.press("ControlOrMeta+Home");
  await transcript.evaluate((el) => {
    el.scrollTop = 60;
    el.dispatchEvent(new Event("scroll"));
  });
  const arrow = page.getByRole("button", {
    name: "Newest message",
    exact: true,
  });
  await expect(arrow).toBeVisible();
  await expect
    .poll(() =>
      transcript.evaluate((el) => el.style.getPropertyValue("--qc-edge-top")),
    )
    .toBe("1");
  await expect
    .poll(() =>
      transcript.evaluate((el) =>
        el.style.getPropertyValue("--qc-edge-bottom"),
      ),
    )
    .toBe("1");
  // Simulate streamed layout growth, not a new user action that asks to send.
  await page.locator(".qc-messages").evaluate((el) => {
    const p = document.createElement("p");
    p.style.height = "200px";
    el.append(p);
  });
  await expect.poll(() => transcript.evaluate((el) => el.scrollTop)).toBe(60);
  await arrow.click();
  await expect(arrow).toHaveCount(0);
  await page.locator(".qc-messages").evaluate((el) => {
    const p = document.createElement("p");
    p.style.height = "200px";
    el.append(p);
  });
  await expect
    .poll(() =>
      transcript.evaluate((el) =>
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(2);
});
