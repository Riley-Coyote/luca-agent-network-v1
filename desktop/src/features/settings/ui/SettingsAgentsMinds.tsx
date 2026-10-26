import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import "@/app/shell/shell-place-rails.css";
import "@/app/shell/shell-settings-agents.css";
import { searchForPick } from "@/app/shell/placeRails/placePicks";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { getPersonaLibraryState } from "@/features/agents/lib/catalog";
import {
  mindSettingsAtOfTab,
  type MindSettingsAt,
} from "@/features/agents/space/mindSection";
import {
  mindStateOf,
  useMindSignals,
} from "@/features/agents/lib/useMindState";
import {
  buildResidentLibrary,
  residentSourceLabel,
  type ResidentSummaryViewModel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { useRuntimeRailConnections } from "@/features/runtime-sessions/RuntimeRailSection";
import {
  runtimeConnectionKey,
  runtimeReadinessLabel,
} from "@/features/runtime-sessions/runtimeSessionModel";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";
import { Button } from "@/shared/ui/button";

/** The specimen's box for a 20 body (it draws its body at 29 of 40). */
const MARK_SIZE = 28;

/** The old detail's words in the address, still sent by ways in (an agent
 *  asking to show its runtime or its access). */
const WAYS_IN = ["settingsAgent", "settingsAgentTab"] as const;

/**
 * Settings > Agents under the shell's frame (SHELL_BUILD.md WP-24). Every
 * mind's settings live in its own space (NAVIGATION.md, "A mind's own
 * space"), so this page is a list of them, as the Agents rail lists them:
 * the mark, the name, the connected app and the one state word
 * (useMindState). A row opens that mind's space on its Settings tab. What is
 * for all agents stays: adding one, and the connected apps with their
 * readiness. The second roster, its search and filters, its detail and
 * "Open in Agent Library" are gone; every control the detail had now lives
 * in the mind's Settings tab (MindSettings.tsx).
 */
export function SettingsAgentsMinds() {
  const agentsQuery = useManagedAgentsQuery();
  const personasQuery = usePersonasQuery();
  const { runtimes } = useRuntimeRailConnections();
  const luca = useCanonicalLucaPubkey();
  const signals = useMindSignals();
  const navigate = useNavigate();
  const { values } = useHistorySearchState(WAYS_IN);

  const minds = React.useMemo(() => {
    const library = buildResidentLibrary(
      agentsQuery.data ?? [],
      getPersonaLibraryState(personasQuery.data ?? []).libraryPersonas,
    );
    const isLuca = (resident: ResidentSummaryViewModel) =>
      Boolean(
        luca && resident.pubkey && normalizePubkey(resident.pubkey) === luca,
      );
    // Luca first and set apart, then the rest in the rail's order.
    return [
      ...library.filter(isLuca).map((resident) => ({ resident, main: true })),
      ...library
        .filter((resident) => !isLuca(resident))
        .map((resident) => ({ resident, main: false })),
    ];
  }, [agentsQuery.data, luca, personasQuery.data]);
  const managed = React.useMemo(
    () =>
      new Map(
        (agentsQuery.data ?? []).map((agent) => [
          normalizePubkey(agent.pubkey),
          agent,
        ]),
      ),
    [agentsQuery.data],
  );
  const ready =
    agentsQuery.data !== undefined && personasQuery.data !== undefined;

  const openMind = React.useCallback(
    (
      resident: ResidentSummaryViewModel,
      replace = false,
      at?: MindSettingsAt,
    ) => {
      const id = resident.pubkey
        ? `mind:${normalizePubkey(resident.pubkey)}`
        : `persona:${resident.personaId ?? resident.residentId}`;
      void navigate({
        to: "/agents",
        search: {
          ...searchForPick("agents", {}, id),
          section: "settings",
          ...(at ? { at } : {}),
        },
        replace,
      } as never);
    },
    [navigate],
  );

  // A way in that names one mind lands in that mind's own Settings, on the
  // row its old tab named (WP-26, Decided 4): runtime on Connected app and
  // model, capabilities (its access) on Permissions.
  const requested = values.settingsAgent;
  const requestedAt = mindSettingsAtOfTab(values.settingsAgentTab);
  React.useEffect(() => {
    if (!requested || !ready) return;
    const match = minds.find(
      ({ resident }) =>
        resident.residentId === requested ||
        (resident.pubkey &&
          normalizePubkey(resident.pubkey) === normalizePubkey(requested)),
    );
    if (match) openMind(match.resident, true, requestedAt);
  }, [minds, openMind, ready, requested, requestedAt]);

  return (
    <section className="luca-settings-minds" data-testid="settings-agents">
      <div className="luca-settings-minds-head">
        <p className="luca-settings-minds-line">
          Each agent's settings are in their own space. Open one to change how
          they run.
        </p>
        <Button
          data-testid="settings-agents-add"
          onClick={() =>
            void navigate({ to: "/agents", search: { add: "agent" } } as never)
          }
          size="quiet"
          variant="quiet"
        >
          Add agent
        </Button>
      </div>
      {ready && minds.length === 0 ? (
        <p className="luca-settings-minds-line">No agents yet.</p>
      ) : null}
      <ul aria-label="Agents" data-testid="settings-agents-minds">
        {minds.map(({ main, resident }) => {
          const key = resident.pubkey ? normalizePubkey(resident.pubkey) : null;
          const agent = key ? managed.get(key) : undefined;
          const state = mindStateOf(signals, key, {
            availability: resident.availability,
            lastError: agent?.lastError,
            waking: Boolean(agent?.waking),
          });
          return (
            <li
              className="luca-place-row luca-settings-mind"
              data-main={main ? "true" : undefined}
              data-testid={`settings-mind-${key ?? resident.residentId}`}
              key={resident.residentId}
            >
              <span aria-hidden className="luca-settings-mind-mark">
                {resident.pubkey ? (
                  <AgentIdentitySpecimen
                    accessibleName={resident.displayName}
                    avatarUrl={resident.avatarUrl}
                    publicKey={resident.pubkey}
                    size={MARK_SIZE}
                    state={identityState(resident)}
                  />
                ) : (
                  <span className="luca-settings-mind-initial">
                    {resident.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <button
                aria-label={`${resident.displayName}, ${state}. Open their settings`}
                className="luca-place-row-what luca-place-row-open"
                onClick={() => openMind(resident)}
                type="button"
              >
                <span className="luca-place-row-title">
                  {resident.displayName}
                </span>
              </button>
              <span className="luca-place-row-middle">
                <span className="luca-place-row-detail">
                  {residentSourceLabel(resident)}
                </span>
              </span>
              <span
                className="luca-place-row-note"
                data-mind-state={state}
                data-testid="settings-mind-state"
              >
                {state}
              </span>
            </li>
          );
        })}
      </ul>
      {runtimes.length > 0 ? (
        <section
          aria-label="Connected"
          className="luca-settings-minds-group"
          data-testid="settings-agents-connected"
        >
          <h2 className="type-eyebrow">Connected</h2>
          <ul>
            {runtimes.map((runtime) => {
              const id = runtimeConnectionKey(runtime);
              const readiness =
                runtimeReadinessLabel(runtime).toLocaleLowerCase();
              return (
                <li
                  className="luca-place-row"
                  data-testid={`settings-connected-${runtime.runtimeId}`}
                  key={id}
                >
                  <button
                    aria-label={`${runtime.label}, ${readiness}. Open in Agents`}
                    className="luca-place-row-what luca-place-row-open"
                    onClick={() =>
                      void navigate({
                        to: "/agents",
                        search: searchForPick("agents", {}, `connected:${id}`),
                      } as never)
                    }
                    type="button"
                  >
                    <span className="luca-place-row-title">
                      {runtime.label}
                    </span>
                  </button>
                  <span className="luca-place-row-middle" />
                  <span className="luca-place-row-note">{readiness}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function identityState(resident: ResidentSummaryViewModel) {
  if (resident.availability === "failed") return "fault" as const;
  if (resident.availability === "working") return "working" as const;
  if (resident.availability === "idle") return "idle" as const;
  if (resident.availability === "offline") return "unavailable" as const;
  return "present" as const;
}
