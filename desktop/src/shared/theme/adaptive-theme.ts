/**
 * Adaptive Theme Engine
 *
 * Derives shadcn CSS variables from a syntax theme's key colors (bg, fg, comment, git).
 * Detects light vs dark from background luminance and adjusts accordingly.
 *
 * Ported from builderbot/apps/staged/src/lib/theme.ts, flattened to emit
 * shadcn CSS vars directly (no intermediate Theme object).
 */

// =============================================================================
// Color Utilities
// =============================================================================

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB {
  const long = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(
    hex,
  );
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }

  const short = /^#?([a-f\d])([a-f\d])([a-f\d])([a-f\d])?$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }

  return { r: 128, g: 128, b: 128 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function mix(hex1: string, hex2: string, factor: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return rgbToHex({
    r: c1.r + (c2.r - c1.r) * factor,
    g: c1.g + (c2.g - c1.g) * factor,
    b: c1.b + (c2.b - c1.b) * factor,
  });
}

function adjust(hex: string, amount: number): string {
  const target = amount > 0 ? "#ffffff" : "#000000";
  return mix(hex, target, Math.abs(amount));
}

function overlay(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// =============================================================================
// Chrome Color Calculation
// =============================================================================

const CONTRAST_VALUE = 0.035;
const CONTRAST_OFFSET = 0.0135;

function calculateLumDiff(bgLum: number): number {
  return CONTRAST_VALUE * Math.log(1 + (bgLum + CONTRAST_OFFSET) * 10);
}

function findColorWithLuminance(baseColor: string, targetLum: number): string {
  const baseLum = luminance(baseColor);
  if (Math.abs(baseLum - targetLum) < 0.001) return baseColor;

  const target = targetLum < baseLum ? "#000000" : "#ffffff";
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const testLum = luminance(mix(baseColor, target, mid));
    const diff = testLum - targetLum;

    if (Math.abs(diff) < 0.001) break;

    if (target === "#000000") {
      if (testLum > targetLum) lo = mid;
      else hi = mid;
    } else {
      if (testLum < targetLum) lo = mid;
      else hi = mid;
    }
  }
  return mix(baseColor, target, (lo + hi) / 2);
}

function calculateChromeColors(syntaxBg: string): {
  chrome: string;
  primary: string;
} {
  const bgLum = luminance(syntaxBg);
  const lumDiff = calculateLumDiff(bgLum);
  const targetChromeLum = bgLum - lumDiff;

  if (targetChromeLum >= 0) {
    return {
      chrome: findColorWithLuminance(syntaxBg, targetChromeLum),
      primary: syntaxBg,
    };
  }

  return {
    chrome: findColorWithLuminance(syntaxBg, 0),
    primary: findColorWithLuminance(syntaxBg, lumDiff),
  };
}

// =============================================================================
// Hex → HSL component format ("H S% L%") for Tailwind's hexToHsl() wrappers
// =============================================================================

export function hexToHsl(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return `0 0% ${(l * 100).toFixed(1)}%`;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6;
  } else {
    h = ((rn - gn) / d + 4) / 6;
  }

  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(2)}% ${(l * 100).toFixed(1)}%`;
}

// =============================================================================
// Adaptive Theme Generator — emits shadcn CSS vars directly
// =============================================================================

export interface ThemeGitColors {
  added: string | null;
  deleted: string | null;
  modified: string | null;
}

export interface ThemeResult {
  isDark: boolean;
  vars: Record<string, string>;
}

/**
 * Source colors for the approved low-contrast charcoal shell. These values
 * come from the conversation-experience study rather than a syntax theme.
 * Secondary ink is lifted just enough to keep readable UI copy at WCAG AA on
 * the raised surface while preserving the study's quieter hierarchy.
 */
export const GRAPHITE_THEME_COLORS = {
  floor: "#0d0d0f",
  navigator: "#0d0d0f",
  surface: "#101012",
  raised: "#151517",
  hover: "#18181b",
  glass: "#0b0b0d",
  border: "#242426",
  borderStrong: "#333336",
  ink: "#eaeaec",
  inkMuted: "#808085",
  inkFaint: "#5f5f65",
  focus: "#d6d6d8",
} as const;

/**
 * The first-party Luca shell is intentionally not derived from a syntax
 * palette. It establishes a stable, dark working canvas while syntax themes
 * continue to govern code blocks and optional appearance choices.
 *
 * SINGLE SOURCE OF TRUTH: the shell palette (surfaces, ink, border, primary,
 * sidebar, focus) is owned by CSS — `globals/conversation-shell.css`, under
 * `:root[data-buzz-sidebar]`, via the `--mn-*` scale. This function must NOT
 * emit those tokens.
 *
 * These vars are applied as *inline styles on `:root`*, which outrank every
 * stylesheet rule regardless of specificity. Re-adding a shell token here
 * silently overrides the CSS and desaturates/re-tints the whole app — that is
 * exactly how the shell previously ended up painted in a bluer, more saturated
 * palette than the one it declared, with a saturated blue on fills, active
 * states and focus rings. Only tokens the CSS layer does not define belong
 * below.
 */
export function createLucaThemeVars(): ThemeResult {
  return {
    isDark: true,
    vars: {
      "--destructive": "0 67% 60%",
      "--destructive-foreground": "0 0% 100%",
      "--chart-1": "213 94% 68%",
      "--chart-2": "160 48% 58%",
      "--chart-3": "37 66% 62%",
      "--chart-4": "284 46% 70%",
      "--chart-5": "0 67% 68%",
      "--huddle-drawer-surface": "222 15% 10%",
      "--huddle-control-surface": "222 12% 16%",
      "--huddle-control-hover-surface": "222 11% 20%",
      "--huddle-control-chevron-surface": "222 14% 12%",
      "--huddle-control-chevron-hover-surface": "222 12% 16%",
      "--huddle-control-foreground": "215 20% 92%",
      "--huddle-popover-surface": "222 14% 12%",
      "--huddle-popover-border": "220 10% 22%",
      "--huddle-tooltip-surface": "222 12% 16%",
      "--huddle-tooltip-foreground": "215 20% 92%",
      "--status-added": "#67c587",
      "--status-deleted": "#ef7b7b",
      "--status-modified": "#d6a95c",
      "--ui-warning": "#d6a95c",
      "--ui-warning-bg": "rgb(214 169 92 / 12%)",
    },
  };
}

/**
 * Build the Graphite app palette while retaining Luca's audited semantic
 * signal colors. Only shell and huddle surfaces are recolored; provider marks,
 * destructive actions, Git status, charts, and warnings keep their established
 * semantic identities.
 */
export function createGraphiteThemeVars(): ThemeResult {
  const semanticVars = createLucaThemeVars().vars;
  const colors = GRAPHITE_THEME_COLORS;

  return {
    isDark: true,
    vars: {
      ...semanticVars,
      "--mn-floor": hexToHsl(colors.floor),
      "--mn-navigator": hexToHsl(colors.navigator),
      "--mn-surface": hexToHsl(colors.surface),
      "--mn-raised": hexToHsl(colors.raised),
      "--mn-hover": hexToHsl(colors.hover),
      "--mn-glass": hexToHsl(colors.glass),
      "--mn-surface-raised": hexToHsl(colors.raised),
      "--mn-surface-hover": hexToHsl(colors.hover),
      "--mn-border": hexToHsl(colors.border),
      "--mn-border-strong": hexToHsl(colors.borderStrong),
      "--mn-ink": hexToHsl(colors.ink),
      "--mn-ink-muted": hexToHsl(colors.inkMuted),
      "--mn-ink-faint": hexToHsl(colors.inkFaint),
      "--mn-focus": hexToHsl(colors.focus),
      "--huddle-drawer-surface": hexToHsl(colors.raised),
      "--huddle-control-surface": hexToHsl(colors.hover),
      "--huddle-control-hover-surface": hexToHsl(colors.border),
      "--huddle-control-chevron-surface": hexToHsl(colors.surface),
      "--huddle-control-chevron-hover-surface": hexToHsl(colors.hover),
      "--huddle-control-foreground": hexToHsl(colors.ink),
      "--huddle-popover-surface": hexToHsl(colors.raised),
      "--huddle-popover-border": hexToHsl(colors.borderStrong),
      "--huddle-tooltip-surface": hexToHsl(colors.hover),
      "--huddle-tooltip-foreground": hexToHsl(colors.ink),
    },
  };
}

/**
 * Derive a full set of shadcn CSS variables from syntax theme colors.
 *
 * Takes bg, fg, comment hex colors (+ optional git decoration colors) and
 * returns the var map ready to apply via style.setProperty().
 */
export function createThemeVars(
  syntaxBg: string,
  syntaxFg: string,
  syntaxComment: string,
  gitColors?: ThemeGitColors,
): ThemeResult {
  const isDark = luminance(syntaxBg) < 0.5;

  const { chrome: chromeColor, primary: primaryBg } =
    calculateChromeColors(syntaxBg);

  const dir = isDark ? 1 : -1;
  const elevate = (amount: number) => adjust(primaryBg, dir * amount);

  // Git/accent colors with fallbacks
  const fallbackGreen = isDark ? "#3fb950" : "#1a7f37";
  const fallbackRed = isDark ? "#f85149" : "#cf222e";
  const fallbackOrange = isDark ? "#d29922" : "#9a6700";

  const accentGreen = gitColors?.added ?? fallbackGreen;
  const accentRed = gitColors?.deleted ?? fallbackRed;
  const accentOrange = fallbackOrange;

  // Derived colors
  const borderColor = mix(primaryBg, syntaxFg, isDark ? 0.15 : 0.12);
  const hoverBg = elevate(0.06);
  const huddleControlBg = isDark ? mix(hoverBg, syntaxFg, 0.14) : "#333333";
  const huddleControlHoverBg = isDark
    ? mix(huddleControlBg, syntaxFg, 0.08)
    : "#3d3d3d";
  const huddleChevronBg = isDark
    ? mix(huddleControlBg, "#000000", 0.2)
    : "#292929";
  const huddleChevronHoverBg = isDark
    ? mix(huddleChevronBg, huddleControlBg, 0.6)
    : "#383838";
  const huddlePopoverBg = huddleChevronBg;
  const huddlePopoverBorder = huddleControlHoverBg;
  const huddleTooltipBg = huddleControlBg;
  const primaryFg = hexToHsl(primaryBg);
  const textFg = hexToHsl(syntaxFg);
  const huddleControlFg = isDark ? textFg : "0 0% 98%";

  return {
    isDark,
    vars: {
      // Luca shell palette. The shell itself is permanent; these values let a
      // user-selected syntax theme recolor the same rail/card hierarchy rather
      // than swapping back to the legacy application structure.
      "--mn-floor": hexToHsl(chromeColor),
      "--mn-surface": hexToHsl(primaryBg),
      "--mn-raised": hexToHsl(elevate(0.025)),
      "--mn-hover": hexToHsl(hoverBg),
      "--mn-glass": hexToHsl(
        isDark ? adjust(chromeColor, -0.08) : adjust(chromeColor, 0.04),
      ),
      "--mn-surface-raised": hexToHsl(elevate(0.025)),
      "--mn-surface-hover": hexToHsl(hoverBg),
      "--mn-border": hexToHsl(borderColor),
      "--mn-border-strong": hexToHsl(
        mix(borderColor, syntaxFg, isDark ? 0.22 : 0.16),
      ),
      "--mn-ink": textFg,
      "--mn-ink-muted": hexToHsl(syntaxComment),
      "--mn-ink-faint": hexToHsl(
        mix(syntaxComment, primaryBg, isDark ? 0.18 : 0.1),
      ),
      "--mn-focus": textFg,

      // Backgrounds
      "--background": hexToHsl(primaryBg),
      "--card": hexToHsl(primaryBg),
      "--popover": hexToHsl(elevate(0.08)),
      "--muted": hexToHsl(hoverBg),
      "--accent": hexToHsl(hoverBg),
      "--secondary": hexToHsl(hoverBg),
      "--huddle-drawer-surface": isDark ? hexToHsl(hoverBg) : "0 0% 0%",
      "--huddle-control-surface": hexToHsl(huddleControlBg),
      "--huddle-control-hover-surface": hexToHsl(huddleControlHoverBg),
      "--huddle-control-chevron-surface": hexToHsl(huddleChevronBg),
      "--huddle-control-chevron-hover-surface": hexToHsl(huddleChevronHoverBg),
      "--huddle-control-foreground": huddleControlFg,
      "--huddle-popover-surface": hexToHsl(huddlePopoverBg),
      "--huddle-popover-border": hexToHsl(huddlePopoverBorder),
      "--huddle-tooltip-surface": hexToHsl(huddleTooltipBg),
      "--huddle-tooltip-foreground": huddleControlFg,

      // Foregrounds
      "--foreground": textFg,
      "--card-foreground": textFg,
      "--popover-foreground": textFg,
      "--muted-foreground": hexToHsl(syntaxComment),
      "--accent-foreground": textFg,
      "--secondary-foreground": textFg,

      // Destructive
      "--destructive": hexToHsl(accentRed),
      "--destructive-foreground": primaryFg,

      // Borders
      "--border": hexToHsl(borderColor),
      "--input": hexToHsl(borderColor),
      "--ring": textFg,

      // Sidebar
      "--sidebar-background": hexToHsl(chromeColor),
      "--sidebar-foreground": textFg,
      "--sidebar-accent": hexToHsl(primaryBg),
      "--sidebar-accent-foreground": textFg,
      "--sidebar-border": hexToHsl(borderColor),
      "--sidebar-ring": hexToHsl(borderColor),

      // Status colors (hex — used directly via var())
      "--status-added": accentGreen,
      "--status-deleted": accentRed,
      "--status-modified": accentOrange,

      // Warning
      "--ui-warning": accentOrange,
      "--ui-warning-bg": overlay(accentOrange, isDark ? 0.1 : 0.08),
    },
  };
}
