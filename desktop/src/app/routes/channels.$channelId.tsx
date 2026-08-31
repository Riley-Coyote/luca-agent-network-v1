import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type ChannelRouteSearch = {
  agentSession?: string;
  /**
   * When set, the composer on mount will auto-submit its loaded draft once,
   * then clear this param. Value is the draft key that was loaded so the
   * composer can verify it has the right draft before firing.
   */
  autoSend?: string;
  messageId?: string;
  profile?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  thread?: string;
  threadRootId?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;

  // Hash history can append the document-level search string to the final
  // hash search value after a hard reload (for example the E2E/dev bridge
  // marker). Keep route-owned IDs independent from those outer parameters.
  const documentSearch =
    typeof window === "undefined" ? "" : window.location.search;
  const normalized =
    documentSearch && value.endsWith(documentSearch)
      ? value.slice(0, -documentSearch.length)
      : value;
  return normalized.length > 0 ? normalized : undefined;
}

function validateChannelSearch(
  search: Record<string, unknown>,
): ChannelRouteSearch {
  return {
    agentSession: nonEmptyString(search.agentSession),
    autoSend: nonEmptyString(search.autoSend),
    messageId: nonEmptyString(search.messageId),
    profile: nonEmptyString(search.profile),
    profileTab: parseProfilePanelTab(search.profileTab) ?? undefined,
    profileView: parseProfilePanelView(search.profileView) ?? undefined,
    thread: nonEmptyString(search.thread),
    threadRootId: nonEmptyString(search.threadRootId),
  };
}

export const Route = createFileRoute("/channels/$channelId")({
  validateSearch: validateChannelSearch,
  component: ChannelRouteComponent,
});

const ChannelRouteScreen = React.lazy(async () => {
  const module = await import("./ChannelRouteScreen");
  return { default: module.ChannelRouteScreen };
});

function ChannelRouteComponent() {
  const { channelId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="channel" />}
    >
      <ChannelRouteScreen
        autoSendDraftKey={search.autoSend ?? null}
        channelId={channelId}
        selectedPostId={null}
        targetMessageId={search.messageId ?? null}
        targetReplyId={null}
        targetThreadRootId={search.threadRootId ?? search.thread ?? null}
      />
    </React.Suspense>
  );
}
