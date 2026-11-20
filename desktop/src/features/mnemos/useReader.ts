import * as React from "react";

import {
  type MnemosSection,
  mnemosView,
  type ViewCounts,
  type ViewItem,
} from "@/shared/api/mnemosView";
import type { PlaceMind } from "./api";

/**
 * The old reader (`mnemos view`, through the agent page's own commands and
 * consent record), for the three rooms today's interface can't give:
 * Standing, Beliefs and Carrying forward. It reads a mind a resident
 * remembers with, through that resident's connection.
 */
export type Reader =
  | { kind: "looking" }
  /** Why the three rooms can't be read here, said plainly. */
  | { kind: "missing"; line: string }
  | {
      kind: "ready";
      read: (section: MnemosSection) => Promise<ViewItem[]>;
      counts: () => Promise<ViewCounts>;
    };

const UNLINKED =
  "Polyphonic can show this for a memory one of your agents remembers with.";
const NO_PYTHON = "Reading it here needs Python 3.12 or 3.13 on this Mac.";
const UNAVAILABLE = "The compatible local reader isn’t available.";

export function useReader(
  mind: Pick<PlaceMind, "id" | "linked">,
  /** Off for a Mnemos that gives the notebook: then nothing is asked. */
  enabled: boolean,
): Reader {
  const resident = mind.linked[0]?.pubkey ?? null;
  const [reader, setReader] = React.useState<Reader>({ kind: "looking" });
  React.useEffect(() => {
    let current = true;
    if (!enabled) {
      setReader({ kind: "looking" });
      return;
    }
    if (!resident) {
      setReader({ kind: "missing", line: UNLINKED });
      return;
    }
    setReader({ kind: "looking" });
    mnemosView.status(resident).then(
      (status) => {
        if (!current) return;
        if (!status.readerReady) {
          setReader({ kind: "missing", line: NO_PYTHON });
          return;
        }
        const grant = status.grant;
        if (!grant || !status.linked) {
          setReader({ kind: "missing", line: UNLINKED });
          return;
        }
        setReader({
          kind: "ready",
          read: async (section) => {
            const page = await mnemosView.read(resident, grant, section);
            return page.kind === "items" ? page.items : [];
          },
          counts: async () => {
            const page = await mnemosView.read(resident, grant, "summary");
            if (page.kind !== "summary") throw new Error("invalid_reply");
            return page.counts;
          },
        });
      },
      () => {
        if (current) setReader({ kind: "missing", line: UNAVAILABLE });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled, resident]);
  return reader;
}

/** One old-reader section, read once the reader is ready. */
export function useReaderSection<T>(
  reader: Reader,
  section: MnemosSection,
  shape: (item: ViewItem) => T,
): { items: T[] | null; line: string | null } {
  const [items, setItems] = React.useState<T[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const shapeRef = React.useRef(shape);
  shapeRef.current = shape;
  React.useEffect(() => {
    if (reader.kind !== "ready") return;
    let current = true;
    setItems(null);
    setFailed(false);
    reader.read(section).then(
      (list) => {
        if (current) setItems(list.map((item) => shapeRef.current(item)));
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [reader, section]);
  if (reader.kind === "missing") return { items: null, line: reader.line };
  if (failed) return { items: null, line: UNAVAILABLE };
  return { items, line: null };
}
