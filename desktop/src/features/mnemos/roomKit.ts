import * as React from "react";

import type { Book, Writes } from "./adapt";
import { mnemosPlace, type PlaceMind } from "./api";
import type { BookHello, BookLife, BookSummary } from "./book";
import type { NotebookMemories } from "./notebookLoad";
import type { Reader } from "./useReader";

/** A newer Mnemos's whole notebook, as last read (`useNotebook`). */
export type NotebookView = {
  hello: BookHello;
  life: BookLife;
  memories: NotebookMemories;
  /** The last summary: its counts, and what waits on the person. */
  summary: BookSummary | null;
  /** A picture the notebook listed, by its path, as an address the page
   *  can show; null when it can't be read. */
  picture: (path: string) => Promise<string | null>;
};

/** What every room is given by the card. */
export type RoomProps = {
  book: Book;
  mind: PlaceMind;
  /** The address's opened item, if any. */
  item: string | null;
  /** Open an item (or close it, with null), in the address; `replace`
   *  when it opened by itself, so Back doesn't step through it. */
  openItem: (id: string | null, options?: { replace?: boolean }) => void;
  /** Go to another room, with an item opened there. */
  goTo: (room: string, item?: string) => void;
  reader: Reader;
  /** The person's writes, each sent once. */
  writes: Writes;
  /** The whole notebook, from a Mnemos that gives it; null from an older
   *  one, where a section it can't feed says so in one line. */
  notebook: NotebookView | null;
};

/** The line a room shows when one read didn't come back. */
export const DIDNT_ANSWER = "Mnemos couldn’t answer that just now.";

/**
 * An item named by the address is opened only if the room has it (its lists
 * hold only what this mind's engine gave in this session), and the engine's
 * own record agrees (`mnemos_place_item`); else the address lets go of it,
 * in place.
 */
export function useAddressItem(
  mind: string,
  item: string | null,
  has: (id: string) => boolean,
  loaded: boolean,
  openItem: RoomProps["openItem"],
): string | null {
  const [known, setKnown] = React.useState<string | null>(null);
  const here = item !== null && has(item);
  React.useEffect(() => {
    if (!item || !loaded) return;
    if (!here) {
      openItem(null, { replace: true });
      return;
    }
    if (known === item) return;
    let current = true;
    mnemosPlace.knows(mind, item).then(
      (yes) => {
        if (!current) return;
        if (yes) setKnown(item);
        else openItem(null, { replace: true });
      },
      () => {
        if (current) openItem(null, { replace: true });
      },
    );
    return () => {
      current = false;
    };
  }, [here, item, known, loaded, mind, openItem]);
  // The room's own lists hold only what the engine gave this session, so an
  // item it has shows at once; the engine's own answer then confirms it, or
  // the address lets it go.
  return here ? item : null;
}
