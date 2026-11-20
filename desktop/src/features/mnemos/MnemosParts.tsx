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

/** A day as the notebook says it in full: Monday, November 16, 2026. */
export function longDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

/**
 * A room: its list (about 360 wide) beside the thing opened. Where the card
 * is narrow, the opened thing slides over the list, with a back link to it
 * (the WP-43 way; mnemos-place.css measures by the room's own width).
 */
export function RoomFrame({
  backLabel,
  empty,
  list,
  onBack,
  opened,
  testId,
}: {
  backLabel: string;
  /** What the opened side says while nothing is open. */
  empty: string;
  list: React.ReactNode;
  onBack: () => void;
  opened: React.ReactNode | null;
  testId: string;
}) {
  const openedRef = React.useRef<HTMLDivElement>(null);
  const isOpen = opened !== null;
  const wasOpen = React.useRef(isOpen);
  React.useEffect(() => {
    // Reading on: the opened thing takes focus, so a screen reader starts
    // there; it isn't something you act on, so it draws no ring.
    if (isOpen && !wasOpen.current) openedRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);
  return (
    <div
      className="luca-mnemos-room"
      data-open={isOpen ? "" : undefined}
      data-testid={testId}
    >
      <div className="luca-mnemos-room-grid">
        <div className="luca-mnemos-list">{list}</div>
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
          ) : (
            <p className="luca-mnemos-quiet text-sm">{empty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** A fact under an opened thing: its label, small, and its words. */
export function Fact({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="luca-mnemos-fact">
      <dt className="text-2xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
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
