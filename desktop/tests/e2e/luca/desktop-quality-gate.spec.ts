import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { seedActiveIdentity } from "../../helpers/onboarding";

const RESIDENT_PUBKEY = "11".repeat(32);
const RESIDENT = {
  agentCommand: "hermes",
  channelNames: ["agents", "engineering"],
  model: "gpt-5.6-sol",
  name: "Luca",
  nativeRuntimeBinding: {
    kind: "hermes" as const,
    schemaVersion: 1,
    profileName: "default",
    hermesHome: "/opt/luca-fixture/hermes",
    executablePath: "/opt/luca-fixture/bin/hermes",
    runtimeVersion: "1.9.0",
    defaultWorkspace: "/opt/luca-fixture/workspace",
  },
  pubkey: RESIDENT_PUBKEY,
  status: "running" as const,
};

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test.beforeEach(async ({ page }) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, { managedAgents: [RESIDENT] });
});

test("desktop shell preserves hierarchy, keyboard reachability, and visual fidelity", async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=mock&projectDemo=1&notebookDemo=1");

  const agents = page.getByTestId("open-agents-view");
  await agents.focus();
  await expect(agents).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/agents/);

  const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
  await resident.focus();
  await expect(resident).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Agent workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to agents" }),
  ).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, "desktop-agent-library");

  await page.getByTestId("project-row-luca").click();
  const navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, "desktop-project-conversation");

  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/#\/pulse$/);
  const activityResident = page.getByTestId(
    `owner-activity-resident-${RESIDENT_PUBKEY}`,
  );
  await expect(activityResident).toContainText("Started");
  await expect(activityResident).toContainText("Connection not yet verified");
  await expect(page.getByText(/public pulse/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("compact desktop prioritizes the active workspace with reduced motion and clean focus", async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 800, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?e2e=mock&projectDemo=1&notebookDemo=1");

  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    )
    .toBe(true);

  const agents = page.getByTestId("open-agents-view");
  await agents.focus();
  await page.keyboard.press("Enter");
  const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
  await resident.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to agents" });
  await expect(back).toBeVisible();
  await expect(resident).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, "compact-agent-workspace");

  await page.keyboard.press("Shift+Tab");
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(resident).toBeVisible();
  await expect(page.getByRole("heading", { name: "Luca" })).toBeHidden();

  await page.getByTestId("open-brain-setup").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, "compact-brain");

  expect(errors).toEqual([]);
});

test("browser history restores the visible owner workspace without focus or console loss", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock&projectDemo=1&notebookDemo=1");

  await page.getByTestId("open-agents-view").click();
  await page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`).click();
  const workspace = page.getByRole("navigation", { name: "Agent workspace" });
  await workspace.getByRole("button", { name: "Notebook" }).click();
  await expect(
    page.getByRole("region", { name: "Luca notebook field" }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/section=settings/);

  await page.goBack();
  await expect(page).toHaveURL(/section=notebook/);
  await expect(
    page.getByRole("region", { name: "Luca notebook field" }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/section=settings/);
  await expect(
    page.getByText("Runtime-owned profile", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("open-inbox-view").focus();
  await expect(page.getByTestId("open-inbox-view")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});
