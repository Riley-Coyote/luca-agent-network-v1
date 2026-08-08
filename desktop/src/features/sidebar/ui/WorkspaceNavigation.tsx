import {
  Activity,
  Bot,
  FolderKanban,
  Home,
  Inbox,
  MessageCircleMore,
  Plus,
  Settings,
} from "lucide-react";
import * as React from "react";

import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { type ChatListItem, sortChats } from "@/features/sidebar/ui/ChatList";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { cn } from "@/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export type WorkspaceSelectedView =
  | "home"
  | "inbox"
  | "channel"
  | "messages"
  | "agents"
  | "workflows"
  | "pulse"
  | "projects";

type WorkspaceNavigationProps = {
  currentPubkey?: string;
  displayName: string;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  homeBadgeCount: number;
  items: readonly ChatListItem[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  projects: readonly RoomProject[];
  selectedChannelId: string | null;
  selectedView: WorkspaceSelectedView;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onNewMessage: () => void;
  onSelectAgents: () => void;
  onSelectChannel: (channelId: string) => void;
  onSelectInbox: () => void;
  onSelectProjects: () => void;
  onSelectPulse: () => void;
  onSelectSettings: () => void;
};

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : label.slice(0, 2)
  ).toUpperCase();
}

function DockButton({
  active,
  badge,
  children,
  testId,
  label,
  onClick,
}: {
  active?: boolean;
  badge?: number;
  children: React.ReactNode;
  testId?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="relative grid size-8 place-items-center rounded-md border border-transparent text-sidebar-foreground/45 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
          data-active={active ? "true" : undefined}
          data-testid={testId}
          onClick={onClick}
          type="button"
        >
          {children}
          {badge && badge > 0 ? (
            <span className="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-foreground px-1 text-center text-2xs font-semibold leading-3.5 text-background">
              {Math.min(badge, 99)}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ProjectDockButton({
  active,
  project,
  onClick,
}: {
  active: boolean;
  project: RoomProject;
  onClick: () => void;
}) {
  return (
    <DockButton
      active={active}
      label={project.label}
      onClick={onClick}
      testId={`project-${project.id}`}
    >
      <span className="font-mono text-2xs font-medium tracking-[0.08em]">
        {initials(project.label)}
      </span>
    </DockButton>
  );
}

function relativeTime(iso: string | null) {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ConversationRow({
  item,
  active,
  unread,
  working,
  onClick,
}: {
  item: ChatListItem;
  active: boolean;
  unread: boolean;
  working?: { agentCount: number };
  onClick: () => void;
}) {
  return (
    <button
      aria-label={unread ? `${item.label}, unread` : item.label}
      className="group flex min-h-8 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm text-sidebar-foreground/65 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
      data-active={active ? "true" : undefined}
      data-channel-id={item.channel.id}
      data-testid={`channel-${item.channel.name}`}
      onClick={onClick}
      type="button"
    >
      <span className="flex shrink-0 -space-x-1.5">
        {item.markPubkeys.length > 0 ? (
          item.markPubkeys.map((seed) => (
            <AgentIdentitySpecimen
              accessibleName={item.label}
              className="ring-2 ring-sidebar"
              key={seed}
              publicKey={seed}
              size={18}
              state={working ? "working" : "present"}
            />
          ))
        ) : (
          <MessageCircleMore className="size-4 text-sidebar-foreground/40" />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", unread && "font-medium")}>
        {item.label}
      </span>
      {unread && !active ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-sidebar-foreground/75"
        />
      ) : working ? (
        <span className="font-mono text-2xs text-sidebar-foreground/42">
          working
        </span>
      ) : (
        <span className="font-mono text-2xs text-sidebar-foreground/30">
          {relativeTime(item.channel.lastMessageAt)}
        </span>
      )}
    </button>
  );
}

function Section({
  children,
  testId,
  title,
}: {
  children: React.ReactNode;
  testId?: string;
  title: string;
}) {
  return (
    <section className="mt-4">
      <h3 className="px-2 pb-1 font-mono text-2xs font-medium uppercase tracking-[0.16em] text-sidebar-foreground/30">
        {title}
      </h3>
      <div className="space-y-px" data-testid={testId}>
        {children}
      </div>
    </section>
  );
}

export function WorkspaceNavigation({
  currentPubkey,
  displayName,
  footer,
  header,
  homeBadgeCount,
  items,
  projectByChannelId,
  projects,
  selectedChannelId,
  selectedView,
  unreadChannelIds,
  workingByChannelId,
  onNewMessage,
  onSelectAgents,
  onSelectChannel,
  onSelectInbox,
  onSelectProjects,
  onSelectPulse,
  onSelectSettings,
}: WorkspaceNavigationProps) {
  const selectedItem = items.find(
    (item) => item.channel.id === selectedChannelId,
  );
  const activeProject = selectedItem
    ? projectByChannelId.get(selectedItem.channel.id)
    : undefined;
  const sorted = React.useMemo(() => sortChats(items), [items]);
  const directMessages = sorted.filter(
    (item) => item.channel.channelType === "dm",
  );
  const looseRooms = sorted.filter(
    (item) =>
      item.channel.channelType !== "dm" &&
      !projectByChannelId.has(item.channel.id),
  );
  const projectRooms = activeProject
    ? sorted.filter(
        (item) =>
          item.channel.channelType !== "dm" &&
          projectByChannelId.get(item.channel.id)?.id === activeProject.id,
      )
    : [];

  const openFirst = React.useCallback(
    (candidates: readonly ChatListItem[], fallback: () => void) => {
      const first = candidates[0];
      if (first) onSelectChannel(first.channel.id);
      else fallback();
    },
    [onSelectChannel],
  );

  const renderRows = (rows: readonly ChatListItem[]) =>
    rows.map((item) => (
      <ConversationRow
        active={item.channel.id === selectedChannelId}
        item={item}
        key={item.channel.id}
        onClick={() => onSelectChannel(item.channel.id)}
        unread={unreadChannelIds.has(item.channel.id)}
        working={workingByChannelId?.get(item.channel.id)}
      />
    ));

  const isHomeContext = !activeProject;
  const selectedProjectId = activeProject?.id;

  return (
    <div className="flex min-h-0 flex-1" data-luca-workspace-navigation>
      <nav
        aria-label="Workspace destinations"
        className="flex w-12 shrink-0 flex-col items-center border-r border-sidebar-border/70 bg-black px-2 pb-2 pt-[calc(var(--mn-card-lip)+var(--mn-header-height))]"
        data-testid="workspace-dock"
      >
        <div className="flex flex-col gap-2">
          <DockButton
            active={
              isHomeContext &&
              ["home", "channel", "messages"].includes(selectedView)
            }
            label="Home"
            onClick={() =>
              openFirst([...directMessages, ...looseRooms], onNewMessage)
            }
          >
            <Home className="size-4" />
          </DockButton>
          <DockButton
            active={selectedView === "inbox"}
            badge={homeBadgeCount}
            label="Inbox"
            onClick={onSelectInbox}
          >
            <Inbox className="size-4" />
          </DockButton>
          <DockButton
            active={selectedView === "agents"}
            label="Agents"
            onClick={onSelectAgents}
          >
            <Bot className="size-4" />
          </DockButton>
          <DockButton
            active={selectedView === "pulse"}
            label="Activity"
            onClick={onSelectPulse}
          >
            <Activity className="size-4" />
          </DockButton>
        </div>

        <div className="my-3 h-px w-5 bg-sidebar-border/70" />
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {projects.map((project) => {
            const rooms = sorted.filter(
              (item) =>
                item.channel.channelType !== "dm" &&
                projectByChannelId.get(item.channel.id)?.id === project.id,
            );
            return (
              <ProjectDockButton
                active={selectedProjectId === project.id}
                key={project.id}
                onClick={() => openFirst(rooms, onSelectProjects)}
                project={project}
              />
            );
          })}
          <DockButton label="Projects" onClick={onSelectProjects}>
            <Plus className="size-4" />
          </DockButton>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <DockButton label="Settings" onClick={onSelectSettings}>
            <Settings className="size-4" />
          </DockButton>
          <DockButton label={displayName} onClick={onSelectSettings}>
            {currentPubkey ? (
              <AgentIdentitySpecimen
                accessibleName={displayName}
                publicKey={currentPubkey}
                size={20}
                state="present"
              />
            ) : (
              <span className="text-2xs font-semibold">
                {initials(displayName)}
              </span>
            )}
          </DockButton>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col bg-sidebar">
        {header}
        <div className="flex min-h-11 items-center justify-between border-b border-sidebar-border/60 px-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
              {activeProject?.label ?? "Home"}
            </p>
            <p className="truncate font-mono text-2xs uppercase tracking-[0.12em] text-sidebar-foreground/30">
              {activeProject ? "Project" : "Personal network"}
            </p>
          </div>
          <button
            aria-label="New conversation"
            className="grid size-7 place-items-center rounded-md text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            onClick={onNewMessage}
            type="button"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {activeProject ? (
            <>
              <Section testId="stream-list" title="Rooms">
                {projectRooms.length > 0 ? (
                  renderRows(projectRooms)
                ) : (
                  <p className="px-2 py-2 text-xs text-sidebar-foreground/35">
                    No rooms in this project yet.
                  </p>
                )}
              </Section>
              <Section title="Working context">
                <button
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={onSelectProjects}
                  type="button"
                >
                  <FolderKanban className="size-4 shrink-0" />
                  <span className="min-w-0 truncate font-mono text-2xs">
                    {activeProject.path ?? "No folder attached"}
                  </span>
                </button>
              </Section>
            </>
          ) : (
            <>
              <Section testId="dm-list" title="Direct messages">
                {directMessages.length > 0 ? (
                  renderRows(directMessages)
                ) : (
                  <button
                    className="w-full rounded-md px-2 py-2 text-left text-xs text-sidebar-foreground/35 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    onClick={onNewMessage}
                    type="button"
                  >
                    Start a direct conversation
                  </button>
                )}
              </Section>
              {looseRooms.length > 0 ? (
                <Section testId="stream-list" title="Rooms">
                  {renderRows(looseRooms)}
                </Section>
              ) : null}
            </>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}
