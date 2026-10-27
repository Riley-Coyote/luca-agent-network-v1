import {
  CopyPlus,
  Ellipsis,
  Share2,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

import {
  PlaceList,
  PlaceListRow,
  PlacePage,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { resolveTeamPersonas } from "@/features/agents/lib/teamPersonas";
import { personaSummary } from "@/features/agents/ui/agentLibraryViewModel";
import type { AgentPersona, AgentTeam } from "@/shared/api/types";
import { AgentMark } from "@/shared/ui/AgentMark";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/**
 * A group's card in Agents (SHELL_BUILD.md WP-10, Decided 4): the head
 * "Group" over its name, its description, its two actions, Edit and Add to
 * a room (no icons, as the study's actions carry none), and its members:
 * each persona's name and runtime, on the page's list grid. The rest of
 * what the Agent groups dialog offered a group (duplicate, share, delete,
 * and importing one from a file) sits behind its quiet More, so nothing the
 * dialog did is lost with it. Both actions are quiet: Talk is the only
 * solid button of its kind on a page (WP-19), and a secondary one is the
 * shared quiet button, at Talk's size (WP-25, Decided 1).
 */
export function GroupCard({
  isPending,
  onAddToRoom,
  onDelete,
  onDuplicate,
  onEdit,
  onImport,
  onShare,
  personas,
  team,
}: {
  isPending: boolean;
  onAddToRoom: (team: AgentTeam) => void;
  onDelete: (team: AgentTeam) => void;
  onDuplicate: (team: AgentTeam) => void;
  onEdit: (team: AgentTeam) => void;
  onImport: () => void;
  onShare: (team: AgentTeam) => void;
  personas: AgentPersona[];
  team: AgentTeam;
}) {
  const resolution = resolveTeamPersonas(team, personas);
  const missing = resolution.missingPersonaCount;
  return (
    <PlacePage testId="group-card">
      <PlacePageHead eyebrow="Group" face={<Users />} title={team.name} />
      {team.description ? (
        <p className="luca-place-page-line">{team.description}</p>
      ) : null}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <Button
          data-testid="group-edit"
          disabled={isPending}
          onClick={() => onEdit(team)}
          size="quiet"
          type="button"
          variant="quiet"
        >
          Edit
        </Button>
        <Button
          data-testid="group-add-to-room"
          disabled={isPending || resolution.hasMissingPersonas}
          onClick={() => onAddToRoom(team)}
          size="quiet"
          type="button"
          variant="quiet"
        >
          Add to a room
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`More for ${team.name}`}
              data-testid="group-more"
              size="icon"
              type="button"
              variant="ghost"
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={isPending || resolution.hasMissingPersonas}
              onClick={() => onDuplicate(team)}
            >
              <CopyPlus className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isPending || resolution.hasMissingPersonas}
              onClick={() => onShare(team)}
            >
              <Share2 className="h-4 w-4" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isPending} onClick={onImport}>
              <Upload className="h-4 w-4" />
              Import a group…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={isPending}
              onClick={() => onDelete(team)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {resolution.resolvedPersonas.length > 0 ? (
        <PlaceList
          count={resolution.resolvedPersonas.length}
          label="Members"
          testId="group-members"
        >
          {resolution.resolvedPersonas.map((persona) => {
            const summary = personaSummary(persona);
            return (
              <PlaceListRow
                detail={summary.runtimeLabel ?? "Not configured"}
                face={<AgentMark />}
                key={persona.id}
                testId={`group-member-${persona.id}`}
                title={summary.displayName}
              />
            );
          })}
        </PlaceList>
      ) : (
        <p className="luca-place-page-line">
          No agents in this group yet. Edit the group to add some.
        </p>
      )}
      {missing > 0 ? (
        <p className="text-xs text-destructive">
          {missing} agent{missing === 1 ? "" : "s"} in this group{" "}
          {missing === 1 ? "is" : "are"} no longer in your agents. Edit the
          group to fix it before adding or sharing.
        </p>
      ) : null}
    </PlacePage>
  );
}
