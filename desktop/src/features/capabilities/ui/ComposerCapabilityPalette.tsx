import { useQuery } from "@tanstack/react-query";
import { Box, BookOpen, Command, Plug, Search, Wrench } from "lucide-react";
import * as React from "react";

import {
  useCapabilitySkills,
  useResidentSessionCapabilities,
} from "@/features/capabilities/hooks";
import {
  type CapabilityPaletteStatus,
  capabilitySkillStatus,
  filterCapabilityPaletteItems,
  nextCapabilityPaletteIndex,
} from "@/features/capabilities/lib/capabilityPalette";
import {
  listLucaMcpRegistry,
  listRuntimeConnectionStatus,
  listRuntimeOwnedMcpCatalog,
} from "@/shared/api/tauriMcp";
import { resolveCapabilitySkillActivation } from "@/shared/api/tauriCapabilities";
import { cn } from "@/shared/lib/cn";

export type CapabilityResidentOption = {
  pubkey: string;
  name: string;
};

export type ComposerCapabilitySelection =
  | {
      kind: "command";
      residentPubkey: string;
      runtimeFamily: string;
      sessionEpoch: number;
      canonicalName: string;
      label: string;
    }
  | {
      kind: "runtime_task";
      residentPubkey: string;
      runtimeFamily: "codex" | "claude_code";
      label: string;
    }
  | {
      kind: "skill";
      residentPubkey: string;
      runtimeFamily: string;
      catalogId: string;
      catalogGeneration: string;
      canonicalName: string;
      label: string;
    }
  | {
      kind: "mcp_preference";
      residentPubkey: string;
      runtimeFamily: string;
      catalogId: string;
      catalogGeneration: string;
      canonicalName: string;
      label: string;
    };

type PaletteItem = {
  id: string;
  section: "Commands" | "Skills" | "Connections";
  name: string;
  description: string;
  status: CapabilityPaletteStatus | null;
  disabled: boolean;
  run: () => void | Promise<void>;
  icon: React.ReactNode;
};

export function ComposerCapabilityPalette({
  open,
  onClose,
  onCommand,
  onError,
  onSelection,
  residents,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (selection: ComposerCapabilitySelection) => void;
  onError: (message: string) => void;
  onSelection: (selection: ComposerCapabilitySelection) => void;
  residents: CapabilityResidentOption[];
}) {
  const [query, setQuery] = React.useState("");
  const [selectedResidentPubkey, setSelectedResidentPubkey] = React.useState(
    residents.length === 1 ? (residents[0]?.pubkey ?? "") : "",
  );
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectedResident =
    residents.find((resident) => resident.pubkey === selectedResidentPubkey) ??
    null;
  const capabilityQuery = useResidentSessionCapabilities(
    selectedResident?.pubkey ?? null,
  );
  const skillsQuery = useCapabilitySkills();
  const registryQuery = useQuery({
    queryKey: ["luca-mcp-registry", "capability-palette"],
    queryFn: listLucaMcpRegistry,
    enabled: open,
    retry: false,
    staleTime: 10_000,
  });
  const runtimeMcpQuery = useQuery({
    queryKey: ["runtime-owned-mcp", "capability-palette"],
    queryFn: listRuntimeOwnedMcpCatalog,
    enabled: open,
    retry: false,
    staleTime: 10_000,
  });
  const runtimeStatusQuery = useQuery({
    queryKey: ["runtime-task-targets", "capability-palette"],
    queryFn: listRuntimeConnectionStatus,
    enabled: open,
    retry: false,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (residents.length === 1) {
      setSelectedResidentPubkey(residents[0]?.pubkey ?? "");
    } else if (
      selectedResidentPubkey &&
      !residents.some((resident) => resident.pubkey === selectedResidentPubkey)
    ) {
      setSelectedResidentPubkey("");
    }
  }, [residents, selectedResidentPubkey]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      0,
    );
  }, [open]);

  const runtimeFamily = capabilityQuery.data?.runtimeFamily ?? null;
  const catalogRuntime =
    runtimeFamily === "claude_code" ? "claude" : runtimeFamily;
  const liveCommands = capabilityQuery.data?.commands ?? [];
  const skillNameCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skillsQuery.data ?? []) {
      if (!catalogRuntime || !skill.runtimeIds.includes(catalogRuntime))
        continue;
      const name = normalizeName(skill.name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [catalogRuntime, skillsQuery.data]);

  const items = React.useMemo<PaletteItem[]>(() => {
    const rows: PaletteItem[] = [];
    const taskTargets = (runtimeStatusQuery.data ?? []).filter(
      (runtime) =>
        (runtime.runtimeId === "codex" ||
          runtime.runtimeId === "claude_code") &&
        runtime.readiness === "ready" &&
        runtime.authentication === "ready",
    );
    if (selectedResident) {
      const defaultTarget = taskTargets.some(
        (runtime) => runtime.runtimeId === runtimeFamily,
      )
        ? (runtimeFamily as "codex" | "claude_code")
        : (taskTargets[0]?.runtimeId as "codex" | "claude_code" | undefined);
      rows.push({
        id: "polyphonic:runtime-task",
        section: "Commands",
        name: "/task",
        description: "Run a new Codex or Claude Code task",
        status: runtimeStatusQuery.isLoading
          ? "Checking"
          : defaultTarget
            ? "Ready"
            : "Needs setup",
        disabled: !defaultTarget,
        run: () => {
          if (!defaultTarget) return;
          onSelection({
            kind: "runtime_task",
            residentPubkey: selectedResident.pubkey,
            runtimeFamily: defaultTarget,
            label: "Run task",
          });
        },
        icon: <Box aria-hidden />,
      });
    }
    for (const command of liveCommands) {
      rows.push({
        id: `command:${command.canonicalName}`,
        section: "Commands",
        name: command.canonicalName,
        description:
          command.description || command.inputHint || "Runtime command",
        status: "Ready",
        disabled: !selectedResident,
        run: () => {
          if (!selectedResident || !runtimeFamily || !capabilityQuery.data)
            return;
          onCommand({
            kind: "command",
            residentPubkey: selectedResident.pubkey,
            runtimeFamily,
            sessionEpoch: capabilityQuery.data.sessionEpoch,
            canonicalName: command.canonicalName,
            label: command.canonicalName,
          });
        },
        icon: <Command aria-hidden />,
      });
    }

    for (const skill of skillsQuery.data ?? []) {
      const name = normalizeName(skill.name);
      const runtimeMatches = Boolean(
        catalogRuntime && skill.runtimeIds.includes(catalogRuntime),
      );
      const commandMatches = liveCommands.filter(
        (command) => normalizeName(command.canonicalName.slice(1)) === name,
      );
      const duplicate = (skillNameCounts.get(name) ?? 0) > 1;
      const checking = Boolean(selectedResident) && capabilityQuery.isLoading;
      const ready = runtimeMatches && commandMatches.length === 1 && !duplicate;
      rows.push({
        id: `skill:${skill.skillId}`,
        section: "Skills",
        name: skill.name,
        description: skill.description,
        status: capabilitySkillStatus({
          residentSelected: Boolean(selectedResident),
          checking,
          ready,
        }),
        disabled: !ready || pendingId === skill.skillId,
        run: async () => {
          if (!selectedResident) return;
          setPendingId(skill.skillId);
          try {
            const activation = await resolveCapabilitySkillActivation(
              skill.skillId,
              selectedResident.pubkey,
            );
            if (
              activation.status !== "ready" ||
              !activation.canonicalName ||
              !activation.runtimeFamily
            ) {
              onError(
                activation.reason ??
                  "This Skill is not available to the selected resident session.",
              );
              return;
            }
            onSelection({
              kind: "skill",
              residentPubkey: selectedResident.pubkey,
              runtimeFamily: activation.runtimeFamily,
              catalogId: activation.skillId,
              catalogGeneration: activation.catalogGeneration,
              canonicalName: activation.canonicalName,
              label: skill.name,
            });
          } catch {
            onError(
              "Polyphonic could not verify this Skill for the selected resident session.",
            );
          } finally {
            setPendingId(null);
          }
        },
        icon: <BookOpen aria-hidden />,
      });
    }

    if (selectedResident && runtimeFamily) {
      const runtimeCatalog = (runtimeMcpQuery.data ?? []).find(
        (catalog) => catalog.runtimeId === runtimeFamily,
      );
      for (const server of runtimeCatalog?.servers ?? []) {
        if (server.status !== "configured") continue;
        rows.push({
          id: `mcp:runtime:${runtimeFamily}:${server.name}`,
          section: "Connections",
          name: server.name,
          description: `Configured in ${runtimeCatalog?.label ?? runtimeFamily}`,
          status: "Ready",
          disabled: false,
          run: () =>
            onSelection({
              kind: "mcp_preference",
              residentPubkey: selectedResident.pubkey,
              runtimeFamily,
              catalogId: `runtime:${runtimeFamily}:${server.name}`,
              catalogGeneration: runtimeMcpQuery.dataUpdatedAt.toString(),
              canonicalName: server.name,
              label: server.name,
            }),
          icon: <Plug aria-hidden />,
        });
      }
      const registry = registryQuery.data;
      const granted = new Set(
        (registry?.grants ?? [])
          .filter((grant) => grant.residentPubkey === selectedResident.pubkey)
          .map((grant) => grant.connectionId),
      );
      for (const connection of registry?.connections ?? []) {
        if (!connection.enabled || !granted.has(connection.connectionId))
          continue;
        const health = registry?.health.find(
          (entry) => entry.connectionId === connection.connectionId,
        );
        rows.push({
          id: `mcp:polyphonic:${connection.connectionId}`,
          section: "Connections",
          name: connection.name,
          description: "Granted to this resident",
          status:
            health?.readiness === "failed" || health?.readiness === "locked"
              ? "Needs setup"
              : "Ready",
          disabled:
            health?.readiness === "failed" || health?.readiness === "locked",
          run: () =>
            onSelection({
              kind: "mcp_preference",
              residentPubkey: selectedResident.pubkey,
              runtimeFamily,
              catalogId: connection.connectionId,
              catalogGeneration: registryQuery.dataUpdatedAt.toString(),
              canonicalName: connection.name,
              label: connection.name,
            }),
          icon: <Wrench aria-hidden />,
        });
      }
    }
    return rows;
  }, [
    capabilityQuery.data,
    capabilityQuery.isLoading,
    catalogRuntime,
    liveCommands,
    onCommand,
    onError,
    onSelection,
    pendingId,
    registryQuery.data,
    registryQuery.dataUpdatedAt,
    runtimeFamily,
    runtimeMcpQuery.data,
    runtimeMcpQuery.dataUpdatedAt,
    runtimeStatusQuery.data,
    runtimeStatusQuery.isLoading,
    selectedResident,
    skillNameCounts,
    skillsQuery.data,
  ]);

  const filtered = React.useMemo(
    () => filterCapabilityPaletteItems(items, query),
    [items, query],
  );
  const enabledItems = filtered.filter((item) => !item.disabled);

  React.useEffect(() => {
    setActiveIndex((index) =>
      Math.min(index, Math.max(0, enabledItems.length - 1)),
    );
  }, [enabledItems.length]);

  if (!open) return null;

  const runActive = () => {
    const item = enabledItems[activeIndex];
    if (!item) return;
    void item.run();
    onClose();
  };

  return (
    <div
      aria-label="Skills and tools"
      className="absolute inset-x-0 bottom-[calc(100%+0.55rem)] z-50 overflow-hidden rounded-2xl border border-border/60 bg-popover/98 shadow-2xl backdrop-blur-xl"
      data-testid="composer-capability-palette"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) =>
            nextCapabilityPaletteIndex(index, enabledItems.length, 1),
          );
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((index) =>
            nextCapabilityPaletteIndex(index, enabledItems.length, -1),
          );
        } else if (event.key === "Enter") {
          event.preventDefault();
          runActive();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Search aria-hidden className="size-4 text-muted-foreground" />
        <input
          aria-label="Search skills and tools"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search commands, Skills, and connections"
          ref={inputRef}
          value={query}
        />
        {residents.length > 1 ? (
          <select
            aria-label="Resident"
            className="max-w-36 rounded-md bg-muted px-2 py-1 text-xs outline-none"
            onChange={(event) =>
              setSelectedResidentPubkey(event.currentTarget.value)
            }
            value={selectedResidentPubkey}
          >
            <option value="">Choose resident</option>
            {residents.map((resident) => (
              <option key={resident.pubkey} value={resident.pubkey}>
                {resident.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5" role="listbox">
        {!selectedResident ? (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Box aria-hidden className="size-4" />
            Choose a resident to see what this session can use.
          </div>
        ) : null}
        {(["Commands", "Skills", "Connections"] as const).map((section) => {
          const rows = filtered.filter((item) => item.section === section);
          if (rows.length === 0) return null;
          return (
            <section key={section}>
              <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {section}
              </p>
              {rows.map((item) => {
                const enabledIndex = enabledItems.findIndex(
                  (entry) => entry.id === item.id,
                );
                const active =
                  enabledIndex >= 0 && enabledIndex === activeIndex;
                return (
                  <button
                    aria-disabled={item.disabled}
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left",
                      active && "bg-accent",
                      item.disabled && "opacity-55",
                    )}
                    disabled={item.disabled}
                    key={item.id}
                    onClick={() => {
                      void item.run();
                      onClose();
                    }}
                    onMouseEnter={() => {
                      if (enabledIndex >= 0) setActiveIndex(enabledIndex);
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted [&_svg]:size-3.5">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    {item.status ? (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {item.status}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          );
        })}
        {selectedResident && filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No matching capability.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function residentOptionsEqual(
  left: CapabilityResidentOption[],
  right: CapabilityResidentOption[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (resident, index) =>
        resident.pubkey === right[index]?.pubkey &&
        resident.name === right[index]?.name,
    )
  );
}
