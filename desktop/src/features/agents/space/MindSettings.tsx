import * as React from "react";
import {
  CircleAlert,
  Folder,
  KeyRound,
  Play,
  RotateCcw,
  ScrollText,
  Settings2,
  Square,
} from "lucide-react";

import { useSetManagedAgentAutoRestartMutation } from "@/features/agents/hooks";
import { CharacterAppearancePicker } from "@/features/agents/ui/CharacterAppearancePicker";
import {
  CompanionSettingsSection,
  LedgerRow,
  LedgerSection,
} from "@/features/agents/ui/AgentLibraryWorkspace";
import { ResidentModelMenu } from "@/features/agents/ui/ResidentModelMenu";
import {
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { BrainView } from "@/features/luca/brain/BrainView";
import { ResidentAccessControl } from "@/features/settings/ui/ResidentCapabilitySettings";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

/**
 * Settings: how they run (SHELL_BUILD.md WP-13, Decided 5 and 6). First the
 * connected app and model, waking with the app, the workspace, What they
 * can read (Brain's body, with this mind's grants), permissions and
 * identity; then today's other sections. A section a mind doesn't have
 * hides. Every control is today's, moved, never redrawn.
 */
export function MindSettings({
  channels,
  focusRead,
  isActionPending,
  managedAgent,
  onEdit,
  onOpenChannel,
  onOpenLogs,
  onReadFocused,
  onRestart,
  onStart,
  onStop,
  onToggleStartOnLaunch,
  persona,
  resident,
}: {
  channels: Array<{ id: string; name: string }>;
  focusRead: boolean;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenLogs?: () => void;
  onReadFocused?: () => void;
  onRestart: () => void;
  onStart: () => void;
  onStop?: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const autoRestart = useSetManagedAgentAutoRestartMutation();
  const nativeBinding = managedAgent?.nativeRuntimeBinding;
  const workspace = nativeBinding?.defaultWorkspace;
  const isRunning =
    managedAgent?.status === "running" || managedAgent?.status === "deployed";
  const readRef = React.useRef<HTMLDivElement | null>(null);
  const name = resident.displayName;

  // `/brain` lands here: on What they can read.
  React.useEffect(() => {
    if (!focusRead || !readRef.current) return;
    readRef.current.scrollIntoView({ block: "start" });
    onReadFocused?.();
  }, [focusRead, onReadFocused]);

  return (
    <div
      className="@container luca-mind-settings divide-y divide-border/55"
      data-testid="agent-settings"
    >
      <LedgerSection eyebrow="Runtime" title="Connected app and model">
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
        <div className="mt-4 flex flex-wrap gap-2">
          {managedAgent ? (
            <>
              <Button
                disabled={isActionPending}
                onClick={isRunning ? onStop : onStart}
                size="sm"
                variant="outline"
              >
                {isRunning ? <Square /> : <Play />}
                {isRunning ? "Stop agent" : "Start agent"}
              </Button>
              {isRunning && managedAgent.backend.type === "local" ? (
                <Button
                  disabled={isActionPending}
                  onClick={onRestart}
                  size="sm"
                  variant="outline"
                >
                  <RotateCcw /> Restart agent
                </Button>
              ) : null}
              <Button
                data-testid="agent-strip-logs"
                onClick={onOpenLogs}
                size="sm"
                variant="outline"
              >
                <ScrollText /> Open logs
              </Button>
            </>
          ) : null}
          <Button
            data-testid="agent-settings-advanced"
            onClick={onEdit}
            size="sm"
            variant="outline"
          >
            <Settings2 /> Advanced…
          </Button>
        </div>
      </LedgerSection>

      {managedAgent ? (
        <LedgerSection eyebrow="Lifecycle" title="Wakes with the app">
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

      {resident.pubkey ? (
        <div
          className="luca-mind-read"
          data-testid="mind-what-they-can-read"
          ref={readRef}
        >
          <LedgerSection
            className="sm:grid-cols-1"
            eyebrow="Brain"
            title={`What ${name} can read`}
          >
            <BrainView embedded residentPubkey={resident.pubkey} />
          </LedgerSection>
        </div>
      ) : null}

      {managedAgent ? (
        <LedgerSection
          className="sm:grid-cols-1"
          eyebrow="Access"
          title="Permissions"
        >
          <ResidentAccessControl residentPubkey={managedAgent.pubkey} />
        </LedgerSection>
      ) : null}

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

      {resident.pubkey ? (
        <LedgerSection eyebrow="Appearance" title="Your character">
          <CharacterAppearancePicker
            avatarUrl={resident.avatarUrl}
            name={name}
            publicKey={resident.pubkey}
          />
        </LedgerSection>
      ) : null}

      {channels.length > 0 ? (
        <LedgerSection eyebrow="Conversations" title="Recent rooms">
          <div className="divide-y divide-border/45">
            {channels.slice(0, 6).map((channel) => (
              <button
                className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                key={channel.id}
                onClick={() => onOpenChannel(channel.id)}
                type="button"
              >
                <span>{channel.name}</span>
                <span className="text-2xs uppercase tracking-caps-wide text-muted-foreground">
                  Open
                </span>
              </button>
            ))}
          </div>
        </LedgerSection>
      ) : null}

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
              isRunning
                ? onRestart
                : onStart
            }
            size="sm"
            variant="outline"
          >
            <RotateCcw />
            {managedAgent.needsRestart &&
            managedAgent.backend.type === "local" &&
            isRunning
              ? "Restart resident"
              : "Retry runtime"}
          </Button>
        </LedgerSection>
      ) : null}

      {managedAgent ? (
        <CompanionSettingsSection
          key={managedAgent.pubkey}
          residentPubkey={managedAgent.pubkey}
        />
      ) : null}
    </div>
  );
}
