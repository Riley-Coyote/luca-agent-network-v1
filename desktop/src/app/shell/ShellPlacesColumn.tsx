import * as React from "react";

import { ShellPlaces, type ShellPlacesProps } from "@/app/shell/ShellPlaces";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { SidebarProfileAvatarMenu } from "@/features/sidebar/ui/SidebarProfileCard";
import type { Channel } from "@/shared/api/types";
import { useSidebar } from "@/shared/ui/sidebar";

/**
 * THE ONE PLACES COLUMN (SHELL_SPEC.md, "The places column"; SHELL_BUILD.md
 * WP-17, 4). Drawn by the shell in one place for every route, Settings
 * included, so the column is never unmounted between them and its mark
 * slides into Settings and out again, as it slides between every other
 * place. Outside the settings chunk's suspense, so it holds still while the
 * panels load.
 *
 * Chats, from anywhere: already in a conversation with the rail closed, it
 * opens the rail, with the toggle's own motion (or the sheet on a narrow
 * window); otherwise it returns to the conversation you stepped out of, while
 * it still exists, and only then to Chats' first screen.
 */
export function ShellPlacesColumn({
  avatarMenu,
  channels,
  onSelectHome,
  places,
  search,
  selectedChannelId,
  selectedView,
}: {
  avatarMenu: React.ComponentProps<typeof SidebarProfileAvatarMenu>;
  /** The rail's conversations: where Chats may return to. */
  channels: Channel[];
  onSelectHome: () => void;
  places: Omit<
    ShellPlacesProps,
    "avatar" | "onSelectConversations" | "search" | "selectedView"
  >;
  search: Omit<ShellPlacesProps["search"], "channelLabels"> & {
    fallbackDisplayName?: string;
  };
  selectedChannelId: string | null;
  selectedView: ShellPlacesProps["selectedView"];
}) {
  const { fallbackDisplayName, ...searchProps } = search;
  const directMessages = React.useMemo(
    () => search.channels.filter((channel) => channel.channelType === "dm"),
    [search.channels],
  );
  // The search dialog names direct conversations as the rail does.
  const { dmChannelLabels } = useDmSidebarMetadata({
    currentPubkey: search.currentPubkey,
    directMessages,
    fallbackDisplayName,
    profileDisplayName: avatarMenu.profile?.displayName,
  });

  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const lastConversation = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (selectedChannelId) lastConversation.current = selectedChannelId;
  }, [selectedChannelId]);
  const { onOpenChannel } = search;
  const selectConversations = React.useCallback(() => {
    const railClosed = isMobile ? !openMobile : !open;
    if (selectedView === "channel" && railClosed) {
      toggleSidebar();
      return;
    }
    const last = lastConversation.current;
    if (
      last &&
      channels.some(
        (channel) =>
          channel.id === last && channel.isMember && !channel.archivedAt,
      )
    ) {
      onOpenChannel(last);
      return;
    }
    onSelectHome();
  }, [
    channels,
    isMobile,
    onOpenChannel,
    onSelectHome,
    open,
    openMobile,
    selectedView,
    toggleSidebar,
  ]);

  return (
    <ShellPlaces
      {...places}
      avatar={<SidebarProfileAvatarMenu {...avatarMenu} />}
      onSelectConversations={selectConversations}
      search={{ ...searchProps, channelLabels: dmChannelLabels }}
      selectedView={selectedView}
    />
  );
}
