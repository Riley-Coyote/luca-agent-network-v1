import type { AgentPersona, AgentTeam } from "@/shared/api/types";

export type ResolvedTeamPersonas = {
  hasMissingPersonas: boolean;
  isComplete: boolean;
  isUsable: boolean;
  missingPersonaCount: number;
  missingPersonaIds: string[];
  resolvedPersonaIds: string[];
  resolvedPersonas: AgentPersona[];
};

export function emptyResolvedTeamPersonas(): ResolvedTeamPersonas {
  return {
    hasMissingPersonas: false,
    isComplete: true,
    isUsable: false,
    missingPersonaCount: 0,
    missingPersonaIds: [],
    resolvedPersonaIds: [],
    resolvedPersonas: [],
  };
}

export function isResolvedTeamUsable(
  resolution: Pick<ResolvedTeamPersonas, "isComplete" | "resolvedPersonaIds">,
) {
  return resolution.isComplete && resolution.resolvedPersonaIds.length > 0;
}

export function getUsableTeams(
  teams: readonly AgentTeam[],
  personas: readonly AgentPersona[],
) {
  return teams.filter((team) =>
    isResolvedTeamUsable(resolveTeamPersonas(team, personas)),
  );
}

export function getTeamPickerUnavailableReason(
  resolution: Pick<
    ResolvedTeamPersonas,
    "missingPersonaCount" | "resolvedPersonaIds"
  >,
): string | null {
  if (resolution.missingPersonaCount > 0) {
    const count = resolution.missingPersonaCount;
    return `${count} ${count === 1 ? "agent is" : "agents are"} no longer available. Edit this group to continue.`;
  }

  if (resolution.resolvedPersonaIds.length === 0) {
    return "This group has no agents. Edit it to continue.";
  }

  return null;
}

export function resolveTeamPersonas(
  team: Pick<AgentTeam, "personaIds">,
  personas: readonly AgentPersona[],
): ResolvedTeamPersonas {
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );
  const resolvedPersonas: AgentPersona[] = [];
  const resolvedPersonaIds: string[] = [];
  const missingPersonaIds: string[] = [];

  for (const personaId of team.personaIds) {
    const persona = personasById.get(personaId);

    if (persona) {
      resolvedPersonas.push(persona);
      resolvedPersonaIds.push(persona.id);
      continue;
    }

    missingPersonaIds.push(personaId);
  }

  const missingPersonaCount = missingPersonaIds.length;

  return {
    hasMissingPersonas: missingPersonaCount > 0,
    isComplete: missingPersonaCount === 0,
    isUsable: missingPersonaCount === 0 && resolvedPersonaIds.length > 0,
    missingPersonaCount,
    missingPersonaIds,
    resolvedPersonaIds,
    resolvedPersonas,
  };
}
