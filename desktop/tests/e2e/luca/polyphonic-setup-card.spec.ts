import { expect, test } from "@playwright/test";

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
}

test("the door names the application and the name field never seeds a key label", async ({
  page,
}) => {
  await openDoor(page);
  await expect(page.getByRole("heading", { name: "Luca" })).toHaveCount(0);
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
  const card = page.getByTestId("polyphonic-setup-assistant");
  await expect(card).toHaveCSS("background-color", "rgb(20, 20, 22)");
  await expect(page.getByTestId("polyphonic-onboarding")).toHaveCSS(
    "background-color",
    "rgb(6, 6, 8)",
  );
  const family = await page
    .getByRole("heading", { name: "Bring your agents together." })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/Instrument Sans/);
});
