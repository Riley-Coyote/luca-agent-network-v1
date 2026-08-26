import { useEffect, useState } from "react";
import { createThemeVars } from "./adaptive-theme";
import {
  SYNTAX_THEMES,
  type SyntaxThemeName,
  extractThemeInfo,
  BUZZ_DARK_THEME_NAME,
  BUZZ_THEME_NAME,
  GRAPHITE_THEME_NAME,
  ASH_THEME_NAME,
  INVERSE_THEME_NAME,
  PAPER_THEME_NAME,
  VOID_THEME_NAME,
  OBSIDIAN_THEME_NAME,
  CRYSTALLINE_THEME_NAME,
  isLightTheme,
  loadThemeData,
} from "./theme-loader";
import {
  SLATE_PREVIEW_VARS,
  DARK_PREVIEW_VARS,
  LIGHT_PREVIEW_VARS,
  previewVarsFromLadder,
  type ThemePreviewVars,
} from "./ThemePreviewFrame";
import {
  ASH_THEME_COLORS,
  OBSIDIAN_THEME_COLORS,
  GRAPHITE_THEME_COLORS,
  INVERSE_THEME_COLORS,
  PAPER_THEME_COLORS,
  VOID_THEME_COLORS,
} from "./adaptive-theme";
import { NEUTRAL_ACCENT } from "./ThemeProvider";
import { hexToHsl } from "./adaptive-theme";

export type ThemePreviewVarsByTheme = Partial<
  Record<SyntaxThemeName, ThemePreviewVars>
>;

let themePreviewVarsCache: ThemePreviewVarsByTheme | null = null;
let themePreviewVarsPromise: Promise<ThemePreviewVarsByTheme> | null = null;

async function loadThemePreviewVars(name: SyntaxThemeName) {
  if (name === BUZZ_THEME_NAME || name === BUZZ_DARK_THEME_NAME) {
    return [name, SLATE_PREVIEW_VARS] as const;
  }
  if (name === ASH_THEME_NAME) {
    return [name, previewVarsFromLadder(ASH_THEME_COLORS)] as const;
  }
  if (name === INVERSE_THEME_NAME) {
    return [name, previewVarsFromLadder(INVERSE_THEME_COLORS)] as const;
  }
  if (name === VOID_THEME_NAME) {
    return [name, previewVarsFromLadder(VOID_THEME_COLORS)] as const;
  }
  if (name === GRAPHITE_THEME_NAME) {
    return [name, previewVarsFromLadder(GRAPHITE_THEME_COLORS)] as const;
  }
  if (name === OBSIDIAN_THEME_NAME) {
    return [name, previewVarsFromLadder(OBSIDIAN_THEME_COLORS)] as const;
  }
  if (name === CRYSTALLINE_THEME_NAME) {
    // Crystalline wears Paper's palette; its tile shows the same truth.
    return [name, previewVarsFromLadder(PAPER_THEME_COLORS)] as const;
  }
  if (name === PAPER_THEME_NAME) {
    // Paper previously had NO branch and fell through to the derived path,
    // so its tile rendered a GitHub-Light approximation of a palette it
    // does not use.
    return [name, previewVarsFromLadder(PAPER_THEME_COLORS)] as const;
  }
  const themeData = await loadThemeData(name);
  const info = extractThemeInfo(name, themeData);
  const { vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added,
    deleted: info.deleted,
    modified: info.modified,
  });
  // Builders speak in roles only; the tile's semantic slots are derived here
  // with the same role assignments the stylesheet mapping uses.
  return [
    name,
    {
      "--background": vars["--mn-surface"],
      "--foreground": vars["--mn-ink"],
      "--border": vars["--mn-border"],
      "--muted": vars["--mn-raised"],
      "--muted-foreground": vars["--mn-ink-muted"],
      "--sidebar-background": vars["--mn-floor"],
      "--sidebar-foreground": vars["--mn-ink"],
    } satisfies ThemePreviewVars,
  ] as const;
}

export function preloadThemePreviewVars() {
  if (themePreviewVarsCache) {
    return Promise.resolve(themePreviewVarsCache);
  }

  if (!themePreviewVarsPromise) {
    themePreviewVarsPromise = Promise.all(
      SYNTAX_THEMES.map((name) => loadThemePreviewVars(name)),
    )
      .then((entries) => {
        const previewVars = Object.fromEntries(
          entries,
        ) as ThemePreviewVarsByTheme;
        themePreviewVarsCache = previewVars;
        return previewVars;
      })
      .catch((error) => {
        themePreviewVarsPromise = null;
        throw error;
      });
  }

  return themePreviewVarsPromise;
}

export function useThemePreviewVars() {
  const [previewVarsByTheme, setPreviewVarsByTheme] =
    useState<ThemePreviewVarsByTheme>(() => themePreviewVarsCache ?? {});

  useEffect(() => {
    let canceled = false;

    void preloadThemePreviewVars()
      .then((previewVars) => {
        if (!canceled) {
          setPreviewVarsByTheme(previewVars);
        }
      })
      .catch(() => {
        if (!canceled) {
          setPreviewVarsByTheme({});
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  return previewVarsByTheme;
}

export function getThemeFallbackPreviewVars(name: SyntaxThemeName) {
  return isLightTheme(name) ? LIGHT_PREVIEW_VARS : DARK_PREVIEW_VARS;
}

export function withAccentPreviewVars(
  vars: ThemePreviewVars | null,
  accentColor: string,
): ThemePreviewVars | null {
  if (!vars) {
    return null;
  }

  if (accentColor === NEUTRAL_ACCENT) {
    return {
      ...vars,
      "--primary": vars["--foreground"],
      "--primary-foreground": vars["--background"],
    };
  }

  return {
    ...vars,
    "--primary": hexToHsl(accentColor),
  };
}
