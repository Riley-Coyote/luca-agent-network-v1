import { Activity, Bot, Brain, Inbox, Plus, Settings } from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import {
  preloadActivitySurface,
  preloadAgentsSurface,
  preloadBrainSurface,
  preloadSettingsSurface,
} from "@/app/navigation/preloadPrimarySurfaces";
import type { Channel, SearchHit } from "@/shared/api/types";
import { useInboxSurfaceEnabled } from "@/shared/features/useInboxSurfaceEnabled";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type SidebarSelectedView =
  | "home"
  | "inbox"
  | "channel"
  | "messages"
  | "agents"
  | "brain"
  | "workflows"
  | "pulse"
  | "projects";

type AppSidebarPinnedHeaderProps = {
  channelLabels: Record<string, string>;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onNewMessage: () => void;
  onSelectAgents: () => void;
  onSelectBrain: () => void;
  onSelectInbox: () => void;
  onSelectPulse: () => void;
  onSelectSettings: () => void;
  selectedView: SidebarSelectedView;
};

export function AppSidebarPinnedHeader({
  channelLabels,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  searchChannels,
  searchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  return (
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-3"
      data-testid="sidebar-pinned-header"
    >
      <TopbarSearch
        channelLabels={channelLabels}
        channels={searchChannels}
        currentPubkey={currentPubkey}
        focusRequest={searchFocusRequest}
        onOpenChannel={onSelectChannel}
        onOpenResult={onOpenSearchResult}
        onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
        onBrowseChannels={onBrowseChannels}
        onCreateAgent={onCreateAgent}
        onCreateChannel={onCreateChannel}
        suggestionChannels={suggestionChannels}
      />
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onNewMessage,
  onSelectAgents,
  onSelectBrain,
  onSelectInbox,
  onSelectPulse,
  onSelectSettings,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  // The Inbox is gated off by default — see shared/features/inboxSurface.ts.
  // Nothing here is deleted; the whole nav item (and its unread badge) simply
  // does not mount while the flag is off.
  const inboxEnabled = useInboxSurfaceEnabled();

  return (
    <SidebarHeader
      className="cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            data-luca-primary-action="new-conversation"
            data-testid="open-new-conversation"
            onClick={onNewMessage}
            tooltip="New conversation (⌘N)"
            type="button"
          >
            <Plus className="h-4 w-4" />
            <SidebarMenuLabel>New conversation</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {inboxEnabled ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-inbox-view"
              isActive={selectedView === "inbox"}
              onClick={onSelectInbox}
              tooltip="Inbox"
              type="button"
            >
              <Inbox className="h-4 w-4" />
              <SidebarMenuLabel>Inbox</SidebarMenuLabel>
            </SidebarMenuButton>
            {homeBadgeCount > 0 ? (
              <SidebarMenuBadge
                className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
                data-testid="sidebar-home-count"
              >
                {Math.min(homeBadgeCount, 99)}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-agents-view"
            isActive={selectedView === "agents"}
            onFocus={() => void preloadAgentsSurface()}
            onClick={onSelectAgents}
            onPointerEnter={() => void preloadAgentsSurface()}
            tooltip="Agents"
            type="button"
          >
            <Bot className="h-4 w-4" />
            <SidebarMenuLabel>Agents</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-label="Activity"
            data-testid="open-activity-view"
            isActive={selectedView === "pulse"}
            onFocus={() => void preloadActivitySurface()}
            onClick={onSelectPulse}
            onPointerEnter={() => void preloadActivitySurface()}
            tooltip="Activity"
            type="button"
          >
            <Activity className="h-4 w-4" />
            <SidebarMenuLabel>Activity</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-brain-setup"
            isActive={selectedView === "brain"}
            onFocus={() => void preloadBrainSurface()}
            onClick={onSelectBrain}
            onPointerEnter={() => void preloadBrainSurface()}
            tooltip="Brain"
            type="button"
          >
            <Brain className="h-4 w-4" />
            <SidebarMenuLabel>Brain</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-settings-view"
            onFocus={() => void preloadSettingsSurface()}
            onClick={onSelectSettings}
            onPointerEnter={() => void preloadSettingsSurface()}
            tooltip="Settings"
            type="button"
          >
            <Settings className="h-4 w-4" />
            <SidebarMenuLabel>Settings</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
