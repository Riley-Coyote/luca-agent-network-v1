import * as React from "react";
import type { VListHandle } from "virtua";

const BOTTOM_EPSILON_PX = 1;
const SETTLE_DEADLINE_MS = 250;

const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export function shouldRetireVirtualizedBottomSettleForKey({
  editableTarget,
  key,
}: {
  editableTarget: boolean;
  key: string;
}): boolean {
  return !editableTarget && SCROLL_INTENT_KEYS.has(key);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches("input, textarea, select") ||
    target.closest('[contenteditable="true"]') !== null
  );
}

export function useVirtualizedBottomSettle(
  hostRef: React.RefObject<HTMLDivElement | null>,
  listRef: React.RefObject<VListHandle | null>,
  itemsLengthRef: React.RefObject<number>,
) {
  const frameRef = React.useRef<number | null>(null);
  const cancel = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  React.useLayoutEffect(() => {
    const scroller = hostRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLDivElement)) return;
    const retire = () => cancel();
    const retireForScrollKey = (event: KeyboardEvent) => {
      if (
        shouldRetireVirtualizedBottomSettleForKey({
          editableTarget: isEditableEventTarget(event.target),
          key: event.key,
        })
      ) {
        cancel();
      }
    };
    scroller.addEventListener("pointerdown", retire, { passive: true });
    scroller.addEventListener("touchstart", retire, { passive: true });
    scroller.addEventListener("wheel", retire, { passive: true });
    scroller.addEventListener("keydown", retireForScrollKey, true);
    return () => {
      scroller.removeEventListener("pointerdown", retire);
      scroller.removeEventListener("touchstart", retire);
      scroller.removeEventListener("wheel", retire);
      scroller.removeEventListener("keydown", retireForScrollKey, true);
    };
  }, [cancel, hostRef]);

  const settle = React.useCallback(() => {
    cancel();
    const deadline = performance.now() + SETTLE_DEADLINE_MS;
    let settledFrames = 0;
    let previousHeight = -1;
    const next = () => {
      const scroller = hostRef.current?.firstElementChild;
      const lastIndex = itemsLengthRef.current - 1;
      if (!(scroller instanceof HTMLDivElement) || lastIndex < 0) {
        cancel();
        return;
      }
      const list = listRef.current;
      if (list) {
        // The permanent composer spacer is the final item. A new message is
        // therefore inserted immediately before an already-known last key,
        // and Virtua can preserve that key's old anchor for one measurement
        // pass. Scrolling to the unchanged spacer index then becomes a no-op
        // while the newly inserted suffix remains below the viewport. Target
        // the virtualizer's physical extent first; the index correction still
        // follows so a newly measured spacer height is incorporated.
        list.scrollTo(list.scrollSize);
        // Realize the content row before correcting to the permanent spacer.
        // The spacer's key and index are already mounted across an append, so
        // asking only for it can be a no-op while the newly inserted owner row
        // remains outside Virtua's rendered range for several frames.
        if (lastIndex > 0) {
          list.scrollToIndex(lastIndex - 1, { align: "end" });
        }
        list.scrollToIndex(lastIndex, { align: "end" });
      }
      // Keep the DOM scroll node authoritative for the current paint. Virtua's
      // offset cache catches up on the next animation frame, but immediate
      // acknowledgement cannot wait behind that reconciliation.
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
      const atBottom =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
        BOTTOM_EPSILON_PX;
      settledFrames =
        atBottom && scroller.scrollHeight === previousHeight
          ? settledFrames + 1
          : 0;
      previousHeight = scroller.scrollHeight;
      if (settledFrames >= 2 || performance.now() >= deadline) {
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(next);
    };
    next();
  }, [cancel, hostRef, itemsLengthRef, listRef]);

  React.useEffect(() => cancel, [cancel]);
  return { cancel, settle };
}
