import type { Community } from "./types";
import { homeDir } from "@tauri-apps/api/path";
import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

const COMMUNITIES_KEY = "buzz-communities";
const ACTIVE_COMMUNITY_KEY = "buzz-active-community-id";
const LEGACY_WORKSPACES_KEY = "buzz-workspaces";
const LEGACY_ACTIVE_WORKSPACE_KEY = "buzz-active-workspace-id";

export const LOCAL_COMMUNITY_RELAY_URL = "buzz-local://on-this-device";
export const LOCAL_COMMUNITY_NAME = "On this device";

export function isLocalCommunityRelayUrl(relayUrl: string): boolean {
  return relayUrl === LOCAL_COMMUNITY_RELAY_URL;
}

/** Stored local sentinel is never a network endpoint. */
export function hasCommunityNetworkEndpoint(relayUrl: string): boolean {
  return !isLocalCommunityRelayUrl(relayUrl);
}

/**
 * Expand a leading `~` to the user's home directory. The backend rejects
 * `~`-prefixed paths (`std::fs` does not expand the shell tilde), so the UI
 * resolves it before save. Returns non-`~` input unchanged. Empty/whitespace
 * input returns `undefined` so callers can clear the override.
 */
export async function expandTilde(input: string): Promise<string | undefined> {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "~") {
    return homeDir();
  }
  if (trimmed.startsWith("~/")) {
    const home = await homeDir();
    const base = home.endsWith("/") ? home.slice(0, -1) : home;
    return `${base}/${trimmed.slice(2)}`;
  }
  return trimmed;
}

export function migrateLegacyCommunityStorage(
  storage: Storage = localStorage,
): void {
  if (storage.getItem(COMMUNITIES_KEY) === null) {
    const legacyCommunities = storage.getItem(LEGACY_WORKSPACES_KEY);
    if (legacyCommunities !== null) {
      storage.setItem(COMMUNITIES_KEY, legacyCommunities);
    }
  }
  if (storage.getItem(ACTIVE_COMMUNITY_KEY) === null) {
    const legacyActiveCommunity = storage.getItem(LEGACY_ACTIVE_WORKSPACE_KEY);
    if (legacyActiveCommunity !== null) {
      storage.setItem(ACTIVE_COMMUNITY_KEY, legacyActiveCommunity);
    }
  }
}

export function loadCommunities(): Community[] {
  try {
    migrateLegacyCommunityStorage();
    const raw = localStorage.getItem(COMMUNITIES_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Migration: older builds stored the user's `nsec` in localStorage and
    // re-applied it to the backend on every reload, which silently overwrote
    // any `import_identity` result with the original generated key. The
    // on-disk `identity.key` file is the only source of truth now. Strip
    // any lingering `nsec` from existing entries on read and persist the
    // cleaned list back so it cannot leak into future sessions.
    let didStrip = false;
    const cleaned = (parsed as Array<Record<string, unknown>>).map((entry) => {
      if (entry && typeof entry === "object" && "nsec" in entry) {
        const { nsec: _nsec, ...rest } = entry;
        didStrip = true;
        return rest;
      }
      return entry;
    }) as Community[];
    if (didStrip) {
      setLocalStorageItemWithRecovery(COMMUNITIES_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return [];
  }
}

export function saveCommunities(communities: Community[]): void {
  setLocalStorageItemWithRecovery(COMMUNITIES_KEY, JSON.stringify(communities));
}

export function clearCommunityStorage(storage: Storage = localStorage): void {
  storage.removeItem(COMMUNITIES_KEY);
  storage.removeItem(ACTIVE_COMMUNITY_KEY);
  storage.removeItem(LEGACY_WORKSPACES_KEY);
  storage.removeItem(LEGACY_ACTIVE_WORKSPACE_KEY);
}

export function loadActiveCommunityId(): string | null {
  migrateLegacyCommunityStorage();
  return localStorage.getItem(ACTIVE_COMMUNITY_KEY);
}

export function saveActiveCommunityId(id: string): void {
  setLocalStorageItemWithRecovery(ACTIVE_COMMUNITY_KEY, id);
}

export function normalizeRelayUrl(url: string): string {
  // The on-this-device sentinel is not a network URL and must survive
  // normalization untouched.
  if (isLocalCommunityRelayUrl(url)) {
    return url;
  }
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    return `wss://${url}`;
  }
  return url;
}

export function deriveCommunityName(relayUrl: string): string {
  if (isLocalCommunityRelayUrl(relayUrl)) {
    return LOCAL_COMMUNITY_NAME;
  }
  try {
    const url = new URL(
      relayUrl.replace("ws://", "http://").replace("wss://", "https://"),
    );
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "Local Dev";
    }
    const parts = host.split(".");
    // Detect staging environments (e.g. buzz-oss.stage.blox.sqprod.co)
    if (parts.some((p) => p === "stage" || p === "staging")) {
      return "Luca (staging)";
    }
    // Use the first subdomain segment or the domain itself
    if (parts.length >= 2) {
      return parts[0] === "relay" ? parts[1] : parts[0];
    }
    return host;
  } catch {
    return "Community";
  }
}

export function initFirstCommunity(
  relayUrl: string,
  pubkey: string,
  name?: string,
): Community {
  const normalizedUrl = normalizeRelayUrl(relayUrl);
  const trimmedName = name?.trim();
  const community: Community = {
    id: crypto.randomUUID(),
    name: trimmedName || deriveCommunityName(normalizedUrl),
    relayUrl: normalizedUrl,
    pubkey,
    addedAt: new Date().toISOString(),
  };
  saveCommunities([community]);
  saveActiveCommunityId(community.id);
  return community;
}
