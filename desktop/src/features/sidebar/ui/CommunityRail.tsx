import {
  Check,
  CheckCheck,
  Link2,
  MoreHorizontal,
  Plus,
  Settings2,
} from "lucide-react";
import * as React from "react";

import type { Community } from "@/features/communities/types";
import { EditCommunityDialog } from "@/features/communities/ui/EditCommunityDialog";
import { useCommunityIcons } from "@/features/communities/useCommunityIcons";
import {
  useCommunityUnread,
  type CommunityUnreadState,
} from "@/features/communities/useCommunityUnread";
import { useAppShell } from "@/app/AppShellContext";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { getInitials } from "@/shared/lib/initials";
import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

type CommunityRailProps = {
  communities: Community[];
  activeCommunityId: string | null;
  onSwitchCommunity: (id: string) => void;
  onAddCommunity: () => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  onRemoveCommunity: (id: string) => void;
};

const MAX_BADGE = 99;

/**
 * Presentation decisions for one community button, derived from its observed
 * mention state. Pure so it can be unit-tested without a DOM. The `state` guard
 * ensures we NEVER render any indicator for a relay we could not observe
 * (`unknown`/`loading`/`error`) — only a `ready` observation is trusted.
 *
 * Two-tier indicator system:
 * - `showBadge`: numeric mention count (mentions/thread-replies present).
 * - `showDot`: plain unread dot when there are regular channel unreads but no
 *   mentions. Mutually exclusive with `showBadge` by construction.
 */
export function communityRailIndicators(unread: CommunityUnreadState): {
  mentionCount: number;
  showBadge: boolean;
  showDot: boolean;
  pending: boolean;
  badgeLabel: string;
} {
  const observed = unread.state === "ready";
  const mentionCount = observed ? (unread.count ?? 0) : 0;
  const showBadge = mentionCount > 0;
  const showDot = observed && unread.hasUnread && !showBadge;
  return {
    mentionCount,
    showBadge,
    showDot,
    pending: unread.state === "unknown" || unread.state === "loading",
    badgeLabel:
      mentionCount > MAX_BADGE ? `${MAX_BADGE}+` : String(mentionCount),
  };
}

function CommunityButton({
  community,
  isActive,
  unread,
  iconUrl,
  onSwitch,
  menu,
}: {
  community: Community;
  isActive: boolean;
  unread: CommunityUnreadState;
  iconUrl: string | null;
  onSwitch: () => void;
  menu: React.ReactNode;
}) {
  const { mentionCount, showBadge, showDot, pending, badgeLabel } =
    communityRailIndicators(unread);

  const tooltipLabel = showBadge
    ? `${community.name} — ${mentionCount} mention${mentionCount === 1 ? "" : "s"}`
    : showDot
      ? `${community.name} — unread`
      : community.name;

  return (
    <ContextMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <button
              aria-current={isActive ? "true" : undefined}
              aria-label={tooltipLabel}
              className="relative flex h-9 w-9 items-center justify-center outline-hidden focus:outline-none focus-visible:outline-none"
              data-testid={`community-rail-button-${community.id}`}
              onClick={onSwitch}
              type="button"
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl text-xs font-semibold transition-all",
                  isActive
                    ? "rounded-xl bg-primary text-primary-foreground"
                    : "bg-sidebar-accent/60 text-ink-muted hover:rounded-xl hover:bg-primary/80 hover:text-primary-foreground",
                  pending && "opacity-60",
                )}
              >
                {iconUrl ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    data-testid={`community-rail-icon-${community.id}`}
                    draggable={false}
                    src={iconUrl}
                  />
                ) : (
                  getInitials(community.name) || "L"
                )}
              </span>
              {showBadge ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground ring-2 ring-sidebar"
                  data-testid={`community-rail-mentions-${community.id}`}
                >
                  {badgeLabel}
                </span>
              ) : showDot ? (
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-2 w-2 shrink-0 rounded-full bg-primary ring-2 ring-sidebar"
                  data-testid={`community-rail-unread-dot-${community.id}`}
                >
                  <span className="sr-only">unread</span>
                </span>
              ) : null}
            </button>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{tooltipLabel}</TooltipContent>
      </Tooltip>
      <ContextMenuContent data-testid={`community-rail-menu-${community.id}`}>
        {menu}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Discord/Slack-style vertical rail of communities on the far left of the app.
 * Shows a mention-count badge for inactive communities (observed via
 * `useCommunityUnread`) and switches relays on click. Right-click opens a
 * per-community menu: mark all as read, copy relay URL, community settings.
 *
 * Hidden entirely with a single community — a rail of one adds no value.
 */
export function CommunityRail({
  communities,
  activeCommunityId,
  onSwitchCommunity,
  onAddCommunity,
  onUpdateCommunity,
  onRemoveCommunity,
}: CommunityRailProps) {
  const { unreadByCommunity, markCommunityRead } = useCommunityUnread(
    communities,
    activeCommunityId,
  );
  const iconsByCommunity = useCommunityIcons(communities);
  const isFullscreen = useIsFullscreen();
  const { markAllChannelsRead } = useAppShell();
  const [editingCommunity, setEditingCommunity] =
    React.useState<Community | null>(null);
  if (communities.length <= 1) {
    return null;
  }

  const handleMarkAllRead = (community: Community) => {
    if (community.id === activeCommunityId) {
      markAllChannelsRead();
      return;
    }
    markCommunityRead(community.id).catch((error) => {
      console.warn(
        `[CommunityRail] mark all read failed community=${community.id}:`,
        error,
      );
    });
  };

  // macOS traffic lights overlay the top-left, so start buttons below them (they hide in fullscreen).
  const topPaddingClass =
    isMacPlatform() && !isFullscreen
      ? "pt-(--buzz-top-chrome-height,32px)"
      : "pt-3";

  return (
    <nav
      aria-label="Communities"
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto bg-sidebar pb-3",
        topPaddingClass,
      )}
      data-testid="community-rail"
    >
      {communities.map((community) => (
        <CommunityButton
          key={community.id}
          iconUrl={iconsByCommunity[community.id] ?? null}
          isActive={community.id === activeCommunityId}
          menu={
            <>
              <ContextMenuItem onClick={() => handleMarkAllRead(community)}>
                <CheckCheck className="h-4 w-4" />
                Mark all as read
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  void writeTextToClipboard(community.relayUrl);
                }}
              >
                <Link2 className="h-4 w-4" />
                Copy relay URL
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setEditingCommunity(community)}>
                <Settings2 className="h-4 w-4" />
                Community settings
              </ContextMenuItem>
            </>
          }
          onSwitch={() => onSwitchCommunity(community.id)}
          unread={
            unreadByCommunity[community.id] ?? {
              hasUnread: false,
              state: "unknown",
            }
          }
          community={community}
        />
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Add community"
            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sidebar-accent/60 text-ink-muted outline-hidden transition-all hover:rounded-xl hover:bg-primary/80 hover:text-primary-foreground focus:outline-none focus-visible:outline-none"
            data-testid="community-rail-add"
            onClick={onAddCommunity}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Add community</TooltipContent>
      </Tooltip>
      <EditCommunityDialog
        canRemove={communities.length > 1}
        onOpenChange={(open) => {
          if (!open) setEditingCommunity(null);
        }}
        onRemove={onRemoveCommunity}
        onSave={onUpdateCommunity}
        open={editingCommunity !== null}
        community={editingCommunity}
      />
    </nav>
  );
}

/* ── Under the shell's frame (SHELL_SPEC.md, "The community strip"; Decided,
 * 1): the strip goes and its communities move into the avatar's menu. The
 * strip's observers and dialog keep running where the strip was mounted
 * (ShellCommunityMenuSource), and publish to the menu, which mounts only
 * while it is open (ShellCommunityMenu). ─────────────────────────────── */

type ShellCommunityMenuState = {
  activeCommunityId: string | null;
  communities: Community[];
  icons: Record<string, string | null>;
  onAdd: () => void;
  onEdit: (community: Community) => void;
  onMarkAllRead: (community: Community) => void;
  onSwitch: (id: string) => void;
  unread: Record<string, CommunityUnreadState>;
};

// Written only by the mounted source and cleared when it unmounts, so it
// never outlives the community it was published from: switching remounts
// the shell (AppReady's key), and the new source publishes afresh.
let shellCommunityMenuState: ShellCommunityMenuState | null = null;
const shellCommunityMenuListeners = new Set<() => void>();

function publishShellCommunityMenu(next: ShellCommunityMenuState | null) {
  shellCommunityMenuState = next;
  for (const listener of shellCommunityMenuListeners) listener();
}

function subscribeShellCommunityMenu(listener: () => void) {
  shellCommunityMenuListeners.add(listener);
  return () => {
    shellCommunityMenuListeners.delete(listener);
  };
}

function useShellCommunityMenuState() {
  return React.useSyncExternalStore(
    subscribeShellCommunityMenu,
    () => shellCommunityMenuState,
    () => null,
  );
}

/** Whether the avatar's menu lists communities: only with more than one. */
export function useShellHasCommunities() {
  return React.useSyncExternalStore(
    subscribeShellCommunityMenu,
    () => (shellCommunityMenuState?.communities.length ?? 0) > 1,
    () => false,
  );
}

/**
 * Mounted where the strip was, under the frame: the strip's observers
 * (inactive communities' unread, their icons), its handlers and its
 * community settings dialog, published for the avatar's menu. Draws nothing
 * but the dialog, which outlives the menu that opens it.
 */
export function ShellCommunityMenuSource({
  communities,
  activeCommunityId,
  onSwitchCommunity,
  onAddCommunity,
  onUpdateCommunity,
  onRemoveCommunity,
}: CommunityRailProps) {
  const { unreadByCommunity, markCommunityRead } = useCommunityUnread(
    communities,
    activeCommunityId,
  );
  const iconsByCommunity = useCommunityIcons(communities);
  const { markAllChannelsRead } = useAppShell();
  const [editingCommunity, setEditingCommunity] =
    React.useState<Community | null>(null);
  // The handlers are read when called, so the published state changes only
  // when what the menu shows does.
  const latest = React.useRef({
    activeCommunityId,
    markAllChannelsRead,
    markCommunityRead,
    onAddCommunity,
    onSwitchCommunity,
  });
  latest.current = {
    activeCommunityId,
    markAllChannelsRead,
    markCommunityRead,
    onAddCommunity,
    onSwitchCommunity,
  };
  const iconsKey = JSON.stringify(iconsByCommunity);
  // biome-ignore lint/correctness/useExhaustiveDependencies: iconsKey is the icons' content; the object is new every render.
  const icons = React.useMemo(() => iconsByCommunity, [iconsKey]);

  React.useEffect(() => {
    publishShellCommunityMenu({
      activeCommunityId,
      communities,
      icons,
      onAdd: () => latest.current.onAddCommunity(),
      onEdit: (community) => setEditingCommunity(community),
      onMarkAllRead: (community) => {
        if (community.id === latest.current.activeCommunityId) {
          latest.current.markAllChannelsRead();
          return;
        }
        latest.current.markCommunityRead(community.id).catch((error) => {
          console.warn(
            `[CommunityRail] mark all read failed community=${community.id}:`,
            error,
          );
        });
      },
      onSwitch: (id) => latest.current.onSwitchCommunity(id),
      unread: unreadByCommunity,
    });
  }, [activeCommunityId, communities, icons, unreadByCommunity]);

  React.useEffect(() => () => publishShellCommunityMenu(null), []);

  return (
    <EditCommunityDialog
      canRemove={communities.length > 1}
      onOpenChange={(open) => {
        if (!open) setEditingCommunity(null);
      }}
      onRemove={onRemoveCommunity}
      onSave={onUpdateCommunity}
      open={editingCommunity !== null}
      community={editingCommunity}
    />
  );
}

const SHELL_COMMUNITY_ROW_CLASS =
  "flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg py-2 pr-1 pl-3 text-left text-sm text-popover-foreground outline-hidden focus:outline-none";

/** The strip's per-community actions, in either menu that offers them. */
function ShellCommunityActions({
  community,
  item: Item,
  onDone,
  separator: Separator,
  state,
}: {
  community: Community;
  item: typeof ContextMenuItem | typeof DropdownMenuItem;
  onDone: () => void;
  separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator;
  state: ShellCommunityMenuState;
}) {
  return (
    <>
      <Item onSelect={() => state.onMarkAllRead(community)}>
        <CheckCheck className="h-4 w-4" />
        Mark all as read
      </Item>
      <Item
        onSelect={() => {
          void writeTextToClipboard(community.relayUrl);
        }}
      >
        <Link2 className="h-4 w-4" />
        Copy relay URL
      </Item>
      <Separator />
      <Item
        onSelect={() => {
          // The dialog takes over from the avatar's menu.
          onDone();
          state.onEdit(community);
        }}
      >
        <Settings2 className="h-4 w-4" />
        Community settings
      </Item>
    </>
  );
}

function ShellCommunityRow({
  community,
  onDone,
  state,
}: {
  community: Community;
  onDone: () => void;
  state: ShellCommunityMenuState;
}) {
  const isActive = community.id === state.activeCommunityId;
  const { mentionCount, showBadge, showDot, pending, badgeLabel } =
    communityRailIndicators(
      state.unread[community.id] ?? { hasUnread: false, state: "unknown" },
    );
  const iconUrl = state.icons[community.id] ?? null;
  const label = isActive
    ? `${community.name}, current`
    : showBadge
      ? `${community.name}, ${mentionCount} mention${mentionCount === 1 ? "" : "s"}`
      : showDot
        ? `${community.name}, unread`
        : community.name;
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          className="group/community flex min-h-9 items-center rounded-lg transition-colors focus-within:bg-muted/50 hover:bg-muted/50"
          data-testid={`shell-community-${community.id}`}
        >
          <button
            aria-current={isActive ? "true" : undefined}
            aria-label={label}
            className={SHELL_COMMUNITY_ROW_CLASS}
            data-testid={`shell-community-switch-${community.id}`}
            onClick={() => {
              onDone();
              if (!isActive) state.onSwitch(community.id);
            }}
            role="menuitem"
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "luca-shell-community-icon",
                pending && !isActive && "opacity-60",
              )}
            >
              {iconUrl ? (
                <img alt="" draggable={false} src={iconUrl} />
              ) : (
                getInitials(community.name) || "L"
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">{community.name}</span>
            {isActive ? (
              <Check
                className="h-4 w-4 shrink-0"
                data-testid={`shell-community-current-${community.id}`}
              />
            ) : showBadge ? (
              <span
                className="luca-shell-community-count"
                data-testid={`shell-community-mentions-${community.id}`}
              >
                {badgeLabel}
              </span>
            ) : showDot ? (
              <span
                className="luca-signal-dot size-1.5 shrink-0 rounded-full"
                data-testid={`shell-community-unread-${community.id}`}
              />
            ) : null}
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`More for ${community.name}`}
                className="luca-shell-community-more"
                data-testid={`shell-community-more-${community.id}`}
                type="button"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              <ShellCommunityActions
                community={community}
                item={DropdownMenuItem}
                onDone={onDone}
                separator={DropdownMenuSeparator}
                state={state}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid={`shell-community-menu-${community.id}`}>
        <ShellCommunityActions
          community={community}
          item={ContextMenuItem}
          onDone={onDone}
          separator={ContextMenuSeparator}
          state={state}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The communities, in the avatar's menu (its switcher slot): each one, the
 * current one marked, the others with the strip's unread dot or mention
 * count; the strip's right-click actions (and a "more" button for the
 * keyboard); then Add community. Switching is the strip's own handler.
 */
export function ShellCommunityMenu({ onDone }: { onDone: () => void }) {
  const state = useShellCommunityMenuState();
  if (!state || state.communities.length <= 1) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of menu items inside the avatar's role="menu", not a form's fieldset.
    <div aria-label="Communities" data-testid="shell-communities" role="group">
      {state.communities.map((community) => (
        <ShellCommunityRow
          community={community}
          key={community.id}
          onDone={onDone}
          state={state}
        />
      ))}
      <button
        className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-popover-foreground outline-hidden transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
        data-testid="shell-community-add"
        onClick={() => {
          onDone();
          state.onAdd();
        }}
        role="menuitem"
        type="button"
      >
        <span aria-hidden="true" className="luca-shell-community-icon">
          <Plus className="h-3.5 w-3.5" />
        </span>
        <span>Add community</span>
      </button>
    </div>
  );
}
