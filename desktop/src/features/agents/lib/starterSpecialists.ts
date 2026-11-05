import catalog from "@/shared/content/starterSpecialists.json" with {
  type: "json",
};
import type { AgentPersona } from "@/shared/api/types";

/** Product examples, not a capability or availability catalog. */
export function starterSpecialist(
  persona: Pick<AgentPersona, "id" | "isBuiltIn" | "displayName">,
) {
  return persona.isBuiltIn
    ? catalog.find(
        (entry) =>
          entry.id === persona.id && entry.name === persona.displayName,
      )
    : undefined;
}
