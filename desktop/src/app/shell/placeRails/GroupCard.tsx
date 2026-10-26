import {
  CopyPlus,
  Ellipsis,
  Pencil,
  Rocket,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";

import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { resolveTeamPersonas } from "@/features/agents/lib/teamPersonas";
import { personaSummary } from "@/features/agents/ui/agentLibraryViewModel";
import type { AgentPersona, AgentTeam } from "@/shared/api/types";
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
 * "Group" over its name, its description, its members (each persona's name
 * and runtime), and its two actions, Edit and Add to a room. The rest of
 * what the Agent groups dialog offered a group (duplicate, share, delete,
 * and importing one from a file) sits behind its quiet More, so nothing the
 * dialog did is lost with it.
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
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-y-auto"
      data-testid="group-card"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
        <PlacePageHead eyebrow="Group" title={team.name} />
        {team.description ? (
          <p className="-mt-3 mb-6 max-w-2xl text-sm leading-6 text-muted-foreground">
            {team.description}
          </p>
        ) : null}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <Button
            data-testid="group-add-to-room"
            disabled={isPending || resolution.hasMissingPersonas}
            onClick={() => onAddToRoom(team)}
            size="sm"
            type="button"
          >
            <Rocket aria-hidden />
            Add to a room
          </Button>
          <Button
            data-testid="group-edit"
            disabled={isPending}
            onClick={() => onEdit(team)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Pencil aria-hidden />
            Edit
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
        <section aria-label="Members">
          <h2 className="type-eyebrow mb-1.5 text-ink-faint">Members</h2>
          {resolution.resolvedPersonas.length > 0 ? (
            <ul>
              {resolution.resolvedPersonas.map((persona) => {
                const summary = personaSummary(persona);
                return (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2.5"
                    data-testid={`group-member-${persona.id}`}
                    key={persona.id}
                  >
                    <span className="truncate text-sm text-foreground">
                      {summary.displayName}
                    </span>
                    <span className="text-lip text-muted-foreground">
                      {summary.runtimeLabel ?? "Not configured"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-2.5 text-sm text-muted-foreground">
              No agents in this group yet. Edit the group to add some.
            </p>
          )}
          {missing > 0 ? (
            <p className="mt-3 text-xs text-destructive">
              {missing} agent{missing === 1 ? "" : "s"} in this group{" "}
              {missing === 1 ? "is" : "are"} no longer in your agents. Edit the
              group to fix it before adding or sharing.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
