import * as React from "react";
import {
  useCanGoBack,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

import { takeHistoryStep } from "@/app/navigation/leaveGuard";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { isMacPlatform } from "@/shared/lib/platform";
import { trimMapToSize } from "@/shared/lib/trimMapToSize";

type RouterHistoryState = {
  __TSR_index?: number;
  __TSR_key?: string;
  key?: string;
};

export function useBackForwardControls() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const locationState = useRouterState({
    select: (state) => state.location.state,
  }) as RouterHistoryState;
  const locationIndex = locationState.__TSR_index ?? 0;
  const locationKey =
    locationState.__TSR_key ?? locationState.key ?? String(locationIndex);
  const keysByIndexRef = React.useRef(new Map<number, string>());
  const [maxIndex, setMaxIndex] = React.useState(locationIndex);
  // Under the shell a place writes its pick into the address by replacing
  // the entry you are on (WP-10, Decided 7). A new key at the same index as
  // last seen is that replace, which keeps the entries ahead: Forward still
  // goes there (WP-09b). A new key one step on is a push, which drops them.
  const shellFrame = useShellFrameEnabled();
  const lastIndexRef = React.useRef(locationIndex);

  React.useEffect(() => {
    const keysByIndex = keysByIndexRef.current;
    const currentKey = keysByIndex.get(locationIndex);
    const replaced = shellFrame && lastIndexRef.current === locationIndex;
    lastIndexRef.current = locationIndex;

    if (replaced) {
      keysByIndex.set(locationIndex, locationKey);
      return;
    }

    if (currentKey && currentKey !== locationKey) {
      for (const storedIndex of [...keysByIndex.keys()]) {
        if (storedIndex >= locationIndex) {
          keysByIndex.delete(storedIndex);
        }
      }
    }

    keysByIndex.set(locationIndex, locationKey);
    trimMapToSize(keysByIndex, 200);
    setMaxIndex((current: number) => {
      if (currentKey && currentKey !== locationKey) {
        return locationIndex;
      }

      return Math.max(current, locationIndex);
    });
  }, [locationIndex, locationKey, shellFrame]);

  const canGoForward = locationIndex < maxIndex;

  // A page with unsaved changes may hold the step and take it on its answer
  // (leaveGuard.ts); taken then, the router's own blocker has had its say.
  const goBack = React.useCallback(() => {
    if (!canGoBack) {
      return;
    }

    takeHistoryStep((options) => router.history.back(options));
  }, [canGoBack, router.history]);

  const goForward = React.useCallback(() => {
    if (!canGoForward) {
      return;
    }

    takeHistoryStep((options) => router.history.forward(options));
  }, [canGoForward, router.history]);

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    // A history key works wherever focus is, the composer included (WP-20):
    // a text field has no use for ⌘[ and ⌘]. A key the field has taken for
    // itself (it prevented the default) stays the field's.
    if (event.defaultPrevented) {
      return;
    }

    const isMac = isMacPlatform();
    const isBackShortcut = isMac
      ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "[" || event.code === "BracketLeft")
      : event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.key === "ArrowLeft";
    const isForwardShortcut = isMac
      ? event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "]" || event.code === "BracketRight")
      : event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.key === "ArrowRight";

    if (isBackShortcut) {
      event.preventDefault();
      goBack();
      return;
    }

    if (isForwardShortcut) {
      event.preventDefault();
      goForward();
    }
  });

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  };
}
