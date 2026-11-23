import * as React from "react";

import { codeOf, mnemosPlace, type PlaceMinds } from "./api";
import { clearMnemosDrafts } from "./drafts";
import { resetVisits } from "./memoryArrange";
import { resetOwnerTouch } from "./readOnSight";
import { resetReadHere } from "./useReadOnSight";

/**
 * What the Mnemos place's rail and card both need to know: the minds on this
 * Mac (names and numbers) and each room's count. Numbers only, never a word
 * of a memory: words live in the card's own state while it is on screen.
 * Reset with the community (`resetCommunityState`).
 */
export type RoomCounts = Partial<
  Record<
    | "memories"
    | "shared"
    | "beliefs"
    | "questions"
    | "journal"
    | "notes"
    | "carrying"
    | "hours",
    number
  >
>;

type Facts = {
  minds: PlaceMinds | null;
  /** Why the minds couldn't be listed, if they couldn't. */
  failed: string | null;
  counts: Record<string, RoomCounts>;
};

const empty: Facts = { minds: null, failed: null, counts: {} };
let facts: Facts = empty;
/** How many memories a newer Mnemos's notebook says each mind can reach,
 *  once read: the one number the head, the rail and its mind line all show,
 *  over the count the minds were listed with. */
const told = new Map<string, number>();

/** The minds, each with the notebook's own number where it has told one. */
function withTold(minds: PlaceMinds | null): PlaceMinds | null {
  const differs = (m: PlaceMinds["minds"][number]) =>
    (told.get(m.id) ?? m.memories) !== m.memories;
  if (!minds?.minds.some(differs)) return minds;
  return {
    ...minds,
    minds: minds.minds.map((m) => {
      const n = told.get(m.id);
      return n === undefined || n === m.memories ? m : { ...m, memories: n };
    }),
  };
}
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Facts) {
  facts = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The place's facts, kept current. */
export function useMnemosFacts(): Facts {
  return React.useSyncExternalStore(
    subscribe,
    () => facts,
    () => facts,
  );
}

/** Look for the minds on this Mac (once at a time; `again` looks afresh). */
export function loadMinds(again = false): Promise<void> {
  if (loading) return loading;
  if (facts.minds && !again) return Promise.resolve();
  loading = mnemosPlace
    .minds()
    .then(
      (minds) => set({ ...facts, minds: withTold(minds), failed: null }),
      (error) => set({ ...facts, failed: codeOf(error) }),
    )
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Record a room's count for a mind. */
export function setRoomCounts(mind: string, counts: RoomCounts) {
  const before = facts.counts[mind] ?? {};
  const changed = Object.entries(counts).some(
    ([key, value]) => before[key as keyof RoomCounts] !== value,
  );
  if (!changed) return;
  set({
    ...facts,
    counts: { ...facts.counts, [mind]: { ...before, ...counts } },
  });
}

/** The notebook's own count of the memories a mind can reach: its rail
 *  row, and the number the minds are listed with (the head's and the rail's
 *  mind line), so all three agree. */
export function setNotebookMemories(mind: string, memories: number) {
  told.set(mind, memories);
  setRoomCounts(mind, { memories });
  const minds = withTold(facts.minds);
  if (minds !== facts.minds) set({ ...facts, minds });
}

/** Forget everything (a community switch). */
export function resetMnemosPlace() {
  loading = null;
  told.clear();
  clearMnemosDrafts();
  resetOwnerTouch();
  resetReadHere();
  resetVisits();
  set(empty);
}
