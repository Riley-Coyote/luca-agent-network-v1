import {
  ArrowLeft,
  BookOpen,
  FolderCog,
  FolderX,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  deleteRoomProject,
  renameRoomProject,
} from "@/features/channels/lib/roomProjects";
import { ConversationTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import { useCommunities } from "@/features/communities/useCommunities";
import { useSelectedAgentPubkey } from "@/features/sidebar/lib/agentColumn";
import { useActiveWorkingChannelsById } from "@/features/sidebar/lib/useActiveWorkingChannelsById";
import {
  filterProjectRooms,
  projectRoomRelativeTime,
  type ProjectNavigatorViewModel,
} from "@/features/projects/lib/projectNavigator";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { cn } from "@/shared/lib/cn";
import { useNativeMacChrome } from "@/shared/lib/useNativeMacChrome";
import { useOptionalSidebar } from "@/shared/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

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

function ProjectDetailsDialog({
  onOpenChange,
  open,
  viewModel,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  viewModel: ProjectNavigatorViewModel;
}) {
  const identityQuery = useIdentityQuery();
  const communities = useCommunities();
  const { goBrain, goHome } = useAppNavigation();
  const [label, setLabel] = React.useState(viewModel.label);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLabel(viewModel.label);
    setSaveError(null);
    setDeleteError(null);
  }, [open, viewModel.label]);

  const trimmedLabel = label.trim();
  const canSave = Boolean(
    trimmedLabel && trimmedLabel !== viewModel.label && label.length <= 80,
  );

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const saved = renameRoomProject(
      identityQuery.data?.pubkey,
      communities.activeCommunity?.relayUrl,
      viewModel.projectId,
      trimmedLabel,
    );
    if (!saved) {
      setSaveError("Luca couldn't save this project name. Try again.");
      return;
    }
    onOpenChange(false);
  }

  function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const deleted = deleteRoomProject(
      identityQuery.data?.pubkey,
      communities.activeCommunity?.relayUrl,
      viewModel.projectId,
    );
    if (!deleted) {
      setDeleteError("Luca couldn't remove this project grouping. Try again.");
      return;
    }
    setDeleteOpen(false);
    onOpenChange(false);
    if (viewModel.rooms.length === 0) {
      void goHome({ replace: true });
    }
  }

  const roomCount = viewModel.rooms.length;
  const sourceCount = viewModel.sourceIds.length;

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent
          className="max-w-lg gap-5"
          data-testid="project-details-dialog"
        >
          <DialogHeader>
            <div data-luca-header-meta>Local organization</div>
            <DialogTitle>Project details</DialogTitle>
            <DialogDescription>
              Projects organize rooms and connected context. They do not grant
              residents tools, credentials, or Brain access.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={handleSave}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="project-name">
                Project name
              </label>
              <Input
                autoFocus
                id="project-name"
                maxLength={80}
                onChange={(event) => {
                  setLabel(event.currentTarget.value);
                  setSaveError(null);
                }}
                value={label}
              />
              {saveError ? (
                <p className="text-sm text-destructive" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>

            <dl className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <dt className="text-2xs uppercase tracking-caps-wide text-muted-foreground">
                  Rooms
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {roomCount === 1 ? "1 room" : `${roomCount} rooms`}
                </dd>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <dt className="text-2xs uppercase tracking-caps-wide text-muted-foreground">
                  Sources
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {sourceCount === 1
                    ? "1 connected"
                    : `${sourceCount} connected`}
                </dd>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <dt className="text-2xs uppercase tracking-caps-wide text-muted-foreground">
                  Context
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {viewModel.workingContextStatus === "missing"
                    ? "Unavailable"
                    : viewModel.workingContextStatus === "attached"
                      ? "Connected"
                      : "Not connected"}
                </dd>
              </div>
            </dl>

            {viewModel.workingContextStatus === "missing" ? (
              <div
                className="rounded-xl border border-destructive/25 bg-destructive/5 p-4"
                data-testid="project-missing-context-recovery"
              >
                <p className="text-sm font-medium">
                  Working folder unavailable
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The project and its rooms are still here. Review the source in
                  Brain to reconnect or remove the missing context.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => {
                    onOpenChange(false);
                    void goBrain();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Review sources in Brain
                </Button>
              </div>
            ) : null}

            <DialogFooter className="items-center sm:justify-between">
              <Button
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden />
                Remove grouping
              </Button>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => onOpenChange(false)}
                  type="button"
                  variant="outline"
                >
                  Close
                </Button>
                <Button disabled={!canSave} type="submit">
                  Save changes
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent data-testid="project-delete-grouping-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove project grouping?</AlertDialogTitle>
            <AlertDialogDescription>
              {roomCount === 0
                ? "No rooms will be deleted. "
                : `${roomCount === 1 ? "The room stays" : `All ${roomCount} rooms stay`} intact and ${roomCount === 1 ? "becomes" : "become"} loose. `}
              Connected sources and resident grants remain in Brain. This only
              removes the local project grouping.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep project</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={handleDelete}
                type="button"
                variant="destructive"
              >
                Remove grouping
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
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
  const { goBrain } = useAppNavigation();
  const sidebar = useOptionalSidebar();
  const isMobile = useIsMobile();
  const nativeMacChrome = useNativeMacChrome();
  const workingByChannelId = useActiveWorkingChannelsById();
  const [query, setQuery] = React.useState("");
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const filteredRooms = React.useMemo(
    () => filterProjectRooms(viewModel.rooms, query),
    [query, viewModel.rooms],
  );

  return (
    <aside
      aria-label={`${viewModel.label} rooms`}
      className="luca-project-room-navigator"
      data-native-traffic-light-inset={
        !isMobile && nativeMacChrome && sidebar?.open === false
          ? "true"
          : undefined
      }
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
                  <span className="flex size-6 shrink-0 items-center justify-center text-ink-faint">
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
                      <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                        {working
                          ? working.agentCount > 1
                            ? `${working.agentCount} working`
                            : "working"
                          : projectRoomRelativeTime(channel.lastMessageAt)}
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
          onClick={() => void goBrain()}
          title="Manage sources in Brain"
          type="button"
        >
          <BookOpen aria-hidden className="size-4" />
          Sources
        </button>
        <button
          onClick={() => setDetailsOpen(true)}
          title="Open project details"
          type="button"
        >
          <FolderCog aria-hidden className="size-4" />
          Project details
        </button>
      </footer>
      <ProjectDetailsDialog
        onOpenChange={setDetailsOpen}
        open={detailsOpen}
        viewModel={viewModel}
      />
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
  // The rail's agent column and this navigator are both "the second column".
  // While the owner has an agent open, the navigator steps aside and only the
  // conversation (or the empty project) shows — navigation is never doubled.
  const agentColumnOpen = useSelectedAgentPubkey() !== null;
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

  if (agentColumnOpen) {
    return <div className="flex min-h-0 min-w-0 flex-1">{children}</div>;
  }

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
