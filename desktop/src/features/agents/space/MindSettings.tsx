import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "@/features/agents/ui/AgentLibraryWorkspace";
import { ResidentModelMenu } from "@/features/agents/ui/ResidentModelMenu";
import {
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { BrainView } from "@/features/luca/brain/BrainView";
import {
  useConnectedBrainInventoryQuery,
  useOwnerBrainStateQuery,
} from "@/features/luca/brain/hooks";
import { ResidentAccessControl } from "@/features/settings/ui/ResidentCapabilitySettings";
import { getResidentCapabilitySettings } from "@/shared/api/residentCapabilities";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

type RowId =
  | "runtime"
  | "wakes"
  | "workspace"
  | "read"
  | "permissions"
  | "identity"
  | "character"
  | "rooms"
  | "health"
  | "companion";

/**
 * Settings: how they run (SHELL_BUILD.md WP-13, Decided 5 and 6), in the
 * study's form: one row per section, its title and its current value in
 * plain words. A row opens today's controls in place beneath it, so nothing
 * is lost; help text shows only in an open row. A section a mind doesn't
 * have hides.
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
  const name = resident.displayName;
  const [open, setOpen] = React.useState<ReadonlySet<RowId>>(
    () => new Set(focusRead ? ["read"] : []),
  );
  const readRef = React.useRef<HTMLLIElement | null>(null);
  const toggle = (id: RowId) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // `/brain` lands here: What they can read, already open.
  React.useEffect(() => {
    if (!focusRead) return;
    setOpen((current) => new Set([...current, "read"]));
    readRef.current?.scrollIntoView({ block: "start" });
    onReadFocused?.();
  }, [focusRead, onReadFocused]);

  const readValue = useWhatTheyCanRead(Boolean(resident.pubkey));
  const permissionsValue = usePermissionsValue(managedAgent?.pubkey ?? null);
  const restartFirst =
    managedAgent?.needsRestart &&
    managedAgent.backend.type === "local" &&
    isRunning;

  return (
    <ul
      className="luca-mind-list luca-mind-settings"
      data-testid="agent-settings"
    >
      <SettingRow
        id="runtime"
        onToggle={toggle}
        open={open}
        title="Connected app and model"
        value={[
          residentSourceLabel(resident),
          managedAgent || resident.modelLabel
            ? (resident.modelLabel ?? "Default model")
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
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
      </SettingRow>

      {managedAgent ? (
        <SettingRow
          id="wakes"
          onToggle={toggle}
          open={open}
          title="Wakes with the app"
          value={managedAgent.startOnAppLaunch ? "On" : "Off"}
        >
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
        </SettingRow>
      ) : null}

      <SettingRow
        id="workspace"
        onToggle={toggle}
        open={open}
        title="Workspace"
        value={workspace ?? "No native workspace reported"}
      >
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
      </SettingRow>

      {resident.pubkey ? (
        <SettingRow
          id="read"
          onToggle={toggle}
          open={open}
          rowRef={readRef}
          testId="mind-what-they-can-read"
          title={`What ${name} can read`}
          value={readValue}
        >
          <BrainView embedded residentPubkey={resident.pubkey} />
        </SettingRow>
      ) : null}

      {managedAgent ? (
        <SettingRow
          id="permissions"
          onToggle={toggle}
          open={open}
          title="Permissions"
          value={permissionsValue}
        >
          <ResidentAccessControl residentPubkey={managedAgent.pubkey} />
        </SettingRow>
      ) : null}

      <SettingRow
        id="identity"
        onToggle={toggle}
        open={open}
        title="Identity"
        value={
          managedAgent?.pubkey
            ? `Signed as ${name} · ${truncatePubkey(managedAgent.pubkey)}`
            : "Created when the resident starts"
        }
      >
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
      </SettingRow>

      {resident.pubkey ? (
        <SettingRow
          id="character"
          onToggle={toggle}
          open={open}
          title="Your character"
          value=""
        >
          <CharacterAppearancePicker
            avatarUrl={resident.avatarUrl}
            name={name}
            publicKey={resident.pubkey}
          />
        </SettingRow>
      ) : null}

      {channels.length > 0 ? (
        <SettingRow
          id="rooms"
          onToggle={toggle}
          open={open}
          title="Recent rooms"
          value={`${channels.length} ${channels.length === 1 ? "room" : "rooms"}`}
        >
          <div className="divide-y divide-border/45">
            {channels.slice(0, 6).map((channel) => (
              <button
                className="flex w-full items-center justify-between gap-4 py-3 text-left text-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                key={channel.id}
                onClick={() => onOpenChannel(channel.id)}
                type="button"
              >
                <span>{channel.name}</span>
                <span className="text-xs text-muted-foreground">Open</span>
              </button>
            ))}
          </div>
        </SettingRow>
      ) : null}

      {managedAgent?.needsRestart || managedAgent?.lastError ? (
        <SettingRow
          id="health"
          onToggle={toggle}
          open={open}
          title="Runtime health"
          value={
            managedAgent.lastError ? "Needs attention" : "Restart required"
          }
        >
          <div className="flex items-start gap-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{managedAgent.lastError ?? "Restart required"}</span>
          </div>
          <Button
            className="mt-4"
            onClick={restartFirst ? onRestart : onStart}
            size="sm"
            variant="outline"
          >
            <RotateCcw />
            {restartFirst ? "Restart resident" : "Retry runtime"}
          </Button>
        </SettingRow>
      ) : null}

      {managedAgent ? (
        <SettingRow
          id="companion"
          onToggle={toggle}
          open={open}
          title="Awareness and initiative"
          value=""
        >
          <CompanionSettingsSection
            bare
            key={managedAgent.pubkey}
            residentPubkey={managedAgent.pubkey}
          />
        </SettingRow>
      ) : null}
    </ul>
  );
}

/** One section: its title and current value, opening its controls. */
function SettingRow({
  children,
  id,
  onToggle,
  open,
  rowRef,
  testId,
  title,
  value,
}: {
  children: React.ReactNode;
  id: RowId;
  onToggle: (id: RowId) => void;
  open: ReadonlySet<RowId>;
  rowRef?: React.Ref<HTMLLIElement>;
  testId?: string;
  title: string;
  value: string;
}) {
  const isOpen = open.has(id);
  const panelId = `mind-setting-${id}`;
  return (
    <li
      className="luca-mind-setting"
      data-open={isOpen ? "true" : undefined}
      data-testid={testId ?? `mind-setting-${id}`}
      ref={rowRef}
    >
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="luca-mind-row-open"
        onClick={() => onToggle(id)}
        type="button"
      >
        <span className="luca-mind-title">{title}</span>
        <span className="luca-mind-value">{value}</span>
      </button>
      {isOpen ? (
        <div className="@container luca-mind-setting-panel" id={panelId}>
          {children}
        </div>
      ) : null}
    </li>
  );
}

/** What they can read, in a breath: Brain's sources as its cards count them. */
function useWhatTheyCanRead(enabled: boolean): string {
  const connected = useConnectedBrainInventoryQuery({ enabled });
  const owner = useOwnerBrainStateQuery({ enabled });
  const sources = (connected.data?.sources ?? []).filter(
    (source) => source.status !== "disconnected",
  );
  const count = (kind: string) =>
    sources.filter((source) => source.sourceKind === kind).length;
  const repositories = count("repository");
  const histories = [
    count("claude_history") > 0 ? "Claude Code" : null,
    count("codex_history") > 0 ? "Codex" : null,
  ].filter(Boolean);
  const files = owner.data?.sources.length ?? 0;
  const parts = [
    repositories > 0
      ? `${repositories} ${repositories === 1 ? "repository" : "repositories"}`
      : null,
    histories.length > 0 ? `${histories.join(" and ")} history` : null,
    files > 0 ? `${files} ${files === 1 ? "file" : "files"}` : null,
  ].filter(Boolean);
  if (!connected.data) return "";
  return parts.length > 0 ? parts.join(" · ") : "Nothing connected";
}

/** Their machine access, as today's picker names it. */
function usePermissionsValue(residentPubkey: string | null): string {
  const settings = useQuery({
    enabled: Boolean(residentPubkey),
    queryFn: getResidentCapabilitySettings,
    queryKey: ["resident-capability-settings"],
  });
  if (!settings.data || !residentPubkey) return "";
  const level =
    settings.data.residentAccess[residentPubkey] ??
    settings.data.householdDefault;
  return level === "full" ? "Don't ask me" : "Work in my project";
}
