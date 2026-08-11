import * as React from "react";

const FOLLOW_TAIL_THRESHOLD_PX = 72;

/**
 * Keep a growing in-timeline response pinned only while the reader is already
 * following the tail. Resize observation is required because per-response
 * subscriptions intentionally do not rerender the timeline parent per chunk.
 */
export function useFollowGrowingTimelineTail(
  hostRef: React.RefObject<HTMLDivElement | null>,
  scrollToBottomOnce: () => void,
) {
  const followsTailRef = React.useRef(true);
  const followFrameRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    const scroller = hostRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLDivElement)) return;
    const content = scroller.firstElementChild;
    if (!(content instanceof HTMLElement)) return;

    let priorHeight = content.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const nextHeight = content.getBoundingClientRect().height;
      const grew = nextHeight > priorHeight + 0.5;
      priorHeight = nextHeight;
      if (grew && followsTailRef.current && followFrameRef.current === null) {
        followFrameRef.current = requestAnimationFrame(() => {
          followFrameRef.current = null;
          if (followsTailRef.current) scrollToBottomOnce();
        });
      }
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    };
  }, [hostRef, scrollToBottomOnce]);

  return React.useCallback((distanceFromBottom: number) => {
    followsTailRef.current = distanceFromBottom <= FOLLOW_TAIL_THRESHOLD_PX;
    if (!followsTailRef.current && followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
  }, []);
}
