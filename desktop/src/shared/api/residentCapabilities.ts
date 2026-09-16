import { invokeTauri } from "@/shared/api/tauri";
import type {
  DurableCapabilityGrant,
  PermissionEffect,
  PermissionMatcher,
  PermissionRule,
  PermissionRuleScope,
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

type RawPermissionRuleScope =
  | { scope: "project"; source_id: string }
  | { scope: "everywhere" };

type RawPermissionMatcher =
  | { kind: "command"; token: string; argv_prefix?: string[] | null }
  | { kind: "path"; write: boolean }
  | { kind: "mcp_tool"; server_family: string; tool: string }
  | { kind: "domain"; host: string };

type RawPermissionRule = {
  protocol: "luca.permission.rule.v1";
  rule_id: string;
  resident_pubkey: string;
  scope: RawPermissionRuleScope;
  matcher: RawPermissionMatcher;
  effect: PermissionEffect;
  display_name: string;
  created_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  use_count?: number | null;
};

type RawResidentCapabilitySettings = Omit<
  ResidentCapabilitySettings,
  "grants" | "rules"
> & {
  grants: RawDurableCapabilityGrant[];
  rules?: RawPermissionRule[] | null;
};

function normalizeScope(scope: RawPermissionRuleScope): PermissionRuleScope {
  if (scope.scope === "project") {
    return { scope: "project", sourceId: scope.source_id };
  }
  return { scope: "everywhere" };
}

function normalizeMatcher(matcher: RawPermissionMatcher): PermissionMatcher {
  switch (matcher.kind) {
    case "command":
      return {
        kind: "command",
        token: matcher.token,
        argvPrefix: matcher.argv_prefix ?? [],
      };
    case "path":
      return { kind: "path", write: matcher.write };
    case "mcp_tool":
      return {
        kind: "mcp_tool",
        serverFamily: matcher.server_family,
        tool: matcher.tool,
      };
    default:
      return { kind: "domain", host: matcher.host };
  }
}

function normalizeRule(rule: RawPermissionRule): PermissionRule {
  return {
    protocol: rule.protocol,
    ruleId: rule.rule_id,
    residentPubkey: rule.resident_pubkey,
    scope: normalizeScope(rule.scope),
    matcher: normalizeMatcher(rule.matcher),
    effect: rule.effect,
    displayName: rule.display_name,
    createdAt: rule.created_at,
    revokedAt: rule.revoked_at ?? null,
    lastUsedAt: rule.last_used_at ?? null,
    useCount: rule.use_count ?? 0,
  };
}

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
    rules: (settings.rules ?? []).map(normalizeRule),
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

export function revokePermissionRule(
  ruleId: string,
): Promise<ResidentCapabilitySettings> {
  return invokeTauri<RawResidentCapabilitySettings>("revoke_permission_rule", {
    ruleId,
  }).then(normalizeResidentCapabilitySettings);
}

/**
 * How far the app's access level actually reaches into this resident's runtime.
 * `native_mode` and `native_policy` mean Polyphonic sets the runtime itself;
 * `advisory` means the runtime keeps its own settings and only the remembered
 * permissions below apply.
 */
export type ResidentRuntimeTier = {
  family: string;
  control: "native_mode" | "native_policy" | "advisory";
  level: ResidentAccessLevel;
};

export function getResidentRuntimeTier(
  residentPubkey: string,
): Promise<ResidentRuntimeTier> {
  return invokeTauri<ResidentRuntimeTier>("get_resident_runtime_tier", {
    residentPubkey,
  });
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
