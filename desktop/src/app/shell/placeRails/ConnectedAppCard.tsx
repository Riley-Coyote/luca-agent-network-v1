import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { PlacePage } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { useCommunities } from "@/features/communities/useCommunities";
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
    </PlacePage>
  );
}
