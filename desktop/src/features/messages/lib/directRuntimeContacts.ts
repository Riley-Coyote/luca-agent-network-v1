import type {
  AcpRuntimeCatalogEntry,
  CreateManagedAgentInput,
  ManagedAgent,
  UserSearchResult,
} from "@/shared/api/types";

export type DirectRuntimeContactId = "claude" | "codex";

export type DirectRuntimeContactSpec = {
  displayName: string;
  personaId: string;
  runtimeId: DirectRuntimeContactId;
};

export type DirectRuntimeContactOption = DirectRuntimeContactSpec & {
  readiness: "ready" | "needs-setup";
  runtime: AcpRuntimeCatalogEntry | null;
};

export const DIRECT_RUNTIME_CONTACTS: readonly DirectRuntimeContactSpec[] = [
  {
    displayName: "Claude Code",
    personaId: "builtin:direct-runtime:claude",
    runtimeId: "claude",
  },
  {
    displayName: "Codex",
    personaId: "builtin:direct-runtime:codex",
    runtimeId: "codex",
  },
];

export function directRuntimeIsReady(runtime: AcpRuntimeCatalogEntry | null) {
  return (
    runtime?.availability === "available" &&
    (runtime.authStatus.status === "logged_in" ||
      runtime.authStatus.status === "not_applicable")
  );
}

export function getUnmaterializedDirectRuntimeContacts({
  managedAgents,
  runtimes,
}: {
  managedAgents: readonly ManagedAgent[];
  runtimes: readonly AcpRuntimeCatalogEntry[];
}): DirectRuntimeContactOption[] {
  const residentPersonaIds = new Set(
    managedAgents
      .map((agent) => agent.personaId)
      .filter((personaId): personaId is string => Boolean(personaId)),
  );

  return DIRECT_RUNTIME_CONTACTS.flatMap((contact) => {
    if (residentPersonaIds.has(contact.personaId)) return [];
    const runtime =
      runtimes.find((candidate) => candidate.id === contact.runtimeId) ?? null;
    return [
      {
        ...contact,
        readiness: directRuntimeIsReady(runtime) ? "ready" : "needs-setup",
        runtime,
      },
    ];
  });
}

export function directRuntimeContactMatches(
  contact: DirectRuntimeContactSpec,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return (
    contact.displayName.toLocaleLowerCase().includes(normalized) ||
    contact.runtimeId.includes(normalized)
  );
}

export function buildDirectRuntimeResidentInput(
  contact: DirectRuntimeContactOption,
): CreateManagedAgentInput {
  const runtime = contact.runtime;
  if (!directRuntimeIsReady(runtime) || !runtime?.command) {
    throw new Error(
      `${contact.displayName} needs setup before you can message it.`,
    );
  }

  return {
    name: contact.displayName,
    personaId: contact.personaId,
    acpCommand: "buzz-acp",
    agentCommand: runtime.command,
    agentArgs: runtime.defaultArgs,
    mcpCommand: runtime.mcpCommand ?? "",
    harnessOverride: true,
    avatarUrl: runtime.avatarUrl || undefined,
    spawnAfterCreate: true,
    startOnAppLaunch: true,
    backend: { type: "local" },
  };
}

export function directRuntimeResidentRecipient({
  avatarUrl,
  displayName,
  ownerPubkey,
  residentPubkey,
}: {
  avatarUrl: string | null;
  displayName: string;
  ownerPubkey?: string;
  residentPubkey: string;
}): UserSearchResult {
  return {
    pubkey: residentPubkey,
    displayName,
    avatarUrl,
    nip05Handle: null,
    ownerPubkey: ownerPubkey ?? null,
    isAgent: true,
  };
}
