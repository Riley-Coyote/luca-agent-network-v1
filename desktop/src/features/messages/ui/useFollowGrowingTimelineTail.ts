import * as React from "react";

import { GrowingTimelineTailScheduler } from "./growingTimelineTailScheduler";

const FOLLOW_TAIL_THRESHOLD_PX = 72;
const MANAGED_RESPONSE_CONTENT_SELECTOR = ".managed-response-content";

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
  const schedulerRef = React.useRef<GrowingTimelineTailScheduler | null>(null);

  React.useLayoutEffect(() => {
    const scroller = hostRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLDivElement)) return;
    const content = scroller.firstElementChild;
    if (!(content instanceof HTMLElement)) return;

    let followCount = 0;
    const scheduler = new GrowingTimelineTailScheduler(() => {
      followCount += 1;
      scroller.dataset.managedTailFollowCount = String(followCount);
      scrollToBottomOnce();
    });
    scheduler.setEnabled(followsTailRef.current);
    schedulerRef.current = scheduler;
    const observed = new Set<HTMLElement>();
    const heights = new WeakMap<HTMLElement, number>();
    const resizeObserver = new ResizeObserver((entries) => {
      let managedBodyGrew = false;
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        const nextHeight = entry.target.getBoundingClientRect().height;
        const previousHeight = heights.get(entry.target) ?? nextHeight;
        heights.set(entry.target, nextHeight);
        if (nextHeight > previousHeight + 0.5) managedBodyGrew = true;
      }
      if (managedBodyGrew) scheduler.request();
    });

    const observeManagedBody = (element: HTMLElement) => {
      if (observed.has(element)) return;
      observed.add(element);
      heights.set(element, element.getBoundingClientRect().height);
      resizeObserver.observe(element);
    };
    const visitAddedNode = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(MANAGED_RESPONSE_CONTENT_SELECTOR)) {
        observeManagedBody(node);
      }
      for (const element of node.querySelectorAll<HTMLElement>(
        MANAGED_RESPONSE_CONTENT_SELECTOR,
      )) {
        observeManagedBody(element);
      }
    };
    const visitRemovedNode = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const removed = node.matches(MANAGED_RESPONSE_CONTENT_SELECTOR)
        ? [node]
        : [];
      removed.push(
        ...node.querySelectorAll<HTMLElement>(
          MANAGED_RESPONSE_CONTENT_SELECTOR,
        ),
      );
      for (const element of removed) {
        if (!observed.delete(element)) continue;
        resizeObserver.unobserve(element);
      }
    };

    for (const element of content.querySelectorAll<HTMLElement>(
      MANAGED_RESPONSE_CONTENT_SELECTOR,
    )) {
      observeManagedBody(element);
    }
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) visitAddedNode(node);
        for (const node of record.removedNodes) visitRemovedNode(node);
      }
    });
    mutationObserver.observe(content, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [hostRef, scrollToBottomOnce]);

  return React.useCallback((distanceFromBottom: number) => {
    followsTailRef.current = distanceFromBottom <= FOLLOW_TAIL_THRESHOLD_PX;
    schedulerRef.current?.setEnabled(followsTailRef.current);
  }, []);
}
