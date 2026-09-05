import * as React from "react";

import { observeElementBlockSize } from "@/shared/layout/observeElementBlockSize";

/**
 * Observes the height of the composer overlay and sets the scroll
 * container's `paddingBottom` to match, so content is never hidden
 * behind the absolutely-positioned composer.
 *
 * If the user is already scrolled to the bottom when padding increases,
 * auto-scrolls to keep them at the bottom (no visible gap).
 */
export function useComposerHeightPadding(
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  composerRef: React.RefObject<HTMLElement | null>,
  resetKey?: unknown,
  mode: "padding" | "css-variable" = "padding",
  trailingClearance = 0,
) {
  React.useEffect(() => {
    void resetKey;
    const scrollEl = scrollContainerRef.current;
    const composerEl = composerRef.current;

    if (!scrollEl || !composerEl) {
      return;
    }

    const getScrollElement = (): HTMLElement =>
      mode === "css-variable"
        ? (scrollEl.querySelector<HTMLElement>(
            '[data-testid="message-timeline"]',
          ) ?? scrollEl)
        : scrollEl;

    let lastPadding: number | null = null;
    let deferredPaddingDecrease: number | null = null;
    let followBottomFrame: number | null = null;
    const initialActivityShelfState = composerEl.querySelector<HTMLElement>(
      '[data-testid="conversation-activity-shelf"]',
    )?.dataset.state;
    let lastActivityShelfVisible =
      initialActivityShelfState !== undefined &&
      initialActivityShelfState !== "idle";

    const physicalBottomDistance = (): number => {
      const target = getScrollElement();
      return target.scrollHeight - target.scrollTop - target.clientHeight;
    };

    const isNearBottom = (): boolean => {
      const target = getScrollElement();
      const threshold = 32;
      const trailingClearance =
        mode === "css-variable" ? (lastPadding ?? 0) : 0;
      return (
        target.scrollHeight -
          target.scrollTop -
          target.clientHeight -
          trailingClearance <
        threshold
      );
    };

    const followBottom = () => {
      const target = getScrollElement();
      target.scrollTop = target.scrollHeight;
    };

    const commitPadding = (padding: number, wasAtBottom: boolean) => {
      const previousPadding = lastPadding;
      if (mode === "css-variable") {
        scrollEl.style.setProperty("--composer-overlay-height", `${padding}px`);
      } else {
        scrollEl.style.paddingBottom = `${padding}px`;
      }
      lastPadding = padding;

      if (
        wasAtBottom &&
        (previousPadding === null || padding > previousPadding)
      ) {
        followBottom();
        if (followBottomFrame !== null) {
          cancelAnimationFrame(followBottomFrame);
        }
        followBottomFrame = requestAnimationFrame(() => {
          followBottomFrame = null;
          followBottom();
        });
      }
    };

    const applyPadding = (height: number) => {
      const padding = Math.ceil(height + trailingClearance);
      const activityShelfState = composerEl.querySelector<HTMLElement>(
        '[data-testid="conversation-activity-shelf"]',
      )?.dataset.state;
      const activityShelfVisible =
        activityShelfState !== undefined && activityShelfState !== "idle";
      const activityShelfJustClosed =
        lastActivityShelfVisible && !activityShelfVisible;
      lastActivityShelfVisible = activityShelfVisible;
      if (lastPadding !== null && Math.abs(padding - lastPadding) <= 1) {
        deferredPaddingDecrease = null;
        return;
      }

      const wasAtBottom = isNearBottom();
      // Removing a composer-owned row while the transcript is physically at
      // the bottom lowers scrollHeight and forces the browser to clamp
      // scrollTop. That makes the answer jump by exactly the removed row's
      // height. Hold that trailing space until the owner scrolls away, where
      // releasing it cannot move any visible content.
      if (
        lastPadding !== null &&
        padding < lastPadding &&
        activityShelfJustClosed &&
        physicalBottomDistance() < 1
      ) {
        deferredPaddingDecrease = padding;
        return;
      }

      deferredPaddingDecrease = null;
      commitPadding(padding, wasAtBottom);
    };

    const releaseDeferredPadding = () => {
      if (deferredPaddingDecrease === null || physicalBottomDistance() <= 32) {
        return;
      }
      const padding = deferredPaddingDecrease;
      deferredPaddingDecrease = null;
      commitPadding(padding, false);
    };

    const disconnect = observeElementBlockSize(composerEl, applyPadding);
    const observedScrollElement = getScrollElement();
    observedScrollElement.addEventListener("scroll", releaseDeferredPadding, {
      passive: true,
    });

    return () => {
      disconnect();
      observedScrollElement.removeEventListener(
        "scroll",
        releaseDeferredPadding,
      );
      if (followBottomFrame !== null) {
        cancelAnimationFrame(followBottomFrame);
      }
      if (mode === "css-variable") {
        scrollEl.style.removeProperty("--composer-overlay-height");
      } else {
        scrollEl.style.paddingBottom = "";
      }
    };
  }, [scrollContainerRef, composerRef, mode, resetKey, trailingClearance]);
}
