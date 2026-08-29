import type { RoomProject } from "@/features/channels/lib/roomProjects";
import type { Channel } from "@/shared/api/types";

export type ProjectRoomSummary = {
  channel: Channel;
  preview: string;
};

export interface ProjectNavigatorViewModel {
  projectId: string;
  label: string;
  sourceIds: string[];
  workingContextStatus: "attached" | "missing" | "none";
  rooms: ProjectRoomSummary[];
  selectedRoomId?: string;
}

export function projectRoomRelativeTime(iso: string | null): string {
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

function roomPreview(channel: Channel): string {
  return (
    channel.description?.trim() ||
    channel.topic?.trim() ||
    channel.purpose?.trim() ||
    ""
  );
}

export function buildProjectNavigatorViewModel({
  channels,
  project,
  projectByChannelId,
  selectedRoomId,
}: {
  channels: readonly Channel[];
  project: RoomProject;
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  selectedRoomId?: string;
}): ProjectNavigatorViewModel {
  const rooms = channels
    .filter((channel) => projectByChannelId.get(channel.id)?.id === project.id)
    .sort((a, b) => {
      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    })
    .map((channel) => ({ channel, preview: roomPreview(channel) }));

  return {
    projectId: project.id,
    label: project.label,
    sourceIds: project.sourceIds ?? [],
    workingContextStatus: project.workingContextStatus ?? "none",
    rooms,
    ...(selectedRoomId &&
    rooms.some(({ channel }) => channel.id === selectedRoomId)
      ? { selectedRoomId }
      : {}),
  };
}

export function filterProjectRooms(
  rooms: readonly ProjectRoomSummary[],
  query: string,
): ProjectRoomSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...rooms];
  return rooms.filter(({ channel, preview }) =>
    `${channel.name}\n${preview}`.toLocaleLowerCase().includes(normalized),
  );
}
