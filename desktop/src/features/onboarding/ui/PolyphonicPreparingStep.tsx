import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
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
import { markLucaArrival } from "@/features/luca/lucaArrival";
import { createLucaResident } from "@/features/luca/residents/api";
import { lucaResidentsQueryKey } from "@/features/luca/residents/hooks";
import {
  getManagedAgentLog,
  listManagedAgents,
  updateManagedAgent,
  beginLucaFirstMeeting,
} from "@/shared/api/tauri";
import {
  startManagedAgent,
  stopManagedAgent,
} from "@/shared/api/tauriManagedAgents";
import { openDm } from "@/shared/api/tauriChannels";
import {
  executeNativeAgentProvisioning,
  previewNativeAgentProvisioning,
  type NativeProvisioningRequestV1,
} from "@/shared/api/tauriOperatorForge";
import { setPersonaActive } from "@/shared/api/tauriPersonas";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

const LUCA_PERSONA_ID = "builtin:fizz";
const LUCA_READY_TIMEOUT_MS = 30_000;

/**
 * What the owner is being given, one frame at a time, while Luca reads. There
 * is no spinner and no invented counter: the wait is spent saying four true
 * things about the place they are about to be in.
 */
const WALKTHROUGH: ReadonlyArray<{ body: string; title: string }> = [
  {
    title: "Conversations",
    body: "You talk to Luca; Luca talks to everyone else.",
  },
  {
    title: "Residents",
    body: "Luca can make new ones, and they get their own time.",
  },
  {
    title: "Quick chat",
    body: "Luca anywhere in the app, without leaving what you’re doing.",
  },
  {
    title: "Brain",
    body: "What Luca has read, and what it may read next. Yours to change.",
  },
];
const FRAME_MS = 2600;
const FRAME_CROSSFADE_MS = 500;

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

export function PolyphonicPreparingStep({
  onComplete,
  onBack,
}: {
  displayName: string;
  onComplete: (channelId: string) => void;
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
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
  const [frame, setFrame] = React.useState(0);
  const readyChannelRef = React.useRef<string | null>(null);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
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
      if (target.kind === "managed") {
        await waitForLucaChannelSubscription(lucaPubkey, channel.id);
      }
      await beginLucaFirstMeeting(channel.id);
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
        // Luca is ready. The walkthrough releases it at the end of whatever
        // frame is on screen — a sentence is never cut in half.
        if (!cancelled) readyChannelRef.current = channelId;
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
    managed.data,
    managed.isPending,
    personas.data,
    queryClient,
    settings.data,
  ]);

  // One frame at a time, and the last word of the frame on screen is always
  // spoken. If Luca takes longer than the four frames, they come round again.
  React.useEffect(() => {
    if (visibleError) return;
    const timer = window.setInterval(() => {
      const ready = readyChannelRef.current;
      if (ready) {
        window.clearInterval(timer);
        onCompleteRef.current(ready);
        return;
      }
      setFrame((current) => (current + 1) % WALKTHROUGH.length);
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [visibleError]);

  return (
    // The frame already carries the polite live region for this chapter; the
    // walkthrough is reading matter, not an announcement queue.
    <div
      aria-busy={working && !visibleError}
      className="flex h-full min-h-0 flex-col justify-center"
    >
      <PolyphonicStepHeading
        stage="preparing"
        title="Luca is reading what you brought."
      />
      {visibleError ? null : (
        <>
          <div className="relative mt-8 h-16 max-w-[30rem]">
            {WALKTHROUGH.map((item, index) => (
              <motion.div
                animate={{
                  opacity: index === frame ? 1 : 0,
                  y: index === frame ? 0 : 4,
                }}
                className="absolute inset-0"
                data-testid={
                  index === frame ? "polyphonic-walkthrough-frame" : undefined
                }
                initial={false}
                key={item.title}
                transition={{
                  duration: reduceMotion ? 0 : FRAME_CROSSFADE_MS / 1000,
                  ease: [0.2, 0, 0, 1],
                }}
              >
                <p className="text-2xs font-medium uppercase tracking-caps-wide text-[var(--prototype-muted)]">
                  {item.title}
                </p>
                <p className="mt-1.5 text-[length:var(--prototype-body-size)] leading-[1.375rem] text-[var(--prototype-ink)]">
                  {item.body}
                </p>
              </motion.div>
            ))}
          </div>
          <div
            className="mt-[18px] flex gap-1.5"
            data-testid="polyphonic-walkthrough-ticks"
          >
            {WALKTHROUGH.map((item, index) => (
              <span
                aria-hidden
                className={cn(
                  "block h-px w-4 bg-[var(--prototype-ink)] transition-opacity duration-300",
                  index <= frame ? "opacity-80" : "opacity-20",
                )}
                key={item.title}
              />
            ))}
          </div>
        </>
      )}
      {visibleError ? (
        <div className="mt-6 flex flex-col items-start gap-4" role="alert">
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
