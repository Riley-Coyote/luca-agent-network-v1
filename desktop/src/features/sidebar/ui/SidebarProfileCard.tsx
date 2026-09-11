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
import type { PresenceStatus, Profile, UserStatus } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { useIsDevBuild } from "@/shared/lib/useIsDevBuild";
import { Badge } from "@/shared/ui/badge";

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
  // Dev-identified builds name themselves here. The Dev app and the beta build
  // render the same UI; without this they are indistinguishable on a machine
  // that has both. A label, not a status — so no fill, no accent.
  const devChip = isDevBuild ? (
    <Badge
      className="relative shrink-0 border-border/70 bg-transparent px-1.5 pb-[2px] pt-[3px] text-badge tracking-caps-wider text-ink-muted"
      data-testid="sidebar-dev-build-chip"
      title="Development build"
      variant="outline"
    >
      DEV
    </Badge>
  ) : null;
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
