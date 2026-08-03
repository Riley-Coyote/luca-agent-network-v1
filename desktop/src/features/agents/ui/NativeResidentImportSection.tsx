import * as React from "react";
import { Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { useCreateManagedAgentMutation } from "@/features/agents/hooks";
import {
  discoverNativeResidents,
} from "@/shared/api/tauri";
import type {
  DiscoveredResidentCandidate,
  ManagedAgent,
  RuntimeBinding,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

function bindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.profileName}`
    : `openclaw:${binding.gatewayIdentity}:${binding.agentId}`;
}

function runtimeLabel(candidate: DiscoveredResidentCandidate): string {
  return candidate.nativeType === "hermes" ? "Hermes profile" : "OpenClaw agent";
}

export function NativeResidentImportSection({
  residents,
}: {
  residents: ManagedAgent[];
}) {
  const [candidates, setCandidates] = React.useState<
    DiscoveredResidentCandidate[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState<string | null>(null);
  const createMutation = useCreateManagedAgentMutation();

  const imported = React.useMemo(
    () =>
      new Set(
        residents
          .map((resident) => resident.nativeRuntimeBinding)
          .filter((binding): binding is RuntimeBinding => binding !== null)
          .map(bindingIdentity),
      ),
    [residents],
  );

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setCandidates(await discoverNativeResidents());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importCandidate(candidate: DiscoveredResidentCandidate) {
    const identity = bindingIdentity(candidate.bindingPreview);
    setImporting(identity);
    setError(null);
    try {
      const command = candidate.bindingPreview.executablePath;
      const result = await createMutation.mutateAsync({
        name: candidate.displayName,
        agentCommand: command,
        agentArgs: ["acp"],
        harnessOverride: true,
        // A native resident is one persistent identity. Additional harness
        // workers multiply runtime startup (and every MCP initialization)
        // without creating additional resident capability.
        parallelism: 1,
        nativeRuntimeBinding: candidate.bindingPreview,
        spawnAfterCreate: true,
        startOnAppLaunch: true,
      });
      if (result.spawnError) {
        setError(`${candidate.displayName} was imported but could not start: ${result.spawnError}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(null);
    }
  }

  if (!isLoading && candidates.length === 0 && !error) return null;

  return (
    <section aria-labelledby="native-residents-title" className="overflow-hidden rounded-xl border border-border/70 bg-card/40">
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium" id="native-residents-title">
            Agents already on this Mac
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import their existing identity and configuration. Mnemos does not copy their credentials.
          </p>
        </div>
        <Button
          aria-label="Scan for agents again"
          disabled={isLoading || importing !== null}
          onClick={() => void refresh()}
          size="icon"
          variant="ghost"
        >
          <RefreshCw className={isLoading ? "animate-spin" : undefined} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-5 py-5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Looking for Hermes profiles and OpenClaw agents…
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {candidates.map((candidate) => {
            const identity = bindingIdentity(candidate.bindingPreview);
            const isImported = imported.has(identity);
            const isImporting = importing === identity;
            const unavailable = candidate.readiness.status === "unavailable";
            return (
              <div className="flex items-center gap-4 px-5 py-3" key={identity}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{candidate.displayName}</span>
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      {runtimeLabel(candidate)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {candidate.modelSummary ?? candidate.workspace ?? candidate.nativeId}
                  </p>
                </div>
                <Button
                  disabled={isImported || unavailable || importing !== null}
                  onClick={() => void importCandidate(candidate)}
                  size="sm"
                  variant={isImported ? "ghost" : "outline"}
                >
                  {isImporting ? <LoaderCircle className="animate-spin" /> : <Download />}
                  {isImported ? "Imported" : isImporting ? "Importing" : "Import"}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <div className="flex items-start gap-2 border-t border-border/60 px-5 py-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </section>
  );
}
