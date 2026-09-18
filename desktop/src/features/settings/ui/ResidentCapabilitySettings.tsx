import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  getResidentCapabilitySettings,
  getResidentRuntimeTier,
  revokePermissionRule,
  revokeResidentCapabilityGrant,
  setHouseholdAccessLevel,
  setResidentAccessLevel,
} from "@/shared/api/residentCapabilities";
import { listConnectedBrainSources } from "@/shared/api/tauriBrain";
import type { PermissionRule, ResidentAccessLevel } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

const queryKey = ["resident-capability-settings"] as const;
const projectNamesQueryKey = ["connected-brain-source-names"] as const;

const levels: Array<{
  value: ResidentAccessLevel;
  label: string;
  description: string;
}> = [
  {
    value: "restricted",
    label: "Manual",
    description:
      "Reads without asking. Requests approval for changes and additional access.",
  },
  {
    value: "standard",
    label: "Accept edits",
    description:
      "Works inside a project without asking. Extra access asks; supported permission requests can be remembered.",
  },
  {
    value: "full",
    label: "Full access",
    description:
      "Runs on its own. The doors — messaging, the shell tool, proposals, deletions — still ask.",
  },
];

const runtimeFamilyNames: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

function runtimeFamilyName(family: string): string {
  return (
    runtimeFamilyNames[family] ??
    family
      .split(/[_-]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** What the level actually reaches in this resident's runtime, in plain words. */
function runtimeTierNote(
  control: "native_mode" | "native_policy" | "advisory",
  family: string,
): string {
  switch (control) {
    case "native_mode":
      return "Claude Code runs at this level.";
    case "native_policy":
      return "Codex supports Accept edits and Full access. Manual is unavailable because this connection cannot enforce a read-only workspace; it will not silently run at a higher level.";
    default:
      return `${runtimeFamilyName(family)} doesn’t take a level from Polyphonic. It keeps its own settings; the remembered permissions below still apply.`;
  }
}

function useCapabilitySettings() {
  return useQuery({ queryKey, queryFn: getResidentCapabilitySettings });
}

/** Source id → the project's own name, so a rule row can say where it applies. */
function useProjectName() {
  const sources = useQuery({
    queryKey: projectNamesQueryKey,
    queryFn: listConnectedBrainSources,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });
  return (sourceId: string): string | null =>
    sources.data?.sources.find((source) => source.sourceId === sourceId)
      ?.displayName ?? null;
}

function ruleScopeLabel(
  rule: PermissionRule,
  projectName: (sourceId: string) => string | null,
): string {
  if (rule.scope.scope === "everywhere") return "Everywhere";
  return `Always in ${projectName(rule.scope.sourceId) ?? "this project"}`;
}

export function AccessLevelPicker({
  disabled,
  onChange,
  value,
  restrictedUnavailable = false,
}: {
  disabled: boolean;
  restrictedUnavailable?: boolean;
  onChange: (value: ResidentAccessLevel) => void;
  value: ResidentAccessLevel;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3">
      <legend className="sr-only">Resident access level</legend>
      {levels.map((level) => (
        <label
          className={
            value === level.value
              ? "cursor-pointer rounded-xl border border-foreground/30 bg-foreground/6 p-3 text-left ring-1 ring-foreground/10 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              : "cursor-pointer rounded-xl border border-border/60 bg-card/25 p-3 text-left transition-colors hover:bg-muted/35 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
          }
          key={level.value}
        >
          <input
            checked={value === level.value}
            className="sr-only"
            disabled={
              disabled ||
              (restrictedUnavailable && level.value === "restricted")
            }
            name="resident-access-level"
            onChange={() => onChange(level.value)}
            type="radio"
            value={level.value}
          />
          <span className="block text-sm font-medium">{level.label}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {restrictedUnavailable && level.value === "restricted"
              ? "Unavailable with this Codex connection."
              : level.description}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function HouseholdAccessLevelControl() {
  const settings = useCapabilitySettings();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: setHouseholdAccessLevel,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Capability settings could not be saved.",
      ),
  });

  if (settings.isError) {
    return (
      <section className="space-y-3" role="alert">
        <p className="text-sm text-destructive">
          Resident access policy is unavailable. No access setting was changed.
        </p>
        <Button
          disabled={settings.isFetching}
          onClick={() => void settings.refetch()}
          size="sm"
          variant="outline"
        >
          {settings.isFetching ? "Retrying…" : "Retry"}
        </Button>
      </section>
    );
  }

  if (!settings.data) {
    return (
      <p className="text-sm text-muted-foreground">Loading access policy…</p>
    );
  }

  return (
    <section className="space-y-3" data-testid="household-access-level">
      <div>
        <p className="text-sm font-medium">Default resident access</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          New residents inherit this level. Per-resident choices take priority.
          Codex residents cannot start with Manual on the current connection.
        </p>
      </div>
      <AccessLevelPicker
        disabled={mutation.isPending}
        onChange={(level) => mutation.mutate(level)}
        value={settings.data.householdDefault}
      />
    </section>
  );
}

export function ResidentAccessControl({
  residentPubkey,
}: {
  residentPubkey: string;
}) {
  const settings = useCapabilitySettings();
  const projectName = useProjectName();
  const tier = useQuery({
    queryKey: ["resident-runtime-tier", residentPubkey] as const,
    queryFn: () => getResidentRuntimeTier(residentPubkey),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const queryClient = useQueryClient();
  const setLevel = useMutation({
    mutationFn: (level: ResidentAccessLevel | null) =>
      setResidentAccessLevel(residentPubkey, level),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });
  const revoke = useMutation({
    mutationFn: revokeResidentCapabilityGrant,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });
  const forget = useMutation({
    mutationFn: revokePermissionRule,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  });

  if (settings.isError) {
    return (
      <section className="space-y-3" role="alert">
        <p className="text-sm text-destructive">
          This resident’s access policy is unavailable. Luca will continue to
          fail closed.
        </p>
        <Button
          disabled={settings.isFetching}
          onClick={() => void settings.refetch()}
          size="sm"
          variant="outline"
        >
          {settings.isFetching ? "Retrying…" : "Retry"}
        </Button>
      </section>
    );
  }

  if (!settings.data) {
    return (
      <p className="text-sm text-muted-foreground">Loading access policy…</p>
    );
  }

  const explicit = settings.data.residentAccess[residentPubkey];
  const effective = explicit ?? settings.data.householdDefault;
  const grants = settings.data.grants.filter(
    (grant) => grant.residentPubkey === residentPubkey,
  );
  const rules = settings.data.rules.filter(
    (rule) => rule.residentPubkey === residentPubkey && !rule.revokedAt,
  );

  return (
    <div className="space-y-5" data-testid="resident-access-control">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Machine access</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {explicit
                ? "Custom for this resident."
                : "Using the household default."}
            </p>
          </div>
          {explicit ? (
            <Button
              disabled={setLevel.isPending}
              onClick={() => setLevel.mutate(null)}
              size="sm"
              variant="ghost"
            >
              Use household default
            </Button>
          ) : null}
        </div>
        <AccessLevelPicker
          disabled={setLevel.isPending}
          onChange={(level) => setLevel.mutate(level)}
          restrictedUnavailable={tier.data?.family === "codex"}
          value={effective}
        />
        <p
          className="text-xs leading-5 text-muted-foreground"
          data-testid="resident-runtime-tier-note"
        >
          {tier.data
            ? `${runtimeTierNote(tier.data.control, tier.data.family)} `
            : null}
          Changes apply the next time this resident starts.
        </p>
      </section>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Remembered permissions</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Polyphonic remembers these so it doesn’t ask you again. Forget one and
          it will ask next time.
        </p>
        {rules.length === 0 && grants.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Nothing remembered yet. “Always here” on a permission card puts it
            here.
          </p>
        ) : (
          <div className="divide-y divide-border/50 rounded-xl border border-border/60">
            {rules.map((rule) => (
              <div
                className="flex items-center justify-between gap-3 p-3"
                data-testid={`remembered-permission-rule-${rule.ruleId}`}
                key={rule.ruleId}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{rule.displayName}</p>
                  {/* A project carries its own name; this line is not a label. */}
                  <p className="mt-0.5 truncate text-xs leading-5 text-ink-faint">
                    {ruleScopeLabel(rule, projectName)}
                    {rule.useCount > 0 ? ` · used ${rule.useCount}×` : ""}
                  </p>
                </div>
                <Button
                  aria-label={`Forget ${rule.displayName}`}
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(rule.ruleId)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {grants.map((grant) => (
              <div
                className="flex items-center justify-between gap-3 p-3"
                key={grant.grantId}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {grant.resource.displayName}
                  </p>
                  <p className="mt-1 text-2xs uppercase tracking-caps-wide text-ink-faint">
                    {grant.capability.replaceAll("_", " ")}
                  </p>
                </div>
                <Button
                  aria-label={`Revoke ${grant.resource.displayName}`}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(grant.grantId)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
