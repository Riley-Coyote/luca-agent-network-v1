/**
 * The edge of a text box can be seen on every surface it sits on.
 *
 * A text box has nothing but its edge to say "you can type here". A real one
 * from the page is copied onto each surface, at rest, focused and disabled,
 * and its edge is read back from the pixels the browser drew: at rest it must
 * hold 3:1 against its surface (WCAG 2.2 SC 1.4.11), focus must never be
 * quieter than rest, and a disabled box quieter than a live one.
 *
 * By default this checks the app's two defaults, Vitesse Black and Paper.
 * FIELD_THEMES=all (or a comma list) checks any others; the pictures go to
 * FIELD_OUT/grid and the numbers to FIELD_OUT/measures. FIELD_FRAME=off
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

const OUT = process.env.FIELD_OUT ?? "test-results/field-edge-contrast";
const FRAME = process.env.FIELD_FRAME !== "off";
const THEMES: readonly string[] = (
  process.env.FIELD_THEMES === "all"
    ? SYNTAX_THEMES
    : (process.env.FIELD_THEMES?.split(",") ?? ["vitesse-black", "paper"])
).filter((name) => !(FRAME && isGlassTheme(name)));

/** The floor for the edge of a control. */
const FLOOR = 3;

const STATES = ["at rest", "focused", "disabled"] as const;

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
    await page.goto("/#/settings?section=connections");
    await expect(page.locator("input:visible").first()).toBeVisible({
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
  test(`a text box's edge is seen on every surface in ${theme}`, async ({
    page,
  }) => {
    await boot(page, theme);

    const built = await page.evaluate(
      ({ surfaces, states }) => {
        // The shared text box: the first one on the page that draws an edge.
        const source = [
          ...document.querySelectorAll<HTMLInputElement>("input"),
        ].find(
          (node) =>
            node.getClientRects().length > 0 &&
            Number.parseFloat(getComputedStyle(node).borderTopWidth) > 0,
        );
        if (!source) throw new Error("no real text box on the page");
        const make = (state: string) => {
          const copy = source.cloneNode(true) as HTMLInputElement;
          for (const name of ["data-testid", "id", "name", "aria-labelledby"])
            copy.removeAttribute(name);
          copy.value = "";
          copy.type = "text";
          copy.placeholder = state;
          copy.setAttribute("aria-label", state);
          copy.disabled = state === "disabled";
          copy.style.width = "112px";
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
          `grid-template-columns:190px repeat(${states.length}, 168px)`,
          "grid-auto-rows:56px",
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

        // What a really focused text box draws, read once and worn by the
        // focused cells: it is made of theme colours alone, so it is the
        // same on every surface.
        const probe = make("at rest");
        grid.append(probe);
        probe.focus();
        const focused = getComputedStyle(probe);
        const focusVisible = probe.matches(":focus-visible");
        const ring = focused.boxShadow;
        const outline = focused.outline;
        const focusBorder = focused.borderTopColor;
        probe.remove();

        for (const surface of surfaces) {
          grid.append(label(surface.name));
          for (const state of states) {
            const cell = document.createElement("div");
            cell.style.cssText = `background:${surface.background};height:100%;display:flex;align-items:center;justify-content:center`;
            cell.setAttribute("data-surface", surface.name);
            const copy = make(state);
            if (state === "focused") {
              copy.style.boxShadow = ring;
              copy.style.outline = outline;
              copy.style.borderColor = focusBorder;
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

    // Along the top edge, away from the corners: the surface outside, the
    // two device pixels of the edge itself, the two a focus ring draws on.
    const PER_CELL = 5;
    const drawn = await pixels(
      page,
      built.cells.flatMap((cell) => {
        const cx = cell.x + cell.w / 2;
        return [
          { x: cx, y: cell.y - 8 },
          { x: cx, y: cell.y },
          { x: cx, y: cell.y + 0.5 },
          { x: cx, y: cell.y - 0.5 },
          { x: cx, y: cell.y - 1 },
        ];
      }),
    );
    const cells = built.cells.map((cell, index) => {
      const [surface, edgeA, edgeB, ringA, ringB] = drawn.slice(
        index * PER_CELL,
        index * PER_CELL + PER_CELL,
      );
      const edgeOnSurface = Math.max(
        contrast(edgeA, surface),
        contrast(edgeB, surface),
      );
      const ringOnSurface = Math.max(
        contrast(ringA, surface),
        contrast(ringB, surface),
      );
      return {
        surface: cell.surface,
        state: cell.state as (typeof STATES)[number],
        surfaceRgb: surface,
        edgeRgb:
          contrast(edgeA, surface) >= contrast(edgeB, surface) ? edgeA : edgeB,
        edgeOnSurface,
        ringOnSurface,
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
      expect(
        at("at rest").edgeOnSurface,
        `${where}: the edge of a text box at rest against its surface`,
      ).toBeGreaterThanOrEqual(FLOOR);
      expect(
        at("focused").ringOnSurface,
        `${where}: the focus ring around a text box`,
      ).toBeGreaterThanOrEqual(FLOOR);
      expect(
        Math.max(at("focused").edgeOnSurface, at("focused").ringOnSurface),
        `${where}: focus is never quieter than rest`,
      ).toBeGreaterThanOrEqual(at("at rest").edgeOnSurface);
      expect(
        at("disabled").edgeOnSurface,
        `${where}: disabled is quieter than live`,
      ).toBeLessThan(at("at rest").edgeOnSurface);
    }
  });
}
