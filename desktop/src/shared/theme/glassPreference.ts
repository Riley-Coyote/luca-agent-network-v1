import * as React from "react";

import {
  DRAGON_GLASS_THEME_NAME,
  ONYX_THEME_NAME,
  SMOKE_THEME_NAME,
} from "./theme-loader";

/**
 * The glass floor: whether the shell's floor plate reads the desktop behind
 * the window, and at which weight.
 *
 * - `on` — the plate is the material's scrim over the native
 *   `NSVisualEffectView` blur.
 * - `off` — the same construction at a whisper: the solid floor token with a
 *   trace of the desktop's colour showing through (macOS desktop tinting).
 *
 * Persisted in localStorage. This is a device-level appearance preference, not
 * community-scoped data, so it is intentionally not reset on community switch.
 *
 * The keys live here rather than in `ThemeProvider` so this module has no
 * import cycle with it — `ThemeProvider` imports this one and re-exports the
 * keys beside its other storage keys.
 */
export type GlassFloor = "on" | "off";

/**
 * The material weight, chosen within ink polarity — a light palette only ever
 * wears the light weight, a dark palette chooses between the two dark ones.
 */
export type GlassMaterial = "light" | "neutral" | "dark";

export const GLASS_STORAGE_KEY = "buzz-glass-floor";
export const GLASS_MATERIAL_STORAGE_KEY = "buzz-glass-material";

const LIGHT_MATERIALS: readonly GlassMaterial[] = ["light"];
const DARK_MATERIALS: readonly GlassMaterial[] = ["neutral", "dark"];

/**
 * Palettes authored FOR glass default to it being on. Everything else — the
 * syntax themes, Paper, Graphite, Void — defaults to the whisper.
 */
export function defaultGlassFor(themeName: string): GlassFloor {
  return themeName === SMOKE_THEME_NAME ||
    themeName === DRAGON_GLASS_THEME_NAME ||
    themeName === ONYX_THEME_NAME
    ? "on"
    : "off";
}

/**
 * The weight a palette wears when the user has not chosen one. Dragon Glass
 * and Onyx are the dark-material palettes by construction; otherwise polarity
 * decides.
 */
export function defaultMaterialFor(
  themeName: string,
  isDark: boolean,
): GlassMaterial {
  if (themeName === DRAGON_GLASS_THEME_NAME || themeName === ONYX_THEME_NAME) {
    return "dark";
  }
  return isDark ? "neutral" : "light";
}

/** The weights available within the current ink polarity. */
export function allowedMaterials(isDark: boolean): readonly GlassMaterial[] {
  return isDark ? DARK_MATERIALS : LIGHT_MATERIALS;
}

const listeners = new Set<() => void>();

function parseGlassFloor(value: string | null | undefined): GlassFloor | null {
  return value === "on" || value === "off" ? value : null;
}

function parseGlassMaterial(
  value: string | null | undefined,
): GlassMaterial | null {
  return value === "light" || value === "neutral" || value === "dark"
    ? value
    : null;
}

function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

let storedGlassFloor = parseGlassFloor(readStored(GLASS_STORAGE_KEY));
type StoredGlassMaterials = Record<string, GlassMaterial>;
const EMPTY_STORED_GLASS_MATERIALS: StoredGlassMaterials = {};

function parseStoredGlassMaterials(value: string | null): StoredGlassMaterials {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const materials: StoredGlassMaterials = {};
    for (const [themeName, candidate] of Object.entries(parsed)) {
      const material = parseGlassMaterial(
        typeof candidate === "string" ? candidate : null,
      );
      if (material) materials[themeName] = material;
    }
    return materials;
  } catch {
    // The first glass-shell candidate stored one scalar globally. Treat that
    // value as unset: carrying it forward would make one theme's choice sticky
    // across every other theme and defeat their authored defaults.
    return {};
  }
}

let storedGlassMaterials = parseStoredGlassMaterials(
  readStored(GLASS_MATERIAL_STORAGE_KEY),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getStoredGlassFloorSnapshot(): GlassFloor | null {
  return storedGlassFloor;
}

function getStoredGlassMaterialSnapshot(): StoredGlassMaterials {
  return storedGlassMaterials;
}

function getStoredGlassMaterialServerSnapshot(): StoredGlassMaterials {
  return EMPTY_STORED_GLASS_MATERIALS;
}

function getServerSnapshot(): null {
  return null;
}

/** Read the resolved glass setting for a theme outside of React. */
export function getGlassFloor(themeName: string): GlassFloor {
  return storedGlassFloor ?? defaultGlassFor(themeName);
}

/**
 * Read the resolved material for a theme outside of React. A stored weight
 * that the current polarity does not admit (e.g. `dark` carried into a light
 * palette) is clamped back to the theme's default rather than honoured.
 */
export function getGlassMaterial(
  themeName: string,
  isDark: boolean,
): GlassMaterial {
  const fallback = defaultMaterialFor(themeName, isDark);
  const stored = storedGlassMaterials[themeName];
  if (!stored) return fallback;
  return allowedMaterials(isDark).includes(stored) ? stored : fallback;
}

/** Update the glass setting and notify all subscribed components. */
export function setGlassFloor(value: GlassFloor): void {
  storedGlassFloor = value;

  try {
    globalThis.localStorage?.setItem(GLASS_STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort; the in-memory value still applies.
  }

  notify();
}

/** Update the material weight and notify all subscribed components. */
export function setGlassMaterial(
  themeName: string,
  value: GlassMaterial,
): void {
  storedGlassMaterials = { ...storedGlassMaterials, [themeName]: value };

  try {
    globalThis.localStorage?.setItem(
      GLASS_MATERIAL_STORAGE_KEY,
      JSON.stringify(storedGlassMaterials),
    );
  } catch {
    // Persistence is best-effort; the in-memory value still applies.
  }

  notify();
}

/**
 * Whether the floor reads the desktop for the given theme. Subscribes to the
 * raw stored value and derives against the theme so the snapshot stays
 * referentially stable across renders.
 */
export function useGlassFloor(themeName: string): GlassFloor {
  const stored = React.useSyncExternalStore(
    subscribe,
    getStoredGlassFloorSnapshot,
    getServerSnapshot,
  );
  return stored ?? defaultGlassFor(themeName);
}

/** The material weight in force for the given theme and ink polarity. */
export function useGlassMaterial(
  themeName: string,
  isDark: boolean,
): GlassMaterial {
  const storedByTheme = React.useSyncExternalStore(
    subscribe,
    getStoredGlassMaterialSnapshot,
    getStoredGlassMaterialServerSnapshot,
  );
  const fallback = defaultMaterialFor(themeName, isDark);
  const stored = storedByTheme[themeName];
  if (!stored) return fallback;
  return allowedMaterials(isDark).includes(stored) ? stored : fallback;
}
