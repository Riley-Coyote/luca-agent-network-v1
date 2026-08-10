import * as React from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";

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
import type { AgentRuntimeTargetV1 } from "@/shared/api/tauriOperatorForge";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { SectionHeader } from "@/shared/ui/PageHeader";

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

  React.useEffect(() => {
    if (!settings.data) return;
    setTarget(settings.data.preferences.defaultRuntimeTarget);
    setLucaEnabled(settings.data.preferences.lucaEnabled);
  }, [settings.data]);

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
