import * as React from "react";

import { getPresenceLabel } from "@/features/presence/lib/presence";
import { PresenceDot } from "@/features/presence/ui/PresenceBadge";
import { useSelfProfileCache } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  MaskedAvatarBadgeFrame,
  STATUS_DOT_MASK_CURVE,
} from "@/features/profile/ui/MaskedAvatarBadgeFrame";
import { ProfilePopover } from "@/features/profile/ui/ProfilePopover";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import type { Community } from "@/features/communities/types";
import {
  ShellCommunityMenu,
  useShellHasCommunities,
} from "@/features/sidebar/ui/CommunityRail";
import type { PresenceStatus, Profile, UserStatus } from "@/shared/api/types";
import { useShellStatus } from "@/app/shell/useShellStatus";
import { cn } from "@/shared/lib/cn";
import { useIsDevBuild } from "@/shared/lib/useIsDevBuild";
import { Badge } from "@/shared/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** The shell avatar's disc, as the study's `.shell-avatar`: painted once on
 *  the avatar, at the ink at 14%, with its initial in text-xs. Rendered with
 *  `plain`, so neither the avatar nor its fallback adds a fill of its own. */
export const SHELL_AVATAR_DISC_CLASS =
  "h-full w-full bg-[hsl(var(--mn-ink)/0.14)] text-xs";

/** The avatar's menu keeps to the window: 8 from its top and sides, and 12
 *  from its bottom, the avatar's own margin there (it ends at 888 of 900). */
const SHELL_AVATAR_MENU_MARGIN = { bottom: 12, left: 8, right: 8, top: 8 };

/** Dev-identified builds name themselves: the Dev app and the beta build
 *  render the same UI, and without this they are indistinguishable on a
 *  machine that has both. A label, not a status, so no fill, no accent. */
function DevBuildChip({ menu = false }: { menu?: boolean }) {
  return (
    <Badge
      className={cn(
        "relative shrink-0 border-border/70 bg-transparent px-1.5 text-badge tracking-caps-wider text-ink-muted",
        // In the avatar's menu its letters sit on its centre (shell-avatar.css).
        menu ? "luca-dev-chip" : "pb-[2px] pt-[3px]",
      )}
      data-testid="sidebar-dev-build-chip"
      title="Development build"
      variant="outline"
    >
      {menu ? <span className="luca-dev-chip__letters">DEV</span> : "DEV"}
    </Badge>
  );
}

/* ── The avatar's one dot (SHELL_SPEC.md, "The footer's status cards";
 * Decided, 4): a connection problem, while the rail's own card, which says
 * it, is out of sight. ──────────────────────────────────────────────── */

// The connection problem comes from the shell's one status source
// (app/shell/useShellStatus.ts, WP-08b), which the rail's connection card
// and the places column read too, so they never disagree.
function useShellConnectionProblem() {
  return useShellStatus().connectionProblem;
}

/** Whether the rail's card, and the status cards at its foot, are out of
 *  sight (the rail closed, or Settings' sections in its place): then the
 *  places column says what they would. Provided by ShellPlaces. */
export const ShellRailSignalsContext = React.createContext(false);

type SidebarProfileCardProps = {
  activeCommunity: Community | null;
  isPresencePending?: boolean;
  onOpenAddCommunity: () => void;
  onOpenSettings: (section?: "profile" | "appearance") => void;
  onRemoveCommunity: (id: string) => void;
  onSendFeedback?: () => void;
  onSetPresenceStatus?: (status: PresenceStatus) => void;
  onSetUserStatus: (text: string, emoji: string) => void;
  onClearUserStatus: () => void;
  onSwitchCommunity: (id: string) => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  profile?: Profile;
  resolvedDisplayName: string;
  selfPresenceStatus: PresenceStatus;
  selfUserStatus?: UserStatus;
  communities: Community[];
};

export function SidebarProfileCard({
  isPresencePending,
  onOpenSettings,
  onSendFeedback,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  profile,
  resolvedDisplayName,
  selfPresenceStatus,
  selfUserStatus,
}: SidebarProfileCardProps) {
  const selfProfileCache = useSelfProfileCache();
  const isDevBuild = useIsDevBuild();
  const [profilePopoverOpen, setProfilePopoverOpen] = React.useState(false);
  const profileCardRef = React.useRef<HTMLDivElement | null>(null);
  const toggleProfilePopover = React.useCallback(
    () => setProfilePopoverOpen((prev) => !prev),
    [],
  );
  const handleCardClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !profileCardRef.current?.contains(target)
      ) {
        return;
      }
      toggleProfilePopover();
    },
    [toggleProfilePopover],
  );
  const hasStatus = Boolean(selfUserStatus?.text || selfUserStatus?.emoji);
  // Luca V1 is a personal home, not an organization switcher. Retain the
  // active relay context internally, but do not surface multi-community
  // controls while organizations and invited humans are deferred.
  const communityLabel = "Personal workspace";
  // Dev-identified builds name themselves here (DevBuildChip).
  const devChip = isDevBuild ? <DevBuildChip /> : null;
  const readonlyCommunityLabel = (
    <span
      className="flex min-w-0 cursor-pointer items-center text-xs leading-snug text-ink-muted"
      data-buzz-sidebar-secondary
    >
      <span className="truncate">{communityLabel}</span>
    </span>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: child buttons provide keyboard access; wrapper fills pointer gaps between them.
    <div
      className="group/profile-card cursor-pointer rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-border/35 dark:hover:bg-sidebar-border/30"
      data-testid="sidebar-profile-card"
      onClick={handleCardClick}
      ref={profileCardRef}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          aria-label={`Open profile menu for ${resolvedDisplayName}`}
          className="relative shrink-0 rounded-xl outline-hidden focus:outline-none focus-visible:outline-none"
          data-testid="sidebar-profile-avatar-button"
          onClick={(event) => {
            event.stopPropagation();
            toggleProfilePopover();
          }}
          type="button"
        >
          <MaskedAvatarBadgeFrame
            badge={
              <span
                aria-label={getPresenceLabel(selfPresenceStatus)}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
                data-testid="self-presence-badge"
                role="img"
              >
                <PresenceDot className="h-2 w-2" status={selfPresenceStatus} />
              </span>
            }
            badgeBox={{ bottom: -2, height: 14, right: -2, width: 14 }}
            className="h-8 w-8"
            curve={STATUS_DOT_MASK_CURVE}
            cutout={{ cx: 28, cy: 28, r: 7.5 }}
            size={32}
          >
            <ProfileAvatar
              avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
              avatarUrl={profile?.avatarUrl ?? null}
              className="h-full w-full text-xs"
              iconClassName="h-4 w-4"
              label={resolvedDisplayName}
              testId="sidebar-profile-avatar"
            />
          </MaskedAvatarBadgeFrame>
        </button>

        <div className="min-w-0 flex-1">
          <ProfilePopover
            open={profilePopoverOpen}
            onOpenChange={setProfilePopoverOpen}
            avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
            currentStatus={selfPresenceStatus}
            displayName={resolvedDisplayName}
            isStatusPending={isPresencePending}
            onClearUserStatus={onClearUserStatus}
            onOpenSettings={onOpenSettings}
            onSendFeedback={onSendFeedback}
            onSetStatus={onSetPresenceStatus ?? (() => {})}
            onSetUserStatus={onSetUserStatus}
            triggerContainerRef={profileCardRef}
            userStatusEmoji={selfUserStatus?.emoji}
            userStatusText={selfUserStatus?.text}
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleProfilePopover();
              }}
              className="block w-full min-w-0 rounded-sm text-left text-sidebar-foreground outline-hidden focus:outline-none focus-visible:outline-none"
              data-testid="open-settings"
              type="button"
            >
              <p
                className="truncate text-sm font-semibold leading-tight text-current"
                data-testid="sidebar-profile-name"
              >
                {resolvedDisplayName}
              </p>
            </button>
          </ProfilePopover>

          {hasStatus ? (
            <div className="relative mt-0.5 flex min-w-0 items-center gap-1.5">
              <button
                aria-label={`Open profile menu for ${resolvedDisplayName}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center truncate rounded-sm text-left text-xs leading-snug text-ink-muted outline-hidden transition-opacity duration-150 focus:outline-none focus-visible:outline-none group-hover/profile-card:opacity-0",
                  profilePopoverOpen && "opacity-100",
                )}
                data-buzz-sidebar-secondary
                data-testid="sidebar-profile-user-status"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleProfilePopover();
                }}
                type="button"
              >
                {selfUserStatus?.emoji ? (
                  <StatusEmoji
                    className="mr-1 w-4 shrink-0 text-xs"
                    value={selfUserStatus.emoji}
                  />
                ) : null}
                <span className="truncate">{selfUserStatus?.text}</span>
              </button>
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 right-0 flex min-w-0 items-center text-xs leading-snug text-ink-muted opacity-0 transition-opacity duration-150 group-hover/profile-card:opacity-100",
                  profilePopoverOpen && "opacity-0",
                )}
                data-buzz-sidebar-secondary
              >
                {readonlyCommunityLabel}
              </div>
              {devChip}
            </div>
          ) : (
            <div className="relative mt-0.5 flex min-w-0 items-center gap-1.5">
              {readonlyCommunityLabel}
              {devChip}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SidebarProfileAvatarMenuProps = Pick<
  SidebarProfileCardProps,
  | "isPresencePending"
  | "onOpenSettings"
  | "onSendFeedback"
  | "onSetPresenceStatus"
  | "onSetUserStatus"
  | "onClearUserStatus"
  | "profile"
  | "resolvedDisplayName"
  | "selfPresenceStatus"
  | "selfUserStatus"
>;

/**
 * The profile card's menu on its own: the avatar at the foot of the shell's
 * places column (SHELL_SPEC.md, "The places column"). The same menu as the
 * card's (presence, status, Settings, feedback), opened from the avatar
 * alone, with the communities in it when there is more than one (Decided,
 * 1). The avatar responds like a place (hover, open, the places' tooltip)
 * and carries no presence dot: its one dot is a connection problem.
 */
export function SidebarProfileAvatarMenu({
  isPresencePending,
  onOpenSettings,
  onSendFeedback,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  profile,
  resolvedDisplayName,
  selfPresenceStatus,
  selfUserStatus,
}: SidebarProfileAvatarMenuProps) {
  const selfProfileCache = useSelfProfileCache();
  const isDevBuild = useIsDevBuild();
  const hasCommunities = useShellHasCommunities();
  const connectionProblem = useShellConnectionProblem();
  const railSignalsSpeak = React.useContext(ShellRailSignalsContext);
  const showConnectionDot = connectionProblem && railSignalsSpeak;
  const [open, setOpen] = React.useState(false);
  // The tooltip names the avatar on its own hover and focus only: pressed,
  // it stands down until the pointer leaves or focus moves on, so it never
  // sits beside the open menu or reappears as focus returns from it.
  const [hinted, setHinted] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);
  const closeMenu = React.useCallback(() => setOpen(false), []);
  const label = showConnectionDot
    ? `Open profile menu for ${resolvedDisplayName}, connection problem`
    : `Open profile menu for ${resolvedDisplayName}`;
  return (
    <Tooltip
      // A request to show while it stands down is dropped, not kept for
      // later: focus coming home must not name it once the pointer leaves.
      onOpenChange={(next) => setHinted(next && !pressed && !open)}
      open={hinted && !pressed && !open}
    >
      <ProfilePopover
        // Beside the avatar, to the right of the places column: its bottom on
        // the avatar's, 8 from the column (the avatar's right is 34, the
        // column's edge 44), so it covers neither the avatar nor Settings.
        align="end"
        communitySwitcherSlot={
          hasCommunities ? <ShellCommunityMenu onDone={closeMenu} /> : undefined
        }
        nameAccessory={isDevBuild ? <DevBuildChip menu /> : null}
        // Never past the window: the menu takes the room left to it, and the
        // communities scroll inside it (shell-avatar.css). 12 below, where
        // the avatar's own bottom sits, so a full menu still ends on it.
        collisionPadding={SHELL_AVATAR_MENU_MARGIN}
        contentClassName="luca-shell-avatar-menu"
        side="right"
        sideOffset={18}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Focus comes home to the avatar as the menu closes: not a reason
          // to name it.
          if (!next) setPressed(true);
        }}
        avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
        avatarUrl={profile?.avatarUrl ?? null}
        currentStatus={selfPresenceStatus}
        displayName={resolvedDisplayName}
        isStatusPending={isPresencePending}
        onClearUserStatus={onClearUserStatus}
        onOpenSettings={onOpenSettings}
        onSendFeedback={onSendFeedback}
        onSetStatus={onSetPresenceStatus ?? (() => {})}
        onSetUserStatus={onSetUserStatus}
        userStatusEmoji={selfUserStatus?.emoji}
        userStatusText={selfUserStatus?.text}
      >
        <TooltipTrigger asChild>
          <button
            aria-label={label}
            className="luca-shell-avatar"
            data-open={open ? "true" : undefined}
            data-testid="shell-profile-avatar-button"
            onBlur={() => setPressed(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setPressed(true);
            }}
            onPointerDown={() => setPressed(true)}
            onPointerEnter={() => {
              if (!open) setPressed(false);
            }}
            onPointerLeave={() => {
              setPressed(false);
              setHinted(false);
            }}
            type="button"
          >
            <MaskedAvatarBadgeFrame
              badge={
                showConnectionDot ? (
                  <span
                    aria-hidden="true"
                    className="luca-shell-avatar-dot"
                    data-testid="shell-avatar-connection-dot"
                  />
                ) : undefined
              }
              badgeBox={{ bottom: -1, height: 10, right: -1, width: 10 }}
              curve={STATUS_DOT_MASK_CURVE}
              cutout={{ cx: 20.5, cy: 20.5, r: 5.5 }}
              size={24}
              sizeUnit="px"
            >
              {/* The initial's weight and ink are in shell-frame.css. */}
              <ProfileAvatar
                avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
                avatarUrl={profile?.avatarUrl ?? null}
                className={SHELL_AVATAR_DISC_CLASS}
                iconClassName="h-3 w-3"
                label={resolvedDisplayName}
                plain
                testId="shell-profile-avatar"
              />
            </MaskedAvatarBadgeFrame>
          </button>
        </TooltipTrigger>
      </ProfilePopover>
      <TooltipContent side="right">{resolvedDisplayName}</TooltipContent>
    </Tooltip>
  );
}
