import * as React from "react";
import { Check, Cpu, Plus, ShieldCheck } from "lucide-react";

import type { AgentPersona } from "@/shared/api/types";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import type { ResidentRegistryEntry } from "./api";

type ResidentSetupProps = {
  isLoading: boolean;
  isPending: boolean;
  personas: AgentPersona[];
  residents: ResidentRegistryEntry[];
  startingPersonaIds: ReadonlySet<string>;
  onAddResident: (persona: AgentPersona) => void;
  onCreateResident: () => void;
};

function bindingLabel(persona: AgentPersona, resident?: ResidentRegistryEntry) {
  const runtime =
    resident?.runtime.runtimeId ??
    persona.runtime ??
    resident?.runtime.runtimeCommand ??
    "App default";
  const model = resident?.runtime.modelId ?? persona.model;
  const provider = resident?.runtime.providerId ?? persona.provider;
  return [runtime, provider, model].filter(Boolean).join(" · ");
}

function isResidentReady(resident: ResidentRegistryEntry) {
  return (
    resident.active &&
    (resident.status === "running" || resident.status === "deployed")
  );
}

/**
 * Reusable first-run resident-selection surface. The surrounding onboarding
 * flow owns navigation; this component owns only direct resident setup.
 */
export function ResidentSetup({
  isLoading,
  isPending,
  personas,
  residents,
  startingPersonaIds,
  onAddResident,
  onCreateResident,
}: ResidentSetupProps) {
  const residentsByPersona = React.useMemo(() => {
    const map = new Map<string, ResidentRegistryEntry>();
    for (const resident of residents) {
      if (resident.personaId && !map.has(resident.personaId)) {
        map.set(resident.personaId, resident);
      }
    }
    return map;
  }, [residents]);
  const linkedPubkeys = new Set(
    [...residentsByPersona.values()].map((resident) => resident.residentPubkey),
  );
  const unlinkedResidents = residents.filter(
    (resident) => !linkedPubkeys.has(resident.residentPubkey),
  );
  const readyCount = residents.filter(isResidentReady).length;

  return (
    <section
      aria-labelledby="resident-setup-title"
      className="overflow-hidden rounded-2xl border border-border/70 bg-card/45"
      data-testid="luca-resident-setup"
    >
      <div className="flex flex-col gap-5 border-b border-border/60 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.16em] text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Personal agent network
          </div>
          <div>
            <h2
              className="text-xl font-medium tracking-tight text-foreground"
              id="resident-setup-title"
            >
              Set up your residents
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Each resident has an independent cryptographic identity. Its model
              and runtime can change without changing who it is.
            </p>
          </div>
        </div>
        <div
          aria-live="polite"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-border/70 bg-background/55 px-3 py-1.5 font-mono text-xs text-muted-foreground"
          data-testid="resident-ready-count"
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${readyCount > 0 ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
          />
          {readyCount} of {residents.length} ready
        </div>
      </div>

      <div className="space-y-3 px-5 py-5 sm:px-6">
        {isLoading ? (
          <div
            className="h-24 animate-pulse rounded-xl border border-border/50 bg-muted/25"
            data-testid="resident-setup-loading"
          />
        ) : null}

        {!isLoading && personas.length === 0 && residents.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border/80 bg-background/30 px-5 py-5">
            <div>
              <p className="text-sm font-medium text-foreground">
                Create your first resident
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Choose its identity, instructions, runtime, and model. Luca
                keeps the signing key in native secure storage.
              </p>
            </div>
            <Button onClick={onCreateResident} size="sm">
              <Plus aria-hidden="true" />
              Create resident
            </Button>
          </div>
        ) : null}

        {!isLoading
          ? personas.map((persona) => {
              const resident = residentsByPersona.get(persona.id);
              const isStarting = startingPersonaIds.has(persona.id);
              const ready = resident ? isResidentReady(resident) : false;
              return (
                <div
                  className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/60 bg-background/35 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`resident-option-${persona.id}`}
                  key={persona.id}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/35 text-sm font-medium text-foreground">
                      {persona.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {persona.displayName}
                        </p>
                        {resident ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs ${
                              ready
                                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "border-border/70 bg-muted/35 text-muted-foreground"
                            }`}
                          >
                            {ready ? (
                              <Check aria-hidden="true" className="size-3" />
                            ) : null}
                            {ready
                              ? "Resident ready"
                              : `Resident ${resident.status}`}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Cpu aria-hidden="true" className="size-3" />
                          {bindingLabel(persona, resident)}
                        </span>
                        {resident ? (
                          <span data-testid={`resident-identity-${persona.id}`}>
                            {truncatePubkey(resident.residentPubkey)}
                          </span>
                        ) : (
                          <span>Identity created on add</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!resident ? (
                    <Button
                      aria-label={`Add ${persona.displayName} as resident`}
                      disabled={isPending || isStarting}
                      onClick={() => onAddResident(persona)}
                      size="sm"
                      variant="outline"
                    >
                      <Plus aria-hidden="true" />
                      {isStarting ? "Adding…" : "Add resident"}
                    </Button>
                  ) : null}
                </div>
              );
            })
          : null}

        {!isLoading
          ? unlinkedResidents.map((resident) => (
              <div
                className="flex min-w-0 items-center gap-3.5 rounded-xl border border-border/60 bg-background/35 px-4 py-4"
                data-testid={`resident-unlinked-${resident.residentPubkey}`}
                key={resident.residentPubkey}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/35 text-sm font-medium text-foreground">
                  {resident.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {resident.displayName}
                  </p>
                  <p className="mt-1 font-mono text-2xs text-muted-foreground">
                    {resident.runtime.runtimeCommand} ·{" "}
                    {truncatePubkey(resident.residentPubkey)}
                  </p>
                </div>
              </div>
            ))
          : null}

        {!isLoading && (personas.length > 0 || residents.length > 0) ? (
          <div className="flex justify-start pt-1">
            <Button onClick={onCreateResident} size="sm" variant="ghost">
              <Plus aria-hidden="true" />
              Create another resident
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
