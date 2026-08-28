import { useQuery } from "@tanstack/react-query";

import {
  listCapabilitySkills,
  readCapabilitySkill,
} from "@/shared/api/tauriCapabilities";

export const capabilitySkillsQueryKey = ["capability-skills"] as const;

export function useCapabilitySkills() {
  return useQuery({
    queryKey: capabilitySkillsQueryKey,
    queryFn: listCapabilitySkills,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useCapabilitySkillDetail(skillId: string | null) {
  return useQuery({
    queryKey: [...capabilitySkillsQueryKey, "detail", skillId],
    queryFn: () => readCapabilitySkill(skillId ?? ""),
    enabled: Boolean(skillId),
    retry: false,
    staleTime: 0,
  });
}
