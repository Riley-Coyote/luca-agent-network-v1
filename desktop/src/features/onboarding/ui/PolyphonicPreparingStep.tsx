import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  managedAgentsQueryKey,
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import { useOperatorForgeSettingsQuery } from "@/features/agents/operatorForgeQueries";
import { LUCA_GREETING_MARKER } from "@/features/luca/canonicalLucaResident";
import { markLucaArrival } from "@/features/luca/lucaArrival";
import { createLucaResident } from "@/features/luca/residents/api";
import { lucaResidentsQueryKey } from "@/features/luca/residents/hooks";
import {
  getManagedAgentLog,
  listManagedAgents,
  updateManagedAgent,
} from "@/shared/api/tauri";
import {
  startManagedAgent,
  stopManagedAgent,
} from "@/shared/api/tauriManagedAgents";
import { openDm } from "@/shared/api/tauriChannels";
import { hasManagedAgentChannelMessageMarker } from "@/shared/api/tauriManagedAgentMessageMarkers";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  type NativeProvisioningRequestV1,
} from "@/shared/api/tauriOperatorForge";
import { setPersonaActive } from "@/shared/api/tauriPersonas";
import { Button } from "@/shared/ui/button";
import { PolyphonicBrandMark } from "./PolyphonicThresholdField";

const LUCA_PERSONA_ID = "builtin:fizz";
const GREETING_MARKER = LUCA_GREETING_MARKER;
const LUCA_READY_TIMEOUT_MS = 30_000;

async function waitForLucaChannelSubscription(
  pubkey: string,
  channelId: string,
) {
  const readyMarker = `subscribed to channel ${channelId}`;
  const deadline = Date.now() + LUCA_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const log = await getManagedAgentLog(pubkey, 160);
    if (log.content.includes(readyMarker)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error(
    "Luca started but did not finish connecting to this conversation. Retry setup to reconnect.",
  );
}

/** A brief introduction that leaves room for the conversation to begin. */
export function lucaGreeting(displayName: string): string {
  return `Hi ${displayName.trim() || "there"}. I’m Luca. We can start with something you’re working on, or bring in your existing work so I have some context.`;
}

export function PolyphonicPreparingStep({
  displayName,
  onComplete,
  onBack,
  showMark = true,
}: {
  displayName: string;
  onComplete: (channelId: string) => void;
  onBack?: () => void;
  /** Hide the inline brand mark when the frame already shows the mark. */
  showMark?: boolean;
}) {
  const queryClient = useQueryClient();
  const managed = useManagedAgentsQuery();
  const personas = usePersonasQuery();
  const runtimes = useAcpRuntimesQuery({ enabled: true });
  const runtimesRef = React.useRef(runtimes);
  runtimesRef.current = runtimes;
  const settings = useOperatorForgeSettingsQuery();
  const [attempt, setAttempt] = React.useState(0);
  const preparationRef = React.useRef<Promise<string> | null>(null);
  const preparedChannelRef = React.useRef<string | null>(null);
  const handoffRef = React.useRef<Promise<string> | null>(null);
  const refetchManaged = managed.refetch;
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(true);
  const visibleError =
    error ??
    settings.error?.message ??
    personas.error?.message ??
    managed.error?.message;

  React.useEffect(() => {
    void attempt;
    let cancelled = false;
    if (!settings.data || !personas.data || managed.isPending) return;
    const currentSettings = settings.data;
    const currentPersonas = personas.data;
    async function prepare(): Promise<string> {
      const target = currentSettings.preferences.defaultRuntimeTarget;
      if (!currentSettings.preferences.runtimeConfirmed || !target) {
        throw new Error("Choose a ready runtime before continuing.");
      }
      const persona = currentPersonas.find(
        (candidate) => candidate.id === LUCA_PERSONA_ID,
      );
      if (!persona)
        throw new Error("Luca's built-in definition is unavailable.");
      if (!persona.isActive) {
        await setPersonaActive(LUCA_PERSONA_ID, true);
      }

      const existingLuca = (managed.data ?? []).find(
        (resident) => resident.personaId === LUCA_PERSONA_ID,
      );
      let lucaPubkey = existingLuca?.pubkey;
      if (existingLuca && target.kind === "managed") {
        if (existingLuca.nativeRuntimeBinding) {
          throw new Error(
            "Luca is already connected to a native runtime. Return to that runtime to finish setup.",
          );
        }
        const available = await availableRuntimesForStart(runtimesRef.current);
        const runtime = available.find(
          (candidate) => candidate.id === target.runtimeId,
        );
        if (!runtime)
          throw new Error("The selected runtime is no longer ready.");
        const changedRuntime = existingLuca.agentCommand !== runtime.command;
        if (changedRuntime) {
          if (existingLuca.status === "running")
            await stopManagedAgent(existingLuca.pubkey);
          await updateManagedAgent({
            pubkey: existingLuca.pubkey,
            agentCommand: runtime.command,
            harnessOverride: true,
            agentArgs: runtime.defaultArgs,
            mcpCommand: runtime.mcpCommand ?? "",
            model: null,
            provider: null,
          });
        }
        if (changedRuntime || existingLuca.status !== "running") {
          await startManagedAgent(existingLuca.pubkey);
        }
      } else if (existingLuca && !existingLuca.nativeRuntimeBinding) {
        throw new Error(
          "Luca has already been created with a managed runtime. Choose that runtime to finish setup; you can change it from Luca’s settings afterward.",
        );
      }

      if (!lucaPubkey && target.kind === "managed") {
        const available = await availableRuntimesForStart(runtimesRef.current);
        const runtime = available.find(
          (candidate) => candidate.id === target.runtimeId,
        );
        if (!runtime)
          throw new Error("The selected runtime is no longer ready.");
        const baseInput = await buildInstanceInputForDefinition(
          persona,
          runtime,
        );
        // Luca wakes with the app: the first message of a session should
        // never wait on a cold start. Every other resident wakes on send.
        const created = await createLucaResident({
          ...baseInput,
          spawnAfterCreate: true,
          startOnAppLaunch: true,
        });
        if (created.profileSyncError) throw new Error(created.profileSyncError);
        if (created.spawnError) throw new Error(created.spawnError);
        lucaPubkey = created.resident.residentPubkey;
      }

      if (!lucaPubkey && target.kind === "native") {
        const request: NativeProvisioningRequestV1 = {
          displayName: "Luca",
          systemPrompt: persona.systemPrompt,
          runtime: target.runtime,
          mode: "fresh",
          selectedSkills: [],
          includeMemory: false,
          workspaceDocuments: [],
        };
        const preview = await previewNativeAgentProvisioning(request);
        const receipt = await executeNativeAgentProvisioning(
          preview.transactionId,
          LUCA_PERSONA_ID,
          request,
        );
        lucaPubkey = receipt.residentPubkey ?? undefined;
      }

      if (!lucaPubkey)
        throw new Error("Luca could not be created on this Mac.");
      const channel = await openDm({ pubkeys: [lucaPubkey] });
      const alreadySent = await hasManagedAgentChannelMessageMarker({
        channelId: channel.id,
        marker: GREETING_MARKER,
        markerScope: "channel",
      });
      if (!alreadySent) {
        await sendManagedAgentChannelMessage({
          agentPubkey: lucaPubkey,
          channelId: channel.id,
          content: lucaGreeting(displayName),
          marker: GREETING_MARKER,
          markerScope: "channel",
        });
      }
      if (target.kind === "managed") {
        await waitForLucaChannelSubscription(lucaPubkey, channel.id);
      }
      return channel.id;
    }
    // Query refreshes can arrive while native startup is in flight. Reuse the
    // same preparation, then attach the current completion callback to it.
    // Cancelling a React effect must never start a second resident transaction.
    preparationRef.current ??= prepare();
    handoffRef.current ??= preparationRef.current.then(async (channelId) => {
      preparedChannelRef.current = channelId;
      // Setup runs before the app's agents-data-changed listener is mounted.
      // Publish the real resident list before enabling the first send: an
      // empty cached audience would save the message without waking Luca.
      queryClient.setQueryData(
        managedAgentsQueryKey,
        await listManagedAgents(),
      );
      await queryClient.invalidateQueries({ queryKey: lucaResidentsQueryKey });
      markLucaArrival(channelId);
      return channelId;
    });
    setWorking(true);
    setError(null);
    void handoffRef.current
      .then((channelId) => {
        if (!cancelled) onComplete(channelId);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setWorking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    displayName,
    managed.data,
    managed.isPending,
    onComplete,
    personas.data,
    queryClient,
    settings.data,
  ]);

  return (
    <div
      className="flex w-full max-w-lg flex-col items-center text-center"
      role="status"
    >
      {showMark ? <PolyphonicBrandMark /> : null}
      <h1
        id="polyphonic-preparing-heading"
        className="mt-5 text-2xl font-medium tracking-tight text-foreground"
      >
        Connecting you with Luca…
      </h1>
      <p className="mt-3 text-base leading-relaxed text-ink-muted">
        Just a moment. You can set up everything else together in chat.
      </p>
      {working && !visibleError ? (
        <LoaderCircle className="mt-6 h-4 w-4 animate-spin text-ink-muted motion-reduce:animate-none" />
      ) : null}
      {visibleError ? (
        <div className="mt-6 flex flex-col items-center gap-4" role="alert">
          <p className="break-words text-sm text-destructive">{visibleError}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={
                settings.isFetching || personas.isFetching || managed.isFetching
              }
              onClick={() => {
                if (preparedChannelRef.current) {
                  // Preparation already succeeded. Retry only the failed
                  // refresh/handoff, preserving the resident, DM and greeting.
                  handoffRef.current = null;
                  setAttempt((value) => value + 1);
                  return;
                }
                void Promise.all([
                  settings.refetch({ throwOnError: true }),
                  personas.refetch({ throwOnError: true }),
                  refetchManaged({ throwOnError: true }),
                ])
                  .then(() => {
                    preparationRef.current = null;
                    handoffRef.current = null;
                    setAttempt((value) => value + 1);
                  })
                  .catch((cause) => {
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                    setWorking(false);
                  });
              }}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
            {onBack ? (
              <Button onClick={onBack} type="button" variant="ghost">
                Choose another runtime
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
