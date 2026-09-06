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

type InitialRouteGate = {
  heldRequests: number;
  release: () => void;
};

async function holdInitialRoute(page: Page) {
  // Home waits for the channel inventory before choosing its initial route.
  // Hold that real boundary so the shell is usable before To mounts.
  await page.addInitScript(() => {
    type Invoke = (
      command: string,
      payload?: unknown,
      options?: unknown,
    ) => Promise<unknown>;
    const target = window as unknown as {
      __TAURI_INTERNALS__?: Record<string, unknown>;
      __INITIAL_ROUTE_GATE__: InitialRouteGate;
    };
    let held = true;
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    target.__INITIAL_ROUTE_GATE__ = {
      heldRequests: 0,
      release: () => {
        held = false;
        release();
      },
    };
    const internals = target.__TAURI_INTERNALS__ ?? {};
    target.__TAURI_INTERNALS__ = internals;
    let realInvoke: Invoke | undefined;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set: (invoke: Invoke) => {
        realInvoke = invoke;
      },
      get:
        () => async (command: string, payload?: unknown, options?: unknown) => {
          if (!realInvoke) throw new Error("Mock invoke is not installed");
          const result = await realInvoke(command, payload, options);
          if (command === "get_channels" && held) {
            target.__INITIAL_ROUTE_GATE__.heldRequests += 1;
            await ready;
          }
          return result;
        },
    });
  });
}

async function releaseInitialRoute(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as { __INITIAL_ROUTE_GATE__: InitialRouteGate }
    ).__INITIAL_ROUTE_GATE__.release();
  });
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("new-dm-search")).toBeEditable();
  await waitForAnimations(page);
}

test.beforeEach(async ({ page }) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, { managedAgents: [RESIDENT] });
});

for (const restoredHistory of [false, true]) {
  test(`late initial recipient mount preserves deliberate Agents focus${restoredHistory ? " with restored history" : ""}`, async ({
    page,
  }, testInfo) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width: 800, height: 720 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await holdInitialRoute(page);
    await page.goto("/?e2e=mock&projectDemo=1&notebookDemo=1");
    await page.waitForFunction(
      () =>
        (window as unknown as { __INITIAL_ROUTE_GATE__: InitialRouteGate })
          .__INITIAL_ROUTE_GATE__.heldRequests > 0,
    );
    if (restoredHistory) {
      await page.getByTestId("open-agents-view").click();
      await expect(page).toHaveURL(/#\/agents$/);
      await page.keyboard.press("ControlOrMeta+Shift+a");
      await expect(page).toHaveURL(/#\/$/);
      const historyIndex = await page.evaluate(() => history.state.__TSR_index);
      expect(historyIndex).toBeGreaterThan(0);
      await page.reload();
      await page.waitForFunction(
        () =>
          (window as unknown as { __INITIAL_ROUTE_GATE__: InitialRouteGate })
            .__INITIAL_ROUTE_GATE__.heldRequests > 0,
      );
      expect(await page.evaluate(() => history.state.__TSR_index)).toBe(
        historyIndex,
      );
    }
    await expect(page.getByTestId("new-message-page")).toHaveCount(0);
    const agents = page.getByTestId("open-agents-view");
    await agents.focus();
    await expect(agents).toBeFocused();

    await releaseInitialRoute(page);
    await expect(agents).toBeFocused();
    await capture(page, testInfo, "late-mount-preserves-agents-focus");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/agents$/);
    const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
    await resident.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to agents" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("unopposed initial recipient mount keeps autofocus", async ({ page }) => {
  await holdInitialRoute(page);
  await page.goto("/?e2e=mock");
  await page.waitForFunction(
    () =>
      (window as unknown as { __INITIAL_ROUTE_GATE__: InitialRouteGate })
        .__INITIAL_ROUTE_GATE__.heldRequests > 0,
  );
  await expect(page.getByTestId("new-message-page")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
  await releaseInitialRoute(page);
  await expect(page.getByTestId("new-dm-search")).toBeFocused();
});

test("explicit New conversation and its shortcut hand focus to recipients", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/agents");
  const agents = page.getByTestId("open-agents-view");
  await expect(
    page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`),
  ).toBeVisible();
  const newConversation = page.getByTestId("open-new-conversation");
  await newConversation.focus();
  await page.keyboard.press("Enter");
  const search = page.getByTestId("new-dm-search");
  await expect(search).toBeFocused();

  await agents.click();
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/);
  await expect(
    page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`),
  ).toBeVisible();
  await agents.focus();
  await page.keyboard.press("ControlOrMeta+n");
  await expect(search).toBeFocused();
  await search.fill("Luca");
  await newConversation.focus();
  await page.keyboard.press("Enter");
  await expect(newConversation).toBeFocused();
  await expect(search).toHaveValue("Luca");
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
