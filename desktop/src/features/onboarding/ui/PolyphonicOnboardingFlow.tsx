import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { rememberLastConversation } from "@/app/navigation/lastConversation";

import { isIdentityKeyLabel } from "@/features/profile/lib/identity";
import { setPolyphonicOnboardingStatus } from "@/shared/api/residentCapabilities";
import type { OnboardingActions, OnboardingProfileSeed } from "./types";
import {
  createPolyphonicOnboardingTransaction,
  type PolyphonicOnboardingChapter,
  readPolyphonicOnboardingTransaction,
  savePolyphonicOnboardingTransaction,
} from "../polyphonicOnboardingState";
import { prefetchNativeResidentDiscovery } from "../onboardingAgentImport";
import { stageOnboardingAgentImports } from "../onboardingBackgroundImport";
import { setPolyphonicScene } from "../polyphonicOnboardingScene";
import { readPendingPolyphonicProfile } from "../polyphonicProfileSync";
import {
  PolyphonicAgentsStep,
  type PolyphonicAgentsStepHandle,
} from "./PolyphonicAgentsStep";
import { PolyphonicPreparingStep } from "./PolyphonicPreparingStep";
import {
  PolyphonicRuntimeStep,
  type PolyphonicRuntimeStepHandle,
} from "./PolyphonicRuntimeStep";
import { PolyphonicSetupFrame } from "./PolyphonicSetupFrame";
import {
  PolyphonicYouStep,
  type PolyphonicYouStepHandle,
} from "./PolyphonicYouStep";

/** Three questions — your name, who speaks for Luca, and who else lives here
 *  — then the waking. Nothing is read during onboarding: the agents chapter
 *  only asks which of the agents already on this Mac should come too, and they
 *  are brought in behind the first conversation. The brain chapter still
 *  exists in the transaction, its migrations and its step component; the flow
 *  never enters it, and a transaction saved on it resumes at the waking rather
 *  than stranding an owner on a chapter that is gone. */
const CHAPTERS: PolyphonicOnboardingChapter[] = [
  "welcome",
  "runtime",
  "agents",
];

const SKIPPED_CHAPTERS: ReadonlySet<PolyphonicOnboardingChapter> = new Set([
  "brain",
]);

const previousChapter: Record<
  PolyphonicOnboardingChapter,
  PolyphonicOnboardingChapter
> = {
  welcome: "welcome",
  runtime: "welcome",
  agents: "runtime",
  brain: "agents",
  preparing: "agents",
};

export function PolyphonicOnboardingFlow({
  actions,
  initialProfile,
  pubkey,
}: {
  actions: OnboardingActions;
  initialProfile: OnboardingProfileSeed;
  pubkey: string;
}) {
  const initialTransaction = React.useMemo(() => {
    const saved =
      readPolyphonicOnboardingTransaction(pubkey) ??
      createPolyphonicOnboardingTransaction(pubkey);
    // A transaction saved on a chapter this build no longer asks resumes at
    // the waking. "agents" is a real chapter again, so a setup that stopped
    // there resumes there, with whatever it had already ticked.
    return savePolyphonicOnboardingTransaction(
      SKIPPED_CHAPTERS.has(saved.chapter)
        ? { ...saved, chapter: "preparing" }
        : saved,
    );
  }, [pubkey]);
  const pendingProfile = readPendingPolyphonicProfile(pubkey);
  const [transaction, setTransaction] = React.useState(initialTransaction);
  const [displayName, setDisplayName] = React.useState(() => {
    // Native identity bootstrap ships a shortened npub as the display name
    // until a real profile exists. That is transport metadata, not a name —
    // seeding the field with it asks a new owner to delete their own key.
    const seed =
      pendingProfile?.displayName ?? initialProfile.profile?.displayName ?? "";
    return isIdentityKeyLabel(seed, pubkey) ? "" : seed;
  });
  const [busy, setBusy] = React.useState(false);
  const continuingRef = React.useRef(false);
  const [runtimeReady, setRuntimeReady] = React.useState(false);
  const [agentSelection, setAgentSelection] = React.useState({
    found: 0,
    selected: 0,
  });
  const [error, setError] = React.useState<string | null>(null);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const runtimeRef = React.useRef<PolyphonicRuntimeStepHandle>(null);
  const agentsRef = React.useRef<PolyphonicAgentsStepHandle>(null);
  const queryClient = useQueryClient();

  // Looking around the Mac starts while the owner is still choosing a runtime,
  // so the agents chapter paints its rows the moment it opens instead of
  // opening onto a spinner.
  React.useEffect(() => {
    if (transaction.chapter !== "runtime") return;
    prefetchNativeResidentDiscovery(queryClient);
  }, [queryClient, transaction.chapter]);

  React.useEffect(() => {
    // The protected local mirror's allowlist lives in native code this work
    // package does not own; the flow now only ever publishes chapters that
    // allowlist already knows. Browser state is canonical either way.
    const chapter = transaction.chapter;
    if (chapter === "brain") return;
    void setPolyphonicOnboardingStatus(chapter, false).catch(() => {
      // Browser state remains canonical if the protected local mirror is
      // temporarily unavailable; the next chapter transition repairs it.
    });
  }, [transaction.chapter]);

  function persist(patch: Partial<typeof transaction>) {
    const next = savePolyphonicOnboardingTransaction({
      ...transaction,
      ...patch,
    });
    setTransaction(next);
  }

  const steps = {
    current:
      CHAPTERS.indexOf(transaction.chapter) < 0
        ? CHAPTERS.length
        : CHAPTERS.indexOf(transaction.chapter),
    total: CHAPTERS.length,
  };

  async function continueForward() {
    if (busy || continuingRef.current) return;
    continuingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (transaction.chapter === "welcome") {
        const outcome = await youRef.current?.commit();
        if (!outcome) return;
        setDisplayName(outcome.displayName);
        persist({ chapter: "runtime", profileSaved: true });
        return;
      }
      if (transaction.chapter === "runtime") {
        const target = await runtimeRef.current?.commit();
        if (!target) return;
        persist({ chapter: "agents", runtimeConfirmed: true });
        return;
      }
      if (transaction.chapter === "agents") {
        // Nothing is imported here: the step stages what was ticked and the
        // waking step enqueues it once Luca exists. The answer is persisted
        // so a reload before the waking keeps the owner's choice.
        const outcome = await agentsRef.current?.commit();
        if (!outcome) return;
        persist({
          chapter: "preparing",
          agentsReviewed: true,
          agentImports: outcome.selection,
        });
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      continuingRef.current = false;
      setBusy(false);
    }
  }

  const enterLucaDm = React.useCallback(
    (channelId: string) => {
      void setPolyphonicOnboardingStatus("complete", true).catch(() => {
        // Completion is not blocked by a best-effort local status mirror.
      });
      // Not "off": the card does not disappear, it becomes the application.
      // The layer grows the shell into the window while the conversation
      // mounts beneath it and the mark travels to the sidebar.
      setPolyphonicScene({ stage: "becoming", resolving: false });
      // Onboarding runs in a small centred window so only the card is on
      // screen. The card becoming the application is also the window
      // becoming the application: macOS animates the zoom, and the field
      // layer retargets the growing shell on every resize frame.
      if (isTauri()) {
        try {
          void getCurrentWindow()
            .maximize()
            .catch(() => {
              // A window that refuses to zoom is not a reason to stay on the
              // card; the conversation is already mounted beneath it.
            });
        } catch {
          // Same: the handoff never depends on the window manager.
        }
      }
      rememberLastConversation(channelId);
      actions.complete();
      window.location.hash = `/channels/${encodeURIComponent(channelId)}`;
    },
    [actions.complete],
  );

  return (
    <PolyphonicSetupFrame
      backDisabled={transaction.chapter === "welcome" || busy}
      continueDisabled={
        busy ||
        (transaction.chapter === "welcome" && !displayName.trim()) ||
        (transaction.chapter === "runtime" && !runtimeReady)
      }
      continueLabel={
        busy
          ? "Working…"
          : transaction.chapter !== "agents"
            ? "Continue"
            : agentSelection.selected > 0
              ? `Bring in ${agentSelection.selected} agent${
                  agentSelection.selected === 1 ? "" : "s"
                }`
              : // Nobody on this Mac to bring in is not a decision declined;
                // it is simply the last screen, so it just carries on.
                agentSelection.found === 0
                ? "Continue"
                : "Meet Luca"
      }
      onBack={() => persist({ chapter: previousChapter[transaction.chapter] })}
      onContinue={() => void continueForward()}
      showFooter={transaction.chapter !== "preparing"}
      stage={transaction.chapter}
      steps={steps}
    >
      {transaction.chapter === "welcome" ? (
        <PolyphonicYouStep
          displayName={displayName}
          onBusyChange={setBusy}
          onDisplayNameChange={setDisplayName}
          pubkey={pubkey}
          ref={youRef}
        />
      ) : null}
      {transaction.chapter === "runtime" ? (
        <PolyphonicRuntimeStep
          onReadyChange={setRuntimeReady}
          ref={runtimeRef}
        />
      ) : null}
      {transaction.chapter === "agents" ? (
        <PolyphonicAgentsStep
          onSelectionChange={setAgentSelection}
          onSkip={() => {
            // Declining is a decision, and it is recorded like one: nothing
            // staged, nothing queued, straight on to the waking.
            stageOnboardingAgentImports([]);
            persist({
              chapter: "preparing",
              agentsReviewed: true,
              agentImports: [],
            });
          }}
          ref={agentsRef}
          residentMemory={transaction.residentMemory}
          savedSelection={transaction.agentImports}
        />
      ) : null}
      {transaction.chapter === "preparing" ? (
        <PolyphonicPreparingStep
          displayName={displayName}
          // The button on the error says "Choose another runtime", so it goes
          // to the runtime, not to the step before this one.
          onBack={() => persist({ chapter: "runtime" })}
          onComplete={enterLucaDm}
        />
      ) : null}
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </PolyphonicSetupFrame>
  );
}
