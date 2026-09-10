import { isTauri } from "@tauri-apps/api/core";
import { emit, emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";

import { AppShellProvider } from "@/app/AppShellContext";
import {
  POPOUT_READ_EVENT,
  popoutRenderReadyEvent,
} from "@/app/popout/popoutMode";
import { usePopoutReadState } from "@/app/popout/usePopoutReadState";
import { router } from "@/app/router";
import { KnownAgentPubkeysProvider } from "@/features/agents/useKnownAgentPubkeys";
import { useChannelsQuery } from "@/features/channels/hooks";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { HuddleProvider } from "@/features/huddle";
import { useIdentityQuery } from "@/shared/api/hooks";
import { createBuzzQueryClient } from "@/shared/api/queryClient";
import type { Channel } from "@/shared/api/types";
import { ChannelNavigationProvider } from "@/shared/context/ChannelNavigationContext";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";

/** A pop-out is one window with one lifetime; its cache is its own. */
const queryClient = createBuzzQueryClient();

const NO_CHANNELS: Channel[] = [];

/**
 * Tell the native side the window has something to show.
 *
 * `open_channel_popout` builds the window hidden and waits for this event
 * before revealing it, so the owner never sees an unpainted frame. Emitted
 * from a layout effect — after React has committed, before paint.
 */
function usePopoutRenderReady() {
  React.useLayoutEffect(() => {
    if (!isTauri()) {
      return;
    }
    try {
      void emit(popoutRenderReadyEvent(getCurrentWindow().label));
    } catch (error) {
      // The reveal has its own timeout; a missed handshake costs a beat, not
      // the window.
      console.warn("pop-out render-ready signal unavailable", error);
    }
  }, []);
}

/**
 * The conversation list, published to the same context the main window uses.
 *
 * A pop-out queries channels itself — it is a separate webview with a separate
 * cache — but it never mounts `useUnreadChannels`: that hook owns the read
 * markers and the notification fan-out, both of which belong to exactly one
 * window.
 */
function PopoutChannelNavigation({ children }: { children: React.ReactNode }) {
  const channelsQuery = useChannelsQuery();
  return (
    <ChannelNavigationProvider channels={channelsQuery.data ?? NO_CHANNELS}>
      {children}
    </ChannelNavigationProvider>
  );
}

/**
 * The slice of AppShell's context a popped-out conversation actually uses.
 *
 * Everything that opens a dialog, browses channels or manages membership stays
 * inert here: those surfaces live in the main window, and a 380px chat window
 * is not where they belong. What IS wired is reading — projected read-only
 * from the shared mirror, and marked by asking the main window to publish.
 */
function PopoutAppShellContext({ children }: { children: React.ReactNode }) {
  const identityQuery = useIdentityQuery();
  const readState = usePopoutReadState(identityQuery.data?.pubkey);

  const markChannelRead = React.useCallback(
    (
      channelId: string,
      readAt: string | null | undefined,
      options?: { topLevelOnly?: boolean },
    ) => {
      if (!isTauri()) {
        return;
      }
      void emitTo("main", POPOUT_READ_EVENT, {
        channelId,
        readAt: readAt ?? null,
        topLevelOnly: options?.topLevelOnly === true,
      }).catch((error) => {
        console.warn("pop-out read delegation unavailable", error);
      });
    },
    [],
  );

  const value = React.useMemo(
    () => ({
      markAllChannelsRead: () => {},
      markChannelRead,
      markChannelUnread: () => {},
      openBrowseChannels: () => {},
      openCreateChannel: () => {},
      openChannelManagement: () => {},
      getChannelReadAt: readState.getChannelReadAt,
      getThreadReadAt: readState.getThreadReadAt,
      markThreadRead: (rootId: string, timestamp: number) => {
        markChannelRead(
          `thread:${rootId}`,
          new Date(timestamp * 1_000).toISOString(),
        );
      },
      getMessageReadAt: readState.getMessageReadAt,
      markMessageRead: () => {},
      readStateVersion: readState.readStateVersion,
      setContextParentResolver: readState.setContextParentResolver,
      followThread: () => {},
      unfollowThread: () => {},
      isFollowingThread: () => false,
      isNotifiedForThread: () => false,
      isThreadMuted: () => false,
      threadActivityItems: [],
      threadActivityFeedItems: [],
      feedItemState: {
        doneSet: new Set<string>(),
        markDone: () => {},
        markUnread: () => {},
        undoDone: () => {},
        undoUnread: () => {},
        unreadSet: new Set<string>(),
      },
      onOpenSettings: null,
    }),
    [markChannelRead, readState],
  );

  return <AppShellProvider value={value}>{children}</AppShellProvider>;
}

/**
 * The pop-out chat window's root.
 *
 * Deliberately NOT `App.tsx`: none of the main window's gates apply here.
 * There is no onboarding to run, no workspace to re-apply (the native side
 * already holds the active one), no updater and no notifier — the main window
 * remains the single notifier by construction. What is left is a theme, a
 * conversation, and a window to put it in.
 */
export function PopoutApp() {
  usePopoutRenderReady();

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <QueryClientProvider client={queryClient}>
          <CommunitiesProvider>
            <KnownAgentPubkeysProvider>
              <HuddleProvider>
                <PopoutChannelNavigation>
                  <EmojiBurstProvider>
                    <PoofBurstProvider>
                      <PopoutAppShellContext>
                        <RouterProvider router={router} />
                      </PopoutAppShellContext>
                      <Toaster />
                    </PoofBurstProvider>
                  </EmojiBurstProvider>
                </PopoutChannelNavigation>
              </HuddleProvider>
            </KnownAgentPubkeysProvider>
          </CommunitiesProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
