import { invoke } from "@tauri-apps/api/core";

/**
 * The Mnemos place's own commands (desktop/src-tauri/src/commands/
 * mnemos_place.rs): four reading requests, and the person's four writes
 * (answer a note, leave one, correct a memory, let one go). The `Wire*`
 * shapes are what the person's `mnemos interface` answers; only `adapt.ts`
 * reads them, and everything else reads the place's own shapes (`book.ts`).
 */

/** A resident that remembers with a mind. */
export type LinkedResident = { pubkey: string; name: string };

/** A mind on this Mac: its name and numbers, never any of its words. */
export type PlaceMind = {
  id: string;
  name: string;
  memories: number;
  /** The day of its newest memory, YYYY-MM-DD. */
  newest: string | null;
  linked: LinkedResident[];
};

export type PlaceMinds = {
  mnemosReady: boolean;
  minds: PlaceMind[];
  /** The owner's residents on this Mac that remember with no memory yet. */
  withoutMemory: LinkedResident[];
};

export type WireState = "active" | "dormant";

export type PlaceRequest =
  | { command: "memories"; state?: WireState; limit: number; offset: number }
  | { command: "search"; query: string }
  | { command: "journal"; last: number }
  | { command: "notes" };

export type WireCounts = { active: number; dormant: number; archived: number };

export type WireMemory = {
  id: string;
  words: string;
  kept: string | null;
  state: string;
  alive: number;
  corrected: string | null;
  impact: string;
  author: string;
};

export type WireFound = {
  id: string;
  words: string;
  kept: string | null;
  closeness: number;
  found: "meaning" | "words" | "link";
};

export type WireEntry = {
  id: string;
  text: string;
  mood: string | null;
  written: string | null;
  model: string | null;
  created_at: string | null;
};

export type WireNote = {
  id: string;
  kind: string | null;
  text: string;
  author: "agent" | "person";
  model: string | null;
  in_reply_to: string | null;
  created_at: string | null;
  read_at: string | null;
  delivered_at?: string | null;
};

export type PlaceReply =
  | { kind: "memories"; memories: WireMemory[]; counts: WireCounts }
  | { kind: "search"; results: WireFound[] }
  | { kind: "journal"; entries: WireEntry[] }
  | { kind: "notes"; notes: WireNote[] };

/** One of the person's own writes: exactly these four. */
export type PlaceWrite =
  | { command: "reply"; note_id: string; text: string }
  | { command: "note"; text: string }
  | { command: "correct"; memory_id: string; text: string }
  | { command: "forget"; memory_id: string };

export type WireWritten =
  | { kind: "note"; note: WireNote }
  | {
      kind: "corrected";
      id: string;
      replaces: string;
      corrected: string | null;
    }
  | { kind: "forgotten"; id: string; forgotten: string | null };

export const mnemosPlace = {
  minds: () => invoke<PlaceMinds>("mnemos_place_minds"),
  open: (mind: string, askAgain = false) =>
    invoke<boolean>("open_mnemos_mind", { mind, askAgain }),
  read: (mind: string, request: PlaceRequest) =>
    invoke<PlaceReply>("read_mnemos_place", { mind, request }),
  write: (mind: string, write: PlaceWrite) =>
    invoke<WireWritten>("write_mnemos_place", { mind, write }),
  knows: (mind: string, id: string) =>
    invoke<boolean>("mnemos_place_item", { mind, id }),
  close: () => invoke<void>("close_mnemos_place"),
  shown: (visible: boolean) => invoke<void>("mnemos_place_shown", { visible }),
};

/** An error's code, as the place's commands give it. */
export function codeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
