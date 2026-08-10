import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  readLastProjectRoom,
  useRoomProjectCatalog,
  useRoomProjects,
} from "@/features/channels/lib/roomProjects";
import { buildProjectNavigatorViewModel } from "@/features/projects/lib/projectNavigator";
import {
  EmptyProjectConversation,
  ProjectRoomWorkspace,
} from "@/features/projects/ui/ProjectRoomWorkspace";
import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ProjectDetailScreen = React.lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectDetailScreen");
  return { default: module.ProjectDetailScreen };
});

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetailRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    commitHash:
      typeof search.commitHash === "string" ? search.commitHash : undefined,
    pullRequestId:
      typeof search.pullRequestId === "string"
        ? search.pullRequestId
        : undefined,
    issueId: typeof search.issueId === "string" ? search.issueId : undefined,
  }),
});

function ProjectDetailRouteComponent() {
  const { projectId } = Route.useParams();
  const projectSearch = Route.useSearch();
  const { goChannel } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data ?? [];
  const projectCatalog = useRoomProjectCatalog(channels);
  const projectByChannelId = useRoomProjects(channels);
  const project = projectCatalog.find(
    (candidate) => candidate.id === projectId,
  );
  const viewModel = React.useMemo(
    () =>
      project
        ? buildProjectNavigatorViewModel({
            channels,
            project,
            projectByChannelId,
          })
        : null,
    [channels, project, projectByChannelId],
  );

  React.useEffect(() => {
    if (!viewModel?.rooms.length) return;
    const remembered = readLastProjectRoom(projectId);
    const selected = viewModel.rooms.find(
      ({ channel }) => channel.id === remembered,
    );
    void goChannel(selected?.channel.id ?? viewModel.rooms[0].channel.id, {
      replace: true,
    });
  }, [goChannel, projectId, viewModel]);

  if (channelsQuery.isPending) {
    return <ViewLoadingFallback kind="projects" />;
  }

  if (!project || !viewModel) {
    return <LegacyProjectDetail projectId={projectId} {...projectSearch} />;
  }

  return (
    <ProjectRoomWorkspace
      onSelectRoom={(channelId) => void goChannel(channelId)}
      viewModel={viewModel}
    >
      <EmptyProjectConversation projectName={project.label} />
    </ProjectRoomWorkspace>
  );
}

function LegacyProjectDetail({
  commitHash,
  issueId,
  projectId,
  pullRequestId,
}: {
  commitHash?: string;
  issueId?: string;
  projectId: string;
  pullRequestId?: string;
}) {
  usePreviewFeatureWarning("projects");
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ProjectDetailScreen
        commitHash={commitHash}
        issueId={issueId}
        projectId={projectId}
        pullRequestId={pullRequestId}
      />
    </React.Suspense>
  );
}
