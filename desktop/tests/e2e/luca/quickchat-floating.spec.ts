import { expect, test } from "@playwright/test";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { waitForAnimations } from "../../helpers/animations";

test.use({ viewport: { width: 1372, height: 835 } });
test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(
    ({ key, theme }) => {
      localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
      localStorage.setItem("buzz-theme", theme);
      localStorage.setItem("buzz-follow-system", "false");
      // A cached native announcement must never hide the approved web controls.
      Object.assign(window, { __POLYPHONIC_NATIVE_QUICKCHAT__: 1 });
    },
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      theme: testInfo.title.includes("day preview") ? "paper" : "obsidian",
    },
  );
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
  await waitForAnimations(page);
});

for (const dark of [true, false]) {
  test(`bare controls and rounded edge blur match the approved ${dark ? "night" : "day"} preview`, async ({
    page,
  }, testInfo) => {
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.setAttribute("data-luca-frame-glass", "");
    }, dark);
    const panel = page.getByTestId("quickchat-panel");
    await expect(panel).not.toHaveAttribute("data-native-quickchat");
    await expect(page.locator(".qc-header")).toHaveCSS("height", "18px");
    await expect(page.locator(".qc-title")).toHaveCount(0);
    const controls = page.locator(".qc-actions button");
    await expect(controls).toHaveCount(3);
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS("width", "24px");
      await expect(control).toHaveCSS("height", "24px");
      await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(control).toHaveCSS("backdrop-filter", "none");
      await expect(control).toHaveCSS("box-shadow", "none");
      await expect(control.locator("svg")).toHaveAttribute("width", "12");
      await control.hover();
      await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await control.focus();
      await control.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
      await expect(control).toHaveCSS("outline-style", "solid");
    }
    const edges = await page.locator(".qc-scroll").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const panel = el.closest(".qc-panel")?.getBoundingClientRect();
      if (!panel) throw new Error("Missing mini-chat panel");
      return {
        top: box.top - panel.top,
        bottom: panel.bottom - box.bottom,
        before: [
          "backdropFilter",
          "borderTopLeftRadius",
          "borderBottomLeftRadius",
          "backgroundColor",
        ].map((key) =>
          getComputedStyle(el, "::before").getPropertyValue(
            key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
          ),
        ),
        after: [
          getComputedStyle(el, "::after").borderBottomRightRadius,
          getComputedStyle(el, "::after").borderTopRightRadius,
        ],
      };
    });
    expect(Math.abs(edges.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.bottom)).toBeLessThanOrEqual(1);
    expect(edges.before).toEqual([
      "blur(10px)",
      "16px",
      "0px",
      "rgba(0, 0, 0, 0)",
    ]);
    expect(edges.after).toEqual(["16px", "0px"]);
    await expect(page.locator(".qc-composer")).toHaveCSS(
      "border-radius",
      "18px",
    );
    await expect(page.locator(".qc-composer")).toHaveCSS("box-shadow", "none");
    const input = page.getByTestId("quickchat-input");
    await input.fill(
      "A local preview message to check the soft scroll edges and floating controls. ".repeat(
        20,
      ),
    );
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await waitForAnimations(page);
    await page.locator(".qc-transcript").evaluate((el) => {
      el.scrollTop = 80;
      el.dispatchEvent(new Event("scroll"));
    });
    await input.fill("Preview check — not sent");
    await panel.screenshot({ path: testInfo.outputPath("mini-chat.png") });
  });
}

test("plus keeps context and attachments; minimize and close preserve the draft", async ({
  page,
}, testInfo) => {
  const input = page.getByTestId("quickchat-input");
  await input.fill("A retained draft\nwith a second line");
  await expect(page.locator(".qc-composer")).toHaveAttribute(
    "data-composer-open",
    "",
  );
  await page
    .getByRole("button", { name: "Attachments and app context", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Attach image", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Attach current view", exact: true }),
  ).toBeVisible();
  const choices = page.getByRole("dialog", { name: "Add to message" });
  await expect(
    choices.getByRole("button", { name: "Attach image" }),
  ).toBeFocused();
  const box = await choices.boundingBox();
  expect(box?.height).toBeLessThan(140);
  expect(box?.width).toBeLessThanOrEqual(240);
  await choices.getByRole("button", { name: "Attach image" }).press("Tab");
  await expect(
    choices.getByRole("button", { name: "Attach current view" }),
  ).toBeFocused();
  await choices
    .getByRole("button", { name: "Attach current view" })
    .press("Tab");
  await expect(
    choices.getByRole("checkbox", { name: "Include app context" }),
  ).toBeFocused();
  await page
    .getByTestId("quickchat-panel")
    .screenshot({ path: testInfo.outputPath("compact-add-menu.png") });
  await page.keyboard.press("Escape");
  for (const name of ["Minimize Quick Chat", "Close Quick Chat"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByTestId("quickchat-launcher")).toBeFocused();
    await page.getByTestId("quickchat-launcher").click();
    await expect(input).toHaveValue("A retained draft\nwith a second line");
  }
});

test("increased contrast retains a solid well without adding button discs", async ({
  page,
}) => {
  await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
  await expect(page.locator(".qc-composer")).toHaveCSS(
    "background-color",
    "rgb(36, 36, 38)",
  );
  await expect(page.locator(".qc-composer")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  await expect(page.locator(".qc-actions button").first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  expect(
    await page
      .locator(".qc-scroll")
      .evaluate((el) => getComputedStyle(el, "::before").display),
  ).toBe("none");
});
