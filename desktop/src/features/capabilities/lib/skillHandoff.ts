import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

import {
  DIRECT_RUNTIME_CONTACTS,
  directRuntimeIsReady,
} from "@/features/messages/lib/directRuntimeContacts";

/**
 * Pick a runtime only when New Message can address it directly and the live
 * runtime probe says it is ready. Returning undefined deliberately opens the
 * ordinary recipient picker without a misleading search filter.
 */
export function preferredReadySkillRuntime(
  skillRuntimeIds: readonly string[],
  runtimes: readonly AcpRuntimeCatalogEntry[],
): string | undefined {
  const installedFor = new Set(skillRuntimeIds);
  return DIRECT_RUNTIME_CONTACTS.find((contact) => {
    if (!installedFor.has(contact.runtimeId)) return false;
    const runtime =
      runtimes.find((candidate) => candidate.id === contact.runtimeId) ?? null;
    return directRuntimeIsReady(runtime);
  })?.runtimeId;
}

/** A skill runtime's name, as the Library says it. */
export function skillRuntimeLabel(runtimeId: string): string {
  switch (runtimeId) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "openclaw":
      return "OpenClaw";
    case "hermes":
      return "Hermes";
    case "goose":
      return "Goose";
    case "polyphonic":
      return "Polyphonic";
    default:
      return runtimeId;
  }
}
