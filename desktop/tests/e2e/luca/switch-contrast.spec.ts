/**
 * The shared switch can be seen, off and on, on every surface it sits on.
 *
 * A real switch from the page is copied onto each surface, in each state,
 * and its colours are read back from the pixels the browser drew: the track
 * against its surface and the thumb against its track must each hold 3:1
 * (WCAG 2.2 SC 1.4.11), on must stay clearly more than off, and a disabled
 * switch quieter than a live one.
 *
 * By default this checks the app's two defaults, Vitesse Black and Paper.
 * SWITCH_THEMES=all (or a comma list) checks any others; the pictures go to
 * SWITCH_OUT/grid and the numbers to SWITCH_OUT/measures. SWITCH_FRAME=off
 * checks the classic look, the only place the two glass themes still draw.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import {
  isGlassTheme,
  SYNTAX_THEMES,
} from "../../../src/shared/theme/theme-loader";
import { installMockBridge } from "../../helpers/bridge";
import { SURFACES } from "../../helpers/controlSurfaces";
import { contrast, pixels } from "../../helpers/drawn";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const OUT = process.env.SWITCH_OUT ?? "test-results/switch-contrast";
const FRAME = process.env.SWITCH_FRAME !== "off";
/** Under the new look's frame the two glass themes hand over to their base
 *  palettes, so there they are not themes to check. */
const THEMES: readonly string[] = (
  process.env.SWITCH_THEMES === "all"
    ? SYNTAX_THEMES
    : (process.env.SWITCH_THEMES?.split(",") ?? ["vitesse-black", "paper"])
).filter((name) => !(FRAME && isGlassTheme(name)));

/** The floor for the edge of a control and for its parts. */
const FLOOR = 3;
/** On must read as clearly more than off: at least twice its contrast. */
const ON_OVER_OFF = 2;

const STATES = [
  "off",
  "on",
  "off focused",
  "on focused",
  "off disabled",
  "on disabled",
] as const;

async function boot(page: Page, theme: string) {
  await page.addInitScript(
    ({ key, theme, frame }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = frame;
      localStorage.setItem(key, JSON.stringify(overrides));
      localStorage.setItem("buzz-theme", theme);
      localStorage.setItem("buzz-follow-system", "false");
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, theme, frame: FRAME },
  );
  await installMockBridge(page);
  await expect(async () => {
    await page.goto("/#/settings?section=notifications");
    await expect(page.locator("button[role='switch']").first()).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-luca-theme", theme, {
    timeout: 20_000,
  });
  await page.waitForTimeout(600);
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1000, height: 760 },
});
test.describe.configure({ timeout: 120_000 });

for (const theme of THEMES) {
  test(`the switch is seen, off and on, on every surface in ${theme}`, async ({
    page,
  }) => {
    await boot(page, theme);
    // Put the page in keyboard mode, so focus draws its ring.
    await page.keyboard.press("Tab");

    const built = await page.evaluate(
      ({ surfaces, states }) => {
        const source = document.querySelector<HTMLButtonElement>(
          "button[role='switch']",
        );
        if (!source) throw new Error("no real switch on the page");
        const make = (state: string) => {
          const copy = source.cloneNode(true) as HTMLButtonElement;
          const on = state.startsWith("on");
          const disabled = state.endsWith("disabled");
          for (const node of [copy, ...copy.querySelectorAll("*")]) {
            node.removeAttribute("data-testid");
            node.removeAttribute("id");
            node.setAttribute("data-state", on ? "checked" : "unchecked");
            if (disabled) node.setAttribute("data-disabled", "");
            else node.removeAttribute("data-disabled");
          }
          copy.setAttribute("aria-checked", String(on));
          copy.removeAttribute("aria-labelledby");
          copy.setAttribute("aria-label", state);
          copy.disabled = disabled;
          copy.setAttribute("data-cell-state", state);
          return copy;
        };

        const grid = document.createElement("div");
        grid.style.cssText = [
          "position:fixed",
          "inset:0",
          "z-index:2147483647",
          "background:hsl(var(--background))",
          "color:hsl(var(--mn-ink-muted))",
          "font:500 0.75rem/1.2 var(--font-ui)",
          "padding:20px 24px",
          "display:grid",
          `grid-template-columns:190px repeat(${states.length}, 124px)`,
          "grid-auto-rows:54px",
          "align-content:start",
          "align-items:center",
        ].join(";");
        const label = (text: string, strong = false) => {
          const cell = document.createElement("div");
          cell.textContent = text;
          cell.style.cssText = `padding:0 10px;${strong ? "color:hsl(var(--mn-ink))" : ""}`;
          return cell;
        };
        const theme =
          document.documentElement.getAttribute("data-luca-theme") ?? "";
        grid.append(label(theme, true));
        for (const state of states) grid.append(label(state));
        document.body.append(grid);

        // The ring a really focused switch draws, read once and worn by the
        // focused cells: it is made of theme colours alone, so it is the
        // same ring on every surface.
        const probe = make("off");
        grid.append(probe);
        probe.focus();
        const focusVisible = probe.matches(":focus-visible");
        const ring = getComputedStyle(probe).boxShadow;
        const outline = getComputedStyle(probe).outline;
        probe.remove();

        for (const surface of surfaces) {
          grid.append(label(surface.name));
          for (const state of states) {
            const cell = document.createElement("div");
            cell.style.cssText = `background:${surface.background};height:100%;display:flex;align-items:center;justify-content:center`;
            cell.setAttribute("data-surface", surface.name);
            const copy = make(state);
            if (state.endsWith("focused")) {
              copy.style.boxShadow = ring;
              copy.style.outline = outline;
            }
            cell.append(copy);
            grid.append(cell);
          }
        }
        (document.activeElement as HTMLElement | null)?.blur();

        return {
          dark: document.documentElement.classList.contains("dark"),
          focusVisible,
          className: source.className,
          cells: [
            ...grid.querySelectorAll<HTMLElement>("[data-cell-state]"),
          ].map((node) => {
            const box = node.getBoundingClientRect();
            return {
              surface: node.parentElement?.getAttribute("data-surface") ?? "",
              state: node.getAttribute("data-cell-state") ?? "",
              x: box.x,
              y: box.y,
              w: box.width,
              h: box.height,
            };
          }),
        };
      },
      { surfaces: SURFACES, states: [...STATES] },
    );
    expect(built.focusVisible, "focus draws as keyboard focus").toBe(true);

    mkdirSync(`${OUT}/grid`, { recursive: true });
    mkdirSync(`${OUT}/measures`, { recursive: true });
    await page.screenshot({
      animations: "disabled",
      path: `${OUT}/grid/${theme}.png`,
    });

    const drawn = await pixels(
      page,
      built.cells.flatMap((cell) => {
        const on = cell.state.startsWith("on");
        const cy = cell.y + cell.h / 2;
        return [
          // the surface, beside the switch
          { x: cell.x - 12, y: cy },
          // the track, on the side the thumb is not
          { x: on ? cell.x + 9 : cell.x + cell.w - 9, y: cy },
          // the thumb
          { x: on ? cell.x + cell.w - 10 : cell.x + 10, y: cy },
          // the focus ring, outside the switch
          { x: cell.x + cell.w / 2, y: cell.y - 3 },
        ];
      }),
    );
    const cells = built.cells.map((cell, index) => {
      const [surface, track, thumb, ring] = drawn.slice(
        index * 4,
        index * 4 + 4,
      );
      return {
        surface: cell.surface,
        state: cell.state as (typeof STATES)[number],
        surfaceRgb: surface,
        trackRgb: track,
        thumbRgb: thumb,
        trackOnSurface: contrast(track, surface),
        thumbOnTrack: contrast(thumb, track),
        ringOnSurface: contrast(ring, surface),
      };
    });
    writeFileSync(
      `${OUT}/measures/${theme}.json`,
      JSON.stringify(
        { theme, dark: built.dark, className: built.className, cells },
        null,
        2,
      ),
    );

    for (const { name } of SURFACES) {
      const at = (state: (typeof STATES)[number]) => {
        const cell = cells.find(
          (each) => each.surface === name && each.state === state,
        );
        if (!cell) throw new Error(`no ${state} cell on ${name}`);
        return cell;
      };
      const where = `${theme}, ${name}`;
      for (const state of ["off", "on"] as const) {
        expect(
          at(state).trackOnSurface,
          `${where}: the ${state} track against its surface`,
        ).toBeGreaterThanOrEqual(FLOOR);
        expect(
          at(state).thumbOnTrack,
          `${where}: the ${state} thumb against its track`,
        ).toBeGreaterThanOrEqual(FLOOR);
        expect(
          at(`${state} focused`).ringOnSurface,
          `${where}: the focus ring around a switch that is ${state}`,
        ).toBeGreaterThanOrEqual(FLOOR);
        expect(
          at(`${state} disabled`).trackOnSurface,
          `${where}: disabled is quieter than live, ${state}`,
        ).toBeLessThan(at(state).trackOnSurface);
      }
      expect(
        at("on").trackOnSurface / at("off").trackOnSurface,
        `${where}: on is clearly more than off`,
      ).toBeGreaterThanOrEqual(ON_OVER_OFF);
      // A switch that is off and live must not be taken for a disabled one.
      expect(
        at("off").trackOnSurface,
        `${where}: off and live is more than off and disabled`,
      ).toBeGreaterThan(at("off disabled").trackOnSurface * 1.5);
    }
  });
}
