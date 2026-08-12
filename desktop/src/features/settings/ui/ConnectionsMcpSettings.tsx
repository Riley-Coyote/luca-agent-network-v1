import * as React from "react";
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import {
  deleteLucaMcpConnection,
  listLucaMcpRegistry,
  listRuntimeConnectionStatus,
  saveLucaMcpConnection,
  setAgentMcpGrant,
  testLucaMcpConnection,
  type LucaMcpConnectionV1,
  type LucaMcpRegistryV1,
  type RuntimeConnectionStatusV1,
} from "@/shared/api/tauriMcp";
import type { RuntimeBinding } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

type ConnectionDraft = {
  connectionId?: string;
  name: string;
  command: string;
  args: string;
  enabled: boolean;
  plainEnvironment: string;
  secretEnvironment: string;
};

type NativeRuntimeConnectionStatus = RuntimeConnectionStatusV1 & {
  statusId?: string;
  nativeSemanticId?: string;
  nativeDisplayName?: string;
  readinessBasis?:
    | "bounded_probe"
    | "discovery_only"
    | "native_reported"
    | "binding_validation";
};

type PresentedRuntimeConnectionStatus = NativeRuntimeConnectionStatus & {
  linkedResidentName?: string;
};

const EMPTY_DRAFT: ConnectionDraft = {
  name: "",
  command: "",
  args: "",
  enabled: true,
  plainEnvironment: "",
  secretEnvironment: "",
};

function nativeBindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

function nativeBindingDisplayName(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? binding.profileName.trim()
    : binding.agentId.trim();
}

function parseEnvironment(source: string, kind: "plain" | "secret") {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) {
        if (kind === "secret") return { name: line, kind } as const;
        throw new Error(`Environment entry must use NAME=value: ${line}`);
      }
      const value = line.slice(separator + 1);
      return {
        name: line.slice(0, separator).trim(),
        kind,
        value: kind === "secret" && !value ? undefined : value,
      } as const;
    });
}

function draftFromConnection(connection: LucaMcpConnectionV1): ConnectionDraft {
  return {
    connectionId: connection.connectionId,
    name: connection.name,
    command: connection.command,
    args: connection.args.join("\n"),
    enabled: connection.enabled,
    plainEnvironment: connection.environment
      .filter((binding) => binding.kind === "plain")
      .map((binding) => `${binding.name}=${binding.value ?? ""}`)
      .join("\n"),
    secretEnvironment: connection.environment
      .filter((binding) => binding.kind === "secret")
      .map((binding) => binding.name)
      .join("\n"),
  };
}

export function ConnectionsMcpSettings() {
  const agentsQuery = useManagedAgentsQuery();
  const [registry, setRegistry] = React.useState<LucaMcpRegistryV1 | null>(
    null,
  );
  const [runtimes, setRuntimes] = React.useState<
    NativeRuntimeConnectionStatus[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ConnectionDraft>(EMPTY_DRAFT);
  const [showForm, setShowForm] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const refresh = React.useCallback(async (announce = false) => {
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextRegistry, nextRuntimes] = await Promise.all([
        listLucaMcpRegistry(),
        listRuntimeConnectionStatus(),
      ]);
      setRegistry(nextRegistry);
      setRuntimes(nextRuntimes);
      if (announce) toast.success("Runtime readiness rechecked");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connections could not be loaded.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const presentedRuntimes = React.useMemo(() => {
    const linkedByNativeIdentity = new Map<
      string,
      { name: string; pubkey: string; binding: RuntimeBinding }
    >();
    for (const agent of agentsQuery.data ?? []) {
      if (!agent.nativeRuntimeBinding) continue;
      linkedByNativeIdentity.set(
        nativeBindingIdentity(agent.nativeRuntimeBinding),
        {
          name: agent.name,
          pubkey: agent.pubkey,
          binding: agent.nativeRuntimeBinding,
        },
      );
    }

    const discoveredIdentities = new Set<string>();
    const presented: PresentedRuntimeConnectionStatus[] = runtimes.map(
      (runtime) => {
        if (!runtime.nativeSemanticId) return runtime;
        discoveredIdentities.add(runtime.nativeSemanticId);
        return {
          ...runtime,
          linkedResidentName: linkedByNativeIdentity.get(
            runtime.nativeSemanticId,
          )?.name,
        };
      },
    );

    // New backend projections carry statusId. Preserve compatibility with the
    // deterministic legacy bridge while ensuring a linked native resident can
    // never silently disappear from the real Settings response.
    if (!runtimes.some((runtime) => runtime.statusId)) return presented;

    for (const [semanticId, resident] of linkedByNativeIdentity) {
      if (discoveredIdentities.has(semanticId)) continue;
      const { binding } = resident;
      const runtimeLabel = binding.kind === "hermes" ? "Hermes" : "OpenClaw";
      presented.push({
        statusId: `${binding.kind}:missing:${resident.pubkey}`,
        runtimeId: binding.kind,
        label: `${runtimeLabel} · ${nativeBindingDisplayName(binding)}`,
        executable: binding.executablePath,
        version: binding.runtimeVersion,
        readiness: "unavailable",
        authentication: "not_applicable",
        lastVerifiedAt: null,
        reason:
          "This linked resident was not returned by current native discovery.",
        nativeSemanticId: semanticId,
        nativeDisplayName: nativeBindingDisplayName(binding),
        readinessBasis: "binding_validation",
        linkedResidentName: resident.name,
      });
    }

    return presented;
  }, [agentsQuery.data, runtimes]);

  async function saveConnection() {
    if (!draft.name.trim() || !draft.command.trim()) return;
    setPendingId(draft.connectionId ?? "new");
    setError(null);
    try {
      const next = await saveLucaMcpConnection({
        connectionId: draft.connectionId,
        name: draft.name.trim(),
        command: draft.command.trim(),
        args: draft.args
          .split("\n")
          .map((arg) => arg.trim())
          .filter(Boolean),
        enabled: draft.enabled,
        environment: [
          ...parseEnvironment(draft.plainEnvironment, "plain"),
          ...parseEnvironment(draft.secretEnvironment, "secret"),
        ],
      });
      setRegistry(next);
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      toast.success("MCP connection saved");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connection could not be saved.",
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="min-w-0" data-testid="settings-connections-mcp">
      <SettingsSectionHeader
        action={
          <Button
            aria-expanded={showForm}
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setShowForm((open) => !open);
            }}
            size="sm"
          >
            <Plus className="mr-1.5 size-3.5" /> Add connection
          </Button>
        }
        description="Inspect installed agent runtimes and grant Luca-owned stdio MCP connections to individual agents."
        title="Connections & MCP"
      />

      {error ? (
        <div
          className="mb-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      ) : null}

      <div className="space-y-10">
        <div>
          <SubsectionHeader
            action={
              <Button
                aria-label="Refresh runtimes"
                aria-busy={isRefreshing}
                disabled={isRefreshing}
                onClick={() => void refresh(true)}
                size="icon"
                variant="ghost"
              >
                <RefreshCw
                  className={isRefreshing ? "size-4 animate-spin" : "size-4"}
                />
              </Button>
            }
            description="Luca uses the authentication and configuration already owned by each runtime."
            title="Runtime connections"
          />
          <SettingsOptionGroup>
            {presentedRuntimes.length > 0 ? (
              presentedRuntimes.map((runtime, index) => (
                <SettingsOptionRow
                  className={index ? "border-t border-border/50" : undefined}
                  key={
                    runtime.statusId ?? `${runtime.runtimeId}:${runtime.label}`
                  }
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted/50">
                      <ServerCog className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{runtime.label}</p>
                      {runtime.nativeSemanticId ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {runtime.linkedResidentName
                            ? `Linked resident · ${runtime.linkedResidentName}`
                            : "Native identity detected · not linked to a Luca resident"}
                        </p>
                      ) : null}
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {runtime.executable ?? "Not detected"}
                        {runtime.version ? ` · ${runtime.version}` : ""}
                      </p>
                      {runtime.reason ? (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {runtime.reason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <StatusLabel
                    readinessBasis={runtime.readinessBasis}
                    status={runtime.readiness}
                  />
                </SettingsOptionRow>
              ))
            ) : (
              <SettingsOptionRow>
                <p className="text-sm text-muted-foreground">
                  Checking Claude Code, Codex, Hermes, and OpenClaw…
                </p>
              </SettingsOptionRow>
            )}
          </SettingsOptionGroup>
        </div>

        <div>
          <SubsectionHeader
            description="Definitions are local to Luca. Secret values are stored only in the OS keychain."
            title="Luca MCP connections"
          />

          {showForm ? (
            <div
              className="mb-4 space-y-4 rounded-2xl border border-border/60 bg-muted/15 p-4"
              data-testid="mcp-connection-form"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    aria-label="Connection name"
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Filesystem tools"
                    value={draft.name}
                  />
                </Field>
                <Field label="Command">
                  <Input
                    aria-label="Connection command"
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        command: event.target.value,
                      }))
                    }
                    placeholder="npx"
                    value={draft.command}
                  />
                </Field>
              </div>
              <Field hint="One argument per line." label="Arguments">
                <Textarea
                  aria-label="Connection arguments"
                  className="min-h-20 font-mono text-xs"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      args: event.target.value,
                    }))
                  }
                  placeholder={
                    "-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Projects"
                  }
                  value={draft.args}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field hint="NAME=value, one per line." label="Environment">
                  <Textarea
                    aria-label="Nonsecret environment"
                    className="min-h-20 font-mono text-xs"
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        plainEnvironment: event.target.value,
                      }))
                    }
                    placeholder="LOG_LEVEL=warn"
                    value={draft.plainEnvironment}
                  />
                </Field>
                <Field
                  hint={
                    draft.connectionId
                      ? "Use NAME to retain a Keychain value, or NAME=new-value to replace it."
                      : "Values are written to Keychain and never returned."
                  }
                  label="Secret environment"
                >
                  <Textarea
                    aria-label="Secret environment"
                    autoComplete="off"
                    className="min-h-20 font-mono text-xs"
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        secretEnvironment: event.target.value,
                      }))
                    }
                    placeholder="SERVICE_TOKEN=…"
                    value={draft.secretEnvironment}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setShowForm(false);
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    pendingId === (draft.connectionId ?? "new") ||
                    !draft.name.trim() ||
                    !draft.command.trim()
                  }
                  onClick={() => void saveConnection()}
                >
                  {draft.connectionId ? "Save changes" : "Save connection"}
                </Button>
              </div>
            </div>
          ) : null}

          <SettingsOptionGroup>
            {registry?.connections.length ? (
              registry.connections.map((connection, index) => (
                <ConnectionRow
                  agents={agentsQuery.data ?? []}
                  connection={connection}
                  grants={registry.grants
                    .filter(
                      (grant) => grant.connectionId === connection.connectionId,
                    )
                    .map((grant) => grant.residentPubkey)}
                  health={
                    registry.health.find(
                      (health) =>
                        health.connectionId === connection.connectionId,
                    )?.readiness ?? "untested"
                  }
                  key={connection.connectionId}
                  onDelete={async () => {
                    setPendingId(connection.connectionId);
                    try {
                      setRegistry(
                        await deleteLucaMcpConnection(connection.connectionId),
                      );
                    } finally {
                      setPendingId(null);
                    }
                  }}
                  onGrant={async (pubkey, granted) => {
                    setPendingId(`${connection.connectionId}:${pubkey}`);
                    try {
                      setRegistry(
                        await setAgentMcpGrant(
                          connection.connectionId,
                          pubkey,
                          granted,
                        ),
                      );
                    } finally {
                      setPendingId(null);
                    }
                  }}
                  onEdit={() => {
                    setDraft(draftFromConnection(connection));
                    setShowForm(true);
                  }}
                  onEnabledChange={async (enabled) => {
                    setPendingId(connection.connectionId);
                    try {
                      setRegistry(
                        await saveLucaMcpConnection({
                          connectionId: connection.connectionId,
                          name: connection.name,
                          command: connection.command,
                          args: connection.args,
                          enabled,
                          environment: connection.environment.map(
                            (binding) => ({
                              name: binding.name,
                              kind: binding.kind,
                              value:
                                binding.kind === "plain"
                                  ? (binding.value ?? "")
                                  : undefined,
                            }),
                          ),
                        }),
                      );
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Connection state could not be changed.",
                      );
                    } finally {
                      setPendingId(null);
                    }
                  }}
                  onTest={async () => {
                    setPendingId(connection.connectionId);
                    try {
                      await testLucaMcpConnection(connection.connectionId);
                      await refresh();
                      toast.success("MCP connection responded");
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Connection test failed.",
                      );
                    } finally {
                      setPendingId(null);
                    }
                  }}
                  pendingId={pendingId}
                  separated={index > 0}
                />
              ))
            ) : (
              <SettingsOptionRow>
                <p className="text-sm text-muted-foreground">
                  No Luca-owned MCP connections yet.
                </p>
              </SettingsOptionRow>
            )}
          </SettingsOptionGroup>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Detected native MCP definitions remain source-attributed and
            read-only inside each agent’s Runtime configuration.
          </p>
        </div>
      </div>
    </section>
  );
}

function ConnectionRow({
  agents,
  connection,
  grants,
  health,
  onDelete,
  onEdit,
  onEnabledChange,
  onGrant,
  onTest,
  pendingId,
  separated,
}: {
  agents: Array<{ pubkey: string; name: string }>;
  connection: LucaMcpConnectionV1;
  grants: string[];
  health: string;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  onEnabledChange: (enabled: boolean) => Promise<void>;
  onGrant: (pubkey: string, granted: boolean) => Promise<void>;
  onTest: () => Promise<void>;
  pendingId: string | null;
  separated: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className={separated ? "border-t border-border/50" : undefined}>
      <SettingsOptionRow>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{connection.name}</p>
            <span className="font-mono text-2xs uppercase tracking-[0.1em] text-muted-foreground">
              stdio · {connection.enabled ? health : "disabled"}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {connection.command} {connection.args.join(" ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            aria-label={`${connection.enabled ? "Disable" : "Enable"} ${connection.name}`}
            checked={connection.enabled}
            disabled={pendingId === connection.connectionId}
            onCheckedChange={(enabled) => void onEnabledChange(enabled)}
          />
          <Button
            aria-label={`Edit ${connection.name}`}
            onClick={onEdit}
            size="icon"
            variant="ghost"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            onClick={() => setExpanded((value) => !value)}
            size="sm"
            variant="ghost"
          >
            Agents
          </Button>
          <Button
            disabled={pendingId === connection.connectionId}
            onClick={() => void onTest()}
            size="sm"
            variant="outline"
          >
            Test
          </Button>
          <Button
            aria-label={`Delete ${connection.name}`}
            disabled={pendingId === connection.connectionId}
            onClick={() => void onDelete()}
            size="icon"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </SettingsOptionRow>
      {expanded ? (
        <div className="border-t border-border/45 bg-background/20 px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Granted agents · applies on fresh session
          </p>
          <div className="space-y-1">
            {agents.map((agent) => {
              const granted = grants.includes(agent.pubkey);
              return (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/30"
                  key={agent.pubkey}
                >
                  <span className="text-sm">{agent.name}</span>
                  <Switch
                    aria-label={`Grant ${connection.name} to ${agent.name}`}
                    checked={granted}
                    disabled={
                      pendingId === `${connection.connectionId}:${agent.pubkey}`
                    }
                    onCheckedChange={(next) => void onGrant(agent.pubkey, next)}
                  />
                </div>
              );
            })}
            {agents.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No instantiated agents are available.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusLabel({
  readinessBasis,
  status,
}: {
  readinessBasis?: NativeRuntimeConnectionStatus["readinessBasis"];
  status: RuntimeConnectionStatusV1["readiness"];
}) {
  const discoveryOnly =
    status === "degraded" && readinessBasis === "discovery_only";
  const Icon =
    status === "ready"
      ? CheckCircle2
      : discoveryOnly
        ? CircleDashed
        : status === "unavailable"
          ? CircleSlash
          : TriangleAlert;
  return (
    <span
      className={
        status === "ready" || discoveryOnly
          ? "inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          : "inline-flex items-center gap-1.5 text-xs text-destructive"
      }
    >
      <Icon className="size-3.5" />
      {discoveryOnly
        ? "Detected"
        : status === "ready"
          ? "Ready"
          : status === "degraded"
            ? "Degraded"
            : "Unavailable"}
    </span>
  );
}

function SubsectionHeader({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <div className="block space-y-1.5">
      <span className="block text-xs font-medium">{label}</span>
      {children}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
