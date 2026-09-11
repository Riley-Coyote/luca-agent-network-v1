import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPopoutWindow } from "@/app/popout/popoutMode";
import { invokeTauri } from "@/shared/api/tauri";
import { isMacPlatform } from "@/shared/lib/platform";
import {
  createGraphiteThemeVars,
  createAshThemeVars,
  createObsidianThemeVars,
  createInverseThemeVars,
  createVoidThemeVars,
  createLucaThemeVars,
  createPaperThemeVars,
  createThemeVars,
  hexToHsl,
} from "./adaptive-theme";
import { THEME_CLEAR_VARS } from "./role-registry";
import {
  CRYSTALLINE_THEME_NAME,
  GRAPHITE_THEME_NAME,
  DEFAULT_THEME_NAME,
  OBSIDIAN_THEME_NAME,
  PAPER_THEME_NAME,
  ASH_THEME_NAME,
  INVERSE_THEME_NAME,
  VOID_THEME_NAME,
  SYNTAX_THEMES,
  type SyntaxThemeName,
  extractThemeInfo,
  getThemePair,
  isGlassTheme,
  loadThemeData,
  resolveSystemTheme,
} from "./theme-loader";

export const THEME_STORAGE_KEY = "buzz-theme";
const CACHE_KEY = "buzz-theme-cache";
/**
 * Bump when the shape or vocabulary of the cached var map changes. v1 caches
 * (pre role-registry) contain semantic keys that must never be replayed onto
 * the root — a stale cache is discarded rather than migrated.
 */
const THEME_CACHE_VERSION = 2;
export const ACCENT_STORAGE_KEY = "buzz-accent-color";
export const NEUTRAL_ACCENT = "neutral";
const FOLLOW_SYSTEM_KEY = "buzz-follow-system";
const VIDEO_REVIEW_NEUTRAL_ACCENT = "0 0% 98%";
const VIDEO_REVIEW_CHIP_SURFACE = "#161616";
const VIDEO_REVIEW_TEXT_CONTRAST = 4.5;
const VIDEO_REVIEW_CHIP_BACKGROUND_ALPHAS = [0.15, 0.3] as const;
const BUZZ_VIBRANCY_MATERIAL = "sidebar";
/**
 * The glass themes wear the same material first-party macOS chrome wears
 * (Finder/Notes/Mail sidebars). `under-window-background` was tried first and
 * rejected by eye: it mixes in its own grey base and desaturates, rendering
 * mush over any wallpaper. `sidebar` adapts to the window's effective
 * appearance — which {@link applyWindowAppearance} pins to the glass theme's
 * polarity — so Obsidian gets the dark smoky variant and Crystalline the
 * milky light one, exactly as a native app would.
 */
const GLASS_VIBRANCY_MATERIAL = "sidebar";
const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";

export const ACCENT_COLORS = [
  { name: "Neutral", value: NEUTRAL_ACCENT },
  { name: "Blue", value: "#60a5fa" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Lilac", value: "#c0a2f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Indigo", value: "#6366f1" },
] as const;

/**
 * A fresh profile starts neutral. Colour in this shell is signal, not
 * surface: an accent the user never chose has no business writing itself
 * onto `--primary`, `--sidebar-primary` and `--sidebar-active` on first
 * run. Changing the default (rather than adding the default theme to
 * `isFixedNeutralTheme`) leaves every saved `buzz-accent-color` alone —
 * pinning the theme would override choices existing users already made.
 */
const DEFAULT_ACCENT = NEUTRAL_ACCENT;

type ThemeContextValue = {
  themeName: string;
  selectedThemeName: string;
  isDark: boolean;
  isLoading: boolean;
  accentColor: string;
  followSystem: boolean;
  hasPair: boolean;
  setTheme: (name: string) => void;
  setAccentColor: (color: string) => void;
  setFollowSystem: (enabled: boolean) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: SyntaxThemeName;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isValidThemeName(name: string): name is SyntaxThemeName {
  return (SYNTAX_THEMES as readonly string[]).includes(name);
}

/** Read stored theme, migrating legacy "light"/"dark"/"system" values. */
function readStoredTheme(fallback: SyntaxThemeName): SyntaxThemeName {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (!stored) return fallback;

  // Migrate legacy values
  // Legacy "light" used to land on a syntax theme because the shell had no
  // light palette of its own. It has one now.
  if (stored === "light") return PAPER_THEME_NAME;
  if (stored === "dark" || stored === "system") return "houston";

  return isValidThemeName(stored) ? stored : fallback;
}

function getContrastColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  if (!m) return "#ffffff";
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#000000" : "#ffffff";
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

function hexToRgb(hex: string): Rgb {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function mixRgb(from: Rgb, to: Rgb, factor: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * factor,
    g: from.g + (to.g - from.g) * factor,
    b: from.b + (to.b - from.b) * factor,
  };
}

function compositeRgb(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return mixRgb(background, foreground, alpha);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const aLum = relativeLuminance(a);
  const bLum = relativeLuminance(b);
  return (Math.max(aLum, bLum) + 0.05) / (Math.min(aLum, bLum) + 0.05);
}

function getReviewAccentForeground(hex: string): string {
  const accent = hexToRgb(hex);
  const surface = hexToRgb(VIDEO_REVIEW_CHIP_SURFACE);
  const white = { r: 255, g: 255, b: 255 };
  const backgrounds = VIDEO_REVIEW_CHIP_BACKGROUND_ALPHAS.map((alpha) =>
    compositeRgb(accent, surface, alpha),
  );
  let low = 0;
  let high = 1;

  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const candidate = mixRgb(accent, white, mid);
    const minContrast = Math.min(
      ...backgrounds.map((background) => contrastRatio(candidate, background)),
    );

    if (minContrast >= VIDEO_REVIEW_TEXT_CONTRAST) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return hexToHsl(rgbToHex(mixRgb(accent, white, high)));
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b]
    .map((channel) => clamp(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function applyAccentColor(value: string) {
  const root = document.documentElement;
  if (value === NEUTRAL_ACCENT) {
    const styles = window.getComputedStyle(root);
    const foreground = styles.getPropertyValue("--foreground").trim();
    const background = styles.getPropertyValue("--background").trim();
    root.style.setProperty("--buzz-selected-accent", foreground);
    root.style.setProperty(
      "--buzz-video-review-accent",
      VIDEO_REVIEW_NEUTRAL_ACCENT,
    );
    root.style.setProperty(
      "--buzz-video-review-accent-foreground",
      VIDEO_REVIEW_NEUTRAL_ACCENT,
    );
    root.style.setProperty("--primary", foreground);
    root.style.setProperty("--primary-foreground", background);
    root.style.setProperty("--sidebar-primary", foreground);
    root.style.setProperty("--sidebar-primary-foreground", background);
    // Rail selection is the one place the ink pill does not survive being
    // mirrored. On a dark palette a near-white pill is a small LIT object on
    // a dark field; invert it and the same shape becomes a near-black slab on
    // paper — a blot, and the loudest thing on the page, for what is only
    // "which room am I in". Light palettes therefore keep the shell's own
    // selected plate (`--sidebar-active` → `--mn-hover`, ink text), which is
    // what every light interface of this kind actually does. Filled buttons
    // still invert: `--primary` above is untouched.
    if (root.classList.contains("dark")) {
      root.style.setProperty("--sidebar-active", foreground);
      root.style.setProperty("--sidebar-active-foreground", background);
    } else {
      root.style.removeProperty("--sidebar-active");
      root.style.removeProperty("--sidebar-active-foreground");
    }
    return;
  }

  const hex = value;
  const accentHsl = hexToHsl(hex);
  const fgHsl = hexToHsl(getContrastColor(hex));
  root.style.setProperty("--buzz-selected-accent", accentHsl);
  root.style.setProperty("--buzz-video-review-accent", accentHsl);
  root.style.setProperty(
    "--buzz-video-review-accent-foreground",
    getReviewAccentForeground(hex),
  );
  root.style.setProperty("--primary", accentHsl);
  root.style.setProperty("--primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-primary", accentHsl);
  root.style.setProperty("--sidebar-primary-foreground", fgHsl);
  root.style.setProperty("--sidebar-active", accentHsl);
  root.style.setProperty("--sidebar-active-foreground", fgHsl);
}

/**
 * The legacy Buzz keys now power Luca's first-party shell. It defaults to a
 * restrained link blue so selection and keyboard focus have one semantic cue.
 */
export function isBuzzTheme(themeName: string): boolean {
  return themeName === "buzz" || themeName === "buzz-dark";
}

/** App palettes whose selection treatment is intentionally monochrome. */
export function isFixedNeutralTheme(themeName: string): boolean {
  return (
    isBuzzTheme(themeName) ||
    themeName === GRAPHITE_THEME_NAME ||
    themeName === PAPER_THEME_NAME ||
    themeName === VOID_THEME_NAME ||
    themeName === ASH_THEME_NAME ||
    themeName === INVERSE_THEME_NAME ||
    themeName === OBSIDIAN_THEME_NAME ||
    themeName === CRYSTALLINE_THEME_NAME
  );
}

/**
 * Resolve the accent to actually apply for a theme. Luca's shell pins the
 * neutral accent; optional syntax themes retain a user's selection.
 *
 * Neutral derives `--primary` from the shell's own foreground, so fills,
 * active plates and selection stay in the greyscale ink cascade that
 * `conversation-shell.css` establishes. Returning a chromatic accent here
 * instead writes a saturated colour onto `--primary`/`--sidebar-active` as an
 * inline style, which outranks the CSS shell palette and puts colour on flat
 * fills — colour in this product is reserved for signal (state, fault), not
 * for surfaces.
 */
function resolveEffectiveAccent(
  themeName: string,
  accentColor: string,
): string {
  return isFixedNeutralTheme(themeName) ? NEUTRAL_ACCENT : accentColor;
}

/**
 * Toggle the opaque Buzz sidebar-gradient marker. This is always safe to apply
 * synchronously: `data-buzz-sidebar` paints solid gradient colors, so it never
 * makes the window see-through. The *translucent* treatment (transparent
 * root/body) is handled separately via {@link setBuzzTranslucent} because it
 * must be sequenced against the native vibrancy layer — see
 * {@link applyBuzzVibrancy}.
 */
function applyBuzzSidebar(themeName: string) {
  const root = document.documentElement;
  // The Luca shell is product structure, not a theme. Keep its layout,
  // typography, rail, conversation card, and interaction refinements mounted
  // while the user changes palettes. The legacy Buzz marker below now controls
  // only the first-party palette/vibrancy compatibility path.
  root.setAttribute("data-luca-shell", "");
  root.setAttribute("data-luca-theme", themeName);
  if (isBuzzTheme(themeName)) {
    root.setAttribute("data-buzz-sidebar", "");
    // Keep the concrete Buzz variant on the root as well as the generic
    // marker. The gradient stylesheet matches this attribute directly, which
    // makes WKWebView invalidate the painted background when light/dark mode
    // changes instead of relying only on a custom-property dependency update.
    root.setAttribute("data-buzz-theme", themeName);
  } else {
    root.removeAttribute("data-buzz-sidebar");
    root.removeAttribute("data-buzz-theme");
    // Leaving Buzz: drop translucency synchronously here too. Going *opaque*
    // never shows desktop/prior content through, so there's no ordering risk
    // on the way out — only on the way in.
    setBuzzTranslucent(false);
  }
}

/**
 * Toggle the translucent (see-through) treatment: transparent root/body so the
 * native macOS vibrancy layer shows through behind the sidebar glass. The
 * transparent root/body themselves are driven by the `data-buzz-translucent`
 * CSS rule (theme.css), so we only flip the attribute here — no inline styles.
 *
 * IMPORTANT: enabling translucency exposes whatever the compositor paints
 * behind the webview. Only enable it once the native `NSVisualEffectView`
 * vibrancy layer is confirmed installed, otherwise there's a frame where the
 * transparent webview reveals the content behind it (the "main app nav
 * underneath" flicker). {@link applyBuzzVibrancy} owns that sequencing.
 */
function setBuzzTranslucent(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    root.setAttribute("data-buzz-translucent", "");
  } else {
    root.removeAttribute("data-buzz-translucent");
  }
}

/**
 * Stamp the native marker the glass CSS keys off, and — for the two glass
 * themes only — retire the index.html boot guard so the vibrancy view can
 * reach the plate.
 *
 * Only a Tauri window has a vibrancy view behind it. The marker gates every
 * transparency in glass-floor.css so browser contexts (dev preview, lab,
 * e2e) render the glass themes fully opaque from their solid tokens.
 *
 * A pop-out chat window is deliberately treated as one of those contexts: it
 * ships an opaque surface on a transparent-capable window, so it must never
 * claim a vibrancy layer it has not installed — the glass CSS would go
 * see-through onto nothing.
 */
function applyNativeMarker(themeName: string) {
  if (!isTauri() || isPopoutWindow()) return;
  const root = document.documentElement;
  root.setAttribute("data-luca-native", "");
  if (isGlassTheme(themeName)) {
    // The index.html boot guard paints <html> inline to prevent a cold-boot
    // flash; on a transparent window it is the one layer CSS cannot defeat.
    document.documentElement.style.removeProperty("background-color");
  }
}

/**
 * Mark that the native vibrancy layer could not be installed. `glass-floor.css`
 * collapses the plate to the solid floor token under this attribute — the same
 * end state as reduced transparency — so a failed IPC never leaves a scrim
 * painted over nothing.
 */
function setGlassVibrancyFallback(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    root.setAttribute("data-luca-glass-fallback", "");
  } else {
    root.removeAttribute("data-luca-glass-fallback");
  }
}

/**
 * Monotonic token for the glass vibrancy request, mirroring
 * {@link buzzVibrancyRequest}: a rapid theme switch can leave two awaits
 * resolving out of order, and only the newest may write the fallback marker.
 */
let glassVibrancyRequest = 0;

/**
 * Pin the window's effective appearance to the glass theme's polarity.
 *
 * `NSVisualEffectMaterial` renders per the WINDOW's appearance, not the app
 * theme — without this, picking Crystalline on a dark-mode Mac composites
 * light scrims over the material's dark variant (grey mud). Glass themes pin
 * light/dark to match themselves; every other theme clears the override so
 * the window follows macOS again.
 *
 * Interplay with follow-system: the override changes what the webview's
 * `prefers-color-scheme` and `onThemeChanged` report. Under follow-system the
 * override always AGREES with macOS (System resolves the glass pair by OS
 * appearance), so the signal stays truthful; the follow-system effect also
 * clears any stale override before seeding, covering the manual-pick → System
 * transition.
 */
async function applyWindowAppearance(themeName: string) {
  if (!isTauri()) return;
  try {
    if (isGlassTheme(themeName)) {
      await getCurrentWindow().setTheme(
        themeName === CRYSTALLINE_THEME_NAME ? "light" : "dark",
      );
    } else {
      await getCurrentWindow().setTheme(null);
    }
  } catch (error) {
    console.warn("window appearance override unavailable", error);
  }
}

/**
 * Install the native `NSVisualEffectView` the glass floor scrims over.
 *
 * The webview cannot filter the real desktop, so the blur has to come from
 * the native layer. Only the two glass themes install it; every opaque theme
 * relies on {@link applyBuzzVibrancy} having already cleared the layer.
 *
 * Buzz themes return immediately. {@link applyBuzzVibrancy} owns the native
 * layer for that palette and its careful translucency handshake must not be
 * raced.
 *
 * MUST be sequenced AFTER {@link applyBuzzVibrancy} resolves — that call issues
 * `set_window_vibrancy(enabled: false)` for every non-Buzz theme, which would
 * otherwise clear the layer this one just installed.
 */
async function applyGlassVibrancy(themeName: string) {
  if (isBuzzTheme(themeName)) return;

  const requestToken = ++glassVibrancyRequest;

  if (!isTauri()) {
    // Web/dev preview: no native layer exists and none can fail to install.
    setGlassVibrancyFallback(false);
    return;
  }

  if (!isGlassTheme(themeName)) {
    // Opaque themes owe the vibrancy layer nothing; applyBuzzVibrancy has
    // already cleared it for every non-Buzz theme.
    setGlassVibrancyFallback(false);
    return;
  }

  if (window.matchMedia(REDUCED_TRANSPARENCY_QUERY).matches) {
    // The CSS collapse paints everything solid, and the layer is already
    // cleared by the buzz path — installing one would be wasted work.
    setGlassVibrancyFallback(false);
    return;
  }

  try {
    await invokeTauri<void>("set_window_vibrancy", {
      enabled: true,
      material: GLASS_VIBRANCY_MATERIAL,
      // Glass does not turn opaque when the window loses focus: the state
      // pin keeps NSVisualEffectView live regardless of key status.
      state: "active",
    });
    if (requestToken !== glassVibrancyRequest) return;
    setGlassVibrancyFallback(false);
  } catch (error) {
    console.warn("glass vibrancy unavailable", error);
    if (requestToken !== glassVibrancyRequest) return;
    setGlassVibrancyFallback(true);
  }
}

/**
 * Monotonic token identifying the most recent vibrancy request. Because
 * {@link applyBuzzVibrancy} awaits the native `set_window_vibrancy` IPC, a rapid
 * Buzz → non-Buzz toggle can fire two overlapping calls whose awaits resolve out
 * of order. Each call captures the token before awaiting and re-checks it after;
 * a stale continuation (superseded by a newer request) bails without touching
 * translucency — otherwise the earlier Buzz call could re-add
 * `data-buzz-translucent` after the later non-Buzz call already cleared it,
 * leaving the window transparent under a non-Buzz theme.
 */
let buzzVibrancyRequest = 0;

/**
 * Whether the native vibrancy layer is confirmed installed for a Buzz theme.
 * Set true only after `set_window_vibrancy(true)` resolves; cleared as soon as a
 * new vibrancy request is issued (its outcome is not yet known).
 */
let buzzVibrancyReady = false;

/** The native layer does not need rebuilding when Buzz only changes mode. */
let buzzVibrancyEnabled = false;

/**
 * Enable the CSS translucency treatment, but only once BOTH prerequisites for
 * the current request are in place:
 *
 *  1. the native vibrancy layer is installed ({@link buzzVibrancyReady}), and
 *  2. the Buzz sidebar marker + gradient vars are applied (`data-buzz-sidebar`,
 *     set synchronously by {@link applyBuzzSidebar} inside {@link applyTheme}).
 *
 * Translucency clears the body/sidebar surfaces so the vibrancy layer shows
 * through; enabling it before the Buzz gradient vars are installed would flash a
 * transparent/unstyled sidebar. `applyTheme` (theme vars) and
 * `applyBuzzVibrancy` (native layer) are independent async effects that can win
 * their race in either order, so each calls this after its own step completes —
 * whichever lands last flips translucency on. The token check drops stale
 * continuations superseded by a newer theme switch.
 */
function maybeEnableBuzzTranslucent(themeName: string, requestToken: number) {
  if (requestToken !== buzzVibrancyRequest) return;
  if (!isBuzzTheme(themeName) || !isMacPlatform()) return;
  if (!buzzVibrancyReady) return;
  if (!document.documentElement.hasAttribute("data-buzz-sidebar")) return;
  setBuzzTranslucent(true);
}

/**
 * Sequence the native vibrancy layer and the CSS translucency so they land in
 * the right order and never leave a transparent webview with nothing painted
 * behind it:
 *
 * - Entering Buzz (macOS): install the vibrancy layer first (await the IPC),
 *   *then* flip on translucency. This closes the frame-gap where the root was
 *   transparent before the vibrancy view existed — the flicker.
 * - Leaving Buzz: translucency was already removed synchronously in
 *   `applyBuzzSidebar` (safe — opaque never shows through), so here we just
 *   clear the native layer.
 *
 * On non-macOS `set_window_vibrancy` is a no-op and translucency stays off, so
 * these platforms fall back to the opaque Buzz gradient.
 *
 * Overlapping calls are guarded by {@link buzzVibrancyRequest} so a stale async
 * continuation can't re-enable translucency after a newer theme superseded it.
 */
async function applyBuzzVibrancy(themeName: string) {
  const buzz = isBuzzTheme(themeName);
  const requestToken = ++buzzVibrancyRequest;

  // Buzz Light and Buzz Dark use the same native material. Rebuilding the
  // NSVisualEffectView on every mode change briefly clears the layer behind
  // the webview and makes the new CSS theme appear late. Keep the installed
  // layer and let applyTheme swap only the color tokens.
  if (buzz && buzzVibrancyEnabled && buzzVibrancyReady) {
    maybeEnableBuzzTranslucent(themeName, requestToken);
    return;
  }

  // A new request is in flight — the vibrancy layer's readiness for it is not
  // yet known, so any stale "ready" from a prior request must not gate this one.
  buzzVibrancyReady = false;

  if (!isTauri()) {
    // Web/dev preview: no native vibrancy layer exists, so translucency would
    // show raw page background. Keep it off; the opaque gradient stands in.
    setBuzzTranslucent(false);
    return;
  }

  try {
    await invokeTauri<void>("set_window_vibrancy", {
      enabled: buzz,
      material: BUZZ_VIBRANCY_MATERIAL,
    });
    // A newer theme change superseded this request while the IPC was in flight;
    // that later call owns the current translucency state, so don't clobber it.
    if (requestToken !== buzzVibrancyRequest) return;
    buzzVibrancyEnabled = buzz;
    // Native layer is installed. Record readiness and try to enable translucency
    // — but only if `applyBuzzSidebar` has already installed the Buzz gradient
    // vars. If that effect hasn't landed yet (the IPC won the race), it will
    // call maybeEnableBuzzTranslucent itself once the marker is applied.
    if (buzz && isMacPlatform()) {
      buzzVibrancyReady = true;
      maybeEnableBuzzTranslucent(themeName, requestToken);
    }
  } catch (error) {
    console.warn("set_window_vibrancy failed", error);
    if (requestToken !== buzzVibrancyRequest) return;
    // Vibrancy failed — don't go transparent or we'd show through to nothing.
    buzzVibrancyEnabled = false;
    setBuzzTranslucent(false);
  }
}

/** Apply cached CSS vars synchronously to prevent FOUC. */
function applyCachedVars(): string | null {
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const { version, themeName, vars, isDark } = JSON.parse(cached);
    if (version !== THEME_CACHE_VERSION) {
      // A cache written by an older vocabulary (e.g. one that inlined
      // semantic tokens) must not touch the root; the async theme load
      // repaints moments later from the current builders.
      window.localStorage.removeItem(CACHE_KEY);
      return null;
    }
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value as string);
    }
    root.classList.remove("light", "dark");
    root.classList.add(isDark ? "dark" : "light");
    applyBuzzSidebar(themeName);
    applyNativeMarker(themeName);

    const accent =
      window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
    // Pin Buzz themes to the neutral accent here too, matching applyTheme.
    // Otherwise a cached Buzz theme + non-neutral stored accent flashes the
    // old accent on reload until the async applyTheme effect runs.
    applyAccentColor(resolveEffectiveAccent(themeName, accent));

    return themeName;
  } catch {
    return null;
  }
}

/** The latest theme load is the only one allowed to write document styles. */
let themeApplyRequest = 0;

/** Apply a theme: load data, derive CSS vars, set them on :root. */
async function applyTheme(
  name: SyntaxThemeName,
): Promise<{ isDark: boolean } | null> {
  const requestToken = ++themeApplyRequest;
  const themeData = await loadThemeData(name);
  if (requestToken !== themeApplyRequest) return null;

  const info = extractThemeInfo(name, themeData);
  const { isDark, vars } = (() => {
    if (isBuzzTheme(name)) return createLucaThemeVars();
    if (name === GRAPHITE_THEME_NAME) return createGraphiteThemeVars();
    if (name === VOID_THEME_NAME) return createVoidThemeVars();
    if (name === ASH_THEME_NAME) return createAshThemeVars();
    if (name === INVERSE_THEME_NAME) return createInverseThemeVars();
    if (name === PAPER_THEME_NAME) return createPaperThemeVars();
    if (name === OBSIDIAN_THEME_NAME) return createObsidianThemeVars();
    // Crystalline: Paper's palette under the light glass weathers.
    if (name === CRYSTALLINE_THEME_NAME) return createPaperThemeVars();
    return createThemeVars(info.bg, info.fg, info.comment, {
      added: info.added,
      deleted: info.deleted,
      modified: info.modified,
    });
  })();

  const root = document.documentElement;
  // A non-default palette supplies `--mn-*` values so the permanent Luca shell
  // can inherit its tonal ladder. Remove the previous palette's inline values
  // first; when returning to the first-party theme, the audited CSS defaults
  // must become authoritative again instead of being shadowed by stale inline
  // variables from the prior theme.
  for (const key of THEME_CLEAR_VARS) {
    root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
  applyBuzzSidebar(name);
  applyNativeMarker(name);
  // The Buzz gradient vars are now installed. If the vibrancy layer already
  // resolved for the current request (the IPC won the race against this theme
  // load), enable translucency now — otherwise applyBuzzVibrancy does it. This
  // is the second half of the two-effect handshake; the token guards against a
  // superseding theme switch.
  maybeEnableBuzzTranslucent(name, buzzVibrancyRequest);

  // Apply the accent synchronously in the same batch as the theme vars so the
  // browser paints the new theme + accent together. Doing this in a later
  // microtask (e.g. the caller's `.then`) let the previous accent flash on the
  // new theme for a frame — the flicker seen when switching to Buzz. Buzz
  // themes resolve to the neutral accent regardless of the stored value.
  applyAccentColor(
    resolveEffectiveAccent(
      name,
      window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT,
    ),
  );

  // Cache for FOUC prevention
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: THEME_CACHE_VERSION,
        themeName: name,
        vars,
        isDark,
      }),
    );
  } catch {
    // Storage full — non-critical
  }

  return { isDark };
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_NAME,
}: ThemeProviderProps) {
  // Apply cached vars synchronously before first render
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    applyCachedVars();
    return readStoredTheme(defaultTheme);
  });
  const [isDark, setIsDark] = useState<boolean>(() => {
    return document.documentElement.classList.contains("dark");
  });
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = useRef<string | null>(null);
  const [accentColor, setAccentColorState] = useState<string>(() => {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY) ?? DEFAULT_ACCENT;
  });
  const [followSystem, setFollowSystemState] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(FOLLOW_SYSTEM_KEY);
    if (stored !== null) return stored === "true";
    // First launch uses Vitesse Black. Following the OS is an explicit choice.
    return false;
  });
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Resolve the effective theme based on follow-system preference
  const effectiveTheme = (() => {
    if (!followSystem || !isValidThemeName(selectedTheme)) return selectedTheme;
    return resolveSystemTheme(selectedTheme as SyntaxThemeName, systemIsDark);
  })();

  // Check if the selected theme has a pair (for UI hint)
  const hasPair = isValidThemeName(selectedTheme)
    ? getThemePair(selectedTheme as SyntaxThemeName) !== null
    : false;

  useEffect(() => {
    if (!isValidThemeName(effectiveTheme)) return;

    // Track which theme we're loading to avoid race conditions
    const thisTheme = effectiveTheme;
    loadingRef.current = thisTheme;
    setIsLoading(true);

    applyTheme(effectiveTheme as SyntaxThemeName).then((result) => {
      if (!result) return;
      // Only update if this is still the theme we want. The accent is applied
      // inside applyTheme (synchronously with the theme vars), so there's no
      // separate re-application here — that avoided the switch-time flicker.
      if (loadingRef.current === thisTheme) {
        setIsDark(result.isDark);
        setIsLoading(false);
      }
    });
  }, [effectiveTheme]);

  useEffect(() => {
    if (!isValidThemeName(effectiveTheme)) return;
    // The native window material belongs to the window that owns its floor.
    // A pop-out chat window ships opaque and installs nothing: without this
    // it would apply the main window's material to ITSELF (the vibrancy
    // command is caller-scoped) and then go translucent over a layer the M1
    // design never asked for.
    if (isPopoutWindow()) return;
    // Strictly sequential, not parallel: applyBuzzVibrancy issues
    // `set_window_vibrancy(enabled: false)` for every non-Buzz theme, so
    // installing the glass layer before it resolves would have that clear
    // land last and leave the window with nothing behind it. Appearance is
    // pinned BEFORE the glass layer installs so the material renders its
    // correct light/dark variant from the first frame.
    void applyBuzzVibrancy(effectiveTheme)
      .then(() => applyWindowAppearance(effectiveTheme))
      .then(() => {
        void applyGlassVibrancy(effectiveTheme);
      });
  }, [effectiveTheme]);

  // One-time hygiene: the retired per-theme glass toggle and material
  // picker left these keys behind; the two-glass system stores nothing.
  useEffect(() => {
    window.localStorage.removeItem("buzz-glass-floor");
    window.localStorage.removeItem("buzz-glass-material");
  }, []);

  // The accessibility contract has a native half (no vibrancy layer) as well
  // as the CSS half, and macOS can flip the setting while the app is running.
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_TRANSPARENCY_QUERY);
    const handleChange = () => {
      void applyGlassVibrancy(effectiveTheme);
    };
    mq.addEventListener("change", handleChange);
    return () => {
      mq.removeEventListener("change", handleChange);
    };
  }, [effectiveTheme]);

  // Listen for system color scheme changes when followSystem is enabled
  useEffect(() => {
    if (!followSystem) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemIsDark(event.matches);
    };
    let disposed = false;
    let unlistenNativeTheme: (() => void) | undefined;

    setSystemIsDark(mq.matches);
    mq.addEventListener("change", handleMediaChange);

    // WKWebView can update the media query value without dispatching its
    // change event until the page reloads. Tauri's native window event arrives
    // immediately when macOS appearance changes, so use it as the reliable app
    // signal while retaining matchMedia for the browser build.
    if (isTauri()) {
      // A glass theme may have pinned the window appearance
      // ({@link applyWindowAppearance}), and both matchMedia and the native
      // theme report the OVERRIDE, not macOS. Clear it before seeding so
      // enabling follow-system after a manual glass pick reads the real OS
      // appearance; the vibrancy effect re-pins for the resolved theme.
      void getCurrentWindow()
        .setTheme(null)
        .then(() => getCurrentWindow().theme())
        .then((native) => {
          if (!disposed && native) setSystemIsDark(native === "dark");
        })
        .catch(() => {});
      void getCurrentWindow()
        .onThemeChanged(({ payload }) => {
          if (!disposed) setSystemIsDark(payload === "dark");
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlistenNativeTheme = unlisten;
          }
        })
        .catch((error) => {
          console.warn("system theme listener unavailable", error);
        });
    }

    return () => {
      disposed = true;
      mq.removeEventListener("change", handleMediaChange);
      unlistenNativeTheme?.();
    };
  }, [followSystem]);

  // Re-apply the accent when the user picks a new swatch or the effective theme
  // changes. applyTheme already applies the (Buzz-neutral-aware) accent in the
  // same synchronous batch as the theme vars — the flicker fix — so this effect
  // is idempotent on theme changes and simply covers accent-only changes.
  useEffect(() => {
    applyAccentColor(resolveEffectiveAccent(effectiveTheme, accentColor));
  }, [accentColor, effectiveTheme]);

  const setTheme = useCallback((name: string) => {
    if (!isValidThemeName(name)) return;
    setSelectedTheme(name);
    window.localStorage.setItem(THEME_STORAGE_KEY, name);
  }, []);

  const setAccentColor = useCallback((color: string) => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, color);
    setAccentColorState(color);
  }, []);

  const setFollowSystem = useCallback((enabled: boolean) => {
    window.localStorage.setItem(FOLLOW_SYSTEM_KEY, enabled ? "true" : "false");
    setFollowSystemState(enabled);
  }, []);

  const value: ThemeContextValue = {
    themeName: effectiveTheme,
    selectedThemeName: selectedTheme,
    isDark,
    isLoading,
    accentColor,
    followSystem,
    hasPair,
    setTheme,
    setAccentColor,
    setFollowSystem,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
