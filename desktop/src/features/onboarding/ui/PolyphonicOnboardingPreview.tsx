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
  | PolyphonicOnboardingChapter;

const stages = new Set<PolyphonicOnboardingPreviewStage>([
  "threshold",
  "prototype",
  "you",
  "agents",
  "brain",
  "ready",
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

function prepareProductionFlow(stage: PolyphonicOnboardingChapter) {
  clearPolyphonicOnboardingTransaction(PREVIEW_PUBKEY);
  savePolyphonicOnboardingTransaction({
    ...createPolyphonicOnboardingTransaction(PREVIEW_PUBKEY),
    chapter: stage,
    profileSaved: stage !== "you",
    agentsReviewed: stage === "brain" || stage === "ready",
    brainReviewed: stage === "ready",
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
    prepareProductionFlow("you");
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
