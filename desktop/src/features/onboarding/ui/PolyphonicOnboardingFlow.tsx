import * as React from "react";

import { isIdentityKeyLabel } from "@/features/profile/lib/identity";
import { discoverNativeResidents } from "@/shared/api/tauri";
import type { NativeResidentDiscoveryOutcome } from "@/shared/api/types";
import { isSelectableAgentImportCandidate } from "../onboardingAgentImport";
import type { OnboardingActions, OnboardingProfileSeed } from "./types";
import {
  createPolyphonicOnboardingTransaction,
  type PolyphonicOnboardingChapter,
  readPolyphonicOnboardingTransaction,
  savePolyphonicOnboardingTransaction,
} from "../polyphonicOnboardingState";
import { readPendingPolyphonicProfile } from "../polyphonicProfileSync";
import {
  PolyphonicAgentImportStep,
  type PolyphonicAgentImportMode,
  type PolyphonicAgentImportStepHandle,
} from "./PolyphonicAgentImportStep";
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

const previousChapter: Record<
  PolyphonicOnboardingChapter,
  PolyphonicOnboardingChapter
> = {
  welcome: "welcome",
  runtime: "welcome",
  agents: "runtime",
  preparing: "runtime",
};

function candidateCount(outcome: NativeResidentDiscoveryOutcome | null) {
  return (
    outcome?.runtimes.reduce(
      (count, runtime) =>
        count +
        runtime.candidates.filter(isSelectableAgentImportCandidate).length,
      0,
    ) ?? 0
  );
}

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
  /** -1 back, +1 forward, 0 arriving from the door. Drives chapter motion. */
  const [direction, setDirection] = React.useState(0);
  const [displayName, setDisplayName] = React.useState(() => {
    // Native identity bootstrap ships a shortened npub as the display name
    // until a real profile exists. That is transport metadata, not a name —
    // seeding the field with it asks a new owner to delete their own key.
    const seed =
      pendingProfile?.displayName ?? initialProfile.profile?.displayName ?? "";
    return isIdentityKeyLabel(seed, pubkey) ? "" : seed;
  });
  const [busy, setBusy] = React.useState(false);
  const [runtimeReady, setRuntimeReady] = React.useState(false);
  const [agentsContinueLabel, setAgentsContinueLabel] =
    React.useState("Continue");
  const [agentsMode, setAgentsMode] =
    React.useState<PolyphonicAgentImportMode>("summary");
  const [error, setError] = React.useState<string | null>(null);
  const [discovery, setDiscovery] =
    React.useState<NativeResidentDiscoveryOutcome | null>(null);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const runtimeRef = React.useRef<PolyphonicRuntimeStepHandle>(null);
  const agentsRef = React.useRef<PolyphonicAgentImportStepHandle>(null);

  const scan = React.useCallback(async () => {
    const outcome = await discoverNativeResidents();
    setDiscovery(outcome);
    return outcome;
  }, []);
  React.useEffect(() => {
    void scan().catch(() => {
      // Native discovery is optional and must never block first run.
    });
  }, [scan]);

  function persist(patch: Partial<typeof transaction>, dir = 1) {
    setDirection(dir);
    const next = savePolyphonicOnboardingTransaction({
      ...transaction,
      ...patch,
    });
    setTransaction(next);
  }

  const chapters: PolyphonicOnboardingChapter[] = [
    "welcome",
    "runtime",
    ...(candidateCount(discovery) > 0
      ? (["agents"] as PolyphonicOnboardingChapter[])
      : []),
  ];
  const steps = {
    current:
      transaction.chapter === "preparing"
        ? chapters.length
        : chapters.indexOf(transaction.chapter),
    total: chapters.length,
  };

  async function continueForward() {
    if (busy) return;
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
          chapter: candidateCount(discovery) > 0 ? "agents" : "preparing",
          runtimeConfirmed: true,
        });
        return;
      }
      if (transaction.chapter === "agents") {
        const outcome = await agentsRef.current?.commit();
        if (!outcome) return;
        persist({ chapter: "preparing", agentsReviewed: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const enterLucaDm = React.useCallback(
    (channelId: string) => {
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
        transaction.chapter === "agents"
          ? agentsContinueLabel
          : busy
            ? "Working…"
            : "Continue"
      }
      footerSecondary={
        transaction.chapter === "agents" && agentsMode === "summary" ? (
          <button
            className="rounded-[7px] px-1 py-1 text-[length:var(--prototype-support-size)] text-[var(--prototype-muted)] hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            onClick={() =>
              persist({ chapter: "preparing", agentsReviewed: true })
            }
            type="button"
          >
            Not now
          </button>
        ) : null
      }
      onBack={() => {
        if (transaction.chapter === "agents" && agentsMode === "select") {
          agentsRef.current?.showSummary();
          return;
        }
        persist({ chapter: previousChapter[transaction.chapter] }, -1);
      }}
      direction={direction}
      onContinue={() => void continueForward()}
      showFooter={transaction.chapter !== "preparing"}
      stage={transaction.chapter}
      steps={steps}
    >
      {transaction.chapter === "welcome" ? (
        <PolyphonicYouStep
          appearanceSwatches
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
      {transaction.chapter === "agents" && discovery ? (
        <PolyphonicAgentImportStep
          discovery={discovery}
          onBusyChange={setBusy}
          onContinueLabelChange={setAgentsContinueLabel}
          onModeChange={setAgentsMode}
          onRescan={scan}
          ref={agentsRef}
        />
      ) : null}
      {transaction.chapter === "preparing" ? (
        <PolyphonicPreparingStep
          displayName={displayName}
          onComplete={enterLucaDm}
          showMark={false}
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
