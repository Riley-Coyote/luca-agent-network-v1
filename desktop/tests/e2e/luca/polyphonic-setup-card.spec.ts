import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const READY_CODEX_RUNTIME = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "available",
  command: "codex",
  binary_path: "/synthetic/bin/codex",
  default_args: [],
  mcp_command: null,
  install_hint: "Install Codex",
  install_instructions_url: "https://example.invalid/codex",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
  login_hint: "Sign in to Codex",
};

async function openDoor(page: import("@playwright/test").Page) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: { runtimes: [] },
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await expect(page.getByTestId("onboarding-footer-scrim")).toHaveCount(0);
}

test("the door names the application and the name field never seeds a key label", async ({
  page,
}, testInfo) => {
  await openDoor(page);
  await expect(page.getByRole("heading", { name: "Luca" })).toHaveCount(0);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  if (evidenceDirectory) {
    await waitForAnimations(page);
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/onboarding-door-without-bottom-gradient.png`,
    });
  } else {
    await testInfo.attach("onboarding door", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }
  await page.getByTestId("polyphonic-door-begin").click();
  // The mock identity's display name is a shortened npub; the field must not
  // ask a new owner to delete their own key.
  await expect(page.getByTestId("polyphonic-owner-name")).toHaveValue("");
});

test("the field is one object: it does not move between the door and the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDoor(page);
  const field = page.getByTestId("polyphonic-onboarding-field");
  await expect(field).toHaveCount(1);
  const before = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });

  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  // Never unmounted, never remounted: same element, same place.
  await expect(field).toHaveCount(1);
  await expect
    .poll(async () =>
      field.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      }),
    )
    .toEqual(before);
  // The card mounted around it, in the frame's own geometry.
  const pane = page.getByTestId("polyphonic-setup-pane");
  const paneRect = await pane.evaluate((el) => el.getBoundingClientRect());
  expect(
    Math.abs(paneRect.left + paneRect.width / 2 - (before.x + before.w / 2)),
  ).toBeLessThan(2);
});

test("the setup card is dark whatever the system scheme, and reads in the app's type", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  // The card's surface is the shell the door already had; the frame in the
  // tree is transparent and holds only the column.
  const card = page.getByTestId("polyphonic-onboarding-shell");
  await expect(card).toHaveCSS("background-color", "rgb(20, 20, 22)");
  // The frame's canvas is still the dark one whatever the OS says; it is
  // simply not painted while the card floats on a transparent window, so the
  // token is what carries the fact and the surface reports nothing.
  const frame = page.getByTestId("polyphonic-onboarding");
  await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const canvasToken = await frame.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--prototype-canvas").trim(),
  );
  expect(canvasToken).toBe("#060608");
  const family = await page
    .getByRole("heading", { name: "What should Luca call you?" })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/Instrument Sans/);
});

test("the shell is the same object on the door and in the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDoor(page);
  const shell = page.getByTestId("polyphonic-onboarding-shell");
  // The card is there from the first frame — there is no door without it.
  await expect(shell).toBeVisible();
  const before = await shell.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });

  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await expect(shell).toHaveCount(1);
  // Nothing materialised: same object, same place.
  await expect
    .poll(async () =>
      shell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      }),
    )
    .toEqual(before);
  // And the transparent frame the column sits on is exactly the shell.
  const frame = await page
    .getByTestId("polyphonic-setup-assistant")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    });
  expect(frame).toEqual(before);
});

/** The window is 1000×656 on a first run; the card is the only thing in it. */
const FIRST_RUN_VIEWPORT = { width: 1000, height: 656 };
const TRANSPARENT = "rgba(0, 0, 0, 0)";

function backgroundOf(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<string | null> {
  return page.evaluate((target) => {
    const node = document.querySelector(target);
    return node ? window.getComputedStyle(node).backgroundColor : null;
  }, selector);
}

test("the first run floats: nothing is painted but the card", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);

  // One fact with one source: the onboarding scene's stage, on <html>.
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-floating-card",
    "",
  );

  // Everything between the desktop and the card stops painting…
  expect(await backgroundOf(page, "html")).toBe(TRANSPARENT);
  expect(await backgroundOf(page, "body")).toBe(TRANSPARENT);
  expect(await backgroundOf(page, "#root")).toBe(TRANSPARENT);
  expect(
    await backgroundOf(page, '[data-testid="machine-onboarding-gate"]'),
  ).toBe(TRANSPARENT);

  // …and the card's shell is the one opaque region left, which is what the
  // macOS window server draws the window's shadow from.
  const shell = page.getByTestId("polyphonic-onboarding-shell");
  await expect(shell).toBeVisible();
  const shellBackground = await shell.evaluate(
    (node) => window.getComputedStyle(node).backgroundColor,
  );
  expect(shellBackground).toBe("rgb(20, 20, 22)");

  // The living field stays inside the card — there is no canvas outside it to
  // spill onto any more.
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const card = rect('[data-testid="polyphonic-onboarding-shell"]');
    const field = rect('[data-testid="polyphonic-onboarding-field"]');
    if (!card || !field) return null;
    return {
      card: {
        left: card.left,
        top: card.top,
        right: card.right,
        bottom: card.bottom,
      },
      field: {
        left: field.left,
        top: field.top,
        right: field.right,
        bottom: field.bottom,
      },
    };
  });
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.field.left).toBeGreaterThanOrEqual(bounds.card.left - 1);
    expect(bounds.field.top).toBeGreaterThanOrEqual(bounds.card.top - 1);
    expect(bounds.field.right).toBeLessThanOrEqual(bounds.card.right + 1);
    expect(bounds.field.bottom).toBeLessThanOrEqual(bounds.card.bottom + 1);
  }

  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await waitForAnimations(page);
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-door.png`,
    });
  } else {
    await testInfo.attach("floating door", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }

  // The name step is the same object on the same transparent window.
  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-floating-card",
    "",
  );
  expect(await backgroundOf(page, "body")).toBe(TRANSPARENT);
  expect(
    await backgroundOf(page, '[data-testid="polyphonic-onboarding"]'),
  ).toBe(TRANSPARENT);
  await waitForAnimations(page);
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-name-step.png`,
    });
  } else {
    await testInfo.attach("floating name step", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }
});
