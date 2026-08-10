import { AlertCircle, Check } from "lucide-react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useConnectedBrainInventoryQuery } from "@/features/luca/brain/hooks";
import type { PolyphonicOnboardingChapter } from "../polyphonicOnboardingState";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";

export function PolyphonicReadyStep({
  agentsNeedAttention,
  brainNeedsAttention,
  displayName,
  onReview,
  profileNeedsAttention,
}: {
  agentsNeedAttention: boolean;
  brainNeedsAttention: boolean;
  displayName: string;
  onReview: (chapter: PolyphonicOnboardingChapter) => void;
  profileNeedsAttention: boolean;
}) {
  const residents = useManagedAgentsQuery();
  const brain = useConnectedBrainInventoryQuery();
  const residentCount = residents.data?.length ?? 0;
  const sources =
    brain.data?.sources.filter((source) => source.status !== "disconnected") ??
    [];
  const brainIssues = sources.filter(
    (source) =>
      source.status === "needs_attention" || source.status === "unavailable",
  ).length;
  const issueCount =
    Number(profileNeedsAttention) +
    Number(agentsNeedAttention || residents.isError) +
    Number(brainNeedsAttention) +
    brainIssues;
  const rows = [
    { label: "You", value: displayName || "Ready", review: "you" as const },
    {
      label: "Agents",
      value: `${residentCount} ready to work`,
      review: "agents" as const,
    },
    {
      label: "Brain",
      value: `${sources.length} source groups connected`,
      review: "brain" as const,
    },
  ];

  return (
    <>
      <PolyphonicStepHeading
        description="Your private agent network is ready. Every choice remains available from Agents, Brain, or Settings."
        stage="ready"
        title="Everything is in its place"
      />
      <div className="mt-6 overflow-hidden rounded-lg border border-[hsl(var(--mn-border))] bg-[hsl(var(--mn-surface))]">
        {rows.map((row) => (
          <button
            className="flex min-h-14 w-full items-center gap-3 border-b border-[hsl(var(--mn-border))] px-4 text-left last:border-b-0 hover:bg-[hsl(var(--mn-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
            key={row.label}
            onClick={() => onReview(row.review)}
            type="button"
          >
            <span className="w-16 text-xs text-white/42">{row.label}</span>
            <span className="flex-1 text-sm text-white/82">{row.value}</span>
            <span className="text-xs text-white/40">Review</span>
          </button>
        ))}
      </div>
      <p
        className="mt-4 flex items-center gap-2 text-xs text-white/48"
        role="status"
      >
        {issueCount ? (
          <>
            <AlertCircle className="h-3.5 w-3.5" /> {issueCount} item
            {issueCount === 1 ? "" : "s"} need attention
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5" /> Setup is complete
          </>
        )}
      </p>
    </>
  );
}
