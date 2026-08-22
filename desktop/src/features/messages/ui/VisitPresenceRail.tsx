import * as React from "react";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";

/**
 * A long visit scrolls past its own door, and then the room stops saying who
 * is in it. So while a visit's passage is on screen, the guest's mark pins to
 * the margin the passage's inset opens up, rides down with you, and lets go
 * at the far door.
 *
 * It reads the DOM rather than the item stream on purpose: the timeline is
 * virtualized, so the only thing that knows where a passage currently sits on
 * screen is the rows that are currently mounted. `position: sticky` cannot do
 * this job for the same reason — the row a sticky mark would live on is
 * unmounted the moment it scrolls away.
 */
const MARK_SIZE = 17;
const TOP_INSET = 10;

type Pinned = { guest: string; top: number } | null;

export function VisitPresenceRail({
  visitorPubkeys,
}: {
  visitorPubkeys: ReadonlySet<string>;
}) {
  const [pinned, setPinned] = React.useState<Pinned>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    // The scrolling element is a sibling subtree: the rail is mounted in the
    // timeline's non-scrolling wrapper so it can stay put while rows move.
    const scroller = hostRef.current?.parentElement?.querySelector<HTMLElement>(
      "[data-buzz-conversation-scroll]",
    );
    if (!scroller) return;

    const measure = () => {
      frame.current = null;
      const viewport = scroller.getBoundingClientRect();
      const rows = [
        ...scroller.querySelectorAll<HTMLElement>("[data-visit-span]"),
      ];
      if (rows.length === 0) {
        setPinned((current) => (current === null ? current : null));
        return;
      }

      // Presence belongs only to the passage still open at the timeline tail.
      // A viewport can contain an older completed passage and the current one
      // at the same time; choosing the first visible run resurrected the older
      // guest as a detached mark.
      const activeRows = rows.filter((row) => {
        if (!row.dataset.visitActiveGuests) return false;
        const rect = row.getBoundingClientRect();
        return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
      });
      if (activeRows.length === 0) {
        setPinned((current) => (current === null ? current : null));
        return;
      }
      const rects = activeRows.map((row) => row.getBoundingClientRect());
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));

      // Historical passages keep their doors and connector, but they must not
      // grow a floating presence mark after the guest has stepped out. The
      // active passage carries its guests on every row, so virtualization does
      // not turn an old passage into presence when its door is remounted.
      const activeGuests = activeRows
        .flatMap((row) => row.dataset.visitActiveGuests?.split(",") ?? [])
        .filter(Boolean);
      let guest: string | undefined;
      for (let index = activeGuests.length - 1; index >= 0; index -= 1) {
        const candidate = activeGuests[index];
        if (candidate && visitorPubkeys.has(candidate.toLowerCase())) {
          guest = candidate;
          break;
        }
      }
      if (!guest) {
        setPinned((current) => (current === null ? current : null));
        return;
      }

      // Ride the top of the viewport, but never past the ends of the passage.
      const floor = viewport.top + TOP_INSET;
      const next = Math.round(
        Math.min(Math.max(top, floor), bottom - MARK_SIZE) - viewport.top,
      );
      setPinned((current) =>
        current && current.guest === guest && current.top === next
          ? current
          : { guest, top: next },
      );
    };

    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    const mutations = new MutationObserver(schedule);
    mutations.observe(scroller, { childList: true, subtree: true });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [visitorPubkeys]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
      data-testid="visit-presence-rail"
      data-visit-present={pinned ? "" : undefined}
      ref={hostRef}
    >
      {pinned ? (
        <div
          className="mx-auto w-full max-w-[48rem] px-0"
          style={{ transform: `translateY(${pinned.top}px)` }}
        >
          <ResidentIdentityMark
            accessibleName="Visiting resident"
            className="ml-1 text-foreground/45"
            decorative
            publicKey={pinned.guest}
            size={MARK_SIZE}
          />
        </div>
      ) : null}
    </div>
  );
}
