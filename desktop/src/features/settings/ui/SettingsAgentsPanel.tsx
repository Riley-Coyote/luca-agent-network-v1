import * as React from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Fingerprint,
  Info,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { cn } from "@/shared/lib/cn";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
  useSetManagedAgentAutoRestartMutation,
  useSetManagedAgentStartOnAppLaunchMutation,
} from "@/features/agents/hooks";
import { AgentConfigPanel } from "@/features/agents/ui/AgentConfigPanel";
import {
  AgentLibraryRoster,
  type AgentLibraryFilter,
} from "@/features/agents/ui/AgentLibraryRoster";
import {
  agentConfigurationViewModel,
  buildResidentLibrary,
  residentAvailabilityLabel,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import type { ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

const SETTINGS_AGENT_SEARCH_KEYS = [
  "section",
  "settingsAgent",
  "settingsAgentTab",
] as const;
type AgentSettingsTab = "general" | "runtime" | "capabilities" | "advanced";

function agentOriginLabel(resident: ResidentSummaryViewModel) {
  if (resident.nativeSource === "hermes") return "Hermes";
  if (resident.nativeSource === "openclaw") return "OpenClaw";
  if (resident.kind === "managed_luca" || resident.kind === "persona_only") {
    return "Polyphonic Agent";
  }
  return "External agent";
}

function agentOriginDescription(resident: ResidentSummaryViewModel) {
  return resident.kind === "managed_native"
    ? `${agentOriginLabel(resident)} · Native-managed agent`
    : `${agentOriginLabel(resident)} · ${residentSourceLabel(resident)}`;
}

function authorityLabel(resident: ResidentSummaryViewModel) {
  return resident.kind === "managed_native"
    ? "Native-managed binding · Luca-managed overlays"
    : "Luca-managed";
}

function identityState(resident: ResidentSummaryViewModel) {
  if (resident.availability === "failed") return "fault" as const;
  if (resident.availability === "offline") return "unavailable" as const;
  if (resident.availability === "working") return "working" as const;
  if (resident.availability === "idle") return "idle" as const;
  return "present" as const;
}

export function SettingsAgentsPanel() {
  const isMobile = useIsMobile();
  const managedQuery = useManagedAgentsQuery();
  const personasQuery = usePersonasQuery();
  const { goAgent, goAgents, goSettings } = useAppNavigation();
  const { applyPatch, values } = useHistorySearchState(
    SETTINGS_AGENT_SEARCH_KEYS,
  );
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<AgentLibraryFilter>("all");
  const library = React.useMemo(
    () =>
      buildResidentLibrary(managedQuery.data ?? [], personasQuery.data ?? []),
    [managedQuery.data, personasQuery.data],
  );
  const selected = React.useMemo(() => {
    const requested = values.settingsAgent;
    if (requested) {
      return (
        library.find(
          (resident) =>
            resident.residentId === requested ||
            (resident.pubkey &&
              normalizePubkey(resident.pubkey) === normalizePubkey(requested)),
        ) ??
        library[0] ??
        null
      );
    }
    return isMobile ? null : (library[0] ?? null);
  }, [isMobile, library, values.settingsAgent]);
  const selectedManagedAgent = React.useMemo(
    () =>
      selected?.pubkey
        ? ((managedQuery.data ?? []).find(
            (agent) =>
              normalizePubkey(agent.pubkey) ===
              normalizePubkey(selected.pubkey ?? ""),
          ) ?? null)
        : null,
    [managedQuery.data, selected],
  );
  const tab: AgentSettingsTab =
    values.settingsAgentTab === "runtime" ||
    values.settingsAgentTab === "capabilities" ||
    values.settingsAgentTab === "advanced"
      ? values.settingsAgentTab
      : "general";

  React.useEffect(() => {
    if (!isMobile && !values.settingsAgent && selected) {
      applyPatch({ settingsAgent: selected.residentId }, { replace: true });
    }
  }, [applyPatch, isMobile, selected, values.settingsAgent]);

  return (
    <section
      className="min-h-[620px] overflow-hidden rounded-2xl border border-border/60 bg-card/30"
      data-testid="settings-agents"
    >
      <div className="flex min-h-[620px] min-w-0">
        {!isMobile || !selected ? (
          <AgentLibraryRoster
            filter={filter}
            onAdd={() => void goAgents()}
            onFilterChange={setFilter}
            onGroups={() => {}}
            onOpenDefaults={() => applyPatch({ section: "defaults" })}
            onQueryChange={setQuery}
            onSelect={(resident) =>
              applyPatch({
                settingsAgent: resident.residentId,
                settingsAgentTab: "general",
              })
            }
            query={query}
            residents={library}
            selectedId={selected?.residentId ?? null}
            showAdd={false}
            showFooter={false}
          />
        ) : null}
        <div
          className={cn(
            "min-w-0 flex-1 overflow-y-auto",
            isMobile && !selected ? "hidden" : "block",
          )}
        >
          {selected ? (
            <>
              {isMobile ? (
                <button
                  className="mx-4 mt-4 inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() =>
                    applyPatch({
                      settingsAgent: null,
                      settingsAgentTab: null,
                    })
                  }
                  type="button"
                >
                  <ArrowLeft className="size-4" />
                  All agents
                </button>
              ) : null}
              <AgentSettingsDetail
                managedAgent={selectedManagedAgent}
                onRevalidate={() => managedQuery.refetch()}
                onOpenLibrary={() => {
                  if (selected.pubkey)
                    void goAgent(selected.pubkey, { section: "settings" });
                }}
                onOpenMcp={() => void goSettings("connections")}
                onTabChange={(nextTab) =>
                  applyPatch({
                    settingsAgentTab: nextTab === "general" ? null : nextTab,
                  })
                }
                resident={selected}
                tab={tab}
              />
            </>
          ) : (
            <div className="grid min-h-[620px] place-items-center px-8 text-center">
              <div>
                <h2 className="text-lg font-medium">No agents configured</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Import a native agent or create a Polyphonic Agent from the
                  Agent Library.
                </p>
                <Button className="mt-5" onClick={() => void goAgents()}>
                  Open Agent Library
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentSettingsDetail({
  managedAgent,
  onOpenLibrary,
  onOpenMcp,
  onRevalidate,
  onTabChange,
  resident,
  tab,
}: {
  managedAgent: ManagedAgent | null;
  onOpenLibrary: () => void;
  onOpenMcp: () => void;
  onRevalidate: () => Promise<unknown>;
  onTabChange: (tab: AgentSettingsTab) => void;
  resident: ResidentSummaryViewModel;
  tab: AgentSettingsTab;
}) {
  const startOnLaunch = useSetManagedAgentStartOnAppLaunchMutation();
  const autoRestart = useSetManagedAgentAutoRestartMutation();
  const configuration = agentConfigurationViewModel(resident);
  const fingerprint = resident.pubkey
    ? truncatePubkey(resident.pubkey)
    : "Created when this agent is started";

  return (
    <div className="min-w-0">
      <header className="border-b border-border/55 px-5 pb-5 pt-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {resident.pubkey ? (
              <AgentIdentitySpecimen
                accessibleName={resident.displayName}
                publicKey={resident.pubkey}
                size={48}
                state={identityState(resident)}
              />
            ) : null}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-medium tracking-tight">
                  {resident.displayName}
                </h2>
                <span className="font-mono text-2xs uppercase tracking-caps-wide text-muted-foreground">
                  {residentAvailabilityLabel(resident.availability)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {agentOriginDescription(resident)}
              </p>
            </div>
          </div>
          <Button
            disabled={!resident.pubkey}
            onClick={onOpenLibrary}
            size="sm"
            variant="outline"
          >
            Open in Agent Library <ArrowUpRight className="ml-1.5 size-3.5" />
          </Button>
        </div>
        <nav
          aria-label="Agent configuration sections"
          className="mt-6 flex gap-5 overflow-x-auto border-b border-border/50 scrollbar-none [&::-webkit-scrollbar]:hidden"
        >
          {(["general", "runtime", "capabilities", "advanced"] as const).map(
            (entry) => (
              <button
                aria-current={tab === entry ? "page" : undefined}
                className={
                  tab === entry
                    ? "-mb-px border-b border-foreground pb-2 text-sm text-foreground"
                    : "-mb-px border-b border-transparent pb-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
                key={entry}
                onClick={() => onTabChange(entry)}
                type="button"
              >
                {entry.charAt(0).toUpperCase() + entry.slice(1)}
              </button>
            ),
          )}
        </nav>
      </header>

      <div className="space-y-6 px-5 py-6 sm:px-7">
        {tab === "general" ? (
          <>
            <AgentSettingBlock
              icon={Fingerprint}
              label="Cryptographic identity"
              value={fingerprint}
            />
            <AgentSettingBlock
              icon={ShieldCheck}
              label="Configuration authority"
              value={authorityLabel(configuration.resident)}
              detail={`Runtime: ${configuration.authorities.runtime.replaceAll("_", " ")} · Continuity and permissions: Luca managed`}
            />
            <AgentSettingBlock
              icon={Info}
              label="Instructions"
              value={
                managedAgent?.systemPrompt?.trim() ||
                "No Luca-managed instructions set."
              }
              detail={
                resident.kind === "managed_native"
                  ? "Native instructions remain managed by the native system. Luca does not rewrite them."
                  : "Editable from the Agent Library when this runtime supports it."
              }
            />
          </>
        ) : null}
        {tab === "runtime" ? (
          resident.pubkey ? (
            <AgentConfigPanel advancedMode="flat" pubkey={resident.pubkey} />
          ) : (
            <EmptyConfiguration message="Start this Polyphonic Agent to create its runtime binding." />
          )
        ) : null}
        {tab === "capabilities" ? (
          <>
            <AgentSettingBlock
              icon={ShieldCheck}
              label="Permission boundary"
              value="Fail closed"
              detail="MCP access never grants tool approval. Every protected action still uses Luca’s existing permission flow."
            />
            <AgentSettingBlock
              icon={LockKeyhole}
              label="Continuity"
              value={
                resident.pubkey
                  ? "Available as a Luca-managed overlay"
                  : "Available after setup"
              }
              detail="Private continuity jobs never receive MCP tools."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Per-agent Luca MCP grants are managed in Connections & MCP.
              </p>
              <Button onClick={onOpenMcp} size="sm" variant="outline">
                Manage MCP access <ArrowUpRight className="ml-1.5 size-3.5" />
              </Button>
            </div>
          </>
        ) : null}
        {tab === "advanced" ? (
          managedAgent ? (
            <SettingsOptionGroup>
              <SettingsOptionRow>
                <div>
                  <p className="text-sm font-medium">Wakes with the app</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Luca-managed overlay; native schedules remain untouched.
                  </p>
                </div>
                <Switch
                  checked={managedAgent.startOnAppLaunch}
                  disabled={startOnLaunch.isPending}
                  onCheckedChange={(enabled) =>
                    startOnLaunch.mutate({
                      pubkey: managedAgent.pubkey,
                      startOnAppLaunch: enabled,
                    })
                  }
                />
              </SettingsOptionRow>
              <SettingsOptionRow className="border-t border-border/50">
                <div>
                  <p className="text-sm font-medium">
                    Restart after Luca config changes
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Applies only to compatible Luca-managed runtime settings.
                  </p>
                </div>
                <Switch
                  checked={managedAgent.autoRestartOnConfigChange}
                  disabled={autoRestart.isPending}
                  onCheckedChange={(enabled) =>
                    autoRestart.mutate({
                      pubkey: managedAgent.pubkey,
                      autoRestartOnConfigChange: enabled,
                    })
                  }
                />
              </SettingsOptionRow>
              <SettingsOptionRow className="border-t border-border/50">
                <div>
                  <p className="text-sm font-medium">
                    Revalidate native binding
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Checks the exact native profile or agent without modifying
                    it.
                  </p>
                </div>
                <Button
                  onClick={() => void onRevalidate()}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw className="mr-1.5 size-3.5" /> Recheck
                </Button>
              </SettingsOptionRow>
            </SettingsOptionGroup>
          ) : (
            <EmptyConfiguration message="This agent has not been instantiated yet." />
          )
        ) : null}
      </div>
    </div>
  );
}

function AgentSettingBlock({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 border-b border-border/45 pb-5 last:border-b-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted/50">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 break-words text-sm text-foreground">{value}</p>
        {detail ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EmptyConfiguration({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-border/50 bg-muted/15 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}
