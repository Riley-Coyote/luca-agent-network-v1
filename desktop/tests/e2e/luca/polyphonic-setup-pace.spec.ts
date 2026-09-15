import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { THREE_NATIVE_AGENTS } from "./onboarding-agent-import-fixture";

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

/**
 * What a page change is allowed to cost. Not a rendering budget — the harness
 * paints in a frame either way — but a promise that nothing on the way to the
 * next page is AWAITED: a single round trip put back in front of a chapter
 * change costs hundreds of milliseconds under the model below, and is caught
 * here at once.
 */
const PAGE_CHANGE_BUDGET_MS = 150;
/** The door hands over through the app's own gates; they cost what they cost. */
const DOOR_BUDGET_MS = 400;
/** What the modelled scan of this Mac costs, start to finish. */
const SCAN_COST_MS = 800;
/** How long the owner reads the door for. Zero is the worst case: a press on
 *  the frame the door appears, which leaves the prefetch almost no head start. */
const DWELL_MS = Number(process.env.LUCA_PACE_DWELL_MS ?? 1500);

declare global {
  interface Window {
    __wpMeasure?: (
      clickSelector: string,
      waitSelector: string,
    ) => Promise<number>;
  }
}

/**
 * The mock bridge answers every command in the same tick, so in the harness
 * every transition is free and the real build's dead pane is invisible. This
 * models a Mac: the commands the card actually waits on cost what they cost
 * there, everything else costs one hop.
 */
async function installLatency(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const COST: Record<string, number> = {
      discover_acp_providers: 700,
      get_operator_forge_settings: 350,
      update_profile: 450,
      save_operator_forge_preferences: 300,
      list_managed_agents: 250,
      list_personas: 200,
      discover_native_residents: 800,
    };
    const DEFAULT_COST = 25;
    const internals: Record<string, unknown> = {};
    let real: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const wrapped = async (...args: unknown[]) => {
      const command = String(args[0]);
      await new Promise((resolve) =>
        window.setTimeout(resolve, COST[command] ?? DEFAULT_COST),
      );
      return real?.(...args);
    };
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => (real ? wrapped : undefined),
      set: (fn) => {
        real = fn;
      },
    });
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = internals;
  });
}

async function installMeasure(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as Window).__paceMeasure = (
      clickSelector: string,
      waitSelector: string,
    ) => {
      const target = document.querySelector<HTMLElement>(clickSelector);
      if (!target) return Promise.reject(new Error(`no ${clickSelector}`));
      const start = performance.now();
      const done = new Promise<number>((resolve) => {
        const check = () => {
          const el = document.querySelector(waitSelector);
          if (el && (el as HTMLElement).getBoundingClientRect().height > 0) {
            resolve(performance.now() - start);
            return true;
          }
          return false;
        };
        const tick = () => {
          if (!check()) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      target.click();
      return done;
    };
  });
}

test("no page of setup waits on a round trip before it changes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installLatency(page);
  await installMeasure(page);
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      // Agents to find, so "opens on rows" is a question this can answer.
      nativeResidentDiscovery: THREE_NATIVE_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.setViewportSize({ width: 1040, height: 584 });
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByTestId("polyphonic-door-begin")).toBeVisible();
  // The owner reads the door before pressing it, and the discovery the door
  // starts has that long to land.
  await page.waitForTimeout(DWELL_MS);

  const doorToName = await page.evaluate(() =>
    window.__paceMeasure?.(
      '[data-testid="polyphonic-door-begin"]',
      '[data-testid="polyphonic-owner-name"]',
    ),
  );

  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  // The name is written to this Mac and handed on in the same tick; the relay
  // write happens behind the runtime page.
  const nameToRuntime = await page.evaluate(() =>
    window.__paceMeasure?.(
      '[data-testid="polyphonic-setup-continue"]',
      "#polyphonic-runtime-heading",
    ),
  );
  // …and the page it lands on opens on its rows, because the door asked.
  const rowsAfterHeading = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const tick = () => {
          if (document.querySelector('input[name="polyphonic-runtime"]'))
            resolve(performance.now() - start);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

  await page.getByRole("radio", { name: /Codex/ }).check();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeEnabled();
  // The agents chapter is the same bargain: the scan was started a chapter
  // ago, so the question arrives with its rows already under it.
  const runtimeToAgents = await page.evaluate(() =>
    window.__paceMeasure?.(
      '[data-testid="polyphonic-setup-continue"]',
      "#polyphonic-agents-heading",
    ),
  );
  const agentRowsAfterHeading = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const tick = () => {
          if (document.querySelector('[data-testid^="onboarding-agent-row-"]'))
            resolve(performance.now() - start);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

  // "Meet Luca" moves to the waking page and does its work there; it never
  // becomes "Working…" on the page the owner is still looking at.
  const meetLucaToWaking = await page.evaluate(() =>
    window.__paceMeasure?.(
      '[data-testid="polyphonic-setup-continue"]',
      "#polyphonic-preparing-heading",
    ),
  );

  const pace = {
    door_to_name_ms: Math.round(doorToName ?? -1),
    name_to_runtime_ms: Math.round(nameToRuntime ?? -1),
    runtime_rows_after_heading_ms: Math.round(rowsAfterHeading),
    runtime_to_agents_ms: Math.round(runtimeToAgents ?? -1),
    agent_rows_after_heading_ms: Math.round(agentRowsAfterHeading),
    meet_luca_to_waking_ms: Math.round(meetLucaToWaking ?? -1),
  };
  console.log(`LUCA_SETUP_PACE ${JSON.stringify(pace)}`);

  expect(pace.name_to_runtime_ms).toBeGreaterThanOrEqual(0);
  expect(pace.name_to_runtime_ms).toBeLessThan(PAGE_CHANGE_BUDGET_MS);
  expect(pace.runtime_to_agents_ms).toBeGreaterThanOrEqual(0);
  expect(pace.runtime_to_agents_ms).toBeLessThan(PAGE_CHANGE_BUDGET_MS);
  expect(pace.meet_luca_to_waking_ms).toBeGreaterThanOrEqual(0);
  expect(pace.meet_luca_to_waking_ms).toBeLessThan(PAGE_CHANGE_BUDGET_MS);
  // Rows are a different promise from page changes: they are asked for at the
  // door, so an owner who read it at all finds them already home. An owner who
  // pressed on the first frame still gets the head start the door bought —
  // well under what the scan would cost if it began when its chapter opened.
  const rowsBudget =
    DWELL_MS >= SCAN_COST_MS ? PAGE_CHANGE_BUDGET_MS : SCAN_COST_MS / 2;
  expect(pace.runtime_rows_after_heading_ms).toBeLessThan(rowsBudget);
  // The scan of this Mac is the slowest thing setup asks for, and it is two
  // chapters from where it is needed precisely so this number is not it.
  expect(pace.agent_rows_after_heading_ms).toBeLessThan(rowsBudget);
  expect(pace.door_to_name_ms).toBeGreaterThanOrEqual(0);
  expect(pace.door_to_name_ms).toBeLessThan(DOOR_BUDGET_MS);
});
