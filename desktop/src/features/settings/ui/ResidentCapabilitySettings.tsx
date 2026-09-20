import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";

const queryKey = ["resident-capability-settings"] as const;
const projectNamesQueryKey = ["connected-brain-source-names"] as const;

/**
 * Beta.13 retires the three-rung picker (Manual/Accept edits/Full access)
 * for two plain modes. A resident still stored at "restricted" (legacy
 * Manual) is migrated to "standard" the next time it starts — see
 * `permission_tier::migrate_unsupported_level` — so it is displayed here as
 * "Work in my project" in the meantime rather than as a third, unselectable
 * option.
 */
const levels: Array<{
  value: "standard" | "full";
  label: string;
  description: string;
  /** The same choice said in one breath, for the composer menu, where a
   * paragraph would turn a two-item menu into a wall of text. */
  menuDescription: string;
}> = [
  {
    value: "standard",
    label: "Work in my project",
    description:
      "Works inside a project without asking. Extra access, and doors like messaging or the shell tool, still ask — Always makes a door stop asking, once you say so.",
    menuDescription: "Asks before reaching outside it",
  },
  {
    value: "full",
    label: "Don't ask me",
    description:
      "Runs on its own, doors included — messaging, deleting, the shell tool. Every one of those is still written to the Activity trail.",
    menuDescription: "Never asks; everything is still logged",
  },
];

/** A resident still on the retired "restricted" (Manual) rung reads here as
 * the level it will actually run at — see the `levels` doc comment above. */
function displayLevel(level: ResidentAccessLevel): "standard" | "full" {
  return level === "full" ? "full" : "standard";
}

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

/**
 * What the level actually reaches in this resident's runtime, in plain
 * words — including whether a change here needs this resident to restart.
 */
function runtimeTierNote(
  control: "native_mode" | "native_policy" | "advisory",
  family: string,
): string {
  switch (control) {
    case "native_mode":
      return "Claude Code applies this right away — no restart needed.";
    case "native_policy":
      return "Codex supports Work in my project and Don't ask me. It takes a change here the next time this resident starts.";
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

/**
 * Two modes, everywhere this control appears — the composer picker and
 * Settings share this exact component, so the words never drift between
 * them (beta.13 P1). Turning "Don't ask me" ON asks for one confirmation
 * first, naming what it covers (beta.13 P4); turning it off, or choosing
 * "Work in my project", needs no confirmation.
 */
export function AccessLevelPicker({
  disabled,
  onChange,
  value,
  subjectLabel = "This resident",
  variant = "cards",
}: {
  disabled: boolean;
  onChange: (value: ResidentAccessLevel) => void;
  value: ResidentAccessLevel;
  /** Who the confirmation names, e.g. a resident's display name, or "New
   * residents" for the household default. Defaults to a neutral phrase. */
  subjectLabel?: string;
  /** `cards` is the Settings surface, where the two modes have room to sit
   * side by side. `menu` is the composer popover, where the same two modes
   * read as ordinary menu rows — a title, a line of explanation, a tick on
   * the one in force — because two cards floating over a conversation look
   * like a dialog that wandered in. */
  variant?: "cards" | "menu";
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const displayed = displayLevel(value);
  const choose = (level: ResidentAccessLevel) => {
    if (level === "full" && displayed !== "full") {
      setConfirmOpen(true);
      return;
    }
    onChange(level);
  };

  if (variant === "menu") {
    return (
      <>
        <fieldset className="grid gap-0.5">
          <legend className="sr-only">Resident access level</legend>
          {levels.map((level) => (
            <label
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              key={level.value}
            >
              <input
                checked={displayed === level.value}
                className="sr-only"
                disabled={disabled}
                name="resident-access-level-menu"
                onChange={() => choose(level.value)}
                type="radio"
                value={level.value}
              />
              <Check
                aria-hidden="true"
                className={
                  displayed === level.value
                    ? "mt-0.5 size-3 shrink-0 opacity-90"
                    : "mt-0.5 size-3 shrink-0 opacity-0"
                }
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-5">
                  {level.label}
                </span>
                <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">
                  {level.menuDescription}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Turn on &quot;Don&apos;t ask me&quot;?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {subjectLabel} will act without asking — including messaging
                people on your behalf, deleting, and the shell tool. Every one
                of those is still written to the Activity trail, and you can
                turn this off again anytime.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  onChange("full");
                }}
              >
                Turn on
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Resident access level</legend>
        {levels.map((level) => (
          <label
            className={
              displayed === level.value
                ? "cursor-pointer rounded-xl border border-foreground/30 bg-foreground/6 p-3 text-left ring-1 ring-foreground/10 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                : "cursor-pointer rounded-xl border border-border/60 bg-card/25 p-3 text-left transition-colors hover:bg-muted/35 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            }
            key={level.value}
          >
            <input
              checked={displayed === level.value}
              className="sr-only"
              disabled={disabled}
              name="resident-access-level"
              onChange={() => {
                if (level.value === "full" && displayed !== "full") {
                  setConfirmOpen(true);
                  return;
                }
                onChange(level.value);
              }}
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
      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on &quot;Don&apos;t ask me&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {subjectLabel} will act without asking — including messaging
              people on your behalf, deleting, and the shell tool. Every one
              of those is still written to the Activity trail, and you can
              turn this off again anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onChange("full");
              }}
            >
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
          New residents inherit this level. Per-resident choices take
          priority.
        </p>
      </div>
      <AccessLevelPicker
        disabled={mutation.isPending}
        onChange={(level) => mutation.mutate(level)}
        subjectLabel="New residents, by default,"
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
          value={effective}
        />
        <p
          className="text-xs leading-5 text-muted-foreground"
          data-testid="resident-runtime-tier-note"
        >
          {tier.data ? runtimeTierNote(tier.data.control, tier.data.family) : null}
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
            Nothing remembered yet. “Always” on a permission card puts it
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
