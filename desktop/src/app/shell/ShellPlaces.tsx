import * as React from "react";
import { Activity, Bot, Library, MessagesSquare, Settings } from "lucide-react";

import {
  preloadActivitySurface,
  preloadAgentsSurface,
  preloadArtifactsSurface,
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
 * traffic lights' axis (22). Search (⌘K); then Chats, Agents, Activity and
 * Library; Settings (⌘,) and the avatar at the foot. Every one is the app's
 * existing action: this column only gives them their home. New conversation
 * (⌘N) is the `+` on the Chats rail, Brain belongs to Agents until a mind's
 * own space takes it, and the Inbox becomes Activity's Needs you. The current
 * place is marked by the places' mark (ShellMarks.tsx), which slides between
 * them.
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
  | "projects"
  | "settings";

type PlaceId = "conversations" | "agents" | "activity" | "library" | "settings";

/** Which place a view belongs to (SHELL_BUILD.md WP-10, Decided 2): Chats
 *  holds conversations, New conversation, projects and workflows; Agents
 *  holds Brain until a mind's own space takes it. The Inbox has left the
 *  column and belongs to no place. */
export function placeOfView(view: PlacesView): PlaceId | null {
  switch (view) {
    case "home":
    case "channel":
    case "messages":
    case "projects":
    case "workflows":
      return "conversations";
    case "artifacts":
      return "library";
    case "agents":
    case "brain":
      return "agents";
    case "pulse":
      return "activity";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

/**
 * The place that held keyboard focus when its column went (SHELL_BUILD.md,
 * WP-05b, 1).
 * Settings and the app each draw their own places column (ShellSettingsPlaces,
 * AppSidebar), so a place that opens or closes Settings takes its tile away
 * with the column it was in, and focus would fall to the page. The column
 * that replaces it gives focus to the same place. Kept for a moment only: it
 * is one swap's hand-over, not state, and holds nothing of a community.
 */
let placeInFocus: { testId: string; at: number } | null = null;
const HAND_OVER_MS = 2_000;

/** Hands focus from the column that goes to the one that comes. */
function usePlaceFocusHandOver(nav: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const held = placeInFocus;
    placeInFocus = null;
    if (!held || Date.now() - held.at > HAND_OVER_MS) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    nav.current
      ?.querySelector<HTMLElement>(`[data-testid="${held.testId}"]`)
      ?.focus({ preventScroll: true });
  }, [nav]);
  // A layout effect's cleanup runs before the column leaves the page, while
  // its focused tile still holds focus.
  React.useLayoutEffect(() => {
    const column = nav.current;
    return () => {
      const active = document.activeElement;
      if (!column || !active || !column.contains(active)) return;
      // Keyboard focus only: a pointer press leaves focus where macOS leaves
      // it, and a tile focused by script would show its tooltip.
      if (!active.matches(":focus-visible")) return;
      const testId = active
        .closest("[data-testid]")
        ?.getAttribute("data-testid");
      if (testId) placeInFocus = { testId, at: Date.now() };
    };
  }, [nav]);
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
  onSelectConversations: () => void;
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
  onSelectConversations,
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
  const nav = React.useRef<HTMLElement>(null);
  usePlaceFocusHandOver(nav);
  // The rail's card says an available update with its footer card; while
  // that card is out of sight, Settings says it with a dot (Decided 4).
  const status = useShellStatus();
  const { frameDrawn } = useTheme();
  const updateDot = status.updateAvailable && railSignalsSpeak;
  // What waits on you, counted on Activity, where the Inbox's count drew
  // (WP-14, Decided 4). At zero nothing shows.
  const needsYou = useNeedsYou();
  return (
    <nav
      aria-label="Places"
      className="luca-places"
      data-connection-problem={status.connectionProblem ? "" : undefined}
      data-testid="shell-places"
      data-update-available={status.updateAvailable ? "" : undefined}
      ref={nav}
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
        <PlaceTile
          current={here === "conversations"}
          dot={unreadDot}
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
          badge={needsYou.count}
          badgeLabel={needsYouNote(needsYou.count)}
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
