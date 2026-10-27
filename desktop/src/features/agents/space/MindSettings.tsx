import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CircleAlert,
  Folder,
  KeyRound,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Settings2,
  Square,
} from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
  useSetManagedAgentAutoRestartMutation,
} from "@/features/agents/hooks";
import { artifactMcpCapabilityPresentation } from "@/features/agents/lib/artifactMcpCapability";
import { AgentConfigPanel } from "@/features/agents/ui/AgentConfigPanel";
import { CharacterAppearancePicker } from "@/features/agents/ui/CharacterAppearancePicker";
import {
  CompanionSettingsSection,
  LedgerRow,
} from "@/features/agents/ui/AgentLibraryWorkspace";
import { ResidentModelMenu } from "@/features/agents/ui/ResidentModelMenu";
import {
  agentConfigurationViewModel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { BrainMindAccess } from "@/features/luca/brain/BrainMindAccess";
import { useWhatTheyCanRead } from "@/features/luca/brain/hooks";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { ResidentAccessControl } from "@/features/settings/ui/ResidentCapabilitySettings";
import { useSettingsAppName } from "@/features/settings/ui/SettingsSectionHeader";
import { getResidentCapabilitySettings } from "@/shared/api/residentCapabilities";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { agentOriginDescription, authorityLabel } from "./mindRunsOn";
import type { MindSettingsAt } from "./mindSection";

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
 *
 * Settings > Agents' own detail retired into these rows (WP-24, Decided 4):
 * its instructions, runtime configuration and Recheck in Connected app and
 * model; its Canvas tools, boundary, continuity and Manage MCP access in
 * Permissions; its kind and authority in Identity.
 */
export function MindSettings({
  channels,
  focusAt,
  isActionPending,
  managedAgent,
  onEdit,
  onOpenChannel,
  onOpenLogs,
  onFocusAtConsumed,
  onRestart,
  onStart,
  onStop,
  onToggleStartOnLaunch,
  persona,
  resident,
}: {
  channels: Array<{ id: string; name: string }>;
  /** The row a way in names (the address's `at`): opened, in view, lit. */
  focusAt: MindSettingsAt | null;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenLogs?: () => void;
  onFocusAtConsumed?: () => void;
  onRestart: () => void;
  onStart: () => void;
  onStop?: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const autoRestart = useSetManagedAgentAutoRestartMutation();
  const managedQuery = useManagedAgentsQuery();
  const appName = useSettingsAppName();
  const nativeBinding = managedAgent?.nativeRuntimeBinding;
  const workspace = nativeBinding?.defaultWorkspace;
  const isRunning =
    managedAgent?.status === "running" || managedAgent?.status === "deployed";
  const name = resident.displayName;
  const [open, setOpen] = React.useState<ReadonlySet<RowId>>(
    () => new Set(focusAt ? [focusAt] : []),
  );
  // The row a way in opened stays lit until it is closed (WP-26, Decided 4).
  const [lit, setLit] = React.useState<RowId | null>(focusAt);
  const rows = React.useRef(new Map<RowId, HTMLLIElement>());
  const scrollTo = React.useRef<RowId | null>(null);
  const register = React.useCallback(
    (id: RowId, element: HTMLLIElement | null) => {
      if (element) rows.current.set(id, element);
      else rows.current.delete(id);
    },
    [],
  );
  const toggle = (id: RowId) => {
    if (open.has(id)) setLit((current) => (current === id ? null : current));
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // A way in that names a row lands on it: `/brain` on What they can read,
  // an agent showing its runtime on Connected app and model, one asking for
  // access on Permissions. Open and lit at once, then consumed.
  React.useEffect(() => {
    if (!focusAt) return;
    setOpen((current) => new Set([...current, focusAt]));
    setLit(focusAt);
    scrollTo.current = focusAt;
    onFocusAtConsumed?.();
  }, [focusAt, onFocusAtConsumed]);

  // Brought into view once it is drawn: a row whose mind is still loading
  // (Permissions waits for its runtime) is scrolled to when it arrives.
  React.useEffect(() => {
    const id = scrollTo.current;
    const row = id ? rows.current.get(id) : undefined;
    if (!row) return;
    scrollTo.current = null;
    row.scrollIntoView({ block: "start" });
  });

  const readValue = useWhatTheyCanRead(Boolean(resident.pubkey));
  const luca = useCanonicalLucaPubkey();
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
        lit={lit}
        onToggle={toggle}
        open={open}
        register={register}
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
        {managedAgent ? (
          <NoteRow
            detail={
              resident.kind === "managed_native"
                ? `Native instructions remain managed by the native system. ${appName} does not rewrite them.`
                : "Change them with Advanced…"
            }
            label="Instructions"
            testId="mind-setting-instructions"
            value={
              managedAgent.systemPrompt?.trim() ||
              `No ${appName}-managed instructions set.`
            }
          />
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {managedAgent ? (
            <>
              <Button
                disabled={isActionPending}
                onClick={isRunning ? onStop : onStart}
                size="quiet"
                variant="quiet"
              >
                {isRunning ? <Square /> : <Play />}
                {isRunning ? "Stop agent" : "Start agent"}
              </Button>
              {isRunning && managedAgent.backend.type === "local" ? (
                <Button
                  disabled={isActionPending}
                  onClick={onRestart}
                  size="quiet"
                  variant="quiet"
                >
                  <RotateCcw /> Restart agent
                </Button>
              ) : null}
              <Button
                data-testid="agent-strip-logs"
                onClick={onOpenLogs}
                size="quiet"
                variant="quiet"
              >
                <ScrollText /> Open logs
              </Button>
            </>
          ) : null}
          <Button
            data-testid="agent-settings-advanced"
            onClick={onEdit}
            size="quiet"
            variant="quiet"
          >
            <Settings2 /> Advanced…
          </Button>
          {managedAgent ? (
            <Button
              data-testid="mind-setting-recheck"
              disabled={managedQuery.isFetching}
              onClick={() => void managedQuery.refetch()}
              size="quiet"
              title="Checks the exact native profile or agent without modifying it."
              variant="quiet"
            >
              <RefreshCw /> Recheck
            </Button>
          ) : null}
        </div>
        {managedAgent ? (
          <div
            className="mt-5 border-t border-border/40 pt-4"
            data-testid="mind-setting-runtime-config"
          >
            <p className="mb-2 text-xs text-muted-foreground">
              Runtime configuration
            </p>
            <AgentConfigPanel
              advancedMode="flat"
              pubkey={managedAgent.pubkey}
            />
          </div>
        ) : null}
      </SettingRow>

      {managedAgent ? (
        <SettingRow
          id="wakes"
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
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
        lit={lit}
        onToggle={toggle}
        open={open}
        register={register}
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
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
          testId="mind-what-they-can-read"
          title={`What ${name} can read`}
          value={readValue}
        >
          {/* This mind's own access; Brain itself is its own place
              (BETA14_RELEASE.md WP-38, Decided 3). */}
          <BrainMindAccess
            isLuca={Boolean(luca && normalizePubkey(resident.pubkey) === luca)}
            name={name}
            residentPubkey={resident.pubkey}
          />
        </SettingRow>
      ) : null}

      {/* Every mind Settings > Agents listed: one running here, or one
          waiting to be set up; a mind not on this Mac has none. */}
      {managedAgent || persona ? (
        <SettingRow
          id="permissions"
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
          title="Permissions"
          value={managedAgent ? permissionsValue : "After setup"}
        >
          <MindPermissions
            appName={appName}
            managedAgent={managedAgent}
            persona={persona}
            resident={resident}
          />
        </SettingRow>
      ) : null}

      <SettingRow
        id="identity"
        lit={lit}
        onToggle={toggle}
        open={open}
        register={register}
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
        <LedgerRow label="Kind" value={agentOriginDescription(resident)} />
        <NoteRow
          detail={`Runtime: ${agentConfigurationViewModel(resident).authorities.runtime.replaceAll("_", " ")} · Continuity and permissions: ${appName} managed`}
          label="Authority"
          value={authorityLabel(resident, appName)}
        />
      </SettingRow>

      {resident.pubkey ? (
        <SettingRow
          id="character"
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
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
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
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
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
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
            size="quiet"
            variant="quiet"
          >
            <RotateCcw />
            {restartFirst ? "Restart resident" : "Retry runtime"}
          </Button>
        </SettingRow>
      ) : null}

      {managedAgent ? (
        <SettingRow
          id="companion"
          lit={lit}
          onToggle={toggle}
          open={open}
          register={register}
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

/**
 * Permissions (WP-24, Decided 4): their machine access, then what the
 * retired Capabilities tab said beside it, the Canvas tools, the boundary
 * and continuity, and the way to their MCP grants. Drawn only while the row
 * is open, so the runtimes are read only then.
 */
function MindPermissions({
  appName,
  managedAgent,
  persona,
  resident,
}: {
  appName: string;
  managedAgent: ManagedAgent | null;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
}) {
  const { goSettings } = useAppNavigation();
  const runtimesQuery = useAcpRuntimesQuery();
  const canvas = artifactMcpCapabilityPresentation({
    runtimeReference: managedAgent?.agentCommand ?? persona?.runtime ?? null,
    runtimes: runtimesQuery.data,
    loading: runtimesQuery.isPending,
    failed: runtimesQuery.isError,
  });
  return (
    <>
      {managedAgent ? (
        <ResidentAccessControl residentPubkey={managedAgent.pubkey} />
      ) : (
        <p className="pb-3 text-sm text-muted-foreground">
          Set up {resident.displayName} before giving them machine access.
        </p>
      )}
      <div className="mt-4">
        <NoteRow
          capabilityState={canvas.state}
          detail={canvas.detail}
          label="Canvas tools"
          testId="agent-artifact-mcp-capability"
          value={canvas.value}
        />
        <NoteRow
          detail={`MCP access never grants tool approval. Every protected action still uses ${appName}’s existing permission flow.`}
          label="Boundary"
          value="Fail closed"
        />
        <NoteRow
          detail="Private continuity jobs never receive MCP tools."
          label="Continuity"
          value={
            managedAgent
              ? `Available as a ${appName}-managed overlay`
              : "Available after setup"
          }
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {`Their ${appName} MCP grants are in Connections & MCP.`}
        </p>
        <Button
          data-testid="mind-setting-manage-mcp"
          onClick={() => void goSettings("connections")}
          size="quiet"
          variant="quiet"
        >
          Manage MCP access <ArrowUpRight />
        </Button>
      </div>
    </>
  );
}

/** A LedgerRow with a quiet line under its value. */
function NoteRow({
  capabilityState,
  detail,
  label,
  testId,
  value,
}: {
  capabilityState?: string;
  detail?: string;
  label: string;
  testId?: string;
  value: string;
}) {
  return (
    <div
      className="grid min-w-0 gap-1 border-b border-border/40 py-3 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5"
      data-capability-state={capabilityState}
      data-testid={testId}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0">
        <span className="block break-words text-sm">{value}</span>
        {detail ? (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** One section: its title and current value, opening its controls. */
function SettingRow({
  children,
  id,
  lit,
  onToggle,
  open,
  register,
  testId,
  title,
  value,
}: {
  children: React.ReactNode;
  id: RowId;
  lit: RowId | null;
  onToggle: (id: RowId) => void;
  open: ReadonlySet<RowId>;
  register: (id: RowId, element: HTMLLIElement | null) => void;
  testId?: string;
  title: string;
  value: string;
}) {
  const isOpen = open.has(id);
  const panelId = `mind-setting-${id}`;
  return (
    <li
      className="luca-mind-setting"
      data-lit={lit === id ? "true" : undefined}
      data-open={isOpen ? "true" : undefined}
      data-testid={testId ?? `mind-setting-${id}`}
      ref={(element) => register(id, element)}
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

/** What they can read, in a breath; it lives with Brain now (WP-38). */
export { useWhatTheyCanRead };

/** Their machine access, as today's picker names it. */
export function usePermissionsValue(residentPubkey: string | null): string {
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
