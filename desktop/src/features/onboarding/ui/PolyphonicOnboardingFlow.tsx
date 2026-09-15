import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { setPolyphonicScene } from "../polyphonicOnboardingScene";
import { readPendingPolyphonicProfile } from "../polyphonicProfileSync";
import {
  PolyphonicAgentsStep,
  type PolyphonicAgentsStepHandle,
} from "./PolyphonicAgentsStep";
import {
  PolyphonicBrainStep,
  type PolyphonicBrainStepHandle,
} from "./PolyphonicBrainStep";
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

/** The four questions, in order, then the reading. */
const CHAPTERS: PolyphonicOnboardingChapter[] = [
  "welcome",
  "runtime",
  "agents",
  "brain",
];

const previousChapter: Record<
  PolyphonicOnboardingChapter,
  PolyphonicOnboardingChapter
> = {
  welcome: "welcome",
  runtime: "welcome",
  agents: "runtime",
  brain: "agents",
  preparing: "brain",
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
  const initialTransaction = React.useMemo(
    () =>
      readPolyphonicOnboardingTransaction(pubkey) ??
      savePolyphonicOnboardingTransaction(
        createPolyphonicOnboardingTransaction(pubkey),
      ),
    [pubkey],
  );
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
  const [agentsContinueLabel, setAgentsContinueLabel] =
    React.useState("Continue");
  const [error, setError] = React.useState<string | null>(null);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const runtimeRef = React.useRef<PolyphonicRuntimeStepHandle>(null);
  const agentsRef = React.useRef<PolyphonicAgentsStepHandle>(null);
  const brainRef = React.useRef<PolyphonicBrainStepHandle>(null);

  React.useEffect(() => {
    // The protected local mirror does not know the brain chapter yet — its
    // allowlist lives in native code this work package does not own — so the
    // nearest chapter it does know is published. Browser state is canonical
    // either way. See the report's open questions.
    const mirrored =
      transaction.chapter === "brain" ? "agents" : transaction.chapter;
    void setPolyphonicOnboardingStatus(mirrored, false).catch(() => {
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
      transaction.chapter === "preparing"
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
        persist({
          chapter: "agents",
          runtimeConfirmed: true,
        });
        return;
      }
      if (transaction.chapter === "agents") {
        // The step returns undefined when it needs another pass (a native
        // creation waiting for approval, an import that needs attention).
        const outcome = await agentsRef.current?.commit();
        if (!outcome) return;
        persist({ chapter: "brain", agentsReviewed: true });
        return;
      }
      if (transaction.chapter === "brain") {
        const outcome = await brainRef.current?.commit();
        if (!outcome || outcome.cancelled) return;
        persist({ chapter: "preparing", brainReviewed: true });
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
          : transaction.chapter === "brain"
            ? "Meet Luca"
            : transaction.chapter === "agents"
              ? agentsContinueLabel
              : "Continue"
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
          onBusyChange={setBusy}
          onContinueLabelChange={setAgentsContinueLabel}
          onResidentMemoryChange={(residentMemory) =>
            persist({ residentMemory })
          }
          ref={agentsRef}
          residentMemory={transaction.residentMemory}
        />
      ) : null}
      {transaction.chapter === "brain" ? (
        <PolyphonicBrainStep onBusyChange={setBusy} ref={brainRef} />
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
