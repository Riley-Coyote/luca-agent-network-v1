import { invokeTauri } from "@/shared/api/tauri";
import type {
  DurableCapabilityGrant,
  ResidentAccessLevel,
  ResidentCapabilitySettings,
} from "@/shared/api/types";

type RawDurableCapabilityGrant = {
  grant_id: string;
  resident_pubkey: string;
  capability: DurableCapabilityGrant["capability"];
  resource: {
    kind: string;
    resource_ref: string;
    display_name: string;
  };
  created_at: string;
  revoked_at?: string | null;
};

type RawResidentCapabilitySettings = Omit<
  ResidentCapabilitySettings,
  "grants"
> & {
  grants: RawDurableCapabilityGrant[];
};

export function normalizeResidentCapabilitySettings(
  settings: RawResidentCapabilitySettings,
): ResidentCapabilitySettings {
  return {
    householdDefault: settings.householdDefault,
    residentAccess: settings.residentAccess,
    grants: settings.grants.map((grant) => ({
      grantId: grant.grant_id,
      residentPubkey: grant.resident_pubkey,
      capability: grant.capability,
      resource: {
        kind: grant.resource.kind,
        resourceRef: grant.resource.resource_ref,
        displayName: grant.resource.display_name,
      },
      createdAt: grant.created_at,
      revokedAt: grant.revoked_at,
    })),
  };
}

export function getResidentCapabilitySettings(): Promise<ResidentCapabilitySettings> {
  return invokeTauri<RawResidentCapabilitySettings>(
    "get_resident_capability_settings",
  ).then(normalizeResidentCapabilitySettings);
}

export function setHouseholdAccessLevel(
  level: ResidentAccessLevel,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri<RawResidentCapabilitySettings>(
    "set_household_access_level",
    { level },
  ).then(normalizeResidentCapabilitySettings);
}

export function setResidentAccessLevel(
  residentPubkey: string,
  level: ResidentAccessLevel | null,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri<RawResidentCapabilitySettings>(
    "set_resident_access_level",
    {
      residentPubkey,
      level,
    },
  ).then(normalizeResidentCapabilitySettings);
}

export function revokeResidentCapabilityGrant(
  grantId: string,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri<RawResidentCapabilitySettings>(
    "revoke_resident_capability_grant",
    { grantId },
  ).then(normalizeResidentCapabilitySettings);
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
