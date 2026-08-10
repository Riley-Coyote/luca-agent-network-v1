export type PolyphonicOnboardingChapter = "you" | "agents" | "brain" | "ready";

export type PolyphonicOnboardingTransaction = {
  version: 2;
  pubkey: string;
  chapter: PolyphonicOnboardingChapter;
  profileSaved: boolean;
  agentsReviewed: boolean;
  brainReviewed: boolean;
  agentsNeedAttention: boolean;
  brainNeedsAttention: boolean;
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
  return ["you", "agents", "brain", "ready"].includes(String(value));
}

function isTransaction(
  value: unknown,
  pubkey: string,
): value is PolyphonicOnboardingTransaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<PolyphonicOnboardingTransaction>;
  return (
    transaction.version === 2 &&
    transaction.pubkey === pubkey &&
    isChapter(transaction.chapter) &&
    typeof transaction.profileSaved === "boolean" &&
    typeof transaction.agentsReviewed === "boolean" &&
    typeof transaction.brainReviewed === "boolean" &&
    typeof transaction.agentsNeedAttention === "boolean" &&
    typeof transaction.brainNeedsAttention === "boolean" &&
    typeof transaction.updatedAt === "string"
  );
}

export function createPolyphonicOnboardingTransaction(
  pubkey: string,
): PolyphonicOnboardingTransaction {
  return {
    version: 2,
    pubkey,
    chapter: "you",
    profileSaved: false,
    agentsReviewed: false,
    brainReviewed: false,
    agentsNeedAttention: false,
    brainNeedsAttention: false,
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
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: unknown }).version === 1
    ) {
      const legacy = parsed as Record<string, unknown>;
      const migrated = {
        ...legacy,
        version: 2 as const,
        agentsNeedAttention: false,
        brainNeedsAttention: false,
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
