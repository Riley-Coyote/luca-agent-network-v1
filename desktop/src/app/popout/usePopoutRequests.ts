import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

import {
  POPOUT_OPEN_IN_MAIN_EVENT,
  POPOUT_READ_EVENT,
  type PopoutOpenInMainRequest,
  type PopoutReadRequest,
  isPopoutWindow,
} from "@/app/popout/popoutMode";

type MarkChannelRead = (
  channelId: string,
  readAt: string | null | undefined,
  options?: { topLevelOnly?: boolean },
) => void;

function isReadRequest(payload: unknown): payload is PopoutReadRequest {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<PopoutReadRequest>;
  return (
    typeof candidate.channelId === "string" &&
    candidate.channelId.length > 0 &&
    (candidate.readAt === null || typeof candidate.readAt === "string")
  );
}

function isOpenInMainRequest(
  payload: unknown,
): payload is PopoutOpenInMainRequest {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<PopoutOpenInMainRequest>;
  return (
    typeof candidate.channelId === "string" && candidate.channelId.length > 0
  );
}

/**
 * Serve the requests pop-out chat windows send to the main window.
 *
 * Two things a pop-out cannot do for itself:
 *
 *  - **Mark a conversation read.** Read markers are NIP-RS events and exactly
 *    one window may publish them, or two clients race for the same slot. The
 *    pop-out asks; the main window's ReadStateManager does it.
 *  - **Come back to the full app.** The pop-out names the conversation; this
 *    window navigates and raises itself, because focus belongs to the window
 *    taking it.
 *
 * Main-window only, and a no-op outside Tauri.
 */
export function usePopoutRequests(args: {
  goChannel: (channelId: string) => void;
  markChannelRead: MarkChannelRead;
}) {
  const handleRead = React.useEffectEvent((payload: unknown) => {
    if (!isReadRequest(payload)) {
      return;
    }
    args.markChannelRead(payload.channelId, payload.readAt, {
      topLevelOnly: payload.topLevelOnly === true,
    });
  });

  const handleOpenInMain = React.useEffectEvent((payload: unknown) => {
    if (!isOpenInMainRequest(payload)) {
      return;
    }
    args.goChannel(payload.channelId);
    const window = getCurrentWindow();
    void window.unminimize().catch(() => {});
    void window.show().catch(() => {});
    void window.setFocus().catch(() => {});
  });

  React.useEffect(() => {
    if (!isTauri() || isPopoutWindow()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (unlisten: () => void) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    void listen(POPOUT_READ_EVENT, (event) => handleRead(event.payload))
      .then(track)
      .catch((error) => {
        console.warn("pop-out read listener unavailable", error);
      });
    void listen(POPOUT_OPEN_IN_MAIN_EVENT, (event) =>
      handleOpenInMain(event.payload),
    )
      .then(track)
      .catch((error) => {
        console.warn("pop-out navigation listener unavailable", error);
      });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);
}
