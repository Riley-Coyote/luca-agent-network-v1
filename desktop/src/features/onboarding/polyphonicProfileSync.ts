const PREFIX = "polyphonic-pending-profile.v1";

export type PendingPolyphonicProfile = {
  version: 1;
  pubkey: string;
  displayName: string;
};

function key(pubkey: string) {
  return `${PREFIX}:${pubkey}`;
}

export function readPendingPolyphonicProfile(
  pubkey: string | null,
  storage: Storage = localStorage,
): PendingPolyphonicProfile | null {
  if (!pubkey) return null;
  try {
    const value = JSON.parse(
      storage.getItem(key(pubkey)) ?? "null",
    ) as Partial<PendingPolyphonicProfile> | null;
    return value?.version === 1 &&
      value.pubkey === pubkey &&
      typeof value.displayName === "string"
      ? { version: 1, pubkey, displayName: value.displayName }
      : null;
  } catch {
    return null;
  }
}

export function savePendingPolyphonicProfile(
  profile: PendingPolyphonicProfile,
  storage: Storage = localStorage,
) {
  storage.setItem(key(profile.pubkey), JSON.stringify(profile));
}

export function clearPendingPolyphonicProfile(
  pubkey: string | null,
  storage: Storage = localStorage,
) {
  if (pubkey) storage.removeItem(key(pubkey));
}
