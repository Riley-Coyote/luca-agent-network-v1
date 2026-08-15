export type PolyphonicOnboardingChapter =
  | "welcome"
  | "runtime"
  | "agents"
  | "preparing";

export type PolyphonicOnboardingTransaction = {
  version: 3;
  pubkey: string;
  chapter: PolyphonicOnboardingChapter;
  profileSaved: boolean;
  agentsReviewed: boolean;
  runtimeConfirmed: boolean;
  updatedAt: string;
};

const TRANSACTION_PREFIX = "polyphonic-onboarding-transaction.v1";
const SESSION_SKIP_PREFIX = "polyphonic-onboarding-session-skip.v1";

function transactionKey(pubkey: string) {
  return `${TRANSACTION_PREFIX}:${pubkey}`;
}

function sessionSkipKey(pubkey: string) {
  return `${SESSION_SKIP_PREFIX}:${pubkey}`;
}

function isChapter(value: unknown): value is PolyphonicOnboardingChapter {
  return ["welcome", "runtime", "agents", "preparing"].includes(String(value));
}

function isTransaction(
  value: unknown,
  pubkey: string,
): value is PolyphonicOnboardingTransaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<PolyphonicOnboardingTransaction>;
  return (
    transaction.version === 3 &&
    transaction.pubkey === pubkey &&
    isChapter(transaction.chapter) &&
    typeof transaction.profileSaved === "boolean" &&
    typeof transaction.agentsReviewed === "boolean" &&
    typeof transaction.runtimeConfirmed === "boolean" &&
    typeof transaction.updatedAt === "string"
  );
}

export function createPolyphonicOnboardingTransaction(
  pubkey: string,
): PolyphonicOnboardingTransaction {
  return {
    version: 3,
    pubkey,
    chapter: "welcome",
    profileSaved: false,
    agentsReviewed: false,
    runtimeConfirmed: false,
    updatedAt: new Date().toISOString(),
  };
}

export function readPolyphonicOnboardingTransaction(
  pubkey: string | null,
  storage: Storage = localStorage,
): PolyphonicOnboardingTransaction | null {
  if (!pubkey) return null;
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(transactionKey(pubkey)) ?? "null",
    );
    if (parsed && typeof parsed === "object") {
      const legacy = parsed as Record<string, unknown>;
      const version = legacy.version;
      if (version !== 1 && version !== 2) {
        return isTransaction(parsed, pubkey) ? parsed : null;
      }
      if (legacy.pubkey !== pubkey) return null;
      const migrated: PolyphonicOnboardingTransaction = {
        version: 3,
        pubkey,
        chapter: legacy.chapter === "you" ? "welcome" : "runtime",
        profileSaved: legacy.profileSaved === true,
        runtimeConfirmed: false,
        agentsReviewed: false,
        updatedAt:
          typeof legacy.updatedAt === "string"
            ? legacy.updatedAt
            : new Date().toISOString(),
      };
      if (isTransaction(migrated, pubkey)) {
        storage.setItem(transactionKey(pubkey), JSON.stringify(migrated));
        return migrated;
      }
    }
    return isTransaction(parsed, pubkey) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePolyphonicOnboardingTransaction(
  transaction: PolyphonicOnboardingTransaction,
  storage: Storage = localStorage,
) {
  const updated = { ...transaction, updatedAt: new Date().toISOString() };
  storage.setItem(transactionKey(transaction.pubkey), JSON.stringify(updated));
  return updated;
}

export function clearPolyphonicOnboardingTransaction(
  pubkey: string | null,
  storage: Storage = localStorage,
) {
  if (pubkey) storage.removeItem(transactionKey(pubkey));
}

export function skipPolyphonicOnboardingForSession(
  pubkey: string,
  storage: Storage = sessionStorage,
) {
  storage.setItem(sessionSkipKey(pubkey), "true");
}

export function isPolyphonicOnboardingSkippedForSession(
  pubkey: string | null,
  storage: Storage = sessionStorage,
) {
  return Boolean(pubkey && storage.getItem(sessionSkipKey(pubkey)) === "true");
}

export function clearPolyphonicOnboardingSessionSkip(
  pubkey: string | null,
  storage: Storage = sessionStorage,
) {
  if (pubkey) storage.removeItem(sessionSkipKey(pubkey));
}
