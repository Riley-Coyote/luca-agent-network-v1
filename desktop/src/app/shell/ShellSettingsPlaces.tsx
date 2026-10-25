import * as React from "react";

import { ShellPlaces, type ShellPlacesProps } from "@/app/shell/ShellPlaces";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { SidebarProfileAvatarMenu } from "@/features/sidebar/ui/SidebarProfileCard";

/**
 * The places column on the Settings route (SHELL_SPEC.md, "Settings": the
 * frame stays). Everywhere else the rail (AppSidebar) draws the places beside
 * its card; Settings puts its own section list in that card, so the shell
 * draws the same places here, from the same handlers, with Settings marked.
 * Outside the settings chunk's suspense, so the column holds still while the
 * panels load.
 */
export function ShellSettingsPlaces({
  avatarMenu,
  places,
  search,
}: {
  avatarMenu: React.ComponentProps<typeof SidebarProfileAvatarMenu>;
  places: Omit<ShellPlacesProps, "avatar" | "search" | "selectedView">;
  search: Omit<ShellPlacesProps["search"], "channelLabels"> & {
    fallbackDisplayName?: string;
  };
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
  return (
    <ShellPlaces
      {...places}
      avatar={<SidebarProfileAvatarMenu {...avatarMenu} />}
      search={{ ...searchProps, channelLabels: dmChannelLabels }}
      selectedView="settings"
    />
  );
}
