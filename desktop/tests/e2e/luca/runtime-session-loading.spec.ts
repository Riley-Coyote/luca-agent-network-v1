import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

async function capturePanel(page: Page, testInfo: TestInfo, name: string) {
  await waitForAnimations(page, 120);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await page.getByTestId("runtime-sessions-panel").screenshot({
    path: evidenceDirectory
      ? `${evidenceDirectory}/${name}.png`
      : testInfo.outputPath(`${name}.png`),
  });
}

test("runtime session loading stays stable and becomes recoverable when delayed", async ({
  page,
}, testInfo) => {
  await installMockBridge(page, { runtimeSessionsDelayMs: 5_500 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock");

  await page.getByTestId("runtime-rail-codex").click();
  const panel = page.getByTestId("runtime-sessions-panel");
  const loading = page.getByTestId("runtime-sessions-loading");
  await expect(loading).toBeVisible();
  await expect(loading).toContainText("Loading local history…");
  await expect(panel.getByText("No sessions found")).toHaveCount(0);
  const initialBox = await panel.boundingBox();
  expect(initialBox).not.toBeNull();
  await capturePanel(page, testInfo, "01-runtime-sessions-loading");

  const delayed = page.getByTestId("runtime-sessions-loading-delayed");
  await expect(delayed).toBeVisible({ timeout: 5_000 });
  await expect(delayed).toContainText("Nothing has been changed");
  await expect(
    delayed.getByRole("button", { name: "Try again" }),
  ).toBeVisible();
  const delayedBox = await panel.boundingBox();
  expect(delayedBox).not.toBeNull();
  expect(
    Math.abs((delayedBox?.x ?? 0) - (initialBox?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((delayedBox?.y ?? 0) - (initialBox?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(delayedBox?.width).toBe(initialBox?.width);
  expect(delayedBox?.height).toBe(initialBox?.height);
  await capturePanel(page, testInfo, "02-runtime-sessions-delayed");

  await expect(
    panel.getByTestId("runtime-session-session-codex-checkpoint"),
  ).toBeVisible({ timeout: 3_000 });
  const readyBox = await panel.boundingBox();
  expect(readyBox).not.toBeNull();
  expect(
    Math.abs((readyBox?.x ?? 0) - (initialBox?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((readyBox?.y ?? 0) - (initialBox?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(readyBox?.width).toBe(initialBox?.width);
  expect(readyBox?.height).toBe(initialBox?.height);
  await capturePanel(page, testInfo, "03-runtime-sessions-ready");
});

test("a failed initial session read explains recovery and retries safely", async ({
  page,
}) => {
  await installMockBridge(page, {
    runtimeSessionListErrors: ["mock local index unavailable", null],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("runtime-rail-codex").click();

  const unavailable = page.getByTestId("runtime-sessions-unavailable");
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText("Nothing was changed");
  await unavailable.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByTestId("runtime-session-session-codex-checkpoint"),
  ).toBeVisible();
  await expect(unavailable).toHaveCount(0);
});

test("a failed refresh keeps saved session results usable", async ({
  page,
}) => {
  await installMockBridge(page, {
    runtimeSessionListErrors: [null, "mock refresh unavailable"],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("runtime-rail-codex").click();

  const session = page.getByTestId("runtime-session-session-codex-checkpoint");
  await expect(session).toBeVisible();
  await page.evaluate(() =>
    window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["connected-runtime-sessions", "codex"],
    }),
  );

  const savedResults = page.getByTestId("runtime-sessions-stale-results");
  await expect(savedResults).toBeVisible();
  await expect(savedResults).toContainText(
    "last indexed results remain available",
  );
  await expect(session).toBeVisible();
  await expect(
    session.getByRole("button", { name: /Start with this context/ }),
  ).toBeEnabled();
});
