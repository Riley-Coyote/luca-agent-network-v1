import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useOpenDmMutation } from "@/features/channels/hooks";
import type { ProfilePanelTab } from "@/features/profile/ui/UserProfilePanelUtils";
import type { ProfilePanelOpenOptions } from "@/shared/context/ProfilePanelContext";

type UseChannelProfilePanelOptions = {
  closeAgentSession: () => void;
  setChannelManagementOpen: (open: boolean) => void;
  setConversationContextOpen: (open: boolean) => void;
  setExpandedThreadReplyIds: (value: Set<string>) => void;
  setOpenThreadHeadId: (value: string | null) => void;
  setProfilePanelPubkey: (value: string | null) => void;
  setProfilePanelTab: (value: ProfilePanelTab) => void;
  setThreadReplyTargetId: (value: string | null) => void;
  setThreadScrollTargetId: (value: string | null) => void;
};

export function useChannelProfilePanel({
  closeAgentSession,
  setChannelManagementOpen,
  setConversationContextOpen,
  setExpandedThreadReplyIds,
  setOpenThreadHeadId,
  setProfilePanelPubkey,
  setProfilePanelTab,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
}: UseChannelProfilePanelOptions) {
  const { goChannel } = useAppNavigation();
  const openDmMutation = useOpenDmMutation();

  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string, options?: ProfilePanelOpenOptions) => {
      setOpenThreadHeadId(null);
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      setThreadReplyTargetId(null);
      closeAgentSession();
      setChannelManagementOpen(false);
      setConversationContextOpen(false);
      setProfilePanelPubkey(pubkey);
      setProfilePanelTab(options?.tab ?? "continuity");
    },
    [
      closeAgentSession,
      setChannelManagementOpen,
      setConversationContextOpen,
      setExpandedThreadReplyIds,
      setOpenThreadHeadId,
      setProfilePanelPubkey,
      setProfilePanelTab,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    ],
  );

  const handleCloseProfilePanel = React.useCallback(() => {
    setProfilePanelPubkey(null);
  }, [setProfilePanelPubkey]);

  const openDmMutateAsync = openDmMutation.mutateAsync;
  const handleOpenDm = React.useCallback(
    async (pubkeys: string[]) => {
      const dm = await openDmMutateAsync({ pubkeys });
      await goChannel(dm.id);
    },
    [goChannel, openDmMutateAsync],
  );

  return {
    handleOpenProfilePanel,
    handleCloseProfilePanel,
    handleOpenDm,
  };
}
