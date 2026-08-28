import * as React from "react";
import { ArrowUpRight, BookOpen, Folder, KeyRound } from "lucide-react";

import {
  getResidentContinuity,
  type ResidentContinuityInspector,
} from "@/shared/api/tauriContinuity";
import type { ManagedAgent } from "@/shared/api/types";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import {
  managedAgentSummary,
  residentAvailabilityLabel,
  residentSourceLabel,
} from "@/features/agents/ui/agentLibraryViewModel";

export function ChatResidentPreview({
  displayName,
  managedAgent,
  onOpenFullProfile,
  pubkey,
}: {
  displayName: string;
  managedAgent?: ManagedAgent;
  onOpenFullProfile: (section?: "overview" | "notebook") => void;
  pubkey: string;
}) {
  const [continuity, setContinuity] =
    React.useState<ResidentContinuityInspector | null>(null);
  const [continuityUnavailable, setContinuityUnavailable] =
    React.useState(false);
  const managedResidentPubkey = managedAgent?.pubkey ?? null;

  React.useEffect(() => {
    let cancelled = false;
    setContinuity(null);
    setContinuityUnavailable(false);
    if (!managedResidentPubkey) return;
    void getResidentContinuity(pubkey)
      .then((next) => {
        if (!cancelled) setContinuity(next);
      })
      .catch(() => {
        if (!cancelled) setContinuityUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [managedResidentPubkey, pubkey]);

  const resident = managedAgent ? managedAgentSummary(managedAgent) : null;
  const workspace = managedAgent?.nativeRuntimeBinding?.defaultWorkspace;
  const unresolvedCount = continuity?.handoff?.unresolvedThreads.length ?? 0;

  return (
    <div className="space-y-6 pb-6 pt-5">
      <section className="flex items-center gap-3 border-b border-border/55 pb-5">
        <AgentIdentitySpecimen
          accessibleName={displayName}
          publicKey={pubkey}
          size={44}
          state={
            managedAgent?.lastError
              ? "fault"
              : managedAgent?.status === "running" ||
                  managedAgent?.status === "deployed"
                ? "present"
                : managedAgent
                  ? "idle"
                  : "unavailable"
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="truncate text-base font-medium">{displayName}</h2>
            <span className="font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground">
              {resident
                ? residentAvailabilityLabel(resident.availability)
                : "External"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {resident
              ? [residentSourceLabel(resident), resident.modelLabel]
                  .filter(Boolean)
                  .join(" · ")
              : "External conversation participant"}
          </p>
        </div>
      </section>

      <PreviewSection label="In this conversation">
        <p className="text-sm leading-6 text-ink">
          {managedAgent
            ? "Present as a managed resident."
            : "Present as an external agent. Luca does not manage its runtime or private Notebook."}
        </p>
        {workspace ? (
          <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Folder className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">Working in {workspace}</span>
          </div>
        ) : null}
      </PreviewSection>

      {managedAgent ? (
        <PreviewSection label="Notebook">
          {continuity?.handoff ? (
            <button
              className="group w-full text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onOpenFullProfile("notebook")}
              type="button"
            >
              <div className="flex items-center gap-2 text-sm text-ink">
                <BookOpen className="size-3.5" />
                <span>
                  {unresolvedCount} unresolved{" "}
                  {unresolvedCount === 1 ? "thread" : "threads"}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground group-hover:text-ink-muted">
                {continuity.handoff.summary || "Continuity handoff available."}
              </p>
            </button>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              {continuityUnavailable
                ? "Notebook status is unavailable. Messaging still works normally."
                : continuity?.enabled === false
                  ? "Continuity is disabled for this resident."
                  : "No continuity handoff has been recorded yet."}
            </p>
          )}
        </PreviewSection>
      ) : null}

      <PreviewSection label="Identity">
        <div className="flex items-center gap-2 text-sm text-ink">
          <KeyRound className="size-3.5" />
          <span className="font-mono text-xs">{truncatePubkey(pubkey)}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {managedAgent
            ? "Verified against the resident identity held by Luca."
            : "Signed relay identity. Runtime custody is external to Luca."}
        </p>
      </PreviewSection>

      {managedAgent ? (
        <Button
          className="w-full justify-between"
          onClick={() => onOpenFullProfile("overview")}
          variant="outline"
        >
          Open full agent profile <ArrowUpRight />
        </Button>
      ) : null}
    </div>
  );
}

function PreviewSection({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="border-b border-border/55 pb-5 last:border-b-0">
      <p className="mb-3 font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </section>
  );
}
