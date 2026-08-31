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
  ScrollText,
  Settings2,
  Square,
} from "lucide-react";

import { ResidentDocumentsSection } from "@/features/agents/documents/ResidentDocumentsSection";
import {
  useManagedAgentLogQuery,
  useSetManagedAgentAutoRestartMutation,
} from "@/features/agents/hooks";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { NavigationTransition } from "@/shared/ui/NavigationTransition";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { ResidentHandoffPanel } from "@/features/profile/ui/ResidentContinuityPanel";
import { ResidentNotebookPanel } from "@/features/profile/ui/notebook/ResidentNotebookPanel";
import {
  residentAvailabilityLabel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "./agentLibraryViewModel";
import { ManagedAgentLogPanel } from "./ManagedAgentLogPanel";
import { ResidentModelMenu } from "./ResidentModelMenu";

/**
 * A resident's own page: a status strip (who, how they are, what runs them,
 * the controls), then Documents · Notebook · Settings. Documents is the
 * agent folder and the default; Notebook is their memory as it reads;
 * Settings is the machinery.
 */
export type AgentLibrarySection = "documents" | "notebook" | "settings";

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
  const [logsOpen, setLogsOpen] = React.useState(false);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-card/60">
      <header
        className="border-b border-border/60 px-5 pb-5 pt-11 sm:px-7 md:py-5"
        data-testid="agent-status-strip"
      >
        {/* Wraps at narrow widths: the controls drop below the name instead
            of covering it. */}
        <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3">
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
          <div className="min-w-[10rem] flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="truncate text-xl font-medium tracking-tight">
                {resident.displayName}
              </h2>
              <span
                className="flex items-center gap-2 text-2xs text-muted-foreground"
                data-testid="agent-strip-state"
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    stateDotClass(resident),
                  )}
                />
                {residentAvailabilityLabel(resident.availability)}
              </span>
            </div>
            <div
              className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
              data-testid="agent-strip-runtime"
            >
              <span>{residentSourceLabel(resident)}</span>
              {managedAgent || resident.modelLabel ? (
                <>
                  <Dot />
                  <span data-testid="agent-strip-model">
                    {resident.modelLabel ?? "Default model"}
                  </span>
                </>
              ) : null}
              {resident.pubkey ? (
                <>
                  <Dot />
                  <span className="font-mono text-2xs text-ink-faint">
                    {truncatePubkey(resident.pubkey)}
                  </span>
                </>
              ) : (
                <>
                  <Dot />
                  <span className="text-2xs text-ink-faint">
                    Identity created when started
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
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
                <Button
                  aria-label="Open logs"
                  data-testid="agent-strip-logs"
                  onClick={() => setLogsOpen(true)}
                  size="icon"
                  variant="outline"
                >
                  <ScrollText />
                </Button>
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
            active={section === "documents"}
            label="Documents"
            onClick={() => onSectionChange("documents")}
            testId="agent-tab-documents"
          />
          {managedAgent ? (
            <WorkspaceTab
              active={section === "notebook"}
              label="Notebook"
              onClick={() => onSectionChange("notebook")}
              testId="agent-tab-notebook"
            />
          ) : null}
          <WorkspaceTab
            active={section === "settings"}
            label="Settings"
            onClick={() => onSectionChange("settings")}
            testId="agent-tab-settings"
          />
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
        <NavigationTransition
          className="mx-auto w-full max-w-4xl"
          contentClassName="w-full"
          transitionKey={section}
          variant="section"
        >
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
          {section === "documents" ? (
            managedAgent ? (
              <ResidentDocumentsSection
                agent={managedAgent}
                onRestart={onRestart}
                residentName={resident.displayName}
              />
            ) : (
              <DocumentsBeforeSetup
                onStart={onStart}
                persona={persona}
                residentName={resident.displayName}
              />
            )
          ) : null}
          {section === "notebook" && managedAgent ? (
            <NotebookSection
              residentName={resident.displayName}
              residentPubkey={managedAgent.pubkey}
            />
          ) : null}
          {section === "settings" ? (
            <SettingsSection
              channels={channels}
              managedAgent={managedAgent}
              onEdit={onEdit}
              onOpenChannel={onOpenChannel}
              onRestart={onRestart}
              onStart={onStart}
              onToggleStartOnLaunch={onToggleStartOnLaunch}
              persona={persona}
              resident={resident}
            />
          ) : null}
        </NavigationTransition>
      </div>

      {managedAgent ? (
        <LogsSheet
          agent={managedAgent}
          onOpenChange={setLogsOpen}
          open={logsOpen}
        />
      ) : null}
    </main>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-ghost">
      ·
    </span>
  );
}

function WorkspaceTab({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId?: string;
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
      data-testid={testId}
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

function LogsSheet({
  agent,
  onOpenChange,
  open,
}: {
  agent: ManagedAgent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const log = useManagedAgentLogQuery(open ? agent.pubkey : null, 400);
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="flex w-full flex-col gap-0 sm:max-w-2xl"
        data-testid="agent-logs-sheet"
        side="right"
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base font-medium">
            {agent.name} · logs
          </SheetTitle>
          <SheetDescription className="text-2xs text-muted-foreground">
            The harness log for this resident. Newest lines at the bottom.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <ManagedAgentLogPanel
            chrome="bare"
            error={log.error instanceof Error ? log.error : null}
            isLoading={log.isPending}
            logContent={log.data?.content ?? null}
            selectedAgent={agent}
            variant="inline"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DocumentsBeforeSetup({
  onStart,
  persona,
  residentName,
}: {
  onStart: () => void;
  persona: AgentPersona | null;
  residentName: string;
}) {
  return (
    <div className="max-w-2xl" data-testid="resident-documents-before-setup">
      <p className="text-sm leading-6 text-muted-foreground">
        {residentName} doesn't have a folder yet. Their documents — soul,
        convictions, self-model, user model, lessons, instructions — are laid
        down when the resident is set up
        {persona?.systemPrompt
          ? ", starting from this definition's instructions"
          : ""}
        .
      </p>
      <Button className="mt-4" onClick={onStart} size="sm" variant="outline">
        <Play /> Set up resident
      </Button>
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
              <span className="font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground group-open:hidden">
                Show
              </span>
              <span className="hidden font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground group-open:inline">
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
  channels,
  managedAgent,
  onEdit,
  onOpenChannel,
  onRestart,
  onStart,
  onToggleStartOnLaunch,
  persona,
  resident,
}: {
  channels: Array<{ id: string; name: string }>;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onOpenChannel: (channelId: string) => void;
  onRestart: () => void;
  onStart: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const autoRestart = useSetManagedAgentAutoRestartMutation();
  const nativeBinding = managedAgent?.nativeRuntimeBinding;
  const workspace = nativeBinding?.defaultWorkspace;

  return (
    <div
      className="divide-y divide-border/55 border-y border-border/55"
      data-testid="agent-settings"
    >
      <LedgerSection eyebrow="Runtime" title="What runs them">
        <LedgerRow label="Runtime" value={residentSourceLabel(resident)} />
        {managedAgent ? (
          <div className="grid min-w-0 gap-1 border-b border-border/40 py-3 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5">
            <span className="flex items-center text-xs text-muted-foreground">
              Model
            </span>
            <div className="max-w-sm">
              <p className="mb-2 text-2xs leading-4 text-muted-foreground">
                For a one-off task, use a resident already running the model you
                need.
              </p>
              <ResidentModelMenu
                agent={managedAgent}
                testId="agent-settings-model"
                variant="field"
              />
              <p className="mt-2 text-2xs leading-4 text-muted-foreground">
                This choice follows the resident into every room. Changing it
                restarts the resident; their name, identity, and documents stay
                the same.
              </p>
            </div>
          </div>
        ) : resident.modelLabel ? (
          <LedgerRow label="Model" value={resident.modelLabel} />
        ) : null}
        {nativeBinding ? (
          <>
            <LedgerRow
              label={nativeBinding.kind === "hermes" ? "Profile" : "Agent ID"}
              value={
                nativeBinding.kind === "hermes"
                  ? nativeBinding.profileName
                  : nativeBinding.agentId
              }
            />
            <LedgerRow label="Version" value={nativeBinding.runtimeVersion} />
            <LedgerRow
              label="Executable"
              mono
              value={nativeBinding.executablePath}
            />
          </>
        ) : null}
        <Button
          className="mt-4"
          data-testid="agent-settings-advanced"
          onClick={onEdit}
          size="sm"
          variant="outline"
        >
          <Settings2 /> Advanced…
        </Button>
      </LedgerSection>

      {managedAgent ? (
        <LedgerSection eyebrow="Lifecycle" title="When they run">
          <div className="flex items-center justify-between gap-6 py-2">
            <div>
              <p className="text-sm">Wakes with the app</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Starts when Polyphonic opens, so the first message never waits
                on a cold start. Everyone else wakes when you message them.
              </p>
            </div>
            <Switch
              aria-label="Wakes with the app"
              checked={managedAgent.startOnAppLaunch}
              onCheckedChange={onToggleStartOnLaunch}
            />
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-border/40 py-3">
            <div>
              <p className="text-sm">
                Restart on their own when settings change
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                After a document or setting changes, restart once they are idle
                so the new version takes effect without being asked.
              </p>
            </div>
            <Switch
              aria-label="Restart automatically when configuration changes"
              checked={managedAgent.autoRestartOnConfigChange}
              data-testid="agent-settings-auto-restart"
              disabled={autoRestart.isPending}
              onCheckedChange={(enabled) =>
                autoRestart.mutate({
                  pubkey: managedAgent.pubkey,
                  autoRestartOnConfigChange: enabled,
                })
              }
            />
          </div>
          <LedgerRow label="Responds to" value={managedAgent.respondTo} />
        </LedgerSection>
      ) : null}

      <LedgerSection eyebrow="Working context" title="Workspace">
        <LedgerRow
          icon={Folder}
          label="Default location"
          value={workspace ?? "No native workspace reported"}
        />
        {managedAgent?.documentsDir ? (
          <LedgerRow
            icon={Folder}
            label="Documents"
            mono
            value={managedAgent.documentsDir}
          />
        ) : null}
      </LedgerSection>

      <LedgerSection eyebrow="Conversations" title="Recent chats">
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
                <span className="font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground">
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

      <LedgerSection eyebrow="Identity" title="Custody and recovery">
        <LedgerRow
          icon={KeyRound}
          label="Public identity"
          mono
          value={managedAgent?.pubkey ?? "Created when the resident starts"}
        />
        {managedAgent?.pubkey ? (
          <LedgerRow label="Custody" value="Held in local secure storage" />
        ) : null}
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
        <p className="font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground">
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

function stateDotClass(resident: ResidentSummaryViewModel): string {
  switch (resident.availability) {
    case "failed":
    case "degraded":
      return "bg-destructive/80";
    case "working":
    case "ready":
      return "bg-primary";
    default:
      return "bg-muted-foreground/40";
  }
}

function identityState(resident: ResidentSummaryViewModel) {
  if (resident.availability === "failed") return "fault" as const;
  if (resident.availability === "working") return "working" as const;
  if (resident.availability === "idle") return "idle" as const;
  if (resident.availability === "offline") return "unavailable" as const;
  return "present" as const;
}
