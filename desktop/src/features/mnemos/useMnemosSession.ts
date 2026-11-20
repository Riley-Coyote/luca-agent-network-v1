import * as React from "react";

import type { Ask } from "./adapt";
import { codeOf, mnemosPlace, type PlaceRequest } from "./api";

/** How the mind in view stands with the place. */
export type SessionPhase =
  | { kind: "opening" }
  | { kind: "open" }
  /** The person said not to show it: nothing was read. */
  | { kind: "declined" }
  | { kind: "failed"; code: string };

/** Answers that end what the card can show, until the person acts. */
const ENDING = new Set([
  "mind_changed",
  "mind_unavailable",
  "mnemos_unavailable",
  "mnemos_too_old",
  "mnemos_timeout",
  "mnemos_failed",
]);

/** Whether the window is on screen (`visibilityState`). Losing focus alone
 *  keeps it visible. */
export function useWindowVisible(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

/**
 * The mind in view, opened through the person's own `mnemos interface`: a
 * mind a resident remembers with opens unasked, any other is asked about
 * once, natively. The process ends when the place is left (here), after the
 * window has been hidden two minutes, and at app exit (both in Rust). A read
 * that finds the process ended opens it again, once, without asking twice.
 */
export function useMnemosSession(mindId: string) {
  const [phase, setPhase] = React.useState<SessionPhase>({ kind: "opening" });
  const [attempt, setAttempt] = React.useState({ n: 0, askAgain: false });
  const live = React.useRef(true);
  const reopening = React.useRef<Promise<boolean> | null>(null);
  const visible = useWindowVisible();

  React.useEffect(() => {
    live.current = true;
    let current = true;
    setPhase({ kind: "opening" });
    mnemosPlace.open(mindId, attempt.askAgain).then(
      (shown) => {
        if (!current) {
          // Answered after the place was left: end what it started.
          void mnemosPlace.close();
          return;
        }
        setPhase(shown ? { kind: "open" } : { kind: "declined" });
      },
      (error) => {
        if (current) setPhase({ kind: "failed", code: codeOf(error) });
      },
    );
    return () => {
      current = false;
      live.current = false;
      void mnemosPlace.close();
    };
  }, [mindId, attempt]);

  React.useEffect(() => {
    void mnemosPlace.shown(visible);
  }, [visible]);

  const ask: Ask = React.useCallback(
    async (request: PlaceRequest) => {
      const settle = (error: unknown): never => {
        const code = codeOf(error);
        if (ENDING.has(code) && live.current)
          setPhase({ kind: "failed", code });
        throw error;
      };
      try {
        return await mnemosPlace.read(mindId, request);
      } catch (error) {
        if (codeOf(error) !== "not_open" || !live.current) return settle(error);
      }
      try {
        reopening.current ??= mnemosPlace.open(mindId, false).finally(() => {
          reopening.current = null;
        });
        if (!(await reopening.current)) {
          if (live.current) setPhase({ kind: "declined" });
          throw new Error("not_open");
        }
        return await mnemosPlace.read(mindId, request);
      } catch (error) {
        return settle(error);
      }
    },
    [mindId],
  );

  const retry = React.useCallback((askAgain = false) => {
    setAttempt((before) => ({ n: before.n + 1, askAgain }));
  }, []);

  return { phase, ask, retry, visible };
}
