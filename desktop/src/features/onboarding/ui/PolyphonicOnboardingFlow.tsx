import * as React from "react";
import { rememberLastConversation } from "@/app/navigation/lastConversation";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

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
  const [error, setError] = React.useState<string | null>(null);
  const youRef = React.useRef<PolyphonicYouStepHandle>(null);
  const runtimeRef = React.useRef<PolyphonicRuntimeStepHandle>(null);

  React.useEffect(() => {
    void setPolyphonicOnboardingStatus(transaction.chapter, false).catch(() => {
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

  const chapters: PolyphonicOnboardingChapter[] = ["welcome", "runtime"];
  const steps = {
    current:
      transaction.chapter === "preparing"
        ? chapters.length
        : chapters.indexOf(transaction.chapter),
    total: chapters.length,
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
          chapter: "preparing",
          runtimeConfirmed: true,
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
      setPolyphonicScene({ stage: "off", anchor: null, resolving: false });
      rememberLastConversation(channelId);
      actions.complete();
      window.location.hash = `/channels/${encodeURIComponent(channelId)}`;
    },
    [actions.complete],
  );

  if (transaction.chapter === "preparing") {
    return (
      <div className="buzz-startup-shell flex h-dvh items-center justify-center overflow-y-auto bg-background px-6 py-10 text-foreground">
        <StartupWindowDragRegion />
        <PolyphonicPreparingStep
          displayName={displayName}
          onComplete={enterLucaDm}
          onBack={() => persist({ chapter: "runtime" })}
          showMark={false}
        />
      </div>
    );
  }

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
          : transaction.chapter === "runtime"
            ? "Meet Luca"
            : "Continue"
      }
      onBack={() => persist({ chapter: previousChapter[transaction.chapter] })}
      onContinue={() => void continueForward()}
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
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </PolyphonicSetupFrame>
  );
}
