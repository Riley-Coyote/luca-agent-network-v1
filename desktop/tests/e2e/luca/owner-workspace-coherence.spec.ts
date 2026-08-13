import { expect, test, type Page } from "@playwright/test";

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

async function selectedProfile(page: Page) {
  return page.evaluate(() => {
    const query = window.location.hash.split("?")[1] ?? "";
    const serialized = new URLSearchParams(query).get("profile");
    if (serialized === null) return null;
    if (!serialized.startsWith('"')) return serialized;
    return JSON.parse(serialized) as string;
  });
}

async function assertResidentWorkspaceCoherence(page: Page) {
  await page.goto("/?e2e=mock&projectDemo=1&notebookDemo=1");

  await page.getByTestId("open-inbox-view").click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();

  await page.getByTestId("open-agents-view").click();
  await expect(page).toHaveURL(/#\/agents/);
  const libraryRow = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
  await expect(libraryRow).toContainText("Luca");
  await libraryRow.click();
  await expect.poll(() => selectedProfile(page)).toBe(RESIDENT_PUBKEY);
  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(page.getByText(RESIDENT_PUBKEY, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Held in local secure storage", { exact: true }),
  ).toBeVisible();

  const isCompact = (page.viewportSize()?.width ?? 0) <= 800;
  const backToAgents = page.getByRole("button", { name: "Back to agents" });
  if (isCompact) {
    await expect(backToAgents).toBeVisible();
    await expect(libraryRow).toBeHidden();
    await backToAgents.click();
    await expect.poll(() => selectedProfile(page)).toBeNull();
    await expect(libraryRow).toBeVisible();
    await libraryRow.click();
    await expect.poll(() => selectedProfile(page)).toBe(RESIDENT_PUBKEY);
    await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  } else {
    await expect(backToAgents).toBeHidden();
    await expect(libraryRow).toBeVisible();
  }

  const workspaceNavigation = page.getByRole("navigation", {
    name: "Agent workspace",
  });
  await workspaceNavigation.getByRole("button", { name: "Notebook" }).click();
  await expect(page).toHaveURL(/section=notebook/);
  await expect(
    page.getByRole("region", { name: "Luca notebook field" }),
  ).toBeVisible();

  await workspaceNavigation.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/section=settings/);
  await expect(page.getByText(RESIDENT_PUBKEY, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Runtime-owned profile", { exact: true }),
  ).toBeVisible();

  await page.getByTestId("global-back").click();
  await expect(page).toHaveURL(/section=notebook/);
  await expect.poll(() => selectedProfile(page)).toBe(RESIDENT_PUBKEY);
  await expect(
    page.getByRole("region", { name: "Luca notebook field" }),
  ).toBeVisible();
  await page.getByTestId("global-forward").click();
  await expect(page).toHaveURL(/section=settings/);
  await expect.poll(() => selectedProfile(page)).toBe(RESIDENT_PUBKEY);

  const openBrain = page.getByTestId("open-brain-setup");
  await expect(openBrain).toBeVisible();
  await openBrain.click();
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  const repository = page.getByTestId("brain-card-repository");
  await repository.getByRole("button", { name: "Details" }).click();
  const brainGrant = page.getByTestId(
    `connected-grant-connected-repository-luca-${RESIDENT_PUBKEY}`,
  );
  await expect(brainGrant).toContainText("Luca");
  await expect(brainGrant).toContainText("Included");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/#\/pulse$/);
  const activity = page.getByTestId(
    `owner-activity-resident-${RESIDENT_PUBKEY}`,
  );
  await expect(activity).toContainText("Luca");
  await expect(activity).toContainText("Runtime ready");

  await page.getByTestId("project-row-luca").click();
  let navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await navigator.getByRole("button", { name: /engineering/i }).click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await navigator.getByRole("button", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  navigator = page.getByTestId("project-room-navigator");
  await expect(navigator).toBeVisible();
  await expect(
    navigator.getByRole("button", { name: /engineering/i }),
  ).toHaveAttribute("aria-current", "page");

  await page.goForward();
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");

  await page.getByTestId("open-settings-view").click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const settings = page.getByTestId("settings-agents");
  await expect(settings).toBeVisible();
  await settings.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`).click();
  await expect(settings.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(settings).toContainText("Hermes · Native-managed agent");
  await expect(settings).toContainText(
    "Native-managed binding · Luca-managed overlays",
  );
  await settings.getByRole("button", { name: "Capabilities" }).click();
  await settings.getByRole("button", { name: "Manage MCP access" }).click();
  await expect(page).toHaveURL(/section=connections/);
  await page
    .getByTestId("settings-connections-mcp")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(
    page.getByRole("switch", {
      name: "Grant Local project tools to Luca",
    }),
  ).toBeVisible();

  await expect(page.getByText(/copy private key/i)).toHaveCount(0);
  await expect(page.getByText(/transfer authority/i)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, { managedAgents: [RESIDENT] });
});

test("one exact resident and project context stay coherent across the owner workspace", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await assertResidentWorkspaceCoherence(page);

  expect(errors).toEqual([]);
});

test("workspace coherence remains reachable in the compact reduced-motion shell", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 800, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  await assertResidentWorkspaceCoherence(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  expect(errors).toEqual([]);
});
