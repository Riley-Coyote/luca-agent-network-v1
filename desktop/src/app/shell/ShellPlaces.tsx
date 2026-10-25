import * as React from "react";
import {
  Activity,
  Bot,
  Brain,
  Inbox,
  Library,
  MessagesSquare,
  Settings,
  SquarePen,
} from "lucide-react";

import {
  preloadActivitySurface,
  preloadAgentsSurface,
  preloadArtifactsSurface,
  preloadBrainSurface,
  preloadSettingsSurface,
} from "@/app/navigation/preloadPrimarySurfaces";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { UNREAD_DOT_CLASS } from "@/features/sidebar/ui/ChatList";
import type { Channel, SearchHit } from "@/shared/api/types";
import { useInboxSurfaceEnabled } from "@/shared/features/useInboxSurfaceEnabled";
import { cn } from "@/shared/lib/cn";
import { isMacPlatform } from "@/shared/lib/platform";
import { useOptionalSidebar } from "@/shared/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * THE PLACES (docs/luca/rail-system/SHELL_SPEC.md, "The places column"): a
 * column 44 wide under the lip, its icons on the traffic lights' axis (22).
 * New conversation and Search; then the places; Settings and the avatar at
 * the foot. Every one is the app's existing action: this column only gives
 * them their new home. The current place wears a static plate until the
 * moving marks come (WP-03).
 */

type PlacesView =
  | "home"
  | "inbox"
  | "channel"
  | "messages"
  | "agents"
  | "brain"
  | "artifacts"
  | "workflows"
  | "pulse"
  | "projects";

type PlaceId =
  | "conversations"
  | "library"
  | "inbox"
  | "agents"
  | "activity"
  | "brain";

/** Which place a view belongs to. */
export function placeOfView(view: PlacesView): PlaceId | null {
  switch (view) {
    case "home":
    case "channel":
    case "messages":
    case "projects":
      return "conversations";
    case "artifacts":
      return "library";
    case "inbox":
      return "inbox";
    case "agents":
      return "agents";
    case "pulse":
      return "activity";
    case "brain":
      return "brain";
    default:
      return null;
  }
}

function PlaceTile({
  badge,
  children,
  current,
  dot,
  label,
  onClick,
  onPreload,
  shortcut,
  testId,
}: {
  badge?: number;
  children: React.ReactNode;
  current?: boolean;
  /** The app's unread dot, at the tile's top right. */
  dot?: boolean;
  label: string;
  onClick: () => void;
  onPreload?: () => void;
  shortcut?: string;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-current={current ? "page" : undefined}
          aria-label={dot ? `${label}, unread` : label}
          className="luca-place"
          data-current={current ? "true" : undefined}
          data-testid={testId}
          onClick={() => onClick()}
          onFocus={onPreload}
          onPointerEnter={onPreload}
          type="button"
        >
          {children}
          {dot ? (
            <span
              aria-hidden="true"
              className={cn(UNREAD_DOT_CLASS, "luca-place-dot")}
              data-testid={`${testId}-unread`}
            />
          ) : null}
          {badge && badge > 0 ? (
            <span className="luca-place-badge" data-testid={`${testId}-count`}>
              {Math.min(badge, 99)}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {shortcut ? `${label}  ${shortcut}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Search is today's search dialog; this tile is its trigger. Its tooltip
 * stands down once the tile is pressed, until the pointer leaves: left open,
 * it sat over the dialog and took the dialog's first Escape.
 */
function SearchPlace({
  search,
  shortcut,
}: {
  search: ShellPlacesProps["search"];
  shortcut: string;
}) {
  const [hinted, setHinted] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  return (
    <Tooltip onOpenChange={(open) => setHinted(open)} open={hinted && !pressed}>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: it only notices presses of the search button inside it, which is the control. */}
        <div
          className="luca-place-search"
          data-testid="shell-place-search"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setPressed(true);
          }}
          onPointerDown={() => setPressed(true)}
          onPointerLeave={() => {
            setPressed(false);
            setHinted(false);
          }}
        >
          <TopbarSearch
            channelLabels={search.channelLabels}
            channels={search.channels}
            currentPubkey={search.currentPubkey}
            focusRequest={search.focusRequest}
            onBrowseChannels={search.onBrowseChannels}
            onCreateAgent={search.onCreateAgent}
            onCreateChannel={search.onCreateChannel}
            onOpenChannel={search.onOpenChannel}
            onOpenResult={search.onOpenResult}
            onOpenUser={(user) => search.onOpenDm({ pubkeys: [user.pubkey] })}
            suggestionChannels={search.suggestionChannels}
            variant="icon"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{`Search  ${shortcut}`}</TooltipContent>
    </Tooltip>
  );
}

export type ShellPlacesProps = {
  avatar: React.ReactNode;
  /** Whether any conversation is unread: said on Conversations while the
   *  rail, which shows each one, is closed. */
  hasUnread: boolean;
  homeBadgeCount: number;
  onNewConversation: () => void;
  onSelectAgents: () => void;
  onSelectArtifacts: () => void;
  onSelectBrain: () => void;
  onSelectConversations: () => void;
  onSelectInbox: () => void;
  onSelectPulse: () => void;
  onSelectSettings: () => void;
  search: {
    channelLabels: Record<string, string>;
    channels: Channel[];
    currentPubkey?: string;
    focusRequest: number;
    onBrowseChannels?: () => void;
    onCreateAgent: () => void;
    onCreateChannel: () => void;
    onOpenChannel: (channelId: string) => void;
    onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
    onOpenResult: (hit: SearchHit) => void;
    suggestionChannels: Channel[];
  };
  selectedView: PlacesView;
};

export function ShellPlaces({
  avatar,
  hasUnread,
  homeBadgeCount,
  onNewConversation,
  onSelectAgents,
  onSelectArtifacts,
  onSelectBrain,
  onSelectConversations,
  onSelectInbox,
  onSelectPulse,
  onSelectSettings,
  search,
  selectedView,
}: ShellPlacesProps) {
  const inboxEnabled = useInboxSurfaceEnabled();
  const here = placeOfView(selectedView);
  const key = isMacPlatform() ? "⌘" : "Ctrl+";
  const sidebar = useOptionalSidebar();
  const railClosed = sidebar
    ? sidebar.isMobile
      ? !sidebar.openMobile
      : !sidebar.open
    : false;
  const unreadDot = hasUnread && railClosed;
  return (
    <nav aria-label="Places" className="luca-places" data-testid="shell-places">
      <div className="luca-places-group">
        <PlaceTile
          label="New conversation"
          onClick={onNewConversation}
          shortcut={`${key}N`}
          testId="open-new-conversation"
        >
          <SquarePen />
        </PlaceTile>
        <SearchPlace search={search} shortcut={`${key}K`} />
      </div>
      <div className="luca-places-group">
        <PlaceTile
          current={here === "conversations"}
          dot={unreadDot}
          label="Conversations"
          onClick={onSelectConversations}
          testId="shell-place-conversations"
        >
          <MessagesSquare />
        </PlaceTile>
        <PlaceTile
          current={here === "library"}
          label="Library"
          onClick={onSelectArtifacts}
          onPreload={() => void preloadArtifactsSurface()}
          testId="open-artifacts-view"
        >
          <Library />
        </PlaceTile>
        {inboxEnabled ? (
          <PlaceTile
            badge={homeBadgeCount}
            current={here === "inbox"}
            label="Inbox"
            onClick={onSelectInbox}
            testId="open-inbox-view"
          >
            <Inbox />
          </PlaceTile>
        ) : null}
        <PlaceTile
          current={here === "agents"}
          label="Agents"
          onClick={onSelectAgents}
          onPreload={() => void preloadAgentsSurface()}
          testId="open-agents-view"
        >
          <Bot />
        </PlaceTile>
        <PlaceTile
          current={here === "activity"}
          label="Activity"
          onClick={onSelectPulse}
          onPreload={() => void preloadActivitySurface()}
          testId="open-activity-view"
        >
          <Activity />
        </PlaceTile>
        <PlaceTile
          current={here === "brain"}
          label="Brain"
          onClick={onSelectBrain}
          onPreload={() => void preloadBrainSurface()}
          testId="open-brain-setup"
        >
          <Brain />
        </PlaceTile>
      </div>
      <div className="luca-places-group luca-places-end">
        <PlaceTile
          label="Settings"
          onClick={onSelectSettings}
          onPreload={() => void preloadSettingsSurface()}
          shortcut={`${key},`}
          testId="open-settings-view"
        >
          <Settings />
        </PlaceTile>
        {avatar}
      </div>
    </nav>
  );
}
