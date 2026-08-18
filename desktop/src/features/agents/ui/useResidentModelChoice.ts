import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  managedAgentsQueryKey,
  useAcpRuntimesQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { updateManagedAgent } from "@/shared/api/tauri";
import {
  startManagedAgent,
  stopManagedAgent,
} from "@/shared/api/tauriManagedAgents";
import type { ManagedAgent } from "@/shared/api/types";
import {
  runtimeSupportsLlmProviderSelection,
  type PersonaModelOption,
} from "./agentConfigOptions";
import { useAgentDialogDefaults } from "./useAgentDialogDefaults";
import { usePersonaModelDiscovery } from "./usePersonaModelDiscovery";

export type ResidentModelOption = { label: string; value: string };

const EMPTY_ENV_VARS: Record<string, string> = {};
const EMPTY_RUNTIMES: readonly [] = [];

/**
 * Best-effort human label for a runtime that is not in the catalog (missing
 * CLI, hand-typed custom command). Takes the executable off the front of the
 * command line, drops any directory prefix and script extension, and returns
 * what is left — e.g. `/opt/homebrew/bin/claude-code-acp --stdio` → `claude-code-acp`.
 *
 * Deliberately does not invent title-casing: `buzz-agent` must stay
 * `buzz-agent`, not become "Buzz Agent".
 */
export function tidyRuntimeCommandLabel(agentCommand: string): string | null {
  const trimmed = agentCommand.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const executable = trimmed.split(/\s+/)[0] ?? trimmed;
  const segment = executable.split(/[\\/]/).pop() ?? executable;
  const withoutExtension = segment.replace(
    /\.(exe|cmd|bat|sh|js|mjs|cjs|ts)$/i,
    "",
  );
  return withoutExtension.length > 0 ? withoutExtension : null;
}

/**
 * Merges the discovered model catalog with the model the resident is actually
 * running.
 *
 * Two invariants the drawer depends on:
 *  - the current model is ALWAYS offered, even when discovery failed, returned
 *    nothing, or the model was pinned by hand and is not in the harness list —
 *    otherwise the picker would render with no selected value and a change
 *    would look like it had already happened;
 *  - one row per value. Discovery can legitimately repeat an id (the harness's
 *    own "default" entry is already folded into the canonical empty-id row by
 *    `getDiscoveredPersonaModelOptions`), and a repeated row reads as two
 *    different choices that do the same thing.
 *
 * Catalog order is preserved and an injected current model is appended, so a
 * known model never jumps position just because it happens to be selected.
 */
export function mergeResidentModelOptions({
  currentModel,
  discovered,
}: {
  currentModel: string | null;
  discovered: readonly PersonaModelOption[] | null;
}): ResidentModelOption[] {
  const options: ResidentModelOption[] = [];
  const seen = new Set<string>();

  for (const option of discovered ?? []) {
    const value = option.id.trim();
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ label: option.label.trim() || value, value });
  }

  const trimmedCurrent = (currentModel ?? "").trim();
  if (trimmedCurrent.length > 0 && !seen.has(trimmedCurrent)) {
    options.push({ label: trimmedCurrent, value: trimmedCurrent });
  }

  return options;
}

function envVarsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

/**
 * Keeps the previous object identity while the contents are unchanged.
 * `usePersonaModelDiscovery` takes `envVars` as an effect dependency, and the
 * managed-agent summary poll re-materialises `agent.envVars` every few
 * seconds — without this, discovery would be abandoned and re-issued on a
 * cadence instead of running once.
 */
function useStableEnvVars(
  next: Record<string, string>,
): Record<string, string> {
  const ref = React.useRef(next);
  const previous = ref.current;
  if (previous !== next && envVarsEqual(previous, next)) {
    return previous;
  }
  ref.current = next;
  return next;
}

/**
 * Show and change the MODEL of one managed resident in a single gesture.
 *
 * Model is per agent, not per conversation: this reads and writes
 * `ManagedAgent.model`, so every conversation the resident is in follows the
 * same choice.
 *
 * Mirrors the resolution `AgentInstanceEditDialog` performs, minus the dialog:
 * the runtime is matched out of the ACP catalog by the agent's resolved
 * command, the effective provider falls back agent → linked persona → global
 * default, and discovery runs against the layered env (global < persona <
 * agent) so it has the credentials it needs to list models.
 *
 * Pass `null` while no resident is selected — every hook still runs, and the
 * returned values collapse to empty.
 */
export function useResidentModelChoice(agent: ManagedAgent | null): {
  /** Human runtime label, e.g. "Codex", "Claude Code", "Hermes"; null while unknown. */
  runtimeLabel: string | null;
  /** The model the agent effectively runs (agent.model, else the inherited persona/global default), or null if unknown. */
  currentModel: string | null;
  /** Options to offer: the discovered models for this agent's runtime/provider, always including currentModel if it isn't in the list. */
  options: ResidentModelOption[];
  /** True while discovery is loading or the change is applying. */
  busy: boolean;
  /** Discovery status text when there's nothing to choose from (e.g. missing API key), else null. */
  status: string | null;
  /** Persist the model for this agent, then restart it if it is running so the change takes effect. Resolves when done; throws on failure. */
  setModel: (model: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const [applying, setApplying] = React.useState(false);

  const hasAgent = agent !== null;
  const pubkey = agent?.pubkey ?? null;
  const isRunning = agent?.status === "running";
  const agentCommand = agent?.agentCommand.trim() ?? "";

  // ── Runtime ────────────────────────────────────────────────────────────────
  const runtimesQuery = useAcpRuntimesQuery({ enabled: hasAgent });
  const runtimes = runtimesQuery.data ?? EMPTY_RUNTIMES;
  const runtimesSettled = !runtimesQuery.isPending;

  // Same dual match the edit dialog uses: catalog entries are keyed by their
  // resolved command, but a record can also carry the bare runtime id.
  const matchedRuntime = React.useMemo(() => {
    if (agentCommand.length === 0) {
      return undefined;
    }
    return (
      runtimes.find((runtime) => runtime.command?.trim() === agentCommand) ??
      runtimes.find((runtime) => runtime.id === agentCommand)
    );
  }, [agentCommand, runtimes]);

  const runtimeLabel = React.useMemo(() => {
    if (!hasAgent) {
      return null;
    }
    if (matchedRuntime) {
      return matchedRuntime.label;
    }
    // Withhold the raw command until the catalog has settled — otherwise the
    // label flashes `claude-code-acp` and then becomes "Claude Code".
    return runtimesSettled ? tidyRuntimeCommandLabel(agentCommand) : null;
  }, [agentCommand, hasAgent, matchedRuntime, runtimesSettled]);

  // ── Inheritance (persona + global defaults) ────────────────────────────────
  const personasQuery = usePersonasQuery();
  const linkedPersona = React.useMemo(
    () =>
      agent?.personaId
        ? (personasQuery.data?.find(
            (persona) => persona.id === agent.personaId,
          ) ?? null)
        : null,
    [agent?.personaId, personasQuery.data],
  );
  const personaEnvVars = linkedPersona?.envVars ?? EMPTY_ENV_VARS;

  const {
    globalConfig,
    inheritedDefaults: {
      model: inheritedModelDefault,
      provider: inheritedProviderDefault,
    },
  } = useAgentDialogDefaults({
    inheritedEnvVars: personaEnvVars,
    open: hasAgent,
  });

  // ── Discovery ──────────────────────────────────────────────────────────────
  // Global env is the base layer, persona env next, agent env on top — the
  // same precedence the spawn path applies, so discovery sees exactly the
  // credentials the resident will run with.
  const envVarsForDiscovery = useStableEnvVars({
    ...globalConfig.env_vars,
    ...personaEnvVars,
    ...(agent?.envVars ?? EMPTY_ENV_VARS),
  });

  const effectiveProvider =
    (agent?.provider ?? "").trim() ||
    (linkedPersona?.provider ?? "").trim() ||
    inheritedProviderDefault.value.trim();
  // Runtimes that own their provider (claude, codex) must not have one forced
  // onto discovery — the dialog passes "" for them too.
  const providerForDiscovery = runtimeSupportsLlmProviderSelection(
    matchedRuntime?.id ?? "",
  )
    ? effectiveProvider
    : "";

  const {
    discoveredModelOptions,
    modelDiscoveryLoading,
    modelDiscoveryStatus,
  } = usePersonaModelDiscovery({
    envVars: envVarsForDiscovery,
    isCustomProviderEditing: false,
    modelFieldVisible: true,
    open: hasAgent,
    provider: providerForDiscovery,
    selectedRuntime: matchedRuntime,
  });

  const currentModel = hasAgent
    ? (agent?.model ?? "").trim() ||
      (linkedPersona?.model ?? "").trim() ||
      inheritedModelDefault.value.trim() ||
      null
    : null;

  const options = React.useMemo(
    () =>
      hasAgent
        ? mergeResidentModelOptions({
            currentModel,
            discovered: discoveredModelOptions,
          })
        : [],
    [currentModel, discoveredModelOptions, hasAgent],
  );

  // ── Apply ──────────────────────────────────────────────────────────────────
  const setModel = React.useCallback(
    async (model: string) => {
      if (pubkey === null) {
        throw new Error("No resident selected.");
      }
      setApplying(true);
      try {
        const trimmed = model.trim();
        // Tri-state on the wire: null clears the pin so the resident falls back
        // to the persona/global default; a value pins it.
        await updateManagedAgent({
          pubkey,
          model: trimmed.length > 0 ? trimmed : null,
        });
        await queryClient.invalidateQueries({
          queryKey: managedAgentsQueryKey,
        });

        // The model only reaches the process at spawn time, so a running
        // resident has to be cycled for the choice to mean anything.
        //
        // No double-restart risk with `autoRestartOnConfigChange`: nothing in
        // the backend acts on that flag (`update_managed_agent` in
        // src-tauri/src/commands/agent_models.rs never restarts; the field is
        // only stored, projected onto the summary, and toggled by
        // `set_managed_agent_auto_restart`). The only auto-restart is the
        // app-level `useAutoRestartPolicy` loop, which requires `needsRestart`
        // to hold green for AUTO_RESTART_QUIESCENCE_MS (3 minutes) before it
        // fires and re-checks `needsRestart` immediately before firing. This
        // restart lands in seconds and clears `needsRestart`, so that loop
        // holds instead of firing — while waiting for it would leave an
        // explicit owner gesture unapplied for minutes, or forever on a
        // non-local backend.
        if (isRunning) {
          await stopManagedAgent(pubkey);
          await startManagedAgent(pubkey);
          await queryClient.invalidateQueries({
            queryKey: managedAgentsQueryKey,
          });
        }
      } finally {
        setApplying(false);
      }
    },
    [isRunning, pubkey, queryClient],
  );

  return {
    runtimeLabel,
    currentModel,
    options,
    busy: hasAgent && (modelDiscoveryLoading || applying),
    status: hasAgent ? (modelDiscoveryStatus?.message ?? null) : null,
    setModel,
  };
}
