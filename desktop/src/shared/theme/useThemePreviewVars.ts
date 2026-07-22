import { useEffect, useState } from "react";
import { createLucaThemeVars, createThemeVars } from "./adaptive-theme";
import {
  SYNTAX_THEMES,
  type SyntaxThemeName,
  extractThemeInfo,
  BUZZ_DARK_THEME_NAME,
  BUZZ_THEME_NAME,
  isLightTheme,
  loadThemeData,
} from "./theme-loader";
import {
  DARK_PREVIEW_VARS,
  LIGHT_PREVIEW_VARS,
  type ThemePreviewVars,
} from "./ThemePreviewFrame";
import { NEUTRAL_ACCENT } from "./ThemeProvider";
import { hexToHsl } from "./adaptive-theme";

export type ThemePreviewVarsByTheme = Partial<
  Record<SyntaxThemeName, ThemePreviewVars>
>;

let themePreviewVarsCache: ThemePreviewVarsByTheme | null = null;
let themePreviewVarsPromise: Promise<ThemePreviewVarsByTheme> | null = null;

async function loadThemePreviewVars(name: SyntaxThemeName) {
  if (name === BUZZ_THEME_NAME || name === BUZZ_DARK_THEME_NAME) {
    return [name, createLucaThemeVars().vars] as const;
  }
  const themeData = await loadThemeData(name);
  const info = extractThemeInfo(name, themeData);
  const { vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added,
    deleted: info.deleted,
    modified: info.modified,
  });
  return [name, vars] as const;
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
