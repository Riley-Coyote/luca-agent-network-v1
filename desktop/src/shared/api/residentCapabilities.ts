import { invokeTauri } from "@/shared/api/tauri";
import type {
  ResidentAccessLevel,
  ResidentCapabilitySettings,
} from "@/shared/api/types";

export function getResidentCapabilitySettings(): Promise<ResidentCapabilitySettings> {
  return invokeTauri("get_resident_capability_settings");
}

export function setHouseholdAccessLevel(
  level: ResidentAccessLevel,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri("set_household_access_level", { level });
}

export function setResidentAccessLevel(
  residentPubkey: string,
  level: ResidentAccessLevel | null,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri("set_resident_access_level", {
    residentPubkey,
    level,
  });
}

export function revokeResidentCapabilityGrant(
  grantId: string,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri("revoke_resident_capability_grant", { grantId });
}

export function setPolyphonicOnboardingStatus(
  chapter: "welcome" | "runtime" | "agents" | "preparing" | "complete",
  completed: boolean,
) {
  return invokeTauri("set_polyphonic_onboarding_status", {
    chapter,
    completed,
  });
}
