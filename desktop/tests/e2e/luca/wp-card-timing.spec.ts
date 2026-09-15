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

declare global {
  interface Window {
    __wpMeasure?: (clickSelector: string, waitSelector: string) => Promise<number>;
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
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ =
      internals;
  });
}

async function installMeasure(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as Window).__wpMeasure = (
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

test("timing: door -> name -> runtime -> waking", async ({ page }) => {
  test.setTimeout(120_000);
  await installLatency(page);
  await installMeasure(page);
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: { runtimes: [] },
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.setViewportSize({ width: 960, height: 544 });
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByTestId("polyphonic-door-begin")).toBeVisible();
  // The owner reads the door before pressing it; the discovery it starts has
  // that long to land. (Set DWELL=0 for the worst case: an instant press.)
  await page.waitForTimeout(Number(process.env.DWELL ?? 1500));

  const doorToName = await page.evaluate(() =>
    window.__wpMeasure?.(
      '[data-testid="polyphonic-door-begin"]',
      '[data-testid="polyphonic-owner-name"]',
    ),
  );

  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  const nameToRuntimeHeading = await page.evaluate(() =>
    window.__wpMeasure?.(
      '[data-testid="polyphonic-setup-continue"]',
      "#polyphonic-runtime-heading",
    ),
  );
  const rowsAt = await page.evaluate(() => {
    const start = performance.now();
    return new Promise<number>((resolve) => {
      const tick = () => {
        const el = document.querySelector('input[name="polyphonic-runtime"]');
        if (el && (el as HTMLElement).closest("label")) {
          resolve(performance.now() - start);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  await expect(page.getByRole("radio", { name: /Codex/ })).toBeVisible();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeEnabled();
  const runtimeToWaking = await page.evaluate(() =>
    window.__wpMeasure?.(
      '[data-testid="polyphonic-setup-continue"]',
      "#polyphonic-preparing-heading",
    ),
  );

  console.log(
    `WPCARD_TIMINGS ${JSON.stringify({
      door_to_name_ms: Math.round(doorToName ?? -1),
      name_to_runtime_heading_ms: Math.round(nameToRuntimeHeading ?? -1),
      runtime_rows_after_heading_ms: Math.round(rowsAt),
      name_to_runtime_rows_ms: Math.round((nameToRuntimeHeading ?? 0) + rowsAt),
      meet_luca_to_waking_ms: Math.round(runtimeToWaking ?? -1),
    })}`,
  );
});
