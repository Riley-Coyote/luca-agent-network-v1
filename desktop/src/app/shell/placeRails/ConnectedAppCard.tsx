import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useCompanionHome } from "@/features/dashboard/useCompanionHome";

const HarnessWorkspace = React.lazy(() =>
  import("@/features/harness-dashboard/HarnessWorkspace").then((module) => ({
    default: module.HarnessWorkspace,
  })),
);

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import "@/app/shell/shell-activity.css";
import "@/app/shell/shell-mind-space.css";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { useCommunities } from "@/features/communities/useCommunities";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import type { TaskSide } from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { useNewAppConversation } from "@/features/sidebar/lib/appConversation";
import { useRuntimeRailConnections } from "@/features/runtime-sessions/RuntimeRailSection";
import { RuntimeSessionsPanelContent } from "@/features/runtime-sessions/RuntimeSessionsPanel";
import {
  runtimeSessionContextScopeKey,
  stageRuntimeSessionContext,
} from "@/features/runtime-sessions/runtimeSessionHandoff";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import { runtimeConnectionKey } from "@/features/runtime-sessions/runtimeSessionModel";
import { useIdentityQuery } from "@/shared/api/hooks";

/**
 * A connected app's page, from the address's family ("claude", "codex"):
 * its row under Apps in the Chats rail opens it in the Chats card
 * (BETA14_RELEASE.md WP-34, Decided 1 and 9; it was Connected's card in
 * Agents).
 */
export function AppPage({
  family,
  initialTaskId,
  initialSessionId,
}: {
  family: string;
  initialTaskId?: string;
  initialSessionId?: string;
}) {
  const frame = useShellFrameEnabled();
  if (frame && (family === "claude" || family === "codex")) {
    return (
      <HarnessAppPage
        runtimeFamily={family === "claude" ? "claude_code" : "codex"}
        initialTaskId={initialTaskId}
        initialSessionId={initialSessionId}
      />
    );
  }
  return <LegacyAppPage family={family} />;
}

function HarnessAppPage({
  runtimeFamily,
  initialTaskId,
  initialSessionId,
}: {
  runtimeFamily: "claude_code" | "codex";
  initialTaskId?: string;
  initialSessionId?: string;
}) {
  const companion = useCompanionHome();
  const navigate = useNavigate();
  return (
    <React.Suspense
      fallback={
        <p className="p-6 text-sm text-muted-foreground" role="status">
          Loading workspace…
        </p>
      }
    >
      <HarnessWorkspace
        runtimeFamily={runtimeFamily}
        conversationId={companion.channel?.id ?? null}
        residentPubkey={companion.residentPubkey}
        ownerScope={companion.scope}
        initialTaskId={initialTaskId}
        initialSessionId={initialSessionId}
        onAskLuca={(context) =>
          void navigate({
            to: "/dashboard",
            search: {
              scope: companion.contextScope,
              task: context.taskId,
              session: context.sessionId,
              title: context.title,
              runtime: context.runtimeFamily,
            },
          })
        }
      />
    </React.Suspense>
  );
}

function LegacyAppPage({ family }: { family: string }) {
  const { runtimes } = useRuntimeRailConnections();
  const runtime = runtimes.find(
    (each) => runtimeRailFamilyFromRuntimeId(each.runtimeId) === family,
  );
  return (
    <ConnectedAppCard
      runtimeKey={runtime ? runtimeConnectionKey(runtime) : family}
    />
  );
}

/**
 * A connected app's card (NAVIGATION.md, "Agents"; SHELL_BUILD.md WP-10,
 * Decided 4; in the Chats card since WP-34): its sessions, ready to start
 * from, under its head: its name, the state line under it ("Connected · on
 * this Mac" only while it is), and New conversation at the end, the rail's
 * `+` for this app (WP-37, Decided 3). The list is
 * the one the runtime sessions column drew (its search, its empty states,
 * "Start with this context"), which retires under the shell: two steps, not
 * three.
 */
export function ConnectedAppCard({ runtimeKey }: { runtimeKey: string }) {
  const { isLoading, runtimes } = useRuntimeRailConnections();
  const runtime =
    runtimes.find((each) => runtimeConnectionKey(each) === runtimeKey) ?? null;
  const { activeCommunity } = useCommunities();
  const ownerPubkey = useIdentityQuery().data?.pubkey;
  const { goBrain, goNewMessage } = useAppNavigation();
  // The head's one action is the rail's own `+` on this app's home.
  const newAppConversation = useNewAppConversation();
  const family = runtime
    ? runtimeRailFamilyFromRuntimeId(runtime.runtimeId)
    : null;
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
        action={
          runtime && family ? (
            <button
              className="luca-mind-talk"
              data-testid="connected-app-new-conversation"
              onClick={() => void newAppConversation(family)}
              type="button"
            >
              New conversation
            </button>
          ) : undefined
        }
        face={runtime ? <HarnessFace runtimeId={runtime.runtimeId} /> : null}
        state={
          runtime
            ? "Connected · on this Mac"
            : isLoading
              ? undefined
              : "Not connected on this Mac"
        }
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
 * runtime tasks, newest first, each opening its own page (WP-35).
 * Shown once there is one, as a rail's sections are.
 */
function WhatLucaDid({ runtimeId }: { runtimeId: string }) {
  const { items, roomOf } = useSideConversations();
  const { goAppTask, goChannel } = useAppNavigation();
  // Luca's runs only (review fix 11): what another mind did with the app is
  // in its own space.
  const luca = useCanonicalLucaPubkey();
  const tasks = items.filter(
    (item): item is TaskSide =>
      item.kind === "task" &&
      item.runtimeFamily === runtimeId &&
      Boolean(luca) &&
      item.residentPubkey === luca,
  );
  if (tasks.length === 0) return null;
  return (
    <div className="luca-connected-history">
      <PlaceList
        count={tasks.length}
        label="What Luca did with it"
        testId="connected-what-luca-did"
      >
        {tasks.map((task) => {
          const room = roomOf(task.conversationId);
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
              onOpen={() => {
                // A task opens as the work, under its app (WP-35).
                const family = runtimeRailFamilyFromRuntimeId(
                  task.runtimeFamily,
                );
                if (family) void goAppTask(family, task.id);
                else void goChannel(task.conversationId);
              }}
              openLabel={[task.summary, task.word, room && `in ${room}`]
                .filter(Boolean)
                .join(", ")}
              summary={room || undefined}
              testId={`connected-task-${task.id}`}
              title={task.summary}
            />
          );
        })}
      </PlaceList>
    </div>
  );
}
