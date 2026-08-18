import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import {
  clearPolyphonicOnboardingTransaction,
  createPolyphonicOnboardingTransaction,
  type PolyphonicOnboardingChapter,
  savePolyphonicOnboardingTransaction,
} from "../polyphonicOnboardingState";
import { MachineOnboardingFlow } from "./MachineOnboardingFlow";
import { ConversationalOnboardingPreview } from "./ConversationalOnboardingPreview";
import { PolyphonicOnboardingFlow } from "./PolyphonicOnboardingFlow";

const PREVIEW_PARAM = "polyphonicOnboardingPreview";
const PREVIEW_PUBKEY = "f".repeat(64);

export type PolyphonicOnboardingPreviewStage =
  | "threshold"
  | "prototype"
  | "you"
  | "brain"
  | "ready"
  | PolyphonicOnboardingChapter;

const stages = new Set<PolyphonicOnboardingPreviewStage>([
  "threshold",
  "prototype",
  "you",
  "welcome",
  "runtime",
  "agents",
  "brain",
  "ready",
  "preparing",
]);

export function readPolyphonicOnboardingPreviewStage(): PolyphonicOnboardingPreviewStage | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) return null;

  const value = new URL(window.location.href).searchParams.get(PREVIEW_PARAM);
  if (!value) return null;
  if (value === "1" || value === "welcome") return "threshold";
  if (value === "conversational") return "prototype";
  return stages.has(value as PolyphonicOnboardingPreviewStage)
    ? (value as PolyphonicOnboardingPreviewStage)
    : null;
}

function prepareProductionFlow(
  stage: Exclude<
    PolyphonicOnboardingPreviewStage,
    "threshold" | "prototype" | "v2"
  >,
) {
  const chapter: PolyphonicOnboardingChapter =
    stage === "you"
      ? "welcome"
      : stage === "brain" || stage === "ready"
        ? "runtime"
        : stage;
  clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
  savePolyphonicOnboardingTransaction({
    ...createPolyphonicOnboardingTransaction(PREVIEW_PUBKEY),
    chapter,
    profileSaved: chapter !== "welcome",
    runtimeConfirmed: chapter !== "welcome" && chapter !== "runtime",
    agentsReviewed: chapter === "preparing",
  });
}

/**
 * Development-only onboarding lab. It supplies deterministic mock lifecycle
 * state while rendering the exact production machine and personal-home flows.
 */
export function PolyphonicOnboardingPreview({
  initialStage,
  queryClient,
}: {
  initialStage: PolyphonicOnboardingPreviewStage;
  queryClient: QueryClient;
}) {
  if (initialStage === "prototype") {
    return <ConversationalOnboardingPreview />;
  }

  return (
    <LegacyPolyphonicOnboardingPreview
      initialStage={initialStage}
      queryClient={queryClient}
    />
  );
}

function LegacyPolyphonicOnboardingPreview({
  initialStage,
  queryClient,
}: {
  initialStage: Exclude<PolyphonicOnboardingPreviewStage, "prototype">;
  queryClient: QueryClient;
}) {
  const [mode, setMode] = React.useState<"machine" | "personal-home">(() => {
    if (initialStage === "threshold") {
      clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
      return "machine";
    }
    prepareProductionFlow(initialStage);
    return "personal-home";
  });
  const [flowKey, setFlowKey] = React.useState(0);

  const beginPersonalHome = React.useCallback(() => {
    prepareProductionFlow("welcome");
    setFlowKey((current) => current + 1);
    setMode("personal-home");
  }, []);

  if (mode === "machine") {
    return (
      <MachineOnboardingFlow
        complete={beginPersonalHome}
        continueWithIdentity={() => undefined}
        currentPubkey={PREVIEW_PUBKEY}
        identityLost={false}
        queryClient={queryClient}
      />
    );
  }

  return (
    <PolyphonicOnboardingFlow
      actions={{
        complete: () => {
          clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
          setMode("machine");
        },
        skipForNow: () => undefined,
      }}
      initialProfile={{
        profile: {
          about: "",
          avatarUrl: "",
          displayName: "Riley",
          hasProfileEvent: false,
          nip05Handle: null,
          ownerPubkey: PREVIEW_PUBKEY,
          pubkey: PREVIEW_PUBKEY,
        },
      }}
      key={`${PREVIEW_PUBKEY}:${flowKey}`}
      pubkey={PREVIEW_PUBKEY}
    />
  );
}
