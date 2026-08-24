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

/** WCAG relative-contrast ratio between two opaque colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Move `color` until it holds exactly `target` contrast against `bg`.
 *
 * A syntax theme is written to color code on a canvas, not to carry an
 * application's text hierarchy, so its foreground and comment colors land
 * wherever that job put them — `solarized-light` renders message copy at
 * 2.6:1, and in most light themes the comment color equals the foreground
 * outright, which collapses the three-step ink ladder into one step and
 * leaves components to invent hierarchy out of alpha.
 *
 * Rather than trusting those colors, each ink role is solved here: too weak
 * and the color is pushed toward black or white (whichever direction gains
 * contrast against this background), too strong and it is pulled back toward
 * the background. Either way the theme's own hue survives — only its distance
 * from the page changes.
 */
function solveContrast(color: string, bg: string, target: number): string {
  const current = contrastRatio(color, bg);
  const toward =
    current < target ? (luminance(bg) > 0.5 ? "#000000" : "#ffffff") : bg;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const reached = contrastRatio(mix(color, toward, mid), bg) >= target;
    // Mixing toward black/white raises contrast; toward bg lowers it. The
    // half that still satisfies the goal is the half to keep searching.
    if (current < target ? reached : !reached) hi = mid;
    else lo = mid;
  }
  return mix(color, toward, hi);
}

/**
 * Contrast targets for palettes derived from a syntax theme.
 *
 * Deliberately below the first-party ladder (17 / 10 / 5.7 / 3.4): an
 * optional appearance should keep some of its own softness. None of the
 * text-bearing roles may sit under the 4.5:1 AA floor, which is what
 * `ink-faint` is pinned just above.
 */
const DERIVED_INK_TARGETS = {
  ink: 11,
  muted: 7,
  // Solved against the conversation surface, but the rail and top chrome sit
  // on the FLOOR, which is a step darker in a light palette — a role solved to
  // exactly 4.7 there rendered "Search everything" and the section labels at
  // 4.4. The margin here is what keeps the sidebar above AA too.
  faint: 5.1,
  ghost: 3,
} as const;

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
 *
 * Graphite is the system's one DELIBERATE exception to the ink contract in
 * the shell scale: it is meant to be quieter than Void, so its roles sit
 * below Void's targets on purpose. What it may not do is fall through the
 * floor. Its secondary ink measured 4.84:1 and its faint ink 3.00:1 against
 * its own surface — the latter under WCAG AA while carrying timestamps and
 * section labels at 11px. Both are lifted here to the least value that clears
 * AA on the RAISED surface (the worst case, since plates sit above the
 * conversation ground), which preserves the study's hush and stops the theme
 * from shipping unreadable meta text.
 */
/**
 * Void — the original blackout ladder, exactly as it shipped as the default
 * before the Composite scale landed (2026-08-23). Pure black floor and all:
 * that violates the no-pure-black rule for defaults, but Void is chosen, not
 * inherited — preserving it unchanged is the point.
 */
export const VOID_THEME_COLORS = {
  floor: "#000000",
  navigator: "#030304",
  surface: "#050506",
  raised: "#070708",
  hover: "#0a0a0b",
  glass: "#000000",
  recess: "#020203",
  border: "#191a1c",
  borderStrong: "#262729",
  ink: "#ebedef",
  inkMuted: "#b4b6b8",
  inkFaint: "#858788",
  inkGhost: "#626364",
  focus: "#60a5fa",
} as const;

/**
 * Ash — the original carved-neutral ladder, exactly as decided 2026-08-23:
 * pure greys (R=G=B), +9 RGB steps, cream ink. Preserved unchanged when the
 * Linear-dose ladder took the default.
 */
export const ASH_THEME_COLORS = {
  floor: "#0e0e0e",
  navigator: "#0e0e0e",
  surface: "#171717",
  raised: "#202020",
  hover: "#282828",
  glass: "#090909",
  recess: "#101010",
  border: "#2b2b2b",
  borderStrong: "#383838",
  ink: "#f4f3f0",
  inkMuted: "#c4c3bf",
  inkFaint: "#97968f",
  inkGhost: "#706f6e",
  focus: "#60a5fa",
} as const;

/**
 * Inverse — the Slate (Linear-dose) ladder with rail and content swapped:
 * light rail #1b1c1d over a deep conversation ground #0d0e0f. Same lean
 * (B = R+2, G = R+1), same spans; objects re-seat on the dark ground and
 * the recess digs toward true dark. Riley, 2026-08-24.
 */
export const INVERSE_THEME_COLORS = {
  floor: "#1b1c1d",
  navigator: "#1b1c1d",
  surface: "#0d0e0f",
  raised: "#1d1e1f",
  hover: "#252627",
  glass: "#050607",
  recess: "#070809",
  border: "#2a2c2f",
  borderStrong: "#35373a",
  ink: "#f4f3f0",
  inkMuted: "#c4c3bf",
  inkFaint: "#97968f",
  inkGhost: "#706f6e",
  focus: "#60a5fa",
} as const;

export const GRAPHITE_THEME_COLORS = {
  floor: "#0d0d0f",
  navigator: "#0d0d0f",
  surface: "#101012",
  raised: "#151517",
  hover: "#18181b",
  glass: "#0b0b0d",
  recess: "#0a0a0b",
  border: "#242426",
  borderStrong: "#333336",
  ink: "#eaeaef",
  inkMuted: "#9d9da2",
  inkFaint: "#8a8a8f",
  inkGhost: "#5d5d62",
  focus: "#d6d6d8",
} as const;

/**
 * Paper — the authored light palette, and the light half Void never had.
 *
 * Until this existed, every light appearance in the product was *derived* from
 * a Shiki code-editor theme: three colors (background, foreground, comment)
 * extrapolated into an entire application. That produced a default light mode
 * whose message copy rendered at 3.6:1 against dark mode's 8.9:1, and whose
 * `comment` color so often equalled `foreground` that the three-step ink
 * ladder collapsed to one — leaving components to invent hierarchy out of
 * alpha values that had been tuned against near-white ink and landed as low
 * as 2.2:1 once the ink went dark.
 *
 * WARM GROUND, COOL INK. The surfaces are a warm off-white (hue 38) so the
 * light mode reads as paper rather than as an inverted screen; the ink stays
 * on the cool neutral axis (hue 222) the dark shell already speaks. Warm
 * paper under cool ink is the pairing printed matter has used for a century,
 * and it keeps the product recognisably itself in both modes.
 *
 * THE LADDER IS CONTRAST-MATCHED, NOT LIGHTNESS-MATCHED. Each ink role was
 * solved to hold the same ratio against its own surface that the same role
 * holds in Void (~17:1, ~10:1, ~5.7:1, ~3.4:1). Hierarchy therefore reads
 * identically in a dark room and in daylight, which lightness numbers picked
 * by eye can never guarantee. `adaptive-theme.test.mjs` asserts the contract.
 */
export const PAPER_THEME_COLORS = {
  floor: "#f6f4f2",
  navigator: "#f8f7f5",
  surface: "#fcfbf9",
  raised: "#fefdfd",
  hover: "#eeedea",
  glass: "#f1f0ed",
  recess: "#eceae6",
  border: "#ebeae6",
  borderStrong: "#dcd8d2",
  ink: "#15161b",
  inkMuted: "#3d4048",
  inkFaint: "#60646f",
  inkGhost: "#848892",
  focus: "#1f5fc4",
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
      "--mn-ink-ghost": hexToHsl(colors.inkGhost),
      "--mn-recess": hexToHsl(colors.recess),
    },
  };
}

/**
 * Build the Void app palette — the preserved blackout shell. Same recipe as
 * Graphite: only shell and huddle surfaces recolor; audited semantic signal
 * colors stay.
 */
export function createVoidThemeVars(): ThemeResult {
  const semanticVars = createLucaThemeVars().vars;
  const colors = VOID_THEME_COLORS;

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
      "--mn-ink-ghost": hexToHsl(colors.inkGhost),
      "--mn-recess": hexToHsl(colors.recess),
    },
  };
}

/** Build the Ash app palette — the preserved carved-neutral shell. */
export function createAshThemeVars(): ThemeResult {
  const semanticVars = createLucaThemeVars().vars;
  const colors = ASH_THEME_COLORS;

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
      "--mn-ink-ghost": hexToHsl(colors.inkGhost),
      "--mn-recess": hexToHsl(colors.recess),
    },
  };
}

/** Build the Inverse app palette — the light-rail arrangement. */
export function createInverseThemeVars(): ThemeResult {
  const semanticVars = createLucaThemeVars().vars;
  const colors = INVERSE_THEME_COLORS;

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
      "--mn-ink-ghost": hexToHsl(colors.inkGhost),
      "--mn-recess": hexToHsl(colors.recess),
    },
  };
}

/**
 * Build the Paper palette — see {@link PAPER_THEME_COLORS}.
 *
 * Light mode is not dark mode with the values flipped, and three things have
 * to be re-decided rather than inverted:
 *
 * 1. `--primary` is the far end of the ink ramp, so on paper it is the DARK
 *    end and its foreground is the page. Inverting the dark values here would
 *    paint a near-white pill with near-white text on it.
 * 2. The lit edge simulates light from above catching a bevel. A 3.5% white
 *    inset does nothing on a surface that is already 99% white, so the object
 *    reads its depth from a hairline shadow beneath instead.
 * 3. The semantic signals (destructive, git status, warning) are tuned for a
 *    dark canvas; at those lightnesses they fall under 3:1 on paper. Each one
 *    is restated at a lightness that carries on a light ground.
 *
 * The huddle bar stays dark in both modes — it is a video-call surface, and
 * the base light palette has always treated it that way.
 */
export function createPaperThemeVars(): ThemeResult {
  const colors = PAPER_THEME_COLORS;

  return {
    isDark: false,
    vars: {
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
      "--mn-ink-ghost": hexToHsl(colors.inkGhost),
      "--mn-recess": hexToHsl(colors.recess),
      "--mn-focus": hexToHsl(colors.focus),

      // (1) The ramp's far end, which on paper is the ink end.
      "--primary": hexToHsl(colors.ink),
      "--primary-foreground": hexToHsl(colors.surface),
      "--sidebar-primary": hexToHsl(colors.ink),
      "--sidebar-primary-foreground": hexToHsl(colors.surface),

      // (2) Depth from a shadow beneath rather than a highlight above.
      "--mn-lit-edge": "0 1px 1.5px rgb(21 22 27 / 0.045)",

      // (3) Signals restated for a light ground.
      "--destructive": "0 64% 44%",
      "--destructive-foreground": hexToHsl(colors.surface),
      "--chart-1": "213 72% 46%",
      "--chart-2": "160 44% 34%",
      "--chart-3": "37 62% 38%",
      "--chart-4": "284 38% 46%",
      "--chart-5": "0 58% 48%",
      "--status-added": "#1c7a45",
      "--status-deleted": "#b3352f",
      "--status-modified": "#8a6212",
      "--ui-warning": "#8a6212",
      "--ui-warning-bg": "rgb(138 98 18 / 10%)",

      // The huddle bar keeps its own dark canvas in both modes.
      "--huddle-drawer-surface": "0 0% 0%",
      "--huddle-control-surface": "0 0% 20%",
      "--huddle-control-hover-surface": "0 0% 24%",
      "--huddle-control-chevron-surface": "0 0% 16%",
      "--huddle-control-chevron-hover-surface": "0 0% 22%",
      "--huddle-control-foreground": "0 0% 98%",
      "--huddle-popover-surface": "0 0% 16%",
      "--huddle-popover-border": "0 0% 24%",
      "--huddle-tooltip-surface": "0 0% 20%",
      "--huddle-tooltip-foreground": "0 0% 98%",
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
  // The ink ladder, solved against the surface this theme actually paints
  // rather than taken on faith from the syntax palette. `muted` starts from
  // the comment color so a theme that does have a distinct one keeps its hue;
  // where comment equals foreground — the common case in light themes, and
  // the reason the ladder used to collapse — the solve separates them anyway.
  const inkHex = solveContrast(syntaxFg, primaryBg, DERIVED_INK_TARGETS.ink);
  const inkMutedHex = solveContrast(
    syntaxComment,
    primaryBg,
    DERIVED_INK_TARGETS.muted,
  );
  const inkFaintHex = solveContrast(
    inkMutedHex,
    primaryBg,
    DERIVED_INK_TARGETS.faint,
  );
  const inkGhostHex = solveContrast(
    inkFaintHex,
    primaryBg,
    DERIVED_INK_TARGETS.ghost,
  );

  const primaryFg = hexToHsl(primaryBg);
  const textFg = hexToHsl(inkHex);
  const mutedFg = hexToHsl(inkMutedHex);
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
      "--mn-ink-muted": mutedFg,
      "--mn-ink-faint": hexToHsl(inkFaintHex),
      "--mn-ink-ghost": hexToHsl(inkGhostHex),
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
      "--muted-foreground": mutedFg,
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
