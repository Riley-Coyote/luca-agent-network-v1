import { invoke } from "@tauri-apps/api/core";

/**
 * The Mnemos place's own commands (desktop/src-tauri/src/commands/
 * mnemos_place.rs): the reading requests (the first four, and a newer
 * Mnemos's `summary` and `notebook`), its `hello`, its pictures, and the
 * person's seven writes (answer a note, leave one, correct a memory, let one
 * go, mark notes read, the quiet hours, the shared notebook). The `Wire*`
 * shapes are what the person's `mnemos interface` answers; only `adapt.ts`
 * and `notebookShapes.ts` read them, and everything else reads the place's
 * own shapes (`book.ts`).
 */

/** A resident that remembers with a mind. */
export type LinkedResident = { pubkey: string; name: string };

/** A mind on this Mac: its name and numbers, never any of its words. */
export type PlaceMind = {
  id: string;
  name: string;
  memories: number;
  /** The moment of its newest memory, as the store holds it, in world time;
   *  the page names the day (`newestDay`). */
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
  | { command: "notes" }
  | { command: "summary" }
  | {
      command: "notebook";
      part: NotebookPart;
      limit?: number;
      offset?: number;
      since?: string;
    };

/** A part of a newer Mnemos's notebook. */
export type NotebookPart = "life" | "memories" | "pulse";

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
  | { kind: "notes"; notes: WireNote[] }
  /** Passed through as the engine gave it; `notebookShapes.ts` guards it. */
  | { kind: "summary"; summary: unknown }
  | {
      kind: "notebook";
      part: NotebookPart;
      document: unknown;
      page: unknown;
      /** The pictures it lists, by their notebook path. */
      pictures: string[];
    };

/** The three quiet hours, by the engine's names for them. */
export type HourKind = "mine" | "ours" | "dream";

/** One quiet hour that changes: `on` as it will be, and only what else
 *  differs. An hour turned off carries `on: false` alone; the dream never
 *  carries `online`. */
export type HourChange = {
  on: boolean;
  /** HH:MM. */
  at?: string;
  /** 5 to 120. */
  minutes?: number;
  online?: boolean;
};

export type HoursChange = Partial<Record<HourKind, HourChange>>;

/** One of the person's own writes: exactly these seven. */
export type PlaceWrite =
  | { command: "reply"; note_id: string; text: string }
  | { command: "note"; text: string }
  | { command: "correct"; memory_id: string; text: string }
  | { command: "forget"; memory_id: string }
  | { command: "read"; note_ids: string[] }
  | {
      command: "hours";
      /** Only the hours that change, each by itself (Mnemos 0.7.0). */
      hours: HoursChange;
    }
  | {
      command: "shared";
      action: "add" | "correct" | "forget";
      text?: string;
      memory_id?: string;
      /** A forget is asked twice: true only once the person said so. */
      confirmed?: boolean;
    };

export type WireWritten =
  | { kind: "note"; note: WireNote }
  | {
      kind: "corrected";
      id: string;
      replaces: string;
      corrected: string | null;
    }
  | { kind: "forgotten"; id: string; forgotten: string | null }
  | { kind: "read"; ids: string[] }
  | { kind: "hours"; said: string }
  | { kind: "shared"; said: string };

export const mnemosPlace = {
  minds: () => invoke<PlaceMinds>("mnemos_place_minds"),
  open: (mind: string, askAgain = false) =>
    invoke<boolean>("open_mnemos_mind", { mind, askAgain }),
  read: (mind: string, request: PlaceRequest) =>
    invoke<PlaceReply>("read_mnemos_place", { mind, request }),
  write: (mind: string, write: PlaceWrite) =>
    invoke<WireWritten>("write_mnemos_place", { mind, write }),
  /** What a newer Mnemos said to `hello`; null from an older one. */
  hello: (mind: string) => invoke<unknown>("mnemos_place_hello", { mind }),
  /** The bytes of a picture the open mind's notebook listed. */
  picture: (mind: string, path: string) =>
    invoke<ArrayBuffer>("mnemos_place_picture", { mind, path }),
  knows: (mind: string, id: string) =>
    invoke<boolean>("mnemos_place_item", { mind, id }),
  close: () => invoke<void>("close_mnemos_place"),
  shown: (visible: boolean) => invoke<void>("mnemos_place_shown", { visible }),
};

/** An error's code, as the place's commands give it. */
export function codeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
