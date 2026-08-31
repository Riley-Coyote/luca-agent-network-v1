import { Bot, FolderKanban, Plus, Users } from "lucide-react";

import { useManagedAgentsQuery, useTeamsQuery } from "@/features/agents/hooks";
import { useLucaProjectsQuery } from "@/features/luca-projects/hooks";
import { cn } from "@/shared/lib/cn";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";

export type LucaCollectionSelection =
  | { type: "agent"; id: string }
  | { type: "project"; id: string }
  | null;

type LucaSidebarCollectionsProps = {
  selection: LucaCollectionSelection;
  onCreateAgent: () => void;
  onOpenAgents: () => void;
  onOpenProjects: () => void;
  onSelectAgent: (pubkey: string) => void;
  onSelectProject: (projectId: string) => void;
};

export function LucaSidebarCollections({
  selection,
  onCreateAgent,
  onOpenAgents,
  onOpenProjects,
  onSelectAgent,
  onSelectProject,
}: LucaSidebarCollectionsProps) {
  const agentsQuery = useManagedAgentsQuery();
  const teamsQuery = useTeamsQuery();
  const projectsQuery = useLucaProjectsQuery();
  const agents = [...(agentsQuery.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const teams = [...(teamsQuery.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const projects = [...(projectsQuery.data ?? [])]
    .filter((project) => !project.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <SidebarGroup className="px-2 py-1" data-testid="sidebar-agents-section">
        <SidebarGroupLabel>
          <Bot />
          <button
            className="ml-2 truncate"
            onClick={onOpenAgents}
            type="button"
          >
            Agents
          </button>
        </SidebarGroupLabel>
        <SidebarGroupAction
          aria-label="Create agent"
          data-testid="sidebar-create-agent"
          onClick={onCreateAgent}
          title="Create agent"
          type="button"
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {agents.map((agent) => (
              <SidebarMenuItem key={agent.pubkey}>
                <SidebarMenuButton
                  data-testid={`agent-row-${agent.pubkey}`}
                  isActive={
                    selection?.type === "agent" && selection.id === agent.pubkey
                  }
                  onClick={() => onSelectAgent(agent.pubkey)}
                  type="button"
                >
                  <AgentIdentitySpecimen
                    accessibleName={agent.name}
                    publicKey={agent.pubkey}
                    size={20}
                    state={
                      agent.status === "running" ? "present" : "unavailable"
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {!agentsQuery.isLoading && agents.length === 0 ? (
              <li className="px-2 py-1 text-xs text-sidebar-foreground/55">
                No agents yet
              </li>
            ) : null}
          </SidebarMenu>
          {teams.length > 0 ? (
            <div className="mt-2 border-t border-sidebar-border/45 pt-2">
              <button
                className="mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs font-medium text-sidebar-foreground/65 hover:bg-sidebar-accent"
                onClick={onOpenAgents}
                type="button"
              >
                <Users className="size-3.5" /> Teams
              </button>
              {teams.map((team) => (
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
                  data-testid={`team-row-${team.id}`}
                  key={team.id}
                  onClick={onOpenAgents}
                  type="button"
                >
                  <Users className="size-4 shrink-0" />
                  <span className="truncate">{team.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup
        className="px-2 py-1"
        data-testid="sidebar-projects-section"
      >
        <SidebarGroupLabel>
          <FolderKanban />
          <button
            className="ml-2 truncate"
            onClick={onOpenProjects}
            type="button"
          >
            Projects
          </button>
        </SidebarGroupLabel>
        <SidebarGroupAction
          aria-label="New project"
          data-testid="sidebar-create-project"
          onClick={onOpenProjects}
          title="New project"
          type="button"
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {projects.map((project) => (
              <SidebarMenuItem key={project.id}>
                <SidebarMenuButton
                  data-testid={`project-row-${project.id}`}
                  isActive={
                    selection?.type === "project" && selection.id === project.id
                  }
                  onClick={() => onSelectProject(project.id)}
                  type="button"
                >
                  <FolderKanban
                    className={cn(
                      "size-4",
                      project.workingFolderState === "missing" &&
                        "text-amber-500",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {!projectsQuery.isLoading && projects.length === 0 ? (
              <li className="px-2 py-1 text-xs text-sidebar-foreground/55">
                No projects yet
              </li>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
