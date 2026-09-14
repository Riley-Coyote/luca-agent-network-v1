import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const ATLAS = { name: "Atlas", pubkey: "a".repeat(64), status: "running" };
const BEX = { name: "Bex", pubkey: "b".repeat(64), status: "running" };

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, { managedAgents: [ATLAS, BEX] });
  await page.goto("/?e2e=mock&projectDemo=1");
});

test("agent DMs keep the title and remove the header companion", async ({
  page,
}) => {
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(page.getByTestId("chat-title")).toContainText("Atlas");
  await expect(page.getByTestId("resident-header-mote")).toHaveCount(0);

  await page.getByTestId("agent-rail-bex").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(page.getByTestId("chat-title")).toContainText("Bex");
  await expect(page.getByTestId("resident-header-mote")).toHaveCount(0);
});

test("the rail stays glyph-only while Appearance chooses the chat mark", async ({
  page,
}) => {
  const railMark = page
    .getByTestId("agent-rail-atlas")
    .locator("[data-resident-mark-kind]");
  await expect(railMark).toHaveAttribute("data-resident-mark-kind", "glyph");
  await expect(railMark.locator("canvas")).toHaveCount(1);
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const ledge = page.getByTestId("composer-agent-ledge");
  const mark = ledge.getByTestId("chat-agent-mark");
  await expect(mark).toHaveAttribute("data-mark-style", "sphere");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("chat-mark-style-pixel").click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(mark).toHaveAttribute("data-mark-style", "pixel");
  await expect(mark.locator(".agent-character")).toHaveCount(1);
  await expect(railMark).toHaveAttribute("data-resident-mark-kind", "glyph");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("chat-mark-style-glyph").click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(mark).toHaveAttribute("data-mark-style", "glyph");
  await expect(mark.locator("canvas")).toHaveCount(1);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("chat-marks-visible-toggle").click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(ledge).toHaveCount(0);
  await expect(railMark).toHaveAttribute("data-resident-mark-kind", "glyph");
});

test("a visible chat sphere follows the pointer and blinks without hover", async ({
  page,
}) => {
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const mark = page
    .getByTestId("composer-agent-ledge")
    .getByTestId("chat-agent-mark");
  await expect(
    page.locator('[data-testid="message-row"] [data-testid="chat-agent-mark"]'),
  ).toHaveCount(0);
  await expect(mark.locator("img")).toBeVisible();
  await expect(mark.locator("mote-3d")).toHaveAttribute("data-ready", "");
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => {
    const mote = document.querySelector(
      '[data-testid="chat-agent-mark"] mote-3d',
    ) as (HTMLElement & { _units?: { yaw: number }[] }) | null;
    return (mote?._units?.[0]?.yaw ?? 0) < -0.1;
  });
  await page.mouse.move(1200, 600);
  await page.waitForFunction(() => {
    const mote = document.querySelector(
      '[data-testid="chat-agent-mark"] mote-3d',
    ) as (HTMLElement & { _units?: { yaw: number }[] }) | null;
    return (mote?._units?.[0]?.yaw ?? 0) > 0.1;
  });

  await mark.locator("mote-3d").evaluate((element) => {
    const mote = element as HTMLElement & {
      _units?: { blinkAt: number }[];
    };
    if (mote._units?.[0]) mote._units[0].blinkAt = 0;
  });
  await page.waitForFunction(() => {
    const mote = document.querySelector(
      '[data-testid="chat-agent-mark"] mote-3d',
    ) as
      | (HTMLElement & {
          _units?: { eyes: { scale: { y: number } }; expressionEyeY: number }[];
        })
      | null;
    const unit = mote?._units?.[0];
    return unit && unit.eyes.scale.y < unit.expressionEyeY * 0.75;
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(mark.locator("mote-3d")).toHaveCount(0);
});

test("composer focus leaves the flat surface unchanged", async ({ page }) => {
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  const composer = page.getByTestId("message-composer");
  await expect(composer).toHaveCSS("box-shadow", "none");
  await expect(composer).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await page.getByTestId("message-input").click();
  await expect(composer).toHaveCSS("box-shadow", "none");
  await expect(composer).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("message-input")).toBeFocused();
});
