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
import {
  type IndexProgressV1,
  listConnectedBrainSources,
  listenToConnectedBrainIndexProgress,
} from "@/shared/api/tauriBrain";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import { MANAGED_PRESENTATION_EVENT } from "@/features/messages/managedPresentationProtocol";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PendingBrainConnect } from "./PolyphonicBrainStep";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
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

/**
 * The three true things that happen between "Meet Luca" and Luca's first
 * words. One of them is on screen at a time, and none of them is invented:
 * the counts come from native's own index progress, and "writing" is not
 * claimed until something Luca-signed is actually in the conversation.
 */
type ReadingPhase = "connecting" | "waking" | "writing";

const SOURCE_PHRASE: Record<string, string> = {
  repository: "Reading repositories",
  codex_history: "Reading Codex sessions",
  claude_history: "Reading Claude Code sessions",
};
/** How often the reading step asks native whether an index it did not start
 *  (a reload mid-connect) has finished. */
const CONNECT_POLL_MS = 1000;
const LUCA_WRITING_POLL_MS = 250;
const LUCA_WRITING_TIMEOUT_MS = 20_000;
/** Even with no counts the bar is a line, not an empty groove. */
const MIN_PHASE_FRACTION = 0.08;

function readingPhaseLine(
  phase: ReadingPhase,
  progress: IndexProgressV1 | null,
): string {
  if (phase === "waking") return "Waking Luca";
  if (phase === "writing") return "Luca is writing to you";
  if (!progress || progress.state === "done") return "Connecting your sources";
  const phrase = SOURCE_PHRASE[progress.kind] ?? progress.label;
  if (typeof progress.total === "number" && progress.total > 0) {
    return `${phrase} · ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`;
  }
  if (progress.done > 0) return `${phrase} · ${progress.done.toLocaleString()}`;
  return phrase;
}

function readingFraction(
  phase: ReadingPhase,
  progress: IndexProgressV1 | null,
): number {
  if (phase === "writing") return 1;
  if (phase === "waking") return 2 / 3;
  const within =
    progress && typeof progress.total === "number" && progress.total > 0
      ? Math.min(1, progress.done / progress.total)
      : 0;
  return (1 / 3) * Math.max(MIN_PHASE_FRACTION, within);
}

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

/**
 * "Luca is writing to you" is only allowed to be on screen while it is true,
 * and the card is only allowed to become the application once Luca's first
 * words are already there to open onto. Anything Luca-signed counts: a
 * published row, or a presentation frame for this conversation. After the cap
 * we stop waiting rather than hold the owner on a screen that cannot finish.
 */
async function waitForLucaToSpeak(
  channelId: string,
  lucaPubkey: string,
  spokeIn: ReadonlySet<string>,
) {
  const luca = normalizePubkey(lucaPubkey);
  const deadline = Date.now() + LUCA_WRITING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spokeIn.has(channelId)) return;
    try {
      const events = await getChannelWindowEvents(channelId, null, 20);
      if (events.some((event) => normalizePubkey(event.pubkey ?? "") === luca))
        return;
    } catch {
      // The conversation is already open beneath; a read that fails is not a
      // reason to keep the owner on the reading screen.
      return;
    }
    await new Promise((resolve) =>
      window.setTimeout(resolve, LUCA_WRITING_POLL_MS),
    );
  }
}

export function PolyphonicPreparingStep({
  onComplete,
  onBack,
  pendingConnect = null,
}: {
  displayName: string;
  onComplete: (channelId: string) => void;
  onBack?: () => void;
  /** The connect the Brain chapter started. Absent after a reload, when the
   *  step asks native what is still running instead of starting anything. */
  pendingConnect?: PendingBrainConnect | null;
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
  const [connectSettled, setConnectSettled] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [connectAttempt, setConnectAttempt] = React.useState(0);
  const [writingStarted, setWritingStarted] = React.useState(false);
  const [progressBySource, setProgressBySource] = React.useState<
    ReadonlyMap<string, IndexProgressV1>
  >(() => new Map());
  const pendingConnectRef = React.useRef(pendingConnect);
  const spokeInRef = React.useRef(new Set<string>());
  // Luca is not asked to read until the sources it was given are in. The gate
  // is a promise so the preparation can run alongside the index and wait for
  // it only at the one moment that matters.
  const connectGateRef = React.useRef<{
    promise: Promise<void>;
    open: () => void;
  } | null>(null);
  if (!connectGateRef.current) {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    connectGateRef.current = { promise, open };
  }
  const visibleError =
    error ??
    settings.error?.message ??
    personas.error?.message ??
    managed.error?.message;

  // What the index is doing, keyed by source. Native may emit nothing at all;
  // the phrase alone is then the whole truth and no counter is invented.
  React.useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listenToConnectedBrainIndexProgress((next) => {
      setProgressBySource((current) => {
        const map = new Map(current);
        map.delete(next.sourceId);
        map.set(next.sourceId, next);
        return map;
      });
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // No progress channel on this build: the reading screen still reads.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // A presentation frame is Luca speaking before the row is published.
  React.useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    const seen = spokeInRef.current;
    void listen<{ conversation_id?: unknown }>(
      MANAGED_PRESENTATION_EVENT,
      (event) => {
        const conversationId = event.payload?.conversation_id;
        if (typeof conversationId === "string") seen.add(conversationId);
      },
    )
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // The published row is the fallback signal.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // The connection the owner authorised. It is already running when it gets
  // here; after a reload it is native's to report, never ours to start again.
  React.useEffect(() => {
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      setConnectSettled(true);
      connectGateRef.current?.open();
    };
    const pending = pendingConnectRef.current;
    if (pending) {
      const run = connectAttempt === 0 ? pending.promise : pending.retry();
      run
        .then((outcome) => {
          if (cancelled) return;
          if (outcome.error) {
            setConnectError(outcome.error);
            return;
          }
          settle();
        })
        .catch((cause) => {
          if (cancelled) return;
          setConnectError(
            cause instanceof Error ? cause.message : String(cause),
          );
        });
      return () => {
        cancelled = true;
      };
    }
    let timer = 0;
    async function poll() {
      try {
        const inventory = await listConnectedBrainSources();
        if (cancelled) return;
        if (
          !inventory.sources.some((source) => source.status === "connecting")
        ) {
          settle();
          return;
        }
      } catch {
        settle();
        return;
      }
      timer = window.setTimeout(() => void poll(), CONNECT_POLL_MS);
    }
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connectAttempt]);

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
      // Nothing is asked of Luca until what the owner brought is in.
      await connectGateRef.current?.promise;
      setWritingStarted(true);
      await beginLucaFirstMeeting(channel.id);
      await waitForLucaToSpeak(channel.id, lucaPubkey, spokeInRef.current);
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
