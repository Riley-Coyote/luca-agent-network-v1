/**
 * Theme Loader
 *
 * Loads Shiki theme JSON files and extracts key colors (bg, fg, comment, git).
 * Only imports the theme JSON — the Shiki highlighter engine is not used here.
 */

import type { ThemeRegistrationRaw } from "shiki";

/**
 * Legacy internal key for Luca's first-party shell theme. It intentionally
 * resolves to GitHub Dark for code highlighting while the app shell receives
 * its stable Luca tokens from ThemeProvider.
 */
export const BUZZ_THEME_NAME = "buzz";

/**
 * Legacy internal companion key retained for existing preferences. Both
 * first-party keys resolve to the same dark Luca shell.
 */
export const BUZZ_DARK_THEME_NAME = "buzz-dark";

/**
 * First-party low-contrast charcoal palette derived from the approved
 * conversation-experience study. It is an app theme, not a bundled Shiki
 * theme, so code highlighting resolves through {@link GRAPHITE_BASE_THEME}.
 */
export const GRAPHITE_THEME_NAME = "graphite";

/**
 * Void — the original near-black blackout palette, preserved as a named
 * theme when the default shell moved to the Composite (Ash) ladder on
 * 2026-08-23. Chosen deliberately, it is the OLED-black option; as a
 * default it was a blackout theme doing a default's job.
 */
export const VOID_THEME_NAME = "void";

/**
 * Ash — the carved-neutral ladder (pure R=G=B greys, cream ink) Riley chose
 * on 2026-08-23, preserved as a named theme when the default moved to the
 * Linear-dose (Slate) ladder the next night. Kept for a live three-way
 * trial: Ash / Slate / Inverse.
 */
export const ASH_THEME_NAME = "ash";

/**
 * Inverse — the Slate ladder with rail and content swapped: a light rail
 * over a deep conversation ground (the arrangement Riley kept returning to
 * in Codex). Same lean, same spans; the stage goes dark and the furniture
 * recedes.
 */
export const INVERSE_THEME_NAME = "inverse";

/**
 * Paper — the first-party LIGHT palette, and Void's counterpart.
 *
 * Until it existed the shell had no authored light mode at all: choosing
 * "Light" in Appearance offered nothing but syntax themes, each one an entire
 * application extrapolated from a code editor's three colors. Paper is an app
 * palette like Void and Graphite, so its code highlighting resolves through
 * {@link PAPER_BASE_THEME}.
 */
export const PAPER_THEME_NAME = "paper";

/**
 * Smoke — the first-party palette authored FOR dark glass. It is an app
 * palette like Void, Graphite and Paper, so its code highlighting resolves
 * through {@link SMOKE_BASE_THEME}.
 */
export const SMOKE_THEME_NAME = "smoke";

/**
 * Dragon Glass — its own theme id, but not its own palette: it takes Smoke's
 * tokens and differs in the material weather it defaults to. Its code
 * highlighting resolves through {@link DRAGON_GLASS_BASE_THEME}.
 */
export const DRAGON_GLASS_THEME_NAME = "dragon-glass";

/**
 * Onyx — the dark-FLOOR dark mode, with elevated surfaces advancing brighter
 * than the base. Its code highlighting resolves through
 * {@link ONYX_BASE_THEME}.
 */
export const ONYX_THEME_NAME = "onyx";

/** The Luca shell uses GitHub Dark for its syntax-highlighting baseline. */
export const BUZZ_BASE_THEME: SyntaxThemeName = "github-dark";

/** The Shiki bundle Buzz Dark borrows its base palette from. */
export const BUZZ_DARK_BASE_THEME: SyntaxThemeName = "github-dark";

/** Graphite keeps the same restrained GitHub Dark syntax baseline as Ash. */
export const GRAPHITE_BASE_THEME: SyntaxThemeName = "github-dark";

/** Void shares the dark syntax baseline of the shell it used to be. */
export const VOID_BASE_THEME: SyntaxThemeName = "github-dark";

/** Ash and Inverse are arrangements of the same dark shell. */
export const ASH_BASE_THEME: SyntaxThemeName = "github-dark";
export const INVERSE_BASE_THEME: SyntaxThemeName = "github-dark";

/** Paper is the light shell, so its code blocks take the light baseline. */
export const PAPER_BASE_THEME: SyntaxThemeName = "github-light";

/** Smoke is a dark shell, so it keeps the GitHub Dark syntax baseline. */
export const SMOKE_BASE_THEME: SyntaxThemeName = "github-dark";

/** Dragon Glass is a dark shell, so it keeps the GitHub Dark baseline too. */
export const DRAGON_GLASS_BASE_THEME: SyntaxThemeName = "github-dark";

/** Onyx is a dark shell, so it keeps the GitHub Dark syntax baseline. */
export const ONYX_BASE_THEME: SyntaxThemeName = "github-dark";

/**
 * Resolve a theme name to the real Shiki bundled theme it maps to.
 *
 * Most themes map to themselves, but the Buzz aliases (`buzz` / `buzz-dark`)
 * are not bundled Shiki themes — they reuse the GitHub Light / GitHub Dark
 * palettes. The Shiki highlighter engine (used for fenced code blocks in
 * `CodeBlock.tsx`) only understands bundled names, so callers that hand a
 * theme name to `loadTheme` / `codeToTokens` must resolve it through here
 * first; passing a raw Buzz alias makes Shiki throw and code blocks fall
 * back to unhighlighted plain text.
 */
export function resolveShikiThemeName(name: string): SyntaxThemeName {
  if (name === BUZZ_THEME_NAME) return BUZZ_BASE_THEME;
  if (name === BUZZ_DARK_THEME_NAME) return BUZZ_DARK_BASE_THEME;
  if (name === GRAPHITE_THEME_NAME) return GRAPHITE_BASE_THEME;
  if (name === VOID_THEME_NAME) return VOID_BASE_THEME;
  if (name === ASH_THEME_NAME) return ASH_BASE_THEME;
  if (name === INVERSE_THEME_NAME) return INVERSE_BASE_THEME;
  if (name === PAPER_THEME_NAME) return PAPER_BASE_THEME;
  if (name === SMOKE_THEME_NAME) return SMOKE_BASE_THEME;
  if (name === DRAGON_GLASS_THEME_NAME) return DRAGON_GLASS_BASE_THEME;
  if (name === ONYX_THEME_NAME) return ONYX_BASE_THEME;
  return name as SyntaxThemeName;
}

// Available themes. The first two names are legacy storage keys for Luca's
// first-party dark shell; the rest are bundled syntax themes.
export const SYNTAX_THEMES = [
  "buzz",
  "buzz-dark",
  "graphite",
  "paper",
  "void",
  "ash",
  "inverse",
  "smoke",
  "dragon-glass",
  "onyx",
  "andromeeda",
  "aurora-x",
  "ayu-dark",
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dark-plus",
  "dracula",
  "dracula-soft",
  "everforest-dark",
  "everforest-light",
  "github-dark",
  "github-dark-default",
  "github-dark-dimmed",
  "github-dark-high-contrast",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-dark-hard",
  "gruvbox-dark-medium",
  "gruvbox-dark-soft",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "houston",
  "kanagawa-dragon",
  "kanagawa-lotus",
  "kanagawa-wave",
  "laserwave",
  "light-plus",
  "material-theme",
  "material-theme-darker",
  "material-theme-lighter",
  "material-theme-ocean",
  "material-theme-palenight",
  "min-dark",
  "min-light",
  "monokai",
  "night-owl",
  "nord",
  "one-dark-pro",
  "one-light",
  "plastic",
  "poimandres",
  "red",
  "rose-pine",
  "rose-pine-dawn",
  "rose-pine-moon",
  "slack-dark",
  "slack-ochin",
  "snazzy-light",
  "solarized-dark",
  "solarized-light",
  "synthwave-84",
  "tokyo-night",
  "vesper",
  "vitesse-black",
  "vitesse-dark",
  "vitesse-light",
] as const;

export type SyntaxThemeName = (typeof SYNTAX_THEMES)[number];

// Known light themes — used by the theme picker to show sun/moon icons
// for themes that haven't been loaded yet.
export const LIGHT_THEMES: ReadonlySet<SyntaxThemeName> = new Set([
  "paper",
  "catppuccin-latte",
  "everforest-light",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "kanagawa-lotus",
  "light-plus",
  "material-theme-lighter",
  "min-light",
  "one-light",
  "rose-pine-dawn",
  "slack-ochin",
  "snazzy-light",
  "solarized-light",
  "vitesse-light",
]);

// Static theme imports (Vite needs static strings for tree-shaking)
const themeImports: Record<
  SyntaxThemeName,
  () => Promise<{ default: ThemeRegistrationRaw }>
> = {
  // Both legacy first-party keys use the dark code palette beneath Luca's shell.
  buzz: () => import("shiki/themes/github-dark.mjs"),
  "buzz-dark": () => import("shiki/themes/github-dark.mjs"),
  graphite: () => import("shiki/themes/github-dark.mjs"),
  paper: () => import("shiki/themes/github-light.mjs"),
  void: () => import("shiki/themes/github-dark.mjs"),
  ash: () => import("shiki/themes/github-dark.mjs"),
  inverse: () => import("shiki/themes/github-dark.mjs"),
  smoke: () => import("shiki/themes/github-dark.mjs"),
  "dragon-glass": () => import("shiki/themes/github-dark.mjs"),
  onyx: () => import("shiki/themes/github-dark.mjs"),
  andromeeda: () => import("shiki/themes/andromeeda.mjs"),
  "aurora-x": () => import("shiki/themes/aurora-x.mjs"),
  "ayu-dark": () => import("shiki/themes/ayu-dark.mjs"),
  "catppuccin-frappe": () => import("shiki/themes/catppuccin-frappe.mjs"),
  "catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
  "catppuccin-macchiato": () => import("shiki/themes/catppuccin-macchiato.mjs"),
  "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
  "dark-plus": () => import("shiki/themes/dark-plus.mjs"),
  dracula: () => import("shiki/themes/dracula.mjs"),
  "dracula-soft": () => import("shiki/themes/dracula-soft.mjs"),
  "everforest-dark": () => import("shiki/themes/everforest-dark.mjs"),
  "everforest-light": () => import("shiki/themes/everforest-light.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
  "github-dark-default": () => import("shiki/themes/github-dark-default.mjs"),
  "github-dark-dimmed": () => import("shiki/themes/github-dark-dimmed.mjs"),
  "github-dark-high-contrast": () =>
    import("shiki/themes/github-dark-high-contrast.mjs"),
  "github-light": () => import("shiki/themes/github-light.mjs"),
  "github-light-default": () => import("shiki/themes/github-light-default.mjs"),
  "github-light-high-contrast": () =>
    import("shiki/themes/github-light-high-contrast.mjs"),
  "gruvbox-dark-hard": () => import("shiki/themes/gruvbox-dark-hard.mjs"),
  "gruvbox-dark-medium": () => import("shiki/themes/gruvbox-dark-medium.mjs"),
  "gruvbox-dark-soft": () => import("shiki/themes/gruvbox-dark-soft.mjs"),
  "gruvbox-light-hard": () => import("shiki/themes/gruvbox-light-hard.mjs"),
  "gruvbox-light-medium": () => import("shiki/themes/gruvbox-light-medium.mjs"),
  "gruvbox-light-soft": () => import("shiki/themes/gruvbox-light-soft.mjs"),
  houston: () => import("shiki/themes/houston.mjs"),
  "kanagawa-dragon": () => import("shiki/themes/kanagawa-dragon.mjs"),
  "kanagawa-lotus": () => import("shiki/themes/kanagawa-lotus.mjs"),
  "kanagawa-wave": () => import("shiki/themes/kanagawa-wave.mjs"),
  laserwave: () => import("shiki/themes/laserwave.mjs"),
  "light-plus": () => import("shiki/themes/light-plus.mjs"),
  "material-theme": () => import("shiki/themes/material-theme.mjs"),
  "material-theme-darker": () =>
    import("shiki/themes/material-theme-darker.mjs"),
  "material-theme-lighter": () =>
    import("shiki/themes/material-theme-lighter.mjs"),
  "material-theme-ocean": () => import("shiki/themes/material-theme-ocean.mjs"),
  "material-theme-palenight": () =>
    import("shiki/themes/material-theme-palenight.mjs"),
  "min-dark": () => import("shiki/themes/min-dark.mjs"),
  "min-light": () => import("shiki/themes/min-light.mjs"),
  monokai: () => import("shiki/themes/monokai.mjs"),
  "night-owl": () => import("shiki/themes/night-owl.mjs"),
  nord: () => import("shiki/themes/nord.mjs"),
  "one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
  "one-light": () => import("shiki/themes/one-light.mjs"),
  plastic: () => import("shiki/themes/plastic.mjs"),
  poimandres: () => import("shiki/themes/poimandres.mjs"),
  red: () => import("shiki/themes/red.mjs"),
  "rose-pine": () => import("shiki/themes/rose-pine.mjs"),
  "rose-pine-dawn": () => import("shiki/themes/rose-pine-dawn.mjs"),
  "rose-pine-moon": () => import("shiki/themes/rose-pine-moon.mjs"),
  "slack-dark": () => import("shiki/themes/slack-dark.mjs"),
  "slack-ochin": () => import("shiki/themes/slack-ochin.mjs"),
  "snazzy-light": () => import("shiki/themes/snazzy-light.mjs"),
  "solarized-dark": () => import("shiki/themes/solarized-dark.mjs"),
  "solarized-light": () => import("shiki/themes/solarized-light.mjs"),
  "synthwave-84": () => import("shiki/themes/synthwave-84.mjs"),
  "tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
  vesper: () => import("shiki/themes/vesper.mjs"),
  "vitesse-black": () => import("shiki/themes/vitesse-black.mjs"),
  "vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
  "vitesse-light": () => import("shiki/themes/vitesse-light.mjs"),
};

export function isLightTheme(name: string): boolean {
  return LIGHT_THEMES.has(name as SyntaxThemeName);
}

/**
 * Theme pairs: maps a light theme to its dark counterpart and vice versa.
 * Used by the "Follow system" feature to auto-switch themes.
 */
export const THEME_PAIRS: ReadonlyMap<SyntaxThemeName, SyntaxThemeName> =
  new Map([
    // Light → Dark
    // Paper ↔ Void is the first-party pair; keep it first so it leads every
    // category. `buzz-dark` stays mapped to `buzz` below — that alias is the
    // "always Void" choice, and pairing it to a light palette would take the
    // stay-dark option away from System mode.
    ["paper", "buzz"],
    ["catppuccin-latte", "catppuccin-mocha"],
    ["everforest-light", "everforest-dark"],
    ["github-light", "github-dark"],
    ["github-light-default", "github-dark-default"],
    ["github-light-high-contrast", "github-dark-high-contrast"],
    ["gruvbox-light-hard", "gruvbox-dark-hard"],
    ["gruvbox-light-medium", "gruvbox-dark-medium"],
    ["gruvbox-light-soft", "gruvbox-dark-soft"],
    ["kanagawa-lotus", "kanagawa-wave"],
    ["light-plus", "dark-plus"],
    ["material-theme-lighter", "material-theme"],
    ["min-light", "min-dark"],
    ["one-light", "one-dark-pro"],
    ["rose-pine-dawn", "rose-pine"],
    ["slack-ochin", "slack-dark"],
    ["solarized-light", "solarized-dark"],
    ["vitesse-light", "vitesse-dark"],
    // Dark → Light (reverse mappings)
    ["buzz", "paper"],
    ["buzz-dark", "buzz"],
    ["catppuccin-mocha", "catppuccin-latte"],
    ["everforest-dark", "everforest-light"],
    ["github-dark", "github-light"],
    ["github-dark-default", "github-light-default"],
    ["github-dark-high-contrast", "github-light-high-contrast"],
    ["gruvbox-dark-hard", "gruvbox-light-hard"],
    ["gruvbox-dark-medium", "gruvbox-light-medium"],
    ["gruvbox-dark-soft", "gruvbox-light-soft"],
    ["kanagawa-wave", "kanagawa-lotus"],
    ["dark-plus", "light-plus"],
    ["material-theme", "material-theme-lighter"],
    ["min-dark", "min-light"],
    ["one-dark-pro", "one-light"],
    ["rose-pine", "rose-pine-dawn"],
    ["slack-dark", "slack-ochin"],
    ["solarized-dark", "solarized-light"],
    ["vitesse-dark", "vitesse-light"],
  ]);

/**
 * Get the counterpart theme for system theme switching.
 * Returns the paired theme if one exists, or null if the theme has no pair.
 */
export function getThemePair(name: SyntaxThemeName): SyntaxThemeName | null {
  return THEME_PAIRS.get(name) ?? null;
}

/**
 * Given a user-selected theme and the current system color scheme,
 * returns the theme that should actually be applied.
 */
export function resolveSystemTheme(
  selectedTheme: SyntaxThemeName,
  systemIsDark: boolean,
): SyntaxThemeName {
  const selectedIsLight = isLightTheme(selectedTheme);
  const needsSwitch =
    (systemIsDark && selectedIsLight) || (!systemIsDark && !selectedIsLight);

  if (!needsSwitch) return selectedTheme;

  const pair = getThemePair(selectedTheme);
  return pair ?? selectedTheme;
}

// Theme settings type from Shiki
interface ThemeSetting {
  scope?: string | string[];
  settings?: { foreground?: string };
}

function extractCommentColor(
  settings: ReadonlyArray<ThemeSetting> | undefined,
  fallback: string,
): string {
  if (!settings) return fallback;

  for (const setting of settings) {
    if (!setting.scope || !setting.settings?.foreground) continue;
    const scopes = Array.isArray(setting.scope)
      ? setting.scope
      : [setting.scope];
    if (scopes.includes("comment")) {
      return setting.settings.foreground;
    }
  }

  return fallback;
}

function stripAlpha(color: string): string {
  if (color.length === 9 && color.startsWith("#")) {
    return color.slice(0, 7);
  }
  return color;
}

function extractGitColors(colors: Record<string, string> | undefined): {
  added: string | null;
  deleted: string | null;
  modified: string | null;
} {
  if (!colors) {
    return { added: null, deleted: null, modified: null };
  }

  const addedKeys = [
    "gitDecoration.addedResourceForeground",
    "editorGutter.addedBackground",
    "diffEditor.insertedTextBackground",
  ];
  const deletedKeys = [
    "gitDecoration.deletedResourceForeground",
    "editorGutter.deletedBackground",
    "diffEditor.removedTextBackground",
  ];
  const modifiedKeys = [
    "gitDecoration.modifiedResourceForeground",
    "editorGutter.modifiedBackground",
  ];

  const findColor = (keys: string[]): string | null => {
    for (const key of keys) {
      const value = colors[key];
      if (value) return stripAlpha(value);
    }
    return null;
  };

  return {
    added: findColor(addedKeys),
    deleted: findColor(deletedKeys),
    modified: findColor(modifiedKeys),
  };
}

export interface ThemeInfo {
  name: string;
  bg: string;
  fg: string;
  comment: string;
  added: string | null;
  deleted: string | null;
  modified: string | null;
}

export function extractThemeInfo(
  themeName: string,
  theme: ThemeRegistrationRaw,
): ThemeInfo {
  const bg =
    (theme.colors?.["editor.background"] as string | undefined) || "#1e1e1e";
  const fg =
    (theme.colors?.["editor.foreground"] as string | undefined) || "#d4d4d4";
  const gitColors = extractGitColors(
    theme.colors as Record<string, string> | undefined,
  );
  return {
    name: themeName,
    bg,
    fg,
    comment: extractCommentColor(
      theme.settings as ReadonlyArray<ThemeSetting> | undefined,
      fg,
    ),
    ...gitColors,
  };
}

export async function loadThemeData(
  name: SyntaxThemeName,
): Promise<ThemeRegistrationRaw> {
  const loader = themeImports[name];
  const { default: theme } = await loader();
  return theme;
}
