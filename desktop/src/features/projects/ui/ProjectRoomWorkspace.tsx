import {
  ArrowLeft,
  BookOpen,
  FolderCog,
  FolderX,
  Plus,
  Search,
} from "lucide-react";
import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import { ConversationTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import {
  filterProjectRooms,
  type ProjectNavigatorViewModel,
} from "@/features/projects/lib/projectNavigator";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { cn } from "@/shared/lib/cn";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

function contextStatus(viewModel: ProjectNavigatorViewModel) {
  if (viewModel.sourceIds.length > 0) {
    return `${viewModel.sourceIds.length} connected ${viewModel.sourceIds.length === 1 ? "source" : "sources"}`;
  }
  if (viewModel.workingContextStatus === "attached") {
    return "Working context attached";
  }
  if (viewModel.workingContextStatus === "missing") {
    return "Working folder unavailable";
  }
  return "No connected context";
}

export function ProjectRoomNavigator({
  onSelectRoom,
  viewModel,
}: {
  onSelectRoom: (channelId: string) => void;
  viewModel: ProjectNavigatorViewModel;
}) {
  const { getChannelReadAt, openCreateChannel, readStateVersion } =
    useAppShell();
  const workingByChannelId = useActiveWorkingChannelsById();
  const [query, setQuery] = React.useState("");
  const filteredRooms = React.useMemo(
    () => filterProjectRooms(viewModel.rooms, query),
    [query, viewModel.rooms],
  );

  return (
    <aside
      aria-label={`${viewModel.label} rooms`}
      className="luca-project-room-navigator"
      data-testid="project-room-navigator"
    >
      <header className="luca-project-room-navigator__header">
        <div className="min-w-0">
          <div data-luca-header-meta>Project</div>
          <h1 className="truncate text-xl font-medium tracking-[-0.025em]">
            {viewModel.label}
          </h1>
          <div
            className={cn(
              "mt-1 flex items-center gap-1.5 text-xs text-muted-foreground",
              viewModel.workingContextStatus === "missing" &&
                "text-destructive",
            )}
          >
            {viewModel.workingContextStatus === "missing" ? (
              <FolderX aria-hidden className="size-3.5" />
            ) : null}
            <span className="truncate">{contextStatus(viewModel)}</span>
          </div>
        </div>
        <button
          aria-label="New room"
          className="luca-project-icon-button"
          onClick={() => openCreateChannel(viewModel.projectId)}
          title="New room"
          type="button"
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </header>

      <div className="luca-project-room-search">
        <Search aria-hidden className="size-4" />
        <input
          aria-label={`Search ${viewModel.label} rooms`}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search rooms"
          type="search"
          value={query}
        />
      </div>

      <ul className="luca-project-room-list">
        {filteredRooms.length > 0 ? (
          filteredRooms.map(({ channel, preview }) => {
            // Referencing the read-state version makes this projection update
            // when the canonical manager advances without duplicating state.
            void readStateVersion;
            const readAt = getChannelReadAt(channel.id);
            const lastMessageAt = channel.lastMessageAt
              ? Date.parse(channel.lastMessageAt) / 1_000
              : null;
            const isUnread =
              lastMessageAt !== null &&
              (readAt === null || lastMessageAt > readAt);
            const working = workingByChannelId.get(channel.id);
            const isSelected = channel.id === viewModel.selectedRoomId;
            return (
              <li key={channel.id}>
                <button
                  aria-current={isSelected ? "page" : undefined}
                  className="luca-project-room-row"
                  data-active={isSelected ? "true" : undefined}
                  data-testid={`project-room-${channel.id}`}
                  onClick={() => onSelectRoom(channel.id)}
                  type="button"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground/60">
                    <ConversationTypeIcon
                      channel={channel}
                      className="size-4"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          isUnread &&
                            !isSelected &&
                            "font-medium text-foreground",
                        )}
                      >
                        {channel.name}
                      </span>
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/65">
                        {working
                          ? working.agentCount > 1
                            ? `${working.agentCount} working`
                            : "working"
                          : relativeTime(channel.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {channel.archivedAt ? "Archived room" : preview}
                      </span>
                      {isUnread && !isSelected ? (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                          title="Unread"
                        />
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        ) : (
          <div className="luca-project-room-list__empty">
            {viewModel.rooms.length === 0
              ? "No rooms yet"
              : `No rooms match “${query.trim()}”`}
          </div>
        )}
      </ul>

      <footer className="luca-project-room-navigator__footer">
        <button
          disabled
          title="Source access is configured in Brain"
          type="button"
        >
          <BookOpen aria-hidden className="size-4" />
          Sources
        </button>
        <button
          disabled
          title="Project details are not available in this slice"
          type="button"
        >
          <FolderCog aria-hidden className="size-4" />
          Project details
        </button>
      </footer>
    </aside>
  );
}

export function ProjectRoomWorkspace({
  children,
  onSelectRoom,
  viewModel,
}: {
  children: React.ReactNode;
  onSelectRoom: (channelId: string) => void;
  viewModel: ProjectNavigatorViewModel;
}) {
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = React.useState<"rooms" | "conversation">(
    viewModel.selectedRoomId || viewModel.rooms.length === 0
      ? "conversation"
      : "rooms",
  );

  const selectRoom = React.useCallback(
    (channelId: string) => {
      setMobileView("conversation");
      onSelectRoom(channelId);
    },
    [onSelectRoom],
  );

  if (isMobile) {
    return mobileView === "rooms" ? (
      <ProjectRoomNavigator onSelectRoom={selectRoom} viewModel={viewModel} />
    ) : (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          className="luca-project-mobile-back"
          onClick={() => setMobileView("rooms")}
          type="button"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {viewModel.label}
        </button>
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="luca-project-room-workspace">
      <ProjectRoomNavigator onSelectRoom={selectRoom} viewModel={viewModel} />
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyProjectConversation({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { openCreateChannel } = useAppShell();
  return (
    <main className="luca-project-empty-conversation">
      <div>
        <div data-luca-header-meta>Project</div>
        <h2>{projectName} has no conversations yet</h2>
        <p>
          Create a room to give this project a durable place for messages,
          agents, files, and decisions.
        </p>
        <button onClick={() => openCreateChannel(projectId)} type="button">
          <Plus aria-hidden className="size-4" />
          Create first room
        </button>
      </div>
    </main>
  );
}
