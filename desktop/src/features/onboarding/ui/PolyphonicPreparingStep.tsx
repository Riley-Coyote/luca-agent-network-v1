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
  type AgentRuntimeTargetV1,
  type NativeProvisioningRequestV1,
} from "@/shared/api/tauriOperatorForge";
import { setPersonaActive } from "@/shared/api/tauriPersonas";
import type { AgentPersona } from "@/shared/api/types";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import { MANAGED_PRESENTATION_EVENT } from "@/features/messages/managedPresentationProtocol";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { startStagedOnboardingAgentImports } from "../onboardingBackgroundImport";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

const LUCA_PERSONA_ID = "builtin:fizz";
const LUCA_READY_TIMEOUT_MS = 30_000;

/**
 * The other two who live here from the first launch. Polyphonic ships three
 * residents, so all three exist by the time the application opens — there is
 * nothing for the owner to add and nothing for them to do about it. Only Luca
 * wakes with the app; these two wake on the first message, like every other
 * resident.
 */
const STARTER_PERSONA_IDS = ["builtin:fifty", "builtin:trinity"] as const;

/**
 * What the owner is being given, one frame at a time, while Luca wakes. There
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
 * Two true things happen between "Meet Luca" and Luca's first words, and one
 * of them is on screen at a time. Nothing is read during onboarding — Luca
 * asks to look around in the conversation — so there is no count to show and
 * none is invented.
 */
type WakingPhase = "starting" | "writing";

const LUCA_WRITING_POLL_MS = 250;
const LUCA_WRITING_TIMEOUT_MS = 20_000;

const WAKING_LINE: Record<WakingPhase, string> = {
  starting: "Starting Luca",
  writing: "Luca is writing to you",
};

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

/**
 * Fifty and Trinity, made in the same breath as Luca and on the same runtime.
 * `create_luca_resident` is persona-agnostic and idempotent, so a second walk
 * through setup recovers the existing records rather than minting duplicates.
 *
 * Nothing here is ever the step's failure. Luca is the one the owner is
 * waiting for; if one of the other two cannot be made, the walk continues and
 * the Agents library shows that one as needing attention. They are created one
 * after another because the native creation lock serialises them anyway.
 */
async function createOtherStarters({
  existingPersonaIds,
  personas,
  runtimes,
  target,
}: {
  existingPersonaIds: ReadonlySet<string>;
  personas: readonly AgentPersona[];
  runtimes: Parameters<typeof availableRuntimesForStart>[0];
  target: AgentRuntimeTargetV1;
}) {
  for (const personaId of STARTER_PERSONA_IDS) {
    if (existingPersonaIds.has(personaId)) continue;
    const persona = personas.find((candidate) => candidate.id === personaId);
    if (!persona) continue;
    try {
      if (!persona.isActive) {
        await setPersonaActive(personaId, true);
      }
      if (target.kind === "managed") {
        const available = await availableRuntimesForStart(runtimes);
        const runtime = available.find(
          (candidate) => candidate.id === target.runtimeId,
        );
        if (!runtime)
          throw new Error("The selected runtime is no longer ready.");
        const baseInput = await buildInstanceInputForDefinition(
          persona,
          runtime,
        );
        // Only Luca wakes with the app. These two wake on send, which is the
        // rule every resident after Luca already lives by.
        await createLucaResident({
          ...baseInput,
          spawnAfterCreate: false,
          startOnAppLaunch: false,
        });
      } else {
        const request: NativeProvisioningRequestV1 = {
          displayName: persona.displayName,
          systemPrompt: persona.systemPrompt,
          runtime: target.runtime,
          mode: "fresh",
          selectedSkills: [],
          includeMemory: false,
          workspaceDocuments: [],
        };
        const preview = await previewNativeAgentProvisioning(request);
        await executeNativeAgentProvisioning(
          preview.transactionId,
          personaId,
          request,
        );
      }
    } catch (cause) {
      // Deliberately swallowed: see the note above. The owner is not told,
      // because there is nothing here for them to do.
      console.warn(`Polyphonic setup could not create ${personaId}`, cause);
    }
  }
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
  const [phase, setPhase] = React.useState<WakingPhase>("starting");
  const spokeInRef = React.useRef(new Set<string>());
  const visibleError =
    error ??
    settings.error?.message ??
    personas.error?.message ??
    managed.error?.message;

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

      // Three residents ship with Polyphonic, so three exist before the
      // application opens. This is invisible work: the phase line still says
      // "Starting Luca", because that is still what the owner is waiting for.
      await createOtherStarters({
        existingPersonaIds: new Set(
          (managed.data ?? []).flatMap((resident) =>
            resident.personaId ? [resident.personaId] : [],
          ),
        ),
        personas: currentPersonas,
        runtimes: runtimesRef.current,
        target,
      });

      // ── the agents the owner chose to bring in ────────────────────────────
      // Started here and deliberately not awaited: the three that ship with
      // Polyphonic exist, so everything left is the owner's own inventory and
      // none of it may stand between them and Luca's first words. The queue
      // runs one at a time behind the becoming; each agent appears in the rail
      // as it is made, and one that fails keeps its reason on its own row.
      startStagedOnboardingAgentImports({
        onResidentsChanged: () => {
          void queryClient.invalidateQueries({
            queryKey: managedAgentsQueryKey,
          });
        },
      });
      // ─────────────────────────────────────────────────────────────────────

      const channel = await openDm({ pubkeys: [lucaPubkey] });
      if (target.kind === "managed") {
        await waitForLucaChannelSubscription(lucaPubkey, channel.id);
      }
      // The subscription is confirmed: from here the wait is Luca composing.
      setPhase("writing");
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
      <PolyphonicStepHeading stage="preparing" title="Luca is waking up." />
      {visibleError ? null : (
        <>
          {/* What is happening, in two words, and a hairline that is only
              ever half or whole — there is nothing to count, so nothing
              pretends to be counted. */}
          <p
            className="mt-5 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]"
            data-testid="polyphonic-reading-phase"
          >
            {WAKING_LINE[phase]}
          </p>
          <div
            aria-hidden
            className="mt-3 h-px w-full overflow-hidden"
            data-testid="polyphonic-reading-progress"
            style={{ backgroundColor: "var(--prototype-hairline)" }}
          >
            <motion.div
              animate={{ scaleX: phase === "writing" ? 1 : 0.5 }}
              className="h-px w-full origin-left"
              initial={false}
              style={{
                backgroundColor: "var(--prototype-ink)",
                opacity: 0.5,
                transformOrigin: "left",
              }}
              transition={{
                duration: reduceMotion ? 0 : 0.6,
                ease: [0.2, 0, 0, 1],
              }}
            />
          </div>
          <div className="relative mt-8 h-16 w-full">
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
                    setPhase("starting");
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
