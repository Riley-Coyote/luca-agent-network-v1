import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import "@/app/shell/shell-activity.css";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { useCommunities } from "@/features/communities/useCommunities";
import type { TaskSide } from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { useRuntimeRailConnections } from "@/features/runtime-sessions/RuntimeRailSection";
import { RuntimeSessionsPanelContent } from "@/features/runtime-sessions/RuntimeSessionsPanel";
import {
  runtimeSessionContextScopeKey,
  stageRuntimeSessionContext,
} from "@/features/runtime-sessions/runtimeSessionHandoff";
import { runtimeConnectionKey } from "@/features/runtime-sessions/runtimeSessionModel";
import { useIdentityQuery } from "@/shared/api/hooks";

/**
 * A connected app's card in Agents (NAVIGATION.md, "Agents"; SHELL_BUILD.md
 * WP-10, Decided 4): its sessions, ready to start from, under the head
 * "Connected · on this Mac" and its name. The list is the one the runtime
 * sessions column drew (its search, its empty states, "Start with this
 * context"), which retires under the shell: two steps, not three.
 */
export function ConnectedAppCard({ runtimeKey }: { runtimeKey: string }) {
  const { isLoading, runtimes } = useRuntimeRailConnections();
  const runtime =
    runtimes.find((each) => runtimeConnectionKey(each) === runtimeKey) ?? null;
  const { activeCommunity } = useCommunities();
  const ownerPubkey = useIdentityQuery().data?.pubkey;
  const { goBrain, goNewMessage } = useAppNavigation();
  const scope = React.useMemo(
    () =>
      activeCommunity && ownerPubkey
        ? {
            communityId: activeCommunity.id,
            ownerPubkey,
            relayUrl: activeCommunity.relayUrl,
          }
        : null,
    [activeCommunity, ownerPubkey],
  );
  const scopeKey = scope ? runtimeSessionContextScopeKey(scope) : null;

  return (
    <PlacePage testId="connected-app-card">
      <PlacePageHead
        eyebrow="Connected · on this Mac"
        title={runtime?.label ?? (isLoading ? "" : runtimeKey)}
      />
      {runtime ? (
        <RuntimeSessionsPanelContent
          contextScopeKey={scopeKey}
          key={runtimeKey}
          onOpenBrain={() => void goBrain()}
          onStartContext={(context, authority) => {
            if (
              !scope ||
              authority.scopeKey !== runtimeSessionContextScopeKey(scope) ||
              authority.runtimeKey !== runtimeConnectionKey(runtime)
            ) {
              return false;
            }
            const staged = stageRuntimeSessionContext(
              { ...scope, context },
              authority.handoffGeneration,
            );
            if (!staged) return false;
            void goNewMessage();
            return true;
          }}
          runtime={runtime}
          variant="card"
        />
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {isLoading
            ? "Checking installed runtimes…"
            : "This app is no longer connected on this Mac."}
        </p>
      )}
      {runtime ? <WhatLucaDid runtimeId={runtime.runtimeId} /> : null}
    </PlacePage>
  );
}

/**
 * What Luca did with it (SHELL_BUILD.md WP-14, Decided 7): this app's
 * runtime tasks, newest first, each opening its room, where its receipt is.
 * Shown once there is one, as a rail's sections are.
 */
function WhatLucaDid({ runtimeId }: { runtimeId: string }) {
  const { items, nameOf, roomOf } = useSideConversations();
  const { goChannel } = useAppNavigation();
  const tasks = items.filter(
    (item): item is TaskSide =>
      item.kind === "task" && item.runtimeFamily === runtimeId,
  );
  if (tasks.length === 0) return null;
  return (
    <div className="luca-connected-history">
      <PlaceList label="What Luca did with it" testId="connected-what-luca-did">
        {tasks.map((task) => {
          const room = roomOf(task.conversationId);
          const who = nameOf(task.residentPubkey);
          return (
            <PlaceListRow
              data-side-state={task.word}
              detail={
                <span
                  className="luca-side-state"
                  data-live={task.live || undefined}
                >
                  {task.word}
                </span>
              }
              key={task.id}
              note={placeNoteTime(new Date(task.at).toISOString())}
              onOpen={() => void goChannel(task.conversationId)}
              openLabel={[task.summary, who, task.word, room && `in ${room}`]
                .filter(Boolean)
                .join(", ")}
              summary={room ? `${who} · ${room}` : who}
              testId={`connected-task-${task.id}`}
              title={task.summary}
            />
          );
        })}
      </PlaceList>
    </div>
  );
}
