import * as React from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  useNativeProvisioningActivityQuery,
  useOperatorForgeSettingsQuery,
  useSaveOperatorForgePreferencesMutation,
} from "@/features/agents/operatorForgeQueries";
import { AgentRuntimeTargetSelector } from "@/features/agents/ui/AgentRuntimeTargetSelector";
import { NativeAgentProvisioningDialog } from "@/features/agents/ui/NativeAgentProvisioningDialog";
import { createLucaResident } from "@/features/luca/residents/api";
import {
  chooseHermesRuntimeSelection,
  clearHermesRuntimeSelection,
  getHermesRuntimeSelection,
  type AgentRuntimeTargetV1,
} from "@/shared/api/tauriOperatorForge";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { HouseholdAccessLevelControl } from "./ResidentCapabilitySettings";

const LUCA_PERSONA_ID = "builtin:fizz";

export function OperatorForgeSettingsCard() {
  const settings = useOperatorForgeSettingsQuery();
  const save = useSaveOperatorForgePreferencesMutation();
  const activity = useNativeProvisioningActivityQuery();
  const agents = useManagedAgentsQuery();
  const personas = usePersonasQuery();
  const runtimes = useAcpRuntimesQuery({ enabled: true });
  const [target, setTarget] = React.useState<AgentRuntimeTargetV1 | null>(null);
  const [lucaEnabled, setLucaEnabled] = React.useState(true);
  const [nativeLucaOpen, setNativeLucaOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const savedTarget = settings.data?.preferences.defaultRuntimeTarget;
  const savedLucaEnabled = settings.data?.preferences.lucaEnabled;

  React.useEffect(() => {
    if (savedLucaEnabled === undefined) return;
    setTarget(savedTarget ?? null);
    setLucaEnabled(savedLucaEnabled);
  }, [savedTarget, savedLucaEnabled]);

  const existingLuca = (agents.data ?? []).find(
    (agent) => agent.personaId === LUCA_PERSONA_ID,
  );
  const lucaPersona = (personas.data ?? []).find(
    (persona) => persona.id === LUCA_PERSONA_ID,
  );

  async function persist(nextLucaEnabled = lucaEnabled) {
    setBusy(true);
    setError(null);
    try {
      await save.mutateAsync({
        defaultRuntimeTarget: target,
        runtimeConfirmed: target !== null,
        lucaEnabled: nextLucaEnabled,
      });
      setNotice("Operator settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function addLuca() {
    if (!target || !lucaPersona) {
      setError("Choose a ready runtime before adding Luca.");
      return;
    }
    if (target.kind === "native") {
      setNativeLucaOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const available = await availableRuntimesForStart(runtimes);
      const runtime = available.find((entry) => entry.id === target.runtimeId);
      if (!runtime) throw new Error("The selected runtime is no longer ready.");
      const input = await buildInstanceInputForDefinition(lucaPersona, runtime);
      await createLucaResident(input);
      setLucaEnabled(true);
      await persist(true);
      await agents.refetch();
      setNotice("Luca is ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="settings-operator-forge"
    >
      <SectionHeader
        description="Choose the runtime inherited by Luca and future agents. Every native creation is reviewed before it changes your machine."
        title="Luca and native agents"
      />
      {settings.data ? (
        <AgentRuntimeTargetSelector
          disabled={busy}
          onChange={setTarget}
          options={settings.data.runtimeOptions}
          value={target}
        />
      ) : (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Checking runtimes…
        </p>
      )}
      <HermesInstallationSettings
        onChanged={() => Promise.all([settings.refetch(), runtimes.refetch()])}
      />
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/30 p-4">
        <div>
          <p className="text-sm font-medium">Luca</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {existingLuca
              ? "Available as your conversational Polyphonic operator."
              : "Optional. Luca can organize the app and prepare agent proposals for review."}
          </p>
        </div>
        {existingLuca ? (
          <Switch
            aria-label="Use Luca as operator"
            checked={lucaEnabled}
            disabled={busy}
            onCheckedChange={(checked) => {
              setLucaEnabled(checked);
              void persist(checked);
            }}
          />
        ) : (
          <Button
            disabled={busy || !target}
            onClick={() => void addLuca()}
            size="sm"
          >
            Add Luca…
          </Button>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          disabled={busy || !settings.data}
          onClick={() => void persist()}
          size="sm"
        >
          Save default
        </Button>
      </div>
      <HouseholdAccessLevelControl />
      {notice ? (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <Check className="size-3.5" />
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          className="flex items-center gap-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="size-4" />
          {error}
        </p>
      ) : null}
      {(activity.data ?? []).length > 0 ? (
        <details className="rounded-xl border border-border/60 bg-card/20 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Provisioning activity
          </summary>
          <div className="mt-3 space-y-2">
            {(activity.data ?? []).slice(0, 8).map((entry) => (
              <div
                className="flex items-center justify-between gap-3 text-xs"
                key={entry.transactionId}
              >
                <span className="text-muted-foreground">
                  {entry.runtime === "hermes" ? "Hermes" : "OpenClaw"} ·{" "}
                  {entry.intendedSlug}
                </span>
                <span
                  className={
                    entry.status === "needs_attention"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {entry.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {nativeLucaOpen && target?.kind === "native" && lucaPersona ? (
        <NativeAgentProvisioningDialog
          initialName="Luca"
          initialPrompt={lucaPersona.systemPrompt}
          initialRuntime={target.runtime}
          onComplete={() => {
            setLucaEnabled(true);
            void persist(true);
            void agents.refetch();
            void activity.refetch();
          }}
          onOpenChange={setNativeLucaOpen}
          open
          personaId={LUCA_PERSONA_ID}
        />
      ) : null}
    </section>
  );
}

const hermesSelectionQueryKey = ["hermes-runtime-selection"] as const;

function HermesInstallationSettings({
  onChanged,
}: {
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const selection = useQuery({
    queryKey: hermesSelectionQueryKey,
    queryFn: getHermesRuntimeSelection,
  });
  const [busy, setBusy] = React.useState<"choose" | "clear" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function changeInstallation(action: "choose" | "clear") {
    if (busy) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const next = await (action === "choose"
        ? chooseHermesRuntimeSelection()
        : clearHermesRuntimeSelection());
      if (!next) return;
      queryClient.setQueryData(hermesSelectionQueryKey, next);
      await onChanged();
      setNotice(
        next.mode === "automatic"
          ? "Automatic Hermes discovery restored."
          : "Hermes installation selected.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="hermes-installation-title"
      className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-card/30 p-4"
      data-testid="settings-hermes-installation"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium" id="hermes-installation-title">
          Hermes installation
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Choose the Hermes program used for discovery and new agents. Existing
          residents keep their saved connections.
        </p>
      </div>
      {selection.data ? (
        <div className="min-w-0 space-y-1 text-xs">
          <p className="font-medium" data-testid="hermes-installation-status">
            {selection.data.status === "invalid"
              ? "Selected installation needs attention"
              : selection.data.mode === "selected"
                ? "Selected installation"
                : "Automatic discovery"}
          </p>
          {selection.data.executablePath ? (
            <p
              className="break-all font-mono text-muted-foreground"
              data-testid="hermes-installation-path"
            >
              {selection.data.executablePath}
            </p>
          ) : null}
          {selection.data.runtimeVersion ? (
            <p className="text-muted-foreground">
              {selection.data.runtimeVersion}
            </p>
          ) : null}
          {selection.data.message ? (
            <p
              className="break-words text-muted-foreground"
              role={selection.data.status === "invalid" ? "alert" : undefined}
            >
              {selection.data.message}
            </p>
          ) : null}
        </div>
      ) : selection.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive" role="alert">
            Hermes installation could not be checked. Try again before choosing
            another installation.
          </p>
          <Button
            disabled={selection.isFetching}
            onClick={() => void selection.refetch()}
            size="sm"
            variant="outline"
          >
            {selection.isFetching ? "Checking…" : "Try again"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" role="status">
          Checking Hermes installation…
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy !== null || !selection.data}
          onClick={() => void changeInstallation("choose")}
          size="sm"
          variant="outline"
        >
          {busy === "choose" ? "Choosing…" : "Choose Hermes…"}
        </Button>
        <Button
          disabled={busy !== null || selection.data?.mode !== "selected"}
          onClick={() => void changeInstallation("clear")}
          size="sm"
          variant="ghost"
        >
          {busy === "clear" ? "Restoring…" : "Use automatic discovery"}
        </Button>
      </div>
      {error ? (
        <p className="break-words text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
