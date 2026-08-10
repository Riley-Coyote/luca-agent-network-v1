import type { Profile, UserProfileSummary } from "@/shared/api/types";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";

export type UserProfileLookup = Record<string, UserProfileSummary>;

export { truncatePubkey };

/**
 * Native identity bootstrap uses a shortened npub as transport metadata before
 * a real profile exists. It is useful in identity details, but it is not a
 * person's name and must not leak into ordinary conversation chrome.
 */
export function isIdentityKeyLabel(
  value: string | null | undefined,
  pubkey?: string | null,
): boolean {
  const label = value?.trim();
  if (!label) return false;

  const normalized = label.toLowerCase();
  if (normalized.startsWith("npub1")) return true;
  if (/^[0-9a-f]{64}$/i.test(label)) return true;
  if (/^[0-9a-f]{8}…[0-9a-f]{4}$/i.test(label)) return true;

  const normalizedPubkey = pubkey?.trim() ?? "";
  const canComparePubkey =
    /^[0-9a-f]{64}$/i.test(normalizedPubkey) ||
    normalizedPubkey.toLowerCase().startsWith("npub1");
  return canComparePubkey
    ? normalized === truncatePubkey(normalizedPubkey).toLowerCase()
    : false;
}

function readableIdentityName(
  value: string | null | undefined,
  pubkey?: string | null,
): string | null {
  const name = value?.trim();
  return name && !isIdentityKeyLabel(name, pubkey) ? name : null;
}

/** Resolve ordinary UI copy for an identity while keeping keys in detail views. */
export function resolveIdentityDisplayName(input: {
  displayName?: string | null;
  fallbackName?: string | null;
  isAgent?: boolean;
  isSelf?: boolean;
  name?: string | null;
  nip05Handle?: string | null;
  pubkey?: string | null;
}): string {
  return (
    readableIdentityName(input.displayName, input.pubkey) ??
    readableIdentityName(input.name, input.pubkey) ??
    readableIdentityName(input.nip05Handle, input.pubkey) ??
    readableIdentityName(input.fallbackName, input.pubkey) ??
    (input.isSelf ? "You" : input.isAgent ? "Agent" : "Person")
  );
}

/** Resolve the owner's shell label without treating bootstrap key text as a name. */
export function resolveSelfDisplayName(input: {
  identityDisplayName?: string | null;
  profileDisplayName?: string | null;
  pubkey?: string | null;
}): string {
  return resolveIdentityDisplayName({
    displayName: input.profileDisplayName,
    fallbackName: input.identityDisplayName,
    isSelf: true,
    pubkey: input.pubkey,
  });
}

/**
 * Deep-equal two profile lookups by value. Used to stabilise the merged
 * `messageProfiles` reference at the ChannelScreen boundary: the underlying
 * `users-batch` query re-keys on the full sorted pubkey set, so typing churn
 * (a transient typing-only pubkey entering/leaving the set) produces a fresh
 * lookup object identity even when no profile value actually changed. That new
 * reference fails MessageRow's `prev.profiles === next.profiles` memo check and
 * re-renders the entire timeline on every keystroke-adjacent typing event.
 * Returning the previous reference when this reports equal keeps the memo
 * intact. Consumers read profiles by pubkey value only, never treating identity
 * as a change signal, so returning the stale-but-value-identical reference is
 * safe.
 */
export function profileLookupsEqual(
  a: UserProfileLookup,
  b: UserProfileLookup,
): boolean {
  if (a === b) {
    return true;
  }

  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  for (const key of aKeys) {
    const prev = a[key];
    const next = b[key];
    if (
      next === undefined ||
      prev.displayName !== next.displayName ||
      prev.name !== next.name ||
      prev.avatarUrl !== next.avatarUrl ||
      prev.nip05Handle !== next.nip05Handle ||
      prev.ownerPubkey !== next.ownerPubkey ||
      prev.isAgent !== next.isAgent
    ) {
      return false;
    }
  }

  return true;
}

function getResolvedProfile(
  pubkey: string,
  profiles: UserProfileLookup | undefined,
) {
  if (!profiles) {
    return null;
  }

  return profiles[normalizePubkey(pubkey)] ?? null;
}

export function mergeCurrentProfileIntoLookup(
  profiles: UserProfileLookup | undefined,
  currentProfile:
    | Pick<Profile, "pubkey" | "displayName" | "avatarUrl" | "nip05Handle">
    | null
    | undefined,
) {
  if (!currentProfile) {
    return profiles;
  }

  return {
    ...(profiles ?? {}),
    [normalizePubkey(currentProfile.pubkey)]: {
      displayName: currentProfile.displayName,
      // `Profile` does not carry the kind-0 `name`; keep whatever the batch
      // lookup already resolved so mention aliases survive the merge.
      name: profiles?.[normalizePubkey(currentProfile.pubkey)]?.name ?? null,
      avatarUrl: currentProfile.avatarUrl,
      nip05Handle: currentProfile.nip05Handle,
      isAgent: profiles?.[normalizePubkey(currentProfile.pubkey)]?.isAgent,
      ownerPubkey:
        profiles?.[normalizePubkey(currentProfile.pubkey)]?.ownerPubkey ?? null,
    },
  };
}

export function resolveUserLabel(input: {
  pubkey: string;
  currentPubkey?: string;
  fallbackName?: string | null;
  profiles?: UserProfileLookup;
  preferResolvedSelfLabel?: boolean;
}) {
  const {
    currentPubkey,
    fallbackName,
    preferResolvedSelfLabel = false,
    profiles,
    pubkey,
  } = input;

  if (
    typeof currentPubkey === "string" &&
    normalizePubkey(currentPubkey) === normalizePubkey(pubkey)
  ) {
    if (!preferResolvedSelfLabel) {
      return "You";
    }
  }

  const profile = getResolvedProfile(pubkey, profiles);
  return resolveIdentityDisplayName({
    displayName: profile?.displayName,
    fallbackName,
    isAgent: profile?.isAgent,
    isSelf:
      typeof currentPubkey === "string" &&
      normalizePubkey(currentPubkey) === normalizePubkey(pubkey),
    name: profile?.name,
    nip05Handle: profile?.nip05Handle,
    pubkey,
  });
}

/**
 * Returns true when the current user owns the agent that authored a message.
 * Mirrors the relay's `is_agent_owner` gate: ownership is determined by the
 * NIP-OA `ownerPubkey` field on the author's profile, NOT by the local
 * managed-agents list (which can diverge from server-side ownership).
 */
export function ownsAuthorAgent(
  profile: { ownerPubkey: string | null } | undefined,
  currentPubkey: string | undefined,
): boolean {
  return (
    !!currentPubkey &&
    !!profile?.ownerPubkey &&
    normalizePubkey(profile.ownerPubkey) === normalizePubkey(currentPubkey)
  );
}

export function resolveUserSecondaryLabel(input: {
  pubkey: string;
  profiles?: UserProfileLookup;
}) {
  const profile = getResolvedProfile(input.pubkey, input.profiles);
  const displayName = readableIdentityName(profile?.displayName, input.pubkey);
  const nip05Handle = readableIdentityName(profile?.nip05Handle, input.pubkey);

  if (displayName && nip05Handle) {
    return nip05Handle;
  }

  return null;
}

/**
 * Label for an agent's owner: "you" when the current user owns it, otherwise
 * the owner's display name, NIP-05 handle, or a semantic owner label.
 */
export function formatOwnerLabel(
  ownerPubkey: string | null | undefined,
  currentPubkey: string | null | undefined,
  ownerProfiles?: UserProfileLookup,
) {
  if (!ownerPubkey) {
    return null;
  }

  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey);
  if (
    currentPubkey &&
    normalizedOwnerPubkey === normalizePubkey(currentPubkey)
  ) {
    return "you";
  }

  const owner = ownerProfiles?.[normalizedOwnerPubkey];
  return (
    readableIdentityName(owner?.displayName, ownerPubkey) ||
    readableIdentityName(owner?.name, ownerPubkey) ||
    readableIdentityName(owner?.nip05Handle, ownerPubkey) ||
    "Owner"
  );
}
