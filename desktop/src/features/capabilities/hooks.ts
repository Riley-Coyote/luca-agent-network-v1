import { useQuery } from "@tanstack/react-query";

import {
  getResidentSessionCapabilities,
  listCapabilitySkills,
  readCapabilitySkill,
} from "@/shared/api/tauriCapabilities";

export const capabilitySkillsQueryKey = ["capability-skills"] as const;

export function useCapabilitySkills(enabled = true) {
  return useQuery({
    queryKey: capabilitySkillsQueryKey,
    queryFn: listCapabilitySkills,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useResidentSessionCapabilities(
  residentPubkey: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["resident-session-capabilities", residentPubkey],
    queryFn: () => getResidentSessionCapabilities(residentPubkey ?? ""),
    enabled: enabled && Boolean(residentPubkey),
    retry: false,
    refetchInterval: enabled ? 2_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 1_000,
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
