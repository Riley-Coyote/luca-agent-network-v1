import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useOpenDmMutation } from "@/features/channels/hooks";
import {
  type ProfilePanelTab,
  type ProfilePanelView,
  UserProfilePanel,
} from "@/features/profile/ui/UserProfilePanel";
import {
  profilePanelTabFromSearch,
  profilePanelViewFromSearch,
} from "@/features/profile/ui/UserProfilePanelUtils";
import type { ActivitySection } from "@/features/pulse/ui/ActivityPageHeader";
import { LucaActivityView } from "@/features/pulse/ui/LucaActivityView";
import { ProvenanceView } from "@/features/provenance/ui/ProvenanceView";
import { useIdentityQuery } from "@/shared/api/hooks";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { useKeepPickInAddress } from "@/app/shell/placeRails/usePlaceRails";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";

const PULSE_PANEL_SEARCH_KEYS = [
  "profile",
  "profileTab",
  "profileView",
  "record",
  "stream",
] as const;

export function PulseScreen() {
  const [localSection, setSection] = React.useState<ActivitySection>("now");
  const identityQuery = useIdentityQuery();
  const { applyPatch, values } = useHistorySearchState(PULSE_PANEL_SEARCH_KEYS);
  // Under the shell the rail picks the stream, in the address (WP-10).
  const shellFrame = useShellFrameEnabled();
  const section: ActivitySection = shellFrame
    ? values.record
      ? "record"
      : "now"
    : localSection;
  const profilePanelPubkey = values.profile;
  const profilePanelTab = profilePanelTabFromSearch(values.profileTab);
  const profilePanelView = profilePanelViewFromSearch(values.profileView);
  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string) =>
      applyPatch({ profile: pubkey, profileTab: null, profileView: null }),
    [applyPatch],
  );
  const handleCloseProfilePanel = React.useCallback(
    () => applyPatch({ profile: null, profileTab: null, profileView: null }),
    [applyPatch],
  );
  const handleProfilePanelViewChange = React.useCallback(
    (view: ProfilePanelView, options?: { replace?: boolean }) =>
      applyPatch({ profileView: view === "summary" ? null : view }, options),
    [applyPatch],
  );
  const handleProfilePanelTabChange = React.useCallback(
    (tab: ProfilePanelTab, options?: { replace?: boolean }) =>
      applyPatch({ profileTab: tab === "info" ? null : tab }, options),
    [applyPatch],
  );
  const threadPanelWidth = useThreadPanelWidth();
  const openDmMutation = useOpenDmMutation();
  const { goChannel } = useAppNavigation();
  const handleOpenDm = React.useCallback(
    async (pubkeys: string[]) => {
      const dm = await openDmMutation.mutateAsync({ pubkeys });
      await goChannel(dm.id);
    },
    [goChannel, openDmMutation],
  );

  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {shellFrame ? <KeepActivityPick applyPatch={applyPatch} /> : null}
            {section === "now" ? (
              <LucaActivityView onSectionChange={setSection} />
            ) : (
              <ProvenanceView
                onSectionChange={setSection}
                pubkey={shellFrame ? values.record : undefined}
              />
            )}
          </div>
          {profilePanelPubkey ? (
            <UserProfilePanel
              canResetWidth={threadPanelWidth.canReset}
              currentPubkey={identityQuery.data?.pubkey}
              onClose={handleCloseProfilePanel}
              onOpenDm={handleOpenDm}
              onOpenProfile={handleOpenProfilePanel}
              onResetWidth={threadPanelWidth.onResetWidth}
              onResizeStart={threadPanelWidth.onResizeStart}
              onTabChange={handleProfilePanelTabChange}
              onViewChange={handleProfilePanelViewChange}
              pubkey={profilePanelPubkey}
              tab={profilePanelTab}
              view={profilePanelView}
              widthPx={threadPanelWidth.widthPx}
            />
          ) : null}
        </div>
      </div>
    </ProfilePanelProvider>
  );
}

/** Under the shell the rail picks, and the pick is in the address (WP-10). */
function KeepActivityPick({
  applyPatch,
}: {
  applyPatch: (
    patch: Record<string, string | null>,
    options?: { replace?: boolean },
  ) => void;
}) {
  useKeepPickInAddress("activity", applyPatch);
  return null;
}
