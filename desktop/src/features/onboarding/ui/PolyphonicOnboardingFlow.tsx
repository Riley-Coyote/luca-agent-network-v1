import * as React from "react";

import type { OnboardingActions, OnboardingProfileSeed } from "./types";
import {
  createPolyphonicOnboardingTransaction,
  type PolyphonicOnboardingChapter,
  readPolyphonicOnboardingTransaction,
  savePolyphonicOnboardingTransaction,
} from "../polyphonicOnboardingState";
import {
  POLYPHONIC_PROFILE_SYNCED_EVENT,
  readPendingPolyphonicProfile,
} from "../polyphonicProfileSync";
import {
  PolyphonicAgentsStep,
  type PolyphonicAgentsStepHandle,
} from "./PolyphonicAgentsStep";
import {
  PolyphonicBrainStep,
  type PolyphonicBrainStepHandle,
} from "./PolyphonicBrainStep";
import { PolyphonicSetupFrame } from "./PolyphonicSetupFrame";
import {
  PolyphonicYouStep,
  type PolyphonicYouStepHandle,
} from "./PolyphonicYouStep";
import { PolyphonicReadyStep } from "./PolyphonicReadyStep";

const previousChapter: Record<
  PolyphonicOnboardingChapter,
  PolyphonicOnboardingChapter
> = {
  you: "you",
  agents: "you",
  brain: "agents",
  ready: "brain",
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
  const [displayName, setDisplayName] = React.useState(
    pendingProfile?.displayName ?? initialProfile.profile?.displayName ?? "",
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [profileNeedsAttention, setProfileNeedsAttention] = React.useState(
    pendingProfile !== null,
  );
  React.useEffect(() => {
    const synced = () => setProfileNeedsAttention(false);
    window.addEventListener(POLYPHONIC_PROFILE_SYNCED_EVENT, synced);
    return () =>
      window.removeEventListener(POLYPHONIC_PROFILE_SYNCED_EVENT, synced);
  }, []);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const agentsRef = React.useRef<PolyphonicAgentsStepHandle>(null);
  const brainRef = React.useRef<PolyphonicBrainStepHandle>(null);

  function persist(patch: Partial<typeof transaction>) {
    const next = savePolyphonicOnboardingTransaction({
      ...transaction,
      ...patch,
    });
    setTransaction(next);
  }

  async function continueForward() {
    if (busy) return;
    setError(null);
    try {
      if (transaction.chapter === "you") {
        const outcome = await youRef.current?.commit();
        if (!outcome) return;
        setDisplayName(outcome.displayName);
        setProfileNeedsAttention(outcome.needsAttention);
        persist({ chapter: "agents", profileSaved: true });
        return;
      }
      if (transaction.chapter === "agents") {
        const outcome = await agentsRef.current?.commit();
        if (!outcome) return;
        persist({
          chapter: "brain",
          agentsReviewed: true,
          agentsNeedAttention: outcome.issueCount > 0,
        });
        return;
      }
      if (transaction.chapter === "brain") {
        const outcome = await brainRef.current?.commit();
        if (!outcome || outcome.cancelled) return;
        persist({
          chapter: "ready",
          brainReviewed: true,
          brainNeedsAttention: outcome.issueCount > 0,
        });
        return;
      }
      actions.complete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <PolyphonicSetupFrame
      backDisabled={transaction.chapter === "you" || busy}
      continueDisabled={
        busy || (transaction.chapter === "you" && !displayName.trim())
      }
      continueLabel={
        transaction.chapter === "ready"
          ? "Start a conversation"
          : busy
            ? "Working…"
            : "Continue"
      }
      onBack={() => persist({ chapter: previousChapter[transaction.chapter] })}
      onContinue={() => void continueForward()}
      stage={transaction.chapter}
    >
      {transaction.chapter === "you" ? (
        <PolyphonicYouStep
          displayName={displayName}
          onBusyChange={setBusy}
          onDisplayNameChange={setDisplayName}
          pubkey={pubkey}
          ref={youRef}
        />
      ) : null}
      {transaction.chapter === "agents" ? (
        <PolyphonicAgentsStep onBusyChange={setBusy} ref={agentsRef} />
      ) : null}
      {transaction.chapter === "brain" ? (
        <PolyphonicBrainStep onBusyChange={setBusy} ref={brainRef} />
      ) : null}
      {transaction.chapter === "ready" ? (
        <PolyphonicReadyStep
          agentsNeedAttention={transaction.agentsNeedAttention}
          brainNeedsAttention={transaction.brainNeedsAttention}
          displayName={displayName}
          onReview={(chapter) => persist({ chapter })}
          profileNeedsAttention={profileNeedsAttention}
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
