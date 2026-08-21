import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  getResidentCapabilitySettings,
  revokeResidentCapabilityGrant,
  setHouseholdAccessLevel,
  setResidentAccessLevel,
} from "@/shared/api/residentCapabilities";
import type { ResidentAccessLevel } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

const queryKey = ["resident-capability-settings"] as const;

const levels: Array<{
  value: ResidentAccessLevel;
  label: string;
  description: string;
}> = [
  {
    value: "restricted",
    label: "Restricted",
    description:
      "Ask before reading files, running commands, or changing anything.",
  },
  {
    value: "standard",
    label: "Standard",
    description:
      "Inspect granted work freely and ask when new authority is needed.",
  },
  {
    value: "full",
    label: "Full Access",
    description:
      "Run routine work without prompts; high-impact actions still ask.",
  },
];

function useCapabilitySettings() {
  return useQuery({ queryKey, queryFn: getResidentCapabilitySettings });
}

function AccessLevelPicker({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
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
            disabled={disabled}
            name="resident-access-level"
            onChange={() => onChange(level.value)}
            type="radio"
            value={level.value}
          />
          <span className="block text-sm font-medium">{level.label}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {level.description}
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
          value={effective}
        />
      </section>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Remembered permissions</p>
        </div>
        {grants.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Nothing has been permanently allowed yet. “Always allow” permissions
            appear here.
          </p>
        ) : (
          <div className="divide-y divide-border/50 rounded-xl border border-border/60">
            {grants.map((grant) => (
              <div
                className="flex items-center justify-between gap-3 p-3"
                key={grant.grantId}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {grant.resource.displayName}
                  </p>
                  <p className="mt-1 font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground">
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
