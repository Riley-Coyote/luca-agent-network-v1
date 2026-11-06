import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

test.use({ video: "on", trace: "off" });

const FILE = {
  url: `https://mock.relay/media/${"a".repeat(64)}.pdf`,
  sha256: "a".repeat(64),
  size: 1234,
  type: "application/pdf",
  uploaded: 1_790_000_000,
  filename: "motion-proof.pdf",
};
const IMAGE = {
  ...FILE,
  url: "https://example.com/e2e/motion-proof.svg",
  type: "image/svg+xml",
  filename: "motion-proof.svg",
  dim: "320x200",
};

type ExitProbe = {
  retained: boolean;
  hidden: boolean;
  inert: boolean;
  editorFocused: boolean;
  sendEnabled: boolean;
  sentBeforeExit: boolean;
  sameTrayAfterReadd: boolean;
  transforms: string[];
};

declare global {
  interface Window {
    __COMPOSER_MOTION_PROBE__?: ExitProbe;
  }
}

async function openComposer(
  page: Page,
  images = false,
  twoFiles = false,
  reduced = false,
) {
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  if (images) {
    await page.route(IMAGE.url, (route) =>
      route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#777"/></svg>',
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
      }),
    );
  }
  await installMockBridge(page, {
    uploadDescriptors: images
      ? [IMAGE]
      : twoFiles
        ? [
            FILE,
            {
              ...FILE,
              url: `${FILE.url}?second`,
              sha256: "b".repeat(64),
              filename: "second.pdf",
            },
          ]
        : [FILE],
  });
  await page.addInitScript((key) => {
    const overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...overrides, "shell-frame": true }),
    );
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await page.goto("/?e2e=mock#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  await expect(page.getByTestId("message-input")).toBeVisible();
}

async function attach(page: Page) {
  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Attach files" }).click();
}

function fileItem(page: Page, filename = FILE.filename) {
  return page
    .getByTestId("message-composer")
    .getByText(filename, { exact: true })
    .locator("../..");
}

// Observe the actual production tray commit, not a wall-clock guess about its
// spring duration. Observer actions intentionally happen inside the exit window.
async function watchFinalExit(
  page: Page,
  action: "none" | "send" | "readd" = "none",
) {
  await fileItem(page).evaluate((item, action) => {
    const tray = item.parentElement;
    const editor = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    );
    const send = document.querySelector<HTMLButtonElement>(
      '[data-testid="send-message"]',
    );
    if (!tray || !editor || !send)
      throw new Error("Expected composer controls and attachment tray");
    tray.dataset.motionTestTray = "true";
    const probe: ExitProbe = {
      retained: false,
      hidden: false,
      inert: false,
      editorFocused: false,
      sendEnabled: false,
      sentBeforeExit: false,
      sameTrayAfterReadd: false,
      transforms: [],
    };
    window.__COMPOSER_MOTION_PROBE__ = probe;
    let observed = false;
    const observer = new MutationObserver(() => {
      if (!tray.inert || observed) return;
      observed = true;
      observer.disconnect();
      probe.retained = tray.isConnected && item.isConnected;
      probe.inert = tray.inert;
      probe.hidden = tray.getAttribute("aria-hidden") === "true";
      probe.editorFocused = document.activeElement === editor;
      probe.sendEnabled = !send.disabled;
      if (action === "send") send.click();
      if (action === "readd") {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["replacement"], "motion-proof.pdf", {
            type: "application/pdf",
          }),
        );
        const drop = document.querySelector(
          '[data-testid="channel-drop-zone"]',
        );
        if (!drop) throw new Error("Expected channel drop zone");
        drop.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }),
        );
        drop.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
        );
      }
      let frames = 0;
      const sample = () => {
        if (item.isConnected)
          probe.transforms.push(getComputedStyle(item).transform);
        if (tray.isConnected && tray.inert && editor.textContent === "")
          probe.sentBeforeExit = true;
        if (tray.isConnected && !tray.inert && observed)
          probe.sameTrayAfterReadd = true;
        if (++frames < 90 && tray.isConnected) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.observe(tray, {
      attributes: true,
      attributeFilter: ["inert", "aria-hidden"],
    });
  }, action);
}

async function removeFileWithKeyboard(page: Page) {
  // The add menu restores focus to its tooltip trigger. Dismiss that tooltip
  // before moving onto the chip, otherwise its portal can cover the hover point.
  await page.getByTestId("message-input").focus();
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0, { timeout: 5000 });
  const item = fileItem(page);
  await item.hover({ timeout: 5000 });
  const remove = item.getByRole("button");
  await remove.focus();
  await remove.press("Enter");
}

function expectNoSpatialTransform(transforms: string[]) {
  expect(transforms.length).toBeGreaterThan(0);
  for (const value of transforms) {
    if (value === "none") continue;
    const expected = value.startsWith("matrix3d")
      ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      : [1, 0, 0, 1, 0, 0];
    const values = value
      .slice(value.indexOf("(") + 1, -1)
      .split(",")
      .map(Number);
    expect(values).toHaveLength(expected.length);
    values.forEach((number, index) => {
      expect(number).toBeCloseTo(expected[index], 5);
    });
  }
}

test("final attachment exits in its retained inert tray and returns keyboard focus", async ({
  page,
}) => {
  await openComposer(page);
  await attach(page);
  await expect(fileItem(page)).toBeVisible();
  await watchFinalExit(page);
  await removeFileWithKeyboard(page);
  await expect
    .poll(() => page.evaluate(() => window.__COMPOSER_MOTION_PROBE__?.retained))
    .toBe(true);
  const probe = await page.evaluate(() => window.__COMPOSER_MOTION_PROBE__);
  expect(probe?.inert).toBe(true);
  expect(probe?.hidden).toBe(true);
  expect(probe?.editorFocused).toBe(true);
  await expect(page.getByTestId("message-input")).toBeFocused();
  await expect(page.locator("[data-motion-test-tray]")).toHaveCount(0);
  await expect(fileItem(page)).toHaveCount(0);
});

test("Send executes while final removal is still exiting", async ({ page }) => {
  await openComposer(page);
  await attach(page);
  await expect(fileItem(page)).toBeVisible();
  await page
    .getByTestId("message-input")
    .fill("Send immediately during attachment exit");
  await watchFinalExit(page, "send");
  await removeFileWithKeyboard(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__COMPOSER_MOTION_PROBE__?.sentBeforeExit),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => window.__COMPOSER_MOTION_PROBE__?.sendEnabled),
  ).toBe(true);
  await expect(page.getByTestId("message-input")).toBeEmpty();
  await expect(
    page
      .getByTestId("message-row")
      .getByText("Send immediately during attachment exit", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("message-row")
      .filter({ hasText: "Send immediately during attachment exit" })
      .getByTestId("file-card"),
  ).toHaveCount(0);
});

test("rapid remove and re-add reuses the tray instead of leaving stale exit state", async ({
  page,
}) => {
  await openComposer(page);
  await attach(page);
  await expect(fileItem(page)).toBeVisible();
  await watchFinalExit(page, "readd");
  await removeFileWithKeyboard(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__COMPOSER_MOTION_PROBE__?.sameTrayAfterReadd),
    )
    .toBe(true);
  await expect(fileItem(page)).toHaveCount(1);
  await expect(page.locator("[data-motion-test-tray]")).not.toHaveAttribute(
    "inert",
  );
  await expect(page.getByTestId("send-message")).toBeEnabled();
});

test("reduced motion removes attachment exit scaling and sibling layout travel", async ({
  page,
}) => {
  await openComposer(page, false, true, true);
  await attach(page);
  await expect(fileItem(page, "second.pdf")).toBeVisible();
  const sibling = fileItem(page, "second.pdf");
  const before = await sibling.boundingBox();
  await removeFileWithKeyboard(page);
  const samples = await sibling.evaluate(async (item) => {
    const samples: string[] = [];
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      samples.push(getComputedStyle(item).transform);
    }
    return samples;
  });
  expectNoSpatialTransform(samples);
  const after = await sibling.boundingBox();
  if (!before || !after)
    throw new Error("Expected visible sibling layout boxes");
  expect(after.x).toBeLessThan(before.x);
  // Attach one fresh item, then capture its full final removal independently.
  await sibling.hover();
  await sibling.getByRole("button").click();
  await expect(sibling).toHaveCount(0);
  await page.evaluate((descriptor) => {
    window.__BUZZ_E2E__ = {
      ...window.__BUZZ_E2E__,
      mock: { ...window.__BUZZ_E2E__?.mock, uploadDescriptors: [descriptor] },
    };
  }, FILE);
  await attach(page);
  await expect(fileItem(page)).toBeVisible();
  await watchFinalExit(page);
  await removeFileWithKeyboard(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__COMPOSER_MOTION_PROBE__?.transforms.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  expectNoSpatialTransform(
    await page.evaluate(
      () => window.__COMPOSER_MOTION_PROBE__?.transforms ?? [],
    ),
  );
  await expect(page.locator("[data-motion-test-tray]")).toHaveCount(0);
});

test("reduced-motion tooltips and annotation toolbar retain fade without spatial entry", async ({
  page,
}) => {
  await openComposer(page, true, false, true);
  await attach(page);
  const image = page
    .getByTestId("message-composer")
    .getByAltText("Attachment aaaa");
  await expect(image).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0, { timeout: 5000 });
  await image.locator("../../..").hover();
  const remove = image.locator("../../..").getByRole("button").last();
  await remove.hover();
  // Radix's named accessibility span lives inside the animated popper content.
  const tooltip = page
    .getByRole("tooltip", { name: "Remove attachment", exact: true })
    .locator("..");
  await expect(tooltip).toBeVisible();
  const tooltipMotion = await tooltip.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      scale: style.getPropertyValue("--tw-enter-scale").trim(),
      x: style.getPropertyValue("--tw-enter-translate-x").trim(),
      y: style.getPropertyValue("--tw-enter-translate-y").trim(),
      animation: style.animationName,
    };
  });
  expect(["", "1"]).toContain(tooltipMotion.scale);
  expect(["", "0", "0px"]).toContain(tooltipMotion.x);
  expect(["", "0", "0px"]).toContain(tooltipMotion.y);
  expect(tooltipMotion.animation).toContain("enter");
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0, { timeout: 5000 });
  await image.click();
  await page.getByTestId("composer-attachment-edit").click();
  const toolbar = page.getByTestId("composer-image-editor-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarMotion = await toolbar.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      x: style.getPropertyValue("--tw-enter-translate-x").trim(),
      animation: style.animationName,
      transform: style.transform,
    };
  });
  expect(["", "0", "0px"]).toContain(toolbarMotion.x);
  expect(toolbarMotion.animation).toContain("enter");
  expectNoSpatialTransform([toolbarMotion.transform]);
  await page.getByRole("button", { name: "Blue pen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Blue pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
});
