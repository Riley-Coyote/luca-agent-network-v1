import * as React from "react";
import {
  Activity,
  Bot,
  Brain,
  House,
  Library,
  MessagesSquare,
  NotebookText,
  Settings,
} from "lucide-react";

import {
  preloadActivitySurface,
  preloadAgentsSurface,
  preloadArtifactsSurface,
  preloadBrainSurface,
  preloadMnemosSurface,
  preloadSettingsSurface,
} from "@/app/navigation/preloadPrimarySurfaces";
import { needsYouNote } from "@/app/shell/placeRails/needsYou";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
import "@/app/shell/shell-activity.css";
import { ShellPlacesMarks } from "@/app/shell/ShellMarks";
import { useShellStatus } from "@/app/shell/useShellStatus";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { UNREAD_DOT_CLASS } from "@/features/sidebar/ui/ChatList";
import { ShellRailSignalsContext } from "@/features/sidebar/ui/SidebarProfileCard";
import type { Channel, SearchHit } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { shellShortcuts } from "@/app/shell/shellFrame";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useOptionalSidebar } from "@/shared/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * THE PLACES (docs/luca/rail-system/SHELL_SPEC.md, "The places column", as
 * amended by NAVIGATION.md): a column 44 wide under the lip, its icons on the
 * traffic lights' axis (22). Search (⌘K); then Chats, Agents, Activity,
 * Library and Brain, the whole account's (BETA14_RELEASE.md WP-38); Settings
 * (⌘,) and the avatar at the foot. Every one is the app's existing action:
 * this column only gives them their home. New conversation is ⌘N (the Chats
 * rail's `+` opens Luca's one chat, WP-34), and the Inbox becomes Needs you,
 * at the top of Chats (WP-34). The current place is marked by the
 * places' mark (ShellMarks.tsx), which slides between them.
 */

type PlacesView =
  | "home"
  | "dashboard"
  | "inbox"
  | "channel"
  | "correspondence"
  | "messages"
  | "agents"
  | "brain"
  | "mnemos"
  | "artifacts"
  | "workflows"
  | "pulse"
  | "projects"
  | "needs-you"
  | "app"
  | "settings";

type PlaceId =
  | "home"
  | "conversations"
  | "agents"
  | "activity"
  | "library"
  | "brain"
  | "mnemos"
  | "settings";

/** Which place a view belongs to (SHELL_BUILD.md WP-10, Decided 2): Chats
 *  holds conversations, New conversation, projects and workflows; Brain is
 *  its own place again (WP-38). The Inbox has left the column and belongs to
 *  no place. */
export function placeOfView(view: PlacesView): PlaceId | null {
  switch (view) {
    case "dashboard":
      return "home";
    case "home":
    case "channel":
    case "correspondence":
    case "messages":
    case "projects":
    case "workflows":
    case "needs-you":
    case "app":
      return "conversations";
    case "artifacts":
      return "library";
    case "agents":
      return "agents";
    case "brain":
      return "brain";
    case "mnemos":
      return "mnemos";
    case "pulse":
      return "activity";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

function PlaceTile({
  badge,
  badgeLabel,
  children,
  current,
  dot,
  label,
  onClick,
  onPreload,
  shortcut,
  testId,
  update,
}: {
  badge?: number;
  /** How the count reads ("99+" past 99); the number itself by default. */
  badgeLabel?: string;
  children: React.ReactNode;
  current?: boolean;
  /** The app's unread dot, at the tile's top right. */
  dot?: boolean;
  label: string;
  onClick: () => void;
  onPreload?: () => void;
  shortcut?: string;
  testId: string;
  /** An available update: the app's accent dot, where the unread dot sits. */
  update?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-current={current ? "page" : undefined}
          aria-label={
            update
              ? `${label}, update available`
              : dot
                ? `${label}, unread`
                : badge && badge > 0
                  ? `${label}, ${badgeLabel ?? badge} waiting on you`
                  : label
          }
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
          {update ? (
            <span
              aria-hidden="true"
              className="motion-enter-signal luca-place-update-dot"
              data-testid={`${testId}-update`}
            />
          ) : null}
          {badge && badge > 0 ? (
            <span
              aria-hidden="true"
              className="luca-place-badge text-2xs"
              data-testid={`${testId}-count`}
              data-wide={
                String(badgeLabel ?? Math.min(badge, 99)).length > 1
                  ? ""
                  : undefined
              }
            >
              {badgeLabel ?? Math.min(badge, 99)}
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
 *
 * The dialog is portalled, but React still bubbles its events through this
 * tile, so the dialog's input taking focus (however it opened: a press, ⌘K)
 * and the pointer crossing the dialog read to the tooltip as the tile's own.
 * Only the tile's own focus and hover may show it.
 */
const ignoreOutsideTile = (event: React.SyntheticEvent<HTMLElement>) => {
  if (!event.currentTarget.contains(event.target as Node)) {
    // Radix skips its own handler once an earlier one has prevented.
    event.preventDefault();
  }
};

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
      <TooltipTrigger
        asChild
        onFocus={ignoreOutsideTile}
        onPointerMove={ignoreOutsideTile}
      >
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
  /** Whether any conversation is unread: said on Chats while the rail,
   *  which shows each one, is closed. */
  hasUnread: boolean;
  onSelectAgents: () => void;
  onSelectArtifacts: () => void;
  onSelectBrain: () => void;
  onSelectConversations: () => void;
  onSelectDashboard?: () => void;
  /** Mnemos, the notebook of a mind, its own place (WP-45). */
  onSelectMnemos?: () => void;
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
  onSelectAgents,
  onSelectArtifacts,
  onSelectBrain,
  onSelectConversations,
  onSelectDashboard,
  onSelectMnemos,
  onSelectPulse,
  onSelectSettings,
  search,
  selectedView,
}: ShellPlacesProps) {
  const here = placeOfView(selectedView);
  const { key } = shellShortcuts();
  const sidebar = useOptionalSidebar();
  const railClosed = sidebar
    ? sidebar.isMobile
      ? !sidebar.openMobile
      : !sidebar.open
    : false;
  // Settings puts its section list in the rail's card, so there the rail,
  // and every unread row on it, is never on screen: the dot always speaks.
  // The same holds for the status cards at the rail's foot (the avatar's dot).
  const railSignalsSpeak = railClosed || here === "settings";
  // Unread conversations are rows of Chats' own rail: wherever the rail on
  // screen is another place's (Agents, Activity, Library, Brain, Settings),
  // or closed, Chats' dot says them (WP-10).
  const unreadDot = hasUnread && (railClosed || here !== "conversations");
  // The rail's card says an available update with its footer card; while
  // that card is out of sight, Settings says it with a dot (Decided 4).
  const status = useShellStatus();
  const { frameDrawn } = useTheme();
  const updateDot = status.updateAvailable && railSignalsSpeak;
  // What waits on you, counted on Chats, whose rail it tops (WP-34,
  // Decided 2; on Activity before). At zero nothing shows; while it shows,
  // it says the place wants you, so the unread dot it would cover stands
  // down.
  const needsYou = useNeedsYou();
  return (
    <nav
      aria-label="Places"
      className="luca-places"
      data-connection-problem={status.connectionProblem ? "" : undefined}
      data-testid="shell-places"
      data-update-available={status.updateAvailable ? "" : undefined}
    >
      {/* On the Black frame the mark is a plate; on a glass frame, a piece
          of the card standing on the glass (SHELL_SPEC.md, "Where you
          are"). */}
      <ShellPlacesMarks
        current={here}
        material={frameDrawn === "solid" ? "plate" : "card"}
      />
      <div className="luca-places-group">
        <SearchPlace search={search} shortcut={`${key}K`} />
      </div>
      <div className="luca-places-group">
        {onSelectDashboard ? (
          <PlaceTile
            current={here === "home"}
            label="Home"
            onClick={onSelectDashboard}
            testId="open-home-dashboard"
          >
            <House />
          </PlaceTile>
        ) : null}
        <PlaceTile
          badge={needsYou.count}
          badgeLabel={needsYouNote(needsYou.count)}
          current={here === "conversations"}
          dot={unreadDot && needsYou.count === 0}
          label="Chats"
          onClick={onSelectConversations}
          testId="shell-place-conversations"
        >
          <MessagesSquare />
        </PlaceTile>
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
          current={here === "library"}
          label="Library"
          onClick={onSelectArtifacts}
          onPreload={() => void preloadArtifactsSurface()}
          testId="open-artifacts-view"
        >
          <Library />
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
        {onSelectMnemos ? (
          <PlaceTile
            current={here === "mnemos"}
            label="Mnemos"
            onClick={onSelectMnemos}
            onPreload={() => void preloadMnemosSurface()}
            testId="open-mnemos-place"
          >
            <NotebookText />
          </PlaceTile>
        ) : null}
      </div>
      <div className="luca-places-group luca-places-end">
        <PlaceTile
          current={here === "settings"}
          label="Settings"
          onClick={onSelectSettings}
          onPreload={() => void preloadSettingsSurface()}
          shortcut={`${key},`}
          testId="open-settings-view"
          update={updateDot}
        >
          <Settings />
        </PlaceTile>
        <ShellRailSignalsContext.Provider value={railSignalsSpeak}>
          {avatar}
        </ShellRailSignalsContext.Provider>
      </div>
    </nav>
  );
}
