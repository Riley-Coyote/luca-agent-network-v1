import type { CreateManagedAgentInput } from "@/shared/api/types";
import { invokeTauri } from "@/shared/api/tauri";

export type ResidentRuntimeBinding = {
  runtimeId: string | null;
  runtimeCommand: string;
  providerId: string | null;
  modelId: string | null;
};

export type ResidentRegistryEntry = {
  residentPubkey: string;
  displayName: string;
  personaId: string | null;
  runtime: ResidentRuntimeBinding;
  status: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResidentRegistrySnapshot = {
  schema: "luca.resident-registry.v1";
  residents: ResidentRegistryEntry[];
};

export type CreatedResidentSummary = {
  residentPubkey: string;
  displayName: string;
  personaId: string | null;
  runtimeCommand: string;
  providerId: string | null;
  modelId: string | null;
  status: string;
};

export type CreateLucaResidentResponse = {
  resident: CreatedResidentSummary;
  profileSyncError: string | null;
  spawnError: string | null;
  reused: boolean;
  recoveryNotice: string | null;
};

export async function listLucaResidents(): Promise<ResidentRegistrySnapshot> {
  return invokeTauri<ResidentRegistrySnapshot>("list_luca_residents");
}

/**
 * Luca's resident setup uses the desktop-owned key-safe command exclusively.
 * Its response type intentionally has no private-key field.
 */
export async function createLucaResident(
  input: CreateManagedAgentInput,
): Promise<CreateLucaResidentResponse> {
  return invokeTauri<CreateLucaResidentResponse>("create_luca_resident", {
    input: {
      name: input.name,
      personaId: input.personaId,
      teamId: input.teamId,
      relayUrl: input.relayUrl,
      acpCommand: input.acpCommand,
      agentCommand: input.agentCommand,
      harnessOverride: input.harnessOverride ?? false,
      agentArgs: input.agentArgs,
      mcpCommand: input.mcpCommand,
      turnTimeoutSeconds: input.turnTimeoutSeconds,
      idleTimeoutSeconds: input.idleTimeoutSeconds,
      maxTurnDurationSeconds: input.maxTurnDurationSeconds,
      parallelism: input.parallelism,
      systemPrompt: input.systemPrompt,
      avatarUrl: input.avatarUrl,
      model: input.model,
      provider: input.provider,
      envVars: input.envVars ?? {},
      spawnAfterCreate: input.spawnAfterCreate,
      startOnAppLaunch: input.startOnAppLaunch,
      backend: input.backend,
      respondTo: input.respondTo,
      respondToAllowlist: input.respondToAllowlist,
      relayMesh: input.relayMesh,
    },
  });
}
