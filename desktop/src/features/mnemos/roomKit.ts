import * as React from "react";

import type { Book } from "./adapt";
import { mnemosPlace, type PlaceMind } from "./api";
import type { Reader } from "./useReader";

/** What every room is given by the card. */
export type RoomProps = {
  book: Book;
  mind: PlaceMind;
  /** The address's opened item, if any. */
  item: string | null;
  /** Open an item (or close it, with null), in the address. */
  openItem: (id: string | null) => void;
  /** Go to another room, with an item opened there. */
  goTo: (room: string, item?: string) => void;
  reader: Reader;
};

/** The line a room shows when one read didn't come back. */
export const DIDNT_ANSWER = "Mnemos couldn’t answer that just now.";

/**
 * An item named by the address is opened only if this mind's engine gave
 * that id in this session (`mnemos_place_item`) and the room has it; else
 * the address lets go of it, in place.
 */
export function useAddressItem(
  mind: string,
  item: string | null,
  has: (id: string) => boolean,
  loaded: boolean,
  openItem: (id: string | null) => void,
): string | null {
  const [known, setKnown] = React.useState<string | null>(null);
  const present = item !== null && loaded && has(item);
  React.useEffect(() => {
    if (!item || !loaded) return;
    if (!present) {
      openItem(null);
      return;
    }
    let current = true;
    mnemosPlace.knows(mind, item).then(
      (yes) => {
        if (!current) return;
        if (yes) setKnown(item);
        else openItem(null);
      },
      () => {
        if (current) openItem(null);
      },
    );
    return () => {
      current = false;
    };
  }, [item, loaded, mind, openItem, present]);
  return item !== null && known === item && present ? item : null;
}
