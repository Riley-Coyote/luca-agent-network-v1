import * as React from "react";

import { getCachedSearchHitEvent } from "@/app/navigation/searchHitEventCache";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { isPopoutWindow } from "@/app/popout/popoutMode";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  rememberLastProjectRoom,
  useRoomProjectCatalog,
  useRoomProjects,
} from "@/features/channels/lib/roomProjects";
import { ChannelScreen } from "@/features/channels/ui/ChannelScreen";
import { LocalChannelPanelStateProvider } from "@/features/channels/ui/useChannelPanelHistoryState";
import {
  ConversationWorkspaceFrame,
  setWorkspacePreset,
  useConversationWorkspace,
  workspaceSlot,
  type WorkspaceConversationRef,
  type WorkspaceSlotId,
} from "@/features/conversation-workspace";
import {
  getThreadReference,
  isBroadcastReply,
} from "@/features/messages/lib/threading";
import { useProfileQuery } from "@/features/profile/hooks";
import { buildProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import { ProjectRoomWorkspace } from "@/features/projects/ui/ProjectRoomWorkspace";
import { useSelectedAgentPubkey } from "@/features/sidebar/lib/agentColumn";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getEventById } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type ChannelRouteScreenProps = {
  autoSendDraftKey: string | null;
  channelId: string;
  selectedPostId: string | null;
  targetMessageId: string | null;
  targetReplyId: string | null;
  targetThreadRootId: string | null;
};

type ChannelConversationSurfaceProps = ChannelRouteScreenProps & {
  focused: boolean;
  onSelectProjectRoom?: (channelId: string, projectId: string) => void;
  projectNavigatorVisible: boolean;
  shellWidthPx?: number;
};

const MAX_ROUTE_ANCESTOR_HOPS = 50;

async function fetchRouteEvent(eventId: string): Promise<RelayEvent | null> {
  try {
    return await getEventById(eventId);
  } catch (error) {
    console.error("Failed to load route event", eventId, error);
    return null;
  }
}

function getReplyParentId(event: RelayEvent): string | null {
  if (isBroadcastReply(event.tags)) {
    return null;
  }

  return getThreadReference(event.tags).parentId;
}

async function fetchRouteTargetEvents(
  eventIds: string[],
  targetMessageId: string | null,
  targetThreadRootId: string | null,
): Promise<RelayEvent[]> {
  const eventsById = new Map<string, RelayEvent>();
  const addEvent = (event: RelayEvent | null) => {
    if (event) {
      eventsById.set(event.id, event);
    }
  };

  const uniqueEventIds = [...new Set(eventIds)];
  const initialEvents = await Promise.all(uniqueEventIds.map(fetchRouteEvent));
  for (const event of initialEvents) {
    addEvent(event);
  }

  const targetEvent = targetMessageId
    ? (eventsById.get(targetMessageId) ?? null)
    : null;
  if (!targetEvent) {
    return [...eventsById.values()];
  }

  const targetThreadRef = getThreadReference(targetEvent.tags);
  const threadRootId = targetThreadRootId ?? targetThreadRef.rootId ?? null;
  if (threadRootId && !eventsById.has(threadRootId)) {
    addEvent(await fetchRouteEvent(threadRootId));
  }

  let parentId = getReplyParentId(targetEvent);
  let guard = 0;
  while (
    parentId &&
    parentId !== threadRootId &&
    guard < MAX_ROUTE_ANCESTOR_HOPS
  ) {
    const parentEvent =
      eventsById.get(parentId) ?? (await fetchRouteEvent(parentId));
    if (!parentEvent) {
      break;
    }

    eventsById.set(parentEvent.id, parentEvent);
    parentId = getReplyParentId(parentEvent);
    guard += 1;
  }

  return [...eventsById.values()];
}

function ChannelConversationSurface({
  autoSendDraftKey,
  channelId,
  focused,
  onSelectProjectRoom,
  projectNavigatorVisible,
  selectedPostId,
  shellWidthPx,
  targetMessageId,
  targetReplyId,
  targetThreadRootId,
}: ChannelConversationSurfaceProps) {
  const { closeForumPost, goChannel, goForumPost } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const communities = useCommunities();
  const profileQuery = useProfileQuery();
  // While the rail's agent column is open the project navigator steps aside
  // (ProjectRoomWorkspace owns that rule); the conversation should lay itself
  // out for the room it actually has.
  const agentColumnOpen = useSelectedAgentPubkey() !== null;
  const channels = channelsQuery.data ?? [];
  const activeChannel =
    channels.find((channel) => channel.id === channelId) ?? null;
  const projectByChannelId = useRoomProjects(
    channels,
    identityQuery.data?.pubkey,
    communities.activeCommunity?.relayUrl,
  );
  const projectCatalog = useRoomProjectCatalog(
    channels,
    identityQuery.data?.pubkey,
    communities.activeCommunity?.relayUrl,
  );
  const activeProject = activeChannel
    ? (projectByChannelId.get(activeChannel.id) ?? null)
    : null;
  const projectViewModel = React.useMemo(() => {
    if (!activeProject) return null;
    const canonicalProject =
      projectCatalog.find((project) => project.id === activeProject.id) ??
      activeProject;
    return buildProjectNavigatorViewModel({
      channels,
      project: canonicalProject,
      projectByChannelId,
      selectedRoomId: activeChannel?.id,
    });
  }, [
    activeChannel?.id,
    activeProject,
    channels,
    projectByChannelId,
    projectCatalog,
  ]);
  const [targetMessageEvents, setTargetMessageEvents] = React.useState<
    RelayEvent[]
  >(() => {
    const cachedTarget = getCachedSearchHitEvent(targetMessageId);
    return cachedTarget ? [cachedTarget] : [];
  });

  // Reset spliced target events when the channel context changes (channel
  // switch or entering/leaving a forum post). Tied to channel identity rather
  // than the route target so clearing the `messageId` param mid-channel keeps
  // the deep-linked row in view. Seeded with the mount key so the initial
  // cache-seeded events survive first commit; only a genuine channel change
  // clears them. Declared before the fetch effect so a channel switch clears
  // stale events before the new target is fetched.
  const previousResetKeyRef = React.useRef<string>(
    `${channelId}::${selectedPostId ?? ""}`,
  );
  React.useEffect(() => {
    const resetKey = `${channelId}::${selectedPostId ?? ""}`;
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    setTargetMessageEvents([]);
  }, [channelId, selectedPostId]);

  React.useEffect(() => {
    let isCancelled = false;

    // Don't wipe already-spliced target events just because the route target
    // cleared (e.g. `onTargetReached` clears the `messageId` URL param once the
    // row is centered). In a channel whose feed doesn't already contain the
    // deep-linked message, the spliced event is the only copy — dropping it on
    // param-clear blanks the timeline. Resetting on channel / forum-post change
    // is handled by the effect below; here we only fetch when there's a target.
    if ((!targetMessageId && !targetThreadRootId) || selectedPostId) {
      return () => {
        isCancelled = true;
      };
    }

    const cachedTarget = getCachedSearchHitEvent(targetMessageId);
    if (cachedTarget) {
      setTargetMessageEvents((currentEvents) =>
        currentEvents.some((event) => event.id === cachedTarget.id)
          ? currentEvents
          : [...currentEvents, cachedTarget],
      );
    }

    const eventIds = [
      targetMessageId,
      targetThreadRootId && targetThreadRootId !== targetMessageId
        ? targetThreadRootId
        : null,
    ].filter((eventId): eventId is string => eventId !== null);

    void fetchRouteTargetEvents(
      eventIds,
      targetMessageId,
      targetThreadRootId,
    ).then((events) => {
      if (!isCancelled) {
        setTargetMessageEvents((currentEvents) => {
          const eventsById = new Map<string, RelayEvent>();
          for (const event of [...currentEvents, ...events]) {
            eventsById.set(event.id, event);
          }
          return Array.from(eventsById.values());
        });
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedPostId, targetMessageId, targetThreadRootId]);

  React.useEffect(() => {
    if (focused && activeProject && activeChannel) {
      rememberLastProjectRoom(activeProject.id, activeChannel.id);
    }
  }, [activeChannel, activeProject, focused]);

  if (channelsQuery.isPending && !activeChannel) {
    return (
      <ViewLoadingFallback
        includeHeader
        kind={selectedPostId ? "forum" : "channel"}
      />
    );
  }

  const conversation = (
    <ChannelScreen
      activeChannel={activeChannel}
      autoSendDraftKey={autoSendDraftKey}
      currentIdentity={identityQuery.data}
      currentProfile={profileQuery.data}
      projectContext={
        projectViewModel
          ? {
              projectId: projectViewModel.projectId,
              label: projectViewModel.label,
              sourceIds: projectViewModel.sourceIds,
            }
          : null
      }
      projectNavigatorVisible={projectNavigatorVisible && !agentColumnOpen}
      projectRoomNavigation={
        projectViewModel
          ? {
              onSelectRoom: (nextChannelId) => {
                if (onSelectProjectRoom) {
                  onSelectProjectRoom(
                    nextChannelId,
                    projectViewModel.projectId,
                  );
                } else {
                  void goChannel(nextChannelId);
                }
              },
              viewModel: projectViewModel,
            }
          : null
      }
      shellWidthPx={shellWidthPx}
      onCloseForumPost={() => {
        void closeForumPost(channelId);
      }}
      onSelectForumPost={(postId) => {
        void goForumPost(channelId, postId);
      }}
      selectedForumPostId={selectedPostId}
      targetForumReplyId={targetReplyId}
      targetMessageEvents={targetMessageEvents}
      targetMessageId={targetMessageId}
    />
  );

  // A pop-out is one conversation and nothing else. The project workspace is a
  // navigator between the rooms of a project — a second place to go — and this
  // window has no second place to go.
  if (!projectViewModel || isPopoutWindow() || !projectNavigatorVisible) {
    return conversation;
  }

  return (
    <ProjectRoomWorkspace
      onSelectRoom={(nextChannelId) => {
        if (onSelectProjectRoom) {
          onSelectProjectRoom(nextChannelId, projectViewModel.projectId);
        } else {
          void goChannel(nextChannelId);
        }
      }}
      viewModel={projectViewModel}
    >
      {conversation}
    </ProjectRoomWorkspace>
  );
}

export function ChannelRouteScreen(props: ChannelRouteScreenProps) {
  const { goChannel } = useAppNavigation();
  const workspace = useConversationWorkspace();

  if (!workspace || isPopoutWindow()) {
    return (
      <ChannelConversationSurface
        {...props}
        focused
        projectNavigatorVisible={!isPopoutWindow()}
      />
    );
  }

  const activateConversation = (
    slotId: WorkspaceSlotId,
    conversation: WorkspaceConversationRef,
  ) => {
    workspace.dispatch({ type: "select-tab", conversation, slotId });
    if (conversation.channelId !== props.channelId) {
      void goChannel(conversation.channelId);
    }
  };

  return (
    <ConversationWorkspaceFrame
      onActivateConversation={activateConversation}
      onPresetChange={(preset) => {
        const nextLayout = setWorkspacePreset(workspace.layout, preset);
        workspace.dispatch({ type: "set-preset", preset });
        const nextConversation = workspaceSlot(
          nextLayout,
          nextLayout.focusedSlotId,
        ).activeTab;
        if (
          nextConversation &&
          nextConversation.channelId !== props.channelId
        ) {
          void goChannel(nextConversation.channelId);
        }
      }}
      renderConversation={(conversation, focused, slotId, shellWidthPx) => {
        const usesRouteState =
          focused && conversation.channelId === props.channelId;
        const surface = (
          <ChannelConversationSurface
            autoSendDraftKey={usesRouteState ? props.autoSendDraftKey : null}
            channelId={conversation.channelId}
            focused={focused}
            onSelectProjectRoom={(nextChannelId, projectId) => {
              const nextConversation = {
                channelId: nextChannelId,
                projectId,
              };
              workspace.dispatch({
                type: "replace-active-tab",
                conversation: nextConversation,
                slotId,
              });
              void goChannel(nextChannelId);
            }}
            projectNavigatorVisible={
              focused && workspace.layout.preset === "single"
            }
            selectedPostId={usesRouteState ? props.selectedPostId : null}
            shellWidthPx={shellWidthPx}
            targetMessageId={usesRouteState ? props.targetMessageId : null}
            targetReplyId={usesRouteState ? props.targetReplyId : null}
            targetThreadRootId={
              usesRouteState ? props.targetThreadRootId : null
            }
          />
        );

        return (
          <LocalChannelPanelStateProvider
            focused={focused}
            resetKey={conversation.channelId}
          >
            {surface}
          </LocalChannelPanelStateProvider>
        );
      }}
    />
  );
}
