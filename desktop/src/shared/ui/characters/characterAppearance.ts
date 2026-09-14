import * as React from "react";

import { normalizePubkey } from "@/shared/lib/pubkey";

// v1 default assignment order is frozen. Add future choices to CHARACTER_IDS,
// never to this list: changing its length would reassign existing residents.
const DEFAULT_CHARACTER_IDS = [
  "scuttle",
  "walker",
  "kite",
  "beetle",
  "crab",
  "manta",
  "scout",
  "sentinel",
] as const;

export const CHARACTER_IDS = [...DEFAULT_CHARACTER_IDS] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

const STORAGE_KEY = "polyphonic.character-appearance.v1";
const CHANGE_EVENT = "polyphonic-character-appearance-change";

// Exact discovery defaults from desktop/src-tauri/src/managed_agents/discovery.rs.
// These can be persisted as avatar_url even though no person chose a photo.
// Keep this an exact list so a real upload from the same host stays a photo.
const RUNTIME_AVATAR_FALLBACKS = new Set([
  "https://goose-docs.ai/img/logo_dark.png",
  "https://anthropic.gallerycdn.vsassets.io/extensions/anthropic/claude-code/2.1.77/1773707456892/Microsoft.VisualStudio.Services.Icons.Default",
  "https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5313.41514/1773706730621/Microsoft.VisualStudio.Services.Icons.Default",
  "https://moonshotai.github.io/Branding-Guide/scenarios/03-icon-without-kimi/kimi-icon-rounded-corner.png",
  "https://grok.com/images/android-chrome-512x512.png",
  "https://raw.githubusercontent.com/block/buzz/refs/heads/main/crates/buzz-agent/buzz-agent.png",
]);

export function isCustomAgentPhotoUrl(
  avatarUrl: string | null | undefined,
): boolean {
  const url = avatarUrl?.trim();
  return Boolean(url && !RUNTIME_AVATAR_FALLBACKS.has(url));
}

type AppearanceRecord = {
  version: 1;
  assignments: Record<string, CharacterId>;
  appearanceModes: Record<string, "character" | "photo">;
  motionEnabled: boolean;
};

function isCharacterId(value: unknown): value is CharacterId {
  return CHARACTER_IDS.some((id) => id === value);
}

function readRecord(): AppearanceRecord {
  const empty: AppearanceRecord = {
    version: 1,
    assignments: {},
    appearanceModes: {},
    motionEnabled: true,
  };
  if (typeof window === "undefined") return empty;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return empty;
    const record = value as Partial<AppearanceRecord>;
    if (record.version !== 1) return empty;
    const assignments: Record<string, CharacterId> = {};
    if (record.assignments && typeof record.assignments === "object") {
      for (const [pubkey, id] of Object.entries(record.assignments)) {
        if (isCharacterId(id)) assignments[normalizePubkey(pubkey)] = id;
      }
    }
    const appearanceModes: AppearanceRecord["appearanceModes"] = {};
    if (record.appearanceModes && typeof record.appearanceModes === "object") {
      for (const [pubkey, mode] of Object.entries(record.appearanceModes)) {
        if (mode === "character" || mode === "photo") {
          appearanceModes[normalizePubkey(pubkey)] = mode;
        }
      }
    }
    return {
      version: 1,
      assignments,
      appearanceModes,
      motionEnabled: record.motionEnabled !== false,
    };
  } catch {
    return empty;
  }
}

function saveRecord(record: AppearanceRecord) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage can be unavailable. The deterministic character still renders.
  }
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Stable across model, runtime, presence, and app launches. */
export function defaultCharacterId(publicKey: string): CharacterId {
  const key = normalizePubkey(publicKey);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  // Mix high bits before taking eight slots; raw FNV low bits cluster for
  // fixed-length hexadecimal public keys.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return DEFAULT_CHARACTER_IDS[(hash >>> 0) % DEFAULT_CHARACTER_IDS.length];
}

export function characterIdForPubkey(publicKey: string): CharacterId {
  return (
    readRecord().assignments[normalizePubkey(publicKey)] ??
    defaultCharacterId(publicKey)
  );
}

export function useCharacterId(publicKey: string): CharacterId {
  return React.useSyncExternalStore(
    subscribe,
    () => characterIdForPubkey(publicKey),
    () => defaultCharacterId(publicKey),
  );
}

export function setCharacterId(publicKey: string, id: CharacterId | null) {
  const record = readRecord();
  const key = normalizePubkey(publicKey);
  if (id) record.assignments[key] = id;
  else delete record.assignments[key];
  record.appearanceModes[key] = "character";
  saveRecord(record);
}

export function agentPhotoPreferred(
  publicKey: string,
  avatarUrl: string | null | undefined,
): boolean {
  if (!isCustomAgentPhotoUrl(avatarUrl)) return false;
  const key = normalizePubkey(publicKey);
  const record = readRecord();
  const mode = record.appearanceModes[key];
  if (mode) return mode === "photo";
  // Existing users keep a genuine photo unless they explicitly chose a
  // character in an earlier v1 build, before appearanceModes existed.
  return record.assignments[key] === undefined;
}

export function useAgentPhotoPreferred(
  publicKey: string,
  avatarUrl: string | null | undefined,
): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => agentPhotoPreferred(publicKey, avatarUrl),
    () => isCustomAgentPhotoUrl(avatarUrl),
  );
}

export function setAgentPhotoPreferred(publicKey: string) {
  const record = readRecord();
  record.appearanceModes[normalizePubkey(publicKey)] = "photo";
  saveRecord(record);
}

export function useCharacterMotionEnabled(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => readRecord().motionEnabled,
    () => true,
  );
}

export function setCharacterMotionEnabled(enabled: boolean) {
  saveRecord({ ...readRecord(), motionEnabled: enabled });
}
