import * as React from "react";

import type { Ask } from "./adapt";
import { codeOf, mnemosPlace } from "./api";
import type { BookHello } from "./book";
import {
  type Loaded,
  NOTHING_LOADED,
  refresh,
  SUMMARY_EVERY_MS,
} from "./notebookLoad";
import { helloOf } from "./notebookShapes";

/** Which Mnemos the open mind's process is: one that gives the notebook
 *  (its `hello`), an older one, or not known yet. */
export type Engine =
  | { kind: "asking" }
  | { kind: "newer"; hello: BookHello }
  | { kind: "older" };

/** What the open mind's Mnemos said to `hello`, once it is open. */
export function useEngine(mind: string, open: boolean): Engine {
  const [engine, setEngine] = React.useState<Engine>({ kind: "asking" });
  React.useEffect(() => {
    if (!open) return;
    let current = true;
    mnemosPlace.hello(mind).then(
      (said) => {
        if (!current) return;
        const hello = helloOf(said);
        setEngine(hello ? { kind: "newer", hello } : { kind: "older" });
      },
      () => {
        // The place's command isn't there (an older app talking to its own
        // engine): read it as before.
        if (current) setEngine({ kind: "older" });
      },
    );
    return () => {
      current = false;
    };
  }, [mind, open]);
  return engine;
}

/** The notebook as last read, and why the last read failed if it did. */
export type NotebookState = Loaded & { failed: string | null };

/**
 * A newer Mnemos's notebook, read while `on` (the mind open and the window
 * on screen): the summary every five seconds, and the parts again only when
 * its token changes (`refresh`). Off, everything read is let go, as every
 * room lets its words go when the window hides.
 */
export function useNotebook(ask: Ask, on: boolean): NotebookState {
  const [state, setState] = React.useState<NotebookState>({
    ...NOTHING_LOADED,
    failed: null,
  });
  React.useEffect(() => {
    if (!on) {
      setState({ ...NOTHING_LOADED, failed: null });
      return;
    }
    let current = true;
    let held: Loaded = NOTHING_LOADED;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const turn = async () => {
      try {
        const { next } = await refresh(ask, held);
        if (!current) return;
        if (next !== held) {
          // Only a new read is a new state: the same token keeps every
          // room's reading as it is.
          const changed = next.life !== held.life;
          held = next;
          setState((before) =>
            changed || before.failed
              ? { ...next, failed: null }
              : { ...before, summary: next.summary },
          );
        }
      } catch (error) {
        if (current)
          setState((before) => ({ ...before, failed: codeOf(error) }));
      } finally {
        if (current) timer = setTimeout(turn, SUMMARY_EVERY_MS);
      }
    };
    void turn();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [ask, on]);
  return state;
}

/**
 * The open mind's pictures, by their notebook path, as addresses the page
 * can show: read once each through `mnemos_place_picture` (only a path the
 * engine listed this session), kept as object URLs while the mind is in
 * view, and let go after.
 */
export function usePictures(mind: string) {
  const urls = React.useRef(new Map<string, Promise<string | null>>());
  React.useEffect(() => {
    const held = urls.current;
    return () => {
      for (const url of held.values())
        void url.then((u) => {
          if (u) URL.revokeObjectURL(u);
        });
      held.clear();
    };
  }, []);
  return React.useCallback(
    (path: string): Promise<string | null> => {
      const known = urls.current.get(path);
      if (known) return known;
      const url = mnemosPlace.picture(mind, path).then(
        (bytes) => URL.createObjectURL(new Blob([bytes])),
        () => null,
      );
      urls.current.set(path, url);
      return url;
    },
    [mind],
  );
}
