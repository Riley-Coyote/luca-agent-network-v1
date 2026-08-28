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
