import * as React from "react";
import {
  ArrowLeft,
  CircleAlert,
  Folder,
  KeyRound,
  MessageCircle,
  MoreHorizontal,
  Play,
  RotateCcw,
  Settings2,
  Square,
} from "lucide-react";

import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import {
  getResidentContinuity,
  type ResidentContinuityInspector,
} from "@/shared/api/tauriContinuity";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { ResidentHandoffPanel } from "@/features/profile/ui/ResidentContinuityPanel";
import { ResidentNotebookPanel } from "@/features/profile/ui/notebook/ResidentNotebookPanel";
import {
  residentAvailabilityLabel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "./agentLibraryViewModel";

export type AgentLibrarySection = "overview" | "notebook" | "settings";

export function AgentLibraryWorkspace({
  actionErrorMessage,
  actionNoticeMessage,
  channels,
  isActionPending,
  managedAgent,
  onBack,
  onEdit,
  onMessage,
  onOpenChannel,
  onSectionChange,
  onRestart,
  onStart,
  onStop,
  onToggleStartOnLaunch,
  persona,
  resident,
  section,
  showBackButton = false,
}: {
  actionErrorMessage: string | null;
  actionNoticeMessage: string | null;
  channels: Array<{ id: string; name: string }>;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onBack: () => void;
  onEdit: () => void;
  onMessage: () => void;
  onOpenChannel: (channelId: string) => void;
  onSectionChange: (section: AgentLibrarySection) => void;
  onRestart: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
  section: AgentLibrarySection;
  showBackButton?: boolean;
}) {
  const isRunning =
    managedAgent?.status === "running" || managedAgent?.status === "deployed";

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card/60">
      <header className="border-b border-border/60 px-5 pb-5 pt-11 sm:px-7 md:py-5">
        <div className="flex min-w-0 items-start gap-4">
          <Button
            aria-label="Back to agents"
            className={cn("mt-0.5", !showBackButton && "hidden")}
            onClick={onBack}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          {resident.pubkey ? (
            <AgentIdentitySpecimen
              accessibleName={resident.displayName}
              publicKey={resident.pubkey}
              size={52}
              state={identityState(resident)}
            />
          ) : (
            <span className="flex size-[52px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border/70 font-mono text-base text-muted-foreground">
              {resident.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="truncate text-xl font-medium tracking-tight">
                {resident.displayName}
              </h2>
              <span className="font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                {residentAvailabilityLabel(resident.availability)}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[residentSourceLabel(resident), resident.modelLabel]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {resident.pubkey ? (
              <p className="mt-1 font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground/75">
                {truncatePubkey(resident.pubkey)}
              </p>
            ) : (
              <p className="mt-1 font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground/75">
                Identity created when started
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {managedAgent ? (
              <>
                <Button
                  aria-label={`Message ${resident.displayName}`}
                  disabled={isActionPending}
                  onClick={onMessage}
                  size="sm"
                >
                  <MessageCircle />
                  <span className="hidden sm:inline">Message</span>
                </Button>
                <Button
                  aria-label={isRunning ? "Stop agent" : "Start agent"}
                  disabled={isActionPending}
                  onClick={isRunning ? onStop : onStart}
                  size="icon"
                  variant="outline"
                >
                  {isRunning ? <Square /> : <Play />}
                </Button>
                {isRunning && managedAgent.backend.type === "local" ? (
                  <Button
                    aria-label="Restart agent"
                    disabled={isActionPending}
                    onClick={onRestart}
                    size="icon"
                    variant="outline"
                  >
                    <RotateCcw />
                  </Button>
                ) : null}
              </>
            ) : (
              <Button disabled={isActionPending} onClick={onStart} size="sm">
                <Play /> Set up resident
              </Button>
            )}
            <Button
              aria-label="Edit agent"
              onClick={onEdit}
              size="icon"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
          </div>
        </div>

        <nav aria-label="Agent workspace" className="mt-5 flex gap-6">
          <WorkspaceTab
            active={section === "overview"}
            label="Overview"
            onClick={() => onSectionChange("overview")}
          />
          {managedAgent ? (
            <WorkspaceTab
              active={section === "notebook"}
              label="Notebook"
              onClick={() => onSectionChange("notebook")}
            />
          ) : null}
          <WorkspaceTab
            active={section === "settings"}
            label="Settings"
            onClick={() => onSectionChange("settings")}
          />
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        <div className="mx-auto w-full max-w-4xl">
          {actionErrorMessage ? (
            <div
              className="mb-5 flex items-start gap-3 border border-destructive/35 bg-destructive/8 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{actionErrorMessage}</span>
            </div>
          ) : actionNoticeMessage ? (
            <div
              className="mb-5 border border-border/70 bg-background/55 px-4 py-3 text-sm text-foreground"
              role="status"
            >
              {actionNoticeMessage}
            </div>
          ) : null}
          {section === "overview" ? (
            <OverviewSection
              channels={channels}
              managedAgent={managedAgent}
              onOpenChannel={onOpenChannel}
              persona={persona}
              resident={resident}
            />
          ) : null}
          {section === "notebook" && managedAgent ? (
            <NotebookSection
              residentName={resident.displayName}
              residentPubkey={managedAgent.pubkey}
            />
          ) : null}
          {section === "settings" ? (
            <SettingsSection
              managedAgent={managedAgent}
              onEdit={onEdit}
              onRestart={onRestart}
              onStart={onStart}
              onToggleStartOnLaunch={onToggleStartOnLaunch}
              persona={persona}
              resident={resident}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function WorkspaceTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative pb-2 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
      ) : null}
    </button>
  );
}

function OverviewSection({
  channels,
  managedAgent,
  onOpenChannel,
  persona,
  resident,
}: {
  channels: Array<{ id: string; name: string }>;
  managedAgent: ManagedAgent | null;
  onOpenChannel: (channelId: string) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const [continuity, setContinuity] =
    React.useState<ResidentContinuityInspector | null>(null);
  const [continuityUnavailable, setContinuityUnavailable] =
    React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setContinuity(null);
    setContinuityUnavailable(false);
    if (!managedAgent) return;
    void getResidentContinuity(managedAgent.pubkey)
      .then((next) => {
        if (!cancelled) setContinuity(next);
      })
      .catch(() => {
        if (!cancelled) setContinuityUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [managedAgent]);

  const nativeBinding = managedAgent?.nativeRuntimeBinding;
  const workspace = nativeBinding?.defaultWorkspace;

  return (
    <div className="divide-y divide-border/55 border-y border-border/55">
      <LedgerSection eyebrow="Status" title="Current state">
        <LedgerRow
          label="Availability"
          value={residentAvailabilityLabel(resident.availability)}
        />
        {managedAgent?.lastError ? (
          <LedgerRow danger label="Last error" value={managedAgent.lastError} />
        ) : null}
        {managedAgent?.needsRestart ? (
          <LedgerRow label="Binding" value="Restart required" />
        ) : null}
      </LedgerSection>

      <LedgerSection eyebrow="Native system" title="Runtime and model">
        <LedgerRow label="Runtime" value={residentSourceLabel(resident)} />
        {resident.modelLabel ? (
          <LedgerRow label="Model" value={resident.modelLabel} />
        ) : null}
        {nativeBinding ? (
          <LedgerRow
            label={nativeBinding.kind === "hermes" ? "Profile" : "Agent ID"}
            value={
              nativeBinding.kind === "hermes"
                ? nativeBinding.profileName
                : nativeBinding.agentId
            }
          />
        ) : null}
        {managedAgent ? (
          <LedgerRow
            label="Version"
            value={nativeBinding?.runtimeVersion ?? "Managed by Luca"}
          />
        ) : (
          <LedgerRow label="Setup" value="Resident not started" />
        )}
      </LedgerSection>

      <LedgerSection eyebrow="Working context" title="Workspace">
        <LedgerRow
          icon={Folder}
          label="Default location"
          value={workspace ?? "No native workspace reported"}
        />
        {persona?.systemPrompt ? (
          <LedgerRow label="Instructions" value="Configured" />
        ) : null}
      </LedgerSection>

      {managedAgent ? (
        <LedgerSection eyebrow="Continuity" title="Current handoff">
          {continuity?.handoff ? (
            <>
              <p className="max-w-2xl text-sm leading-6 text-foreground/90">
                {continuity.handoff.summary || "No summary recorded."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MiniMetric
                  label="Unresolved"
                  value={continuity.handoff.unresolvedThreads.length}
                />
                <MiniMetric
                  label="Commitments"
                  value={continuity.handoff.commitments.length}
                />
                <MiniMetric
                  label="Preferences"
                  value={continuity.handoff.explicitPreferences.length}
                />
              </div>
            </>
          ) : continuityUnavailable ? (
            <p className="text-sm text-muted-foreground">
              Continuity is unavailable. Messaging still works normally.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {continuity?.enabled === false
                ? "Continuity is disabled."
                : "No handoff has been recorded yet."}
            </p>
          )}
        </LedgerSection>
      ) : null}

      <LedgerSection eyebrow="Conversations" title="Recent rooms">
        {channels.length > 0 ? (
          <div className="divide-y divide-border/45">
            {channels.slice(0, 6).map((channel) => (
              <button
                className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                key={channel.id}
                onClick={() => onOpenChannel(channel.id)}
                type="button"
              >
                <span>{channel.name}</span>
                <span className="font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground">
                  Open
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No shared conversations are available yet.
          </p>
        )}
      </LedgerSection>

      {managedAgent?.pubkey ? (
        <LedgerSection eyebrow="Identity" title="Cryptographic identity">
          <LedgerRow
            icon={KeyRound}
            label="Public key"
            mono
            value={managedAgent.pubkey}
          />
          <LedgerRow label="Custody" value="Held in local secure storage" />
        </LedgerSection>
      ) : null}
    </div>
  );
}

function NotebookSection({
  residentName,
  residentPubkey,
}: {
  residentName: string;
  residentPubkey: string;
}) {
  return (
    <div>
      <ResidentNotebookPanel
        handoffSlot={
          <details className="group border-y border-border/55 py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring">
              <span>Current handoff</span>
              <span className="font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground group-open:hidden">
                Show
              </span>
              <span className="hidden font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground group-open:inline">
                Hide
              </span>
            </summary>
            <div className="pb-3 pt-2">
              <ResidentHandoffPanel residentPubkey={residentPubkey} />
            </div>
          </details>
        }
        residentName={residentName}
        residentPubkey={residentPubkey}
      />
    </div>
  );
}

function SettingsSection({
  managedAgent,
  onEdit,
  onRestart,
  onStart,
  onToggleStartOnLaunch,
  persona,
  resident,
}: {
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onRestart: () => void;
  onStart: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  return (
    <div className="divide-y divide-border/55 border-y border-border/55">
      <LedgerSection eyebrow="Runtime" title="Binding and model">
        <LedgerRow label="Runtime" value={residentSourceLabel(resident)} />
        {resident.modelLabel ? (
          <LedgerRow label="Model" value={resident.modelLabel} />
        ) : null}
        {managedAgent?.nativeRuntimeBinding ? (
          <LedgerRow
            label="Executable"
            mono
            value={managedAgent.nativeRuntimeBinding.executablePath}
          />
        ) : null}
        <Button className="mt-4" onClick={onEdit} size="sm" variant="outline">
          <Settings2 /> Edit configuration
        </Button>
      </LedgerSection>

      {managedAgent ? (
        <LedgerSection eyebrow="Lifecycle" title="Startup behavior">
          <div className="flex items-center justify-between gap-6 py-2">
            <div>
              <p className="text-sm">Start when Luca opens</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Restore this resident with a fresh runtime session whenever Luca
                opens or relaunches.
              </p>
            </div>
            <Switch
              aria-label="Start resident when Luca opens"
              checked={managedAgent.startOnAppLaunch}
              onCheckedChange={onToggleStartOnLaunch}
            />
          </div>
          <LedgerRow
            label="Automatic restart"
            value={
              managedAgent.autoRestartOnConfigChange ? "Enabled" : "Disabled"
            }
          />
          <LedgerRow label="Responds to" value={managedAgent.respondTo} />
        </LedgerSection>
      ) : null}

      <LedgerSection eyebrow="Identity" title="Custody and recovery">
        <LedgerRow
          label="Public identity"
          mono
          value={managedAgent?.pubkey ?? "Created when the resident starts"}
        />
        <LedgerRow
          label="Definition"
          value={persona ? "Editable Luca definition" : "Runtime-owned profile"}
        />
      </LedgerSection>

      {managedAgent?.needsRestart || managedAgent?.lastError ? (
        <LedgerSection eyebrow="Attention" title="Runtime health">
          <div className="flex items-start gap-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{managedAgent.lastError ?? "Restart required"}</span>
          </div>
          <Button
            className="mt-4"
            onClick={
              managedAgent.needsRestart &&
              managedAgent.backend.type === "local" &&
              (managedAgent.status === "running" ||
                managedAgent.status === "deployed")
                ? onRestart
                : onStart
            }
            size="sm"
            variant="outline"
          >
            <RotateCcw />
            {managedAgent.needsRestart &&
            managedAgent.backend.type === "local" &&
            (managedAgent.status === "running" ||
              managedAgent.status === "deployed")
              ? "Restart resident"
              : "Retry runtime"}
          </Button>
        </LedgerSection>
      ) : null}
    </div>
  );
}

function LedgerSection({
  children,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="grid gap-5 py-6 sm:grid-cols-[160px_minmax(0,1fr)]">
      <div>
        <p className="font-mono text-2xs uppercase tracking-[0.15em] text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-sm font-medium">{title}</h3>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function LedgerRow({
  danger = false,
  icon: Icon,
  label,
  mono = false,
  value,
}: {
  danger?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border/40 py-3 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-sm",
          mono && "font-mono text-xs",
          danger && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-border/60 pl-3">
      <p className="font-mono text-lg leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function identityState(resident: ResidentSummaryViewModel) {
  if (resident.availability === "failed") return "fault" as const;
  if (resident.availability === "working") return "working" as const;
  if (resident.availability === "idle") return "idle" as const;
  if (resident.availability === "offline") return "unavailable" as const;
  return "present" as const;
}
