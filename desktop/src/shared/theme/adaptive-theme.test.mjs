import assert from "node:assert/strict";
import test from "node:test";

import {
  contrastRatio,
  createGraphiteThemeVars,
  createLucaThemeVars,
  createThemeVars,
  ASH_THEME_COLORS,
  GRAPHITE_THEME_COLORS,
  hexToHsl,
  INVERSE_THEME_COLORS,
  luminance,
  PAPER_THEME_COLORS,
  VOID_THEME_COLORS,
} from "./adaptive-theme.ts";

/**
 * THE INK CONTRACT.
 *
 * Every role that carries text must clear WCAG AA (4.5:1) against every
 * surface it can land on — including the FLOOR, which the rail and top chrome
 * sit on and which is a step away from the conversation surface in both
 * directions. `ink-ghost` is exempt: it is decorative and disabled states
 * only, and is asserted to stay BELOW the text roles so nobody promotes it.
 *
 * This test exists because the failure it guards against is invisible in
 * review: light palettes derived from syntax themes shipped message copy at
 * 2.6:1 and section labels at 2.2:1 for as long as they existed, and every
 * one of those values looked deliberate in the source.
 */
const AA = 4.5;

function assertInkContract(
  name,
  { floor, surface, raised, ink, inkMuted, inkFaint, inkGhost },
) {
  for (const [ground, groundName] of [
    [surface, "surface"],
    [floor, "floor"],
    [raised, "raised"],
  ]) {
    for (const [role, hex] of [
      ["ink", ink],
      ["ink-muted", inkMuted],
      ["ink-faint", inkFaint],
    ]) {
      const ratio = contrastRatio(hex, ground);
      assert.ok(
        ratio >= AA,
        `${name}: ${role} on ${groundName} is ${ratio.toFixed(2)}:1, under AA`,
      );
    }
    assert.ok(
      contrastRatio(ink, ground) > contrastRatio(inkMuted, ground),
      `${name}: ink must outrank ink-muted on ${groundName}`,
    );
    assert.ok(
      contrastRatio(inkMuted, ground) > contrastRatio(inkFaint, ground),
      `${name}: ink-muted must outrank ink-faint on ${groundName}`,
    );
    if (inkGhost) {
      assert.ok(
        contrastRatio(inkFaint, ground) > contrastRatio(inkGhost, ground),
        `${name}: ink-faint must outrank ink-ghost on ${groundName}`,
      );
    }
  }
}

test("Paper holds the ink contract", () => {
  assertInkContract("Paper", PAPER_THEME_COLORS);
});

test("Graphite holds the ink contract despite being deliberately quieter", () => {
  assertInkContract("Graphite", GRAPHITE_THEME_COLORS);
});

test("Paper reproduces Void's ink ratios, so hierarchy reads the same in both", () => {
  // Void's ladder, from conversation-shell.css, measured on its own surface.
  const VOID = {
    surface: "#05050a",
    ink: "#ebedef",
    inkMuted: "#b4b6b8",
    inkFaint: "#86878a",
  };
  for (const role of ["ink", "inkMuted", "inkFaint"]) {
    const voidRatio = contrastRatio(VOID[role], VOID.surface);
    const paperRatio = contrastRatio(
      PAPER_THEME_COLORS[role],
      PAPER_THEME_COLORS.surface,
    );
    const drift = Math.abs(paperRatio - voidRatio) / voidRatio;
    assert.ok(
      drift < 0.08,
      `${role}: Paper is ${paperRatio.toFixed(2)}:1 against Void's ${voidRatio.toFixed(2)}:1 — ${(drift * 100).toFixed(0)}% apart`,
    );
  }
});

test("a derived light palette cannot ship the collapsed ladder that syntax themes hand it", () => {
  // solarized-light: message copy rendered at 2.6:1, and its comment color is
  // close enough to its foreground that the muted step used to vanish.
  const { isDark, vars } = createThemeVars("#fdf6e3", "#586e75", "#93a1a1");
  assert.equal(isDark, false);
  assert.notEqual(vars["--mn-ink"], vars["--mn-ink-muted"]);
  assert.notEqual(vars["--mn-ink-muted"], vars["--mn-ink-faint"]);

  // Even when the theme hands over a comment color IDENTICAL to its
  // foreground — the common case, and the one that collapsed the ladder.
  const collapsed = createThemeVars("#eff1f5", "#4c4f69", "#4c4f69");
  assert.notEqual(collapsed.vars["--mn-ink"], collapsed.vars["--mn-ink-muted"]);
  assert.notEqual(
    collapsed.vars["--mn-ink-muted"],
    collapsed.vars["--mn-ink-faint"],
  );
});

test("the first-party Luca palette remains stylesheet-owned", () => {
  const { isDark, vars } = createLucaThemeVars();

  assert.equal(isDark, true);
  assert.equal(vars["--mn-floor"], undefined);
  assert.equal(vars["--mn-surface"], undefined);
});

test("a user-selected dark palette supplies the permanent Luca shell ladder", () => {
  const { isDark, vars } = createThemeVars("#0d1117", "#f0f6fc", "#8b949e");

  assert.equal(isDark, true);
  for (const key of [
    "--mn-floor",
    "--mn-surface",
    "--mn-raised",
    "--mn-hover",
    "--mn-border",
    "--mn-ink",
    "--mn-ink-muted",
  ]) {
    assert.equal(typeof vars[key], "string", `${key} was not projected`);
  }
  assert.notEqual(vars["--mn-floor"], vars["--mn-surface"]);
});

test("a user-selected light palette keeps the same shell contract", () => {
  const { isDark, vars } = createThemeVars("#ffffff", "#24292f", "#57606a");

  assert.equal(isDark, false);
  assert.equal(typeof vars["--mn-floor"], "string");
  assert.equal(typeof vars["--mn-surface"], "string");
  assert.equal(typeof vars["--mn-glass"], "string");
});

test("Graphite projects the approved charcoal study onto the Luca shell", () => {
  const { isDark, vars } = createGraphiteThemeVars();

  assert.equal(isDark, true);
  for (const [token, color] of [
    ["--mn-floor", GRAPHITE_THEME_COLORS.floor],
    ["--mn-navigator", GRAPHITE_THEME_COLORS.navigator],
    ["--mn-surface", GRAPHITE_THEME_COLORS.surface],
    ["--mn-raised", GRAPHITE_THEME_COLORS.raised],
    ["--mn-hover", GRAPHITE_THEME_COLORS.hover],
    ["--mn-glass", GRAPHITE_THEME_COLORS.glass],
    ["--mn-border", GRAPHITE_THEME_COLORS.border],
    ["--mn-border-strong", GRAPHITE_THEME_COLORS.borderStrong],
    ["--mn-ink", GRAPHITE_THEME_COLORS.ink],
    ["--mn-ink-muted", GRAPHITE_THEME_COLORS.inkMuted],
    ["--mn-ink-faint", GRAPHITE_THEME_COLORS.inkFaint],
    ["--mn-focus", GRAPHITE_THEME_COLORS.focus],
  ]) {
    assert.equal(vars[token], hexToHsl(color), `${token} drifted`);
  }
});

test("Graphite preserves semantic colors and accessible secondary copy", () => {
  const graphite = createGraphiteThemeVars().vars;
  const luca = createLucaThemeVars().vars;

  for (const token of [
    "--destructive",
    "--status-added",
    "--status-deleted",
    "--status-modified",
    "--ui-warning",
  ]) {
    assert.equal(graphite[token], luca[token], `${token} was recolored`);
  }

  const surface = luminance(GRAPHITE_THEME_COLORS.raised);
  const muted = luminance(GRAPHITE_THEME_COLORS.inkMuted);
  const contrast =
    (Math.max(surface, muted) + 0.05) / (Math.min(surface, muted) + 0.05);
  assert.ok(contrast >= 4.5, `secondary copy contrast was ${contrast}`);
});

/**
 * THE FOCUS CONTRACT.
 *
 * Focus is the focused element's own edge moving toward the ink it is written
 * in — never a hue of its own, and never quieter than a person can see. Two
 * failures are guarded here, both of which shipped:
 *
 *   HUE. Every palette carried a saturated blue (`#60a5fa`, `#1f5fc4` on
 *   Paper) while the system's only accent is slate-as-signal. A focus ring was
 *   the most colourful thing on screen.
 *
 *   CONTRAST. The replacement cannot simply be quiet. WCAG 2.2 SC 1.4.11 puts
 *   a 3:1 floor on a focus indicator against what it sits on, and the raised
 *   surface — the brightest ground focus lands on in a dark palette — is the
 *   worst case. `inkGhost` measures ~2.7:1 there, which is why the rule anchors
 *   on `inkFaint` and not one rung lower.
 */
const FOCUS_INDICATOR_FLOOR = 3;

test("every palette's focus is ink-derived, never an accent hue", () => {
  for (const [name, palette] of [
    ["Void", VOID_THEME_COLORS],
    ["Ash", ASH_THEME_COLORS],
    ["Inverse", INVERSE_THEME_COLORS],
    ["Graphite", GRAPHITE_THEME_COLORS],
    ["Paper", PAPER_THEME_COLORS],
  ]) {
    assert.equal(
      palette.focus,
      palette.inkFaint,
      `${name}: focus must be the faint ink role, not a colour of its own`,
    );

    for (const [ground, groundName] of [
      [palette.surface, "surface"],
      [palette.floor, "floor"],
      [palette.raised, "raised"],
      [palette.hover, "hover"],
    ]) {
      const ratio = contrastRatio(palette.focus, ground);
      assert.ok(
        ratio >= FOCUS_INDICATOR_FLOOR,
        `${name}: focus on ${groundName} is ${ratio.toFixed(2)}:1, under the 3:1 focus-indicator floor`,
      );
    }
  }
});

test("a syntax-derived palette gets the same ink-derived focus", () => {
  const { vars } = createThemeVars("#1e1e2e", "#cdd6f4", "#9399b2");
  assert.equal(vars["--mn-focus"], vars["--mn-ink-faint"]);
  assert.notEqual(vars["--mn-focus"], vars["--mn-ink"]);
});
