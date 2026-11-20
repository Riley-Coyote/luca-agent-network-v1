import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/shared/ui/button";

/** One plain line for a state, with its one way on where it has one. Never
 *  a spinner. */
export function PlaceLine({
  action,
  children,
  testId,
}: {
  action?: { label: string; run: () => void };
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="luca-mnemos-line" data-testid={testId ?? "mnemos-line"}>
      <p className="text-sm">{children}</p>
      {action ? (
        <Button onClick={action.run} size="quiet" type="button" variant="quiet">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/** The one line of a section an older Mnemos can't feed. */
export function NeedsNewer({ what }: { what: string }) {
  return (
    <PlaceLine testId="mnemos-needs-newer">
      {what} needs a newer Mnemos. Updating Mnemos brings it.
    </PlaceLine>
  );
}

/** When, as the place says it everywhere: the time today ("today at
 *  2:37 AM"), the day this year ("Friday, November 20"), the year only
 *  before this one. */
export function longDay(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (at.toDateString() === now.toDateString())
    return `today at ${at.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** The rest of an opened thing, said in one quiet line the way the notebook
 *  says it: "Kept Friday, November 20 · it can reach · never corrected". */
export function QuietLine({
  after,
  parts,
  testId,
}: {
  /** A quiet way on, said at the line's end after its parts. */
  after?: React.ReactNode;
  parts: (string | null | undefined | false)[];
  testId?: string;
}) {
  const said = parts.filter(Boolean);
  if (!said.length) return null;
  return (
    <p className="luca-mnemos-quietline text-xs" data-testid={testId}>
      {said.join(" · ")}
      {after ? <> · {after}</> : null}
    </p>
  );
}

/** Words as paragraphs, split where the writer left a blank line. */
export function Words({
  className,
  text,
}: {
  className?: string;
  text: string;
}) {
  const parts = text.split(/\n\s*\n/).filter((each) => each.trim());
  return (
    <div className={className ?? "luca-mnemos-words text-base"}>
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one fixed text, never reordered.
        <p key={index}>{part}</p>
      ))}
    </div>
  );
}

/** The width at which a room's list and the thing opened sit side by side
 *  (mnemos-place.css says the same). */
const SIDE_BY_SIDE = 721;

/**
 * A room: its list (about 360 wide) beside the thing opened. Wide, the room
 * opens its newest item by itself, so that side is never empty; narrow, it
 * stays on the list, and the opened thing slides over it with a back link
 * (the WP-43 way; mnemos-place.css measures by the room's own width).
 */
export function RoomFrame({
  addressed = null,
  backLabel,
  first,
  list,
  onBack,
  onOpenFirst,
  opened,
  openedKey,
  testId,
}: {
  /** The item the address names, if any: while it names one that isn't
   *  open (yet, or any more), nothing opens by itself. */
  addressed?: string | null;
  backLabel: string;
  /** The newest item's key, once the list has it. */
  first: string | null;
  list: React.ReactNode;
  onBack: () => void;
  /** Opens the newest item, in place (wide only). */
  onOpenFirst: (key: string) => void;
  opened: React.ReactNode | null;
  /** The opened item's key, or null. */
  openedKey: string | null;
  testId: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const openedRef = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= SIDE_BY_SIDE);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Wide, nothing open: the newest opens by itself, once each time the
  // card is left empty (a memory let go, say).
  const opener = React.useRef(onOpenFirst);
  opener.current = onOpenFirst;
  const autoFor = React.useRef<string | null>(null);
  const autoOpened = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (openedKey !== null) {
      // Something the person opened: once it closes, the newest opens
      // again. What opened by itself and was then refused stays closed.
      if (openedKey !== autoFor.current) autoFor.current = null;
      return;
    }
    if (!wide || addressed !== null || !first || autoFor.current === first)
      return;
    autoFor.current = first;
    autoOpened.current = first;
    opener.current(first);
  }, [wide, openedKey, first, addressed]);

  // Reading on: what the person opens takes focus, so a screen reader
  // starts there; what opened by itself leaves focus where it was. It isn't
  // something you act on, so it draws no ring.
  const lastKey = React.useRef(openedKey);
  React.useEffect(() => {
    if (!openedKey || openedKey === lastKey.current) return;
    if (openedKey === autoOpened.current) autoOpened.current = null;
    else openedRef.current?.focus();
    lastKey.current = openedKey;
  }, [openedKey]);

  const isOpen = opened !== null;
  return (
    <div
      className="luca-mnemos-room"
      data-open={isOpen ? "" : undefined}
      data-testid={testId}
      ref={root}
    >
      <div className="luca-mnemos-room-grid">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: it only listens; each row is its own button. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: a row's Enter arrives as its click. */}
        <div
          className="luca-mnemos-list"
          onClick={(event) => {
            // The row already open, opened again: what it opened takes focus,
            // as a newly opened one does.
            const row = (event.target as Element).closest(
              "li[aria-current='true']",
            );
            if (row && isOpen) openedRef.current?.focus();
          }}
        >
          {list}
        </div>
        <div
          className="luca-mnemos-opened"
          data-testid={`${testId}-opened`}
          ref={openedRef}
          tabIndex={-1}
        >
          {isOpen ? (
            <div className="luca-mnemos-push">
              <button
                className="luca-mnemos-back text-sm"
                data-testid="mnemos-back"
                onClick={onBack}
                type="button"
              >
                <ChevronLeft aria-hidden />
                {backLabel}
              </button>
              {opened}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Runs `load` once per change of `deps`, keeping its answer only while the
 *  component that asked is still there. */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: React.DependencyList,
): { value: T | null; failed: string | null; again: () => void } {
  const [value, setValue] = React.useState<T | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [n, setN] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what a load depends on; `n` asks again.
  React.useEffect(() => {
    let current = true;
    setValue(null);
    setFailed(null);
    loadRef.current().then(
      (next) => {
        if (current) setValue(next);
      },
      (error: unknown) => {
        if (current)
          setFailed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      current = false;
    };
  }, [...deps, n]);
  return { value, failed, again: () => setN((x) => x + 1) };
}
