/**
 * When you last looked at each mind's page (BETA14_RELEASE.md WP-43,
 * Decided 8): one time per agent, under the community, so anything they
 * made, wrote or did since can wear a small dot, here and on their rail row.
 *
 * Kept in localStorage under the community's own key; the module's memory of
 * it is reset with the community's other state (resetCommunityState), so
 * nothing of one community's visits outlives a switch to another.
 */

const PREFIX = "luca-mind-visits-v1";

type Visits = Record<string, number>;

type Store = Pick<Storage, "getItem" | "setItem">;

const memory = new Map<string, Visits>();
const listeners = new Set<() => void>();
let version = 0;

function storage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function keyOf(scope: string) {
  return `${PREFIX}:${scope}`;
}

function read(scope: string, store: Store | null): Visits {
  const held = memory.get(scope);
  if (held) return held;
  let visits: Visits = {};
  try {
    const raw = store?.getItem(keyOf(scope));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      visits = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]),
        ),
      );
  } catch {
    // A visit list that can't be read is no visits: nothing is marked new.
  }
  memory.set(scope, visits);
  return visits;
}

/** When you last opened this mind's page here, or null if you never have. */
export function lastVisitOf(
  scope: string,
  pubkey: string,
  store: Store | null = storage(),
): number | null {
  return read(scope, store)[pubkey.toLowerCase()] ?? null;
}

/** Opening their page: the time is kept, and the rail's dot goes. */
export function recordVisit(
  scope: string,
  pubkey: string,
  at: number = Date.now(),
  store: Store | null = storage(),
): void {
  const next = { ...read(scope, store), [pubkey.toLowerCase()]: at };
  memory.set(scope, next);
  try {
    store?.setItem(keyOf(scope), JSON.stringify(next));
  } catch {
    // Kept for this session only.
  }
  version += 1;
  for (const listener of listeners) listener();
}

/** Something is new when it came after the last visit; with no visit yet
 *  nothing is (there is nothing to be new since). */
export function isNewSince(at: number, since: number | null): boolean {
  return since !== null && Number.isFinite(at) && at > since;
}

export function subscribeMindVisits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mindVisitsVersion(): number {
  return version;
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetMindVisits(): void {
  memory.clear();
  version += 1;
  for (const listener of listeners) listener();
}
