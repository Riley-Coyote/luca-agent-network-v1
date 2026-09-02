import { invokeTauri } from "@/shared/api/tauri";

type JsonRecord = Record<string, unknown>;

export type CapabilitySkillSummary = {
  skillId: string;
  name: string;
  description: string;
  sourceLabels: string[];
  runtimeIds: string[];
};

export type CapabilitySkillDetail = CapabilitySkillSummary & {
  content: string;
};

export type ResidentSessionCommand = {
  canonicalName: string;
  description: string;
  inputHint?: string;
};

export type ResidentSessionCapability = {
  protocol: "luca.resident-session-capability.v1";
  residentPubkey: string;
  runtimeFamily: string;
  runtimeVersion?: string;
  adapterVersion?: string;
  sessionId?: string;
  sessionEpoch: number;
  observedAt: string;
  commands: ResidentSessionCommand[];
};

export type CapabilitySkillActivation = {
  skillId: string;
  residentPubkey: string;
  runtimeFamily: string | null;
  canonicalName: string | null;
  catalogGeneration: string;
  status: "ready" | "checking" | "unavailable";
  reason: string | null;
};

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function normalizeSkill(value: unknown): CapabilitySkillSummary {
  const raw = record(value);
  return {
    skillId: stringValue(raw.skillId ?? raw.skill_id),
    name: stringValue(raw.name, "Untitled skill"),
    description: stringValue(raw.description, "Installed skill"),
    sourceLabels: stringList(raw.sourceLabels ?? raw.source_labels),
    runtimeIds: stringList(raw.runtimeIds ?? raw.runtime_ids),
  };
}

export async function listCapabilitySkills(): Promise<
  CapabilitySkillSummary[]
> {
  const value = await invokeTauri<unknown>("list_capability_skills");
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSkill).filter((skill) => skill.skillId.length > 0);
}

export async function readCapabilitySkill(
  skillId: string,
): Promise<CapabilitySkillDetail> {
  const value = await invokeTauri<unknown>("read_capability_skill", {
    skillId,
  });
  const raw = record(value);
  return {
    ...normalizeSkill(raw),
    content: stringValue(raw.content),
  };
}

export function getResidentSessionCapabilities(
  residentPubkey: string,
): Promise<ResidentSessionCapability | null> {
  return invokeTauri("get_resident_session_capabilities", { residentPubkey });
}

export function resolveCapabilitySkillActivation(
  skillId: string,
  residentPubkey: string,
): Promise<CapabilitySkillActivation> {
  return invokeTauri("resolve_capability_skill_activation", {
    skillId,
    residentPubkey,
  });
}
