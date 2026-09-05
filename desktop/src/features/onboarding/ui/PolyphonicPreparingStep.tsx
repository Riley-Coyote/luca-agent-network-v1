import * as React from "react";
import { LoaderCircle } from "lucide-react";

import {
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
import { getManagedAgentLog } from "@/shared/api/tauri";
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
  return `Hey ${displayName.trim()} — I’m Luca. Tell me what you’re working on, or choose a place to begin.`;
}

export function PolyphonicPreparingStep({
  displayName,
  onComplete,
  showMark = true,
}: {
  displayName: string;
  onComplete: (channelId: string) => void;
  /** Hide the inline brand mark when the frame already shows the mark. */
  showMark?: boolean;
}) {
  const managed = useManagedAgentsQuery();
  const personas = usePersonasQuery();
  const runtimes = useAcpRuntimesQuery({ enabled: true });
  const runtimesRef = React.useRef(runtimes);
  runtimesRef.current = runtimes;
  const settings = useOperatorForgeSettingsQuery();
  const [attempt, setAttempt] = React.useState(0);
  const preparationRef = React.useRef<Promise<string> | null>(null);
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

      let lucaPubkey = (managed.data ?? []).find(
        (resident) => resident.personaId === LUCA_PERSONA_ID,
      )?.pubkey;

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
        // The greeting is durable already; the conversation stages its
        // arrival once so the owner sees Luca about to speak, then speak.
        markLucaArrival(channel.id);
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
    setWorking(true);
    setError(null);
    void preparationRef.current
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
    settings.data,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col items-start" role="status">
      {showMark ? <PolyphonicBrandMark /> : null}
      <h1
        id="polyphonic-preparing-heading"
        className="mt-5 text-[length:var(--prototype-heading-size)] font-medium leading-[1.15] tracking-[-0.018em] text-[var(--prototype-ink)]"
      >
        Getting Luca ready…
      </h1>
      <p className="mt-2 text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-muted-strong)]">
        Preparing your resident and opening your conversation.
      </p>
      {working && !visibleError ? (
        <LoaderCircle className="mt-6 h-4 w-4 animate-spin text-[var(--prototype-muted)] motion-reduce:animate-none" />
      ) : null}
      {visibleError ? (
        <div className="mt-6 flex flex-col items-start gap-4" role="alert">
          <p className="break-words text-sm text-destructive">{visibleError}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={
                settings.isFetching || personas.isFetching || managed.isFetching
              }
              onClick={() => {
                void Promise.all([
                  settings.refetch(),
                  personas.refetch(),
                  managed.refetch(),
                ]).then(() => {
                  preparationRef.current = null;
                  setAttempt((value) => value + 1);
                });
              }}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
