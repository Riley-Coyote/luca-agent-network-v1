import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import {
  importIdentity,
  persistCurrentIdentity,
} from "@/shared/api/tauriIdentity";
import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { BackupStep } from "./BackupStep";
import { DefaultConfigStep } from "./DefaultConfigStep";
import { NostrKeyImportForm } from "./NostrKeyImportForm";
import { OnboardingChrome } from "./OnboardingChrome";
import { OnboardingFooterProvider } from "./OnboardingFooter";
import { OnboardingSlideTransition } from "./OnboardingSlideTransition";
import { SetupStep } from "./SetupStep";
import { PolyphonicThresholdField } from "./PolyphonicThresholdField";
import { skipPolyphonicOnboardingForSession } from "../polyphonicOnboardingState";

export type MachineOnboardingPage =
  | "identity"
  | "key-import"
  | "backup"
  | "setup"
  | "config";

export function MachineOnboardingFlow({
  complete,
  continueWithIdentity,
  currentPubkey,
  identityLost,
  initialPage,
  queryClient,
}: {
  complete: (pubkey?: string) => void;
  continueWithIdentity: (pubkey: string) => void;
  currentPubkey: string | null;
  identityLost: boolean;
  initialPage?: MachineOnboardingPage;
  queryClient: QueryClient;
}) {
  const [page, setPage] = React.useState<MachineOnboardingPage>(
    identityLost ? "key-import" : (initialPage ?? "identity"),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [identityWasImported, setIdentityWasImported] = React.useState(false);
  const [selectedPubkey, setSelectedPubkey] = React.useState<string | null>(
    null,
  );
  const [readyRuntimeIds, setReadyRuntimeIds] = React.useState<string[]>([]);
  const handleReadyRuntimeIdsChange = React.useCallback(
    (runtimeIds: readonly string[]) => {
      setReadyRuntimeIds(Array.from(new Set(runtimeIds)));
    },
    [],
  );

  const loadFreshIdentity = React.useCallback(
    (skipSetup = false) => {
      setIsPending(true);
      setError(null);
      if (!currentPubkey) {
        setError("The owner identity is not available. Please try again.");
        setIsPending(false);
        return;
      }
      setSelectedPubkey(currentPubkey);
      if (skipSetup) skipPolyphonicOnboardingForSession(currentPubkey);
      complete(currentPubkey);
      setIsPending(false);
    },
    [complete, currentPubkey],
  );

  const replaceLostIdentity = React.useCallback(async () => {
    const confirmed = window.confirm(
      "This will create a new identity and abandon your previous key. This cannot be undone. Continue?",
    );
    if (!confirmed) return;

    setIsPending(true);
    setError(null);
    try {
      const identity = await persistCurrentIdentity();
      queryClient.setQueryData(["identity"], identity);
      setSelectedPubkey(identity.pubkey);
      setPage("backup");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to save identity",
      );
    } finally {
      setIsPending(false);
    }
  }, [queryClient]);

  const importExistingIdentity = React.useCallback(
    async (nsec: string) => {
      const identity = await importIdentity(nsec);
      continueWithIdentity(identity.pubkey);
      queryClient.setQueryData(["identity"], identity);
      setIdentityWasImported(true);
      setSelectedPubkey(identity.pubkey);
      complete(identity.pubkey);
    },
    [complete, continueWithIdentity, queryClient],
  );

  return (
    <div
      className={`buzz-onboarding-neutral-theme buzz-startup-shell flex max-h-dvh items-start justify-center overflow-x-hidden overflow-y-auto px-4 text-foreground ${
        page === "identity"
          ? "buzz-onboarding-welcome py-8"
          : "pb-28 pt-[106px]"
      }`}
      data-testid="machine-onboarding-gate"
    >
      <StartupWindowDragRegion />
      {page !== "identity" ? (
        <OnboardingChrome
          brand="luca"
          current={page === "config" ? 4 : page === "setup" ? 3 : 2}
          total={4}
        />
      ) : null}
      <OnboardingFooterProvider>
        <div
          className={`relative flex w-full max-w-[1040px] flex-col items-center text-center ${
            page === "identity" ? "my-auto" : "buzz-onboarding-step-frame"
          }`}
        >
          {page === "identity" ? (
            <OnboardingSlideTransition
              className="flex w-full max-w-[720px] flex-col items-center text-center"
              direction="forward"
              effect="mask-reveal-up"
              transitionKey="machine-identity"
            >
              <PolyphonicThresholdField />
              <h1 className="relative -mt-8 text-4xl font-medium tracking-[-0.04em] text-white">
                Polyphonic
              </h1>
              <p className="mt-3 max-w-[26rem] text-center text-sm leading-6 text-white/60">
                A private home for your agents and the work that makes them
                useful.
              </p>
              {error ? (
                <p className="mt-4 text-sm text-destructive">{error}</p>
              ) : null}
              <div className="mt-10 flex flex-col items-center gap-3">
                <Button
                  className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black hover:bg-white/90"
                  disabled={isPending}
                  onClick={() => void loadFreshIdentity(false)}
                  type="button"
                >
                  {isPending ? "Preparing Polyphonic…" : "Begin setup"}
                </Button>
                <Button
                  className="h-9 rounded-lg px-4 text-xs text-white/55 hover:bg-white/[0.05] hover:text-white"
                  disabled={isPending}
                  onClick={() => setPage("key-import")}
                  type="button"
                  variant="ghost"
                >
                  Use an existing identity…
                </Button>
                <Button
                  className="h-8 rounded-lg px-3 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white/70"
                  disabled={isPending}
                  onClick={() => void loadFreshIdentity(true)}
                  type="button"
                  variant="ghost"
                >
                  Set up later
                </Button>
              </div>
            </OnboardingSlideTransition>
          ) : page === "key-import" ? (
            <OnboardingSlideTransition
              className="flex min-h-[calc(100dvh-13.25rem)] w-full max-w-[837px] flex-col items-center text-center"
              direction="forward"
              effect="fade"
              transitionKey="machine-key-import"
            >
              <div className="shrink-0">
                <h1 className="text-title font-normal text-foreground">
                  {identityLost
                    ? "Re-import your key"
                    : "Connect your owner identity"}
                </h1>
                <p className="mt-5 max-w-[440px] text-sm leading-6 text-foreground/80">
                  {identityLost
                    ? "Your identity is no longer in the system keyring. Re-import your nsec to restore it."
                    : "If you already have a compatible cryptographic identity, enter its private key to connect it to Luca. It stays masked while you enter it."}
                </p>
              </div>
              <div className="buzz-onboarding-key-import-position w-full">
                <NostrKeyImportForm
                  backLabel={identityLost ? "Start new identity" : "Back"}
                  onBack={
                    identityLost
                      ? () => void replaceLostIdentity()
                      : () => setPage("identity")
                  }
                  onImport={importExistingIdentity}
                  variant="spotlight"
                />
              </div>
            </OnboardingSlideTransition>
          ) : page === "backup" ? (
            <BackupStep
              direction="forward"
              onBack={() => setPage("identity")}
              onNext={() => setPage("setup")}
            />
          ) : page === "setup" ? (
            <SetupStep
              actions={{
                back: () =>
                  setPage(identityWasImported ? "key-import" : "backup"),
                next: (runtimeIds) => {
                  setReadyRuntimeIds(Array.from(runtimeIds));
                  setPage("config");
                },
              }}
              direction="forward"
              onReadyRuntimeIdsChange={handleReadyRuntimeIdsChange}
            />
          ) : (
            <DefaultConfigStep
              actions={{
                back: () => setPage("setup"),
                complete: () => complete(selectedPubkey ?? undefined),
              }}
              direction="forward"
              readyRuntimeIds={readyRuntimeIds}
            />
          )}
        </div>
      </OnboardingFooterProvider>
    </div>
  );
}
