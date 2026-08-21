import * as React from "react";
import { Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { useCreateManagedAgentMutation } from "@/features/agents/hooks";
import { discoverNativeResidents } from "@/shared/api/tauri";
import { setResidentContinuityEnabled } from "@/shared/api/tauriContinuity";
import type {
  DiscoveredResidentCandidate,
  ManagedAgent,
  NativeResidentDiscoveryOutcome,
  RuntimeBinding,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

function bindingIdentity(binding: RuntimeBinding): string {
  return binding.kind === "hermes"
    ? `hermes:${binding.hermesHome}:${binding.profileName.trim()}`
    : `openclaw:${binding.gatewayIdentity.trim()}:${binding.agentId.trim()}`;
}

function runtimeLabel(candidate: DiscoveredResidentCandidate): string {
  return candidate.nativeType === "hermes"
    ? "Hermes profile"
    : "OpenClaw agent";
}

export function NativeResidentImportSection({
  residents,
}: {
  residents: ManagedAgent[];
}) {
  const [discovery, setDiscovery] =
    React.useState<NativeResidentDiscoveryOutcome | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState<string | null>(null);
  const [continuityChoices, setContinuityChoices] = React.useState<
    Record<string, boolean>
  >({});
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
    setNotice(null);
    try {
      setDiscovery(await discoverNativeResidents());
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
    const identity = candidate.semanticId;
    setImporting(identity);
    setError(null);
    setNotice(null);
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
      const continuityEnabled = continuityChoices[identity] ?? true;
      try {
        await setResidentContinuityEnabled(
          result.agent.pubkey,
          continuityEnabled,
        );
      } catch (cause) {
        setError(
          `${candidate.displayName} was imported, but its continuity preference could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return;
      }
      if (result.spawnError) {
        setError(
          `${candidate.displayName} was imported but could not start: ${result.spawnError}`,
        );
      } else if (result.profileSyncError) {
        setError(
          `${candidate.displayName} is imported, but its public profile could not sync: ${result.profileSyncError}`,
        );
      } else if (result.recoveryNotice) {
        setNotice(`Reused ${candidate.displayName}: ${result.recoveryNotice}`);
      } else if (result.reused) {
        setNotice(
          `${candidate.displayName} was already linked; its verified runtime binding was refreshed.`,
        );
      } else {
        setNotice(`${candidate.displayName} is imported and ready to use.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(null);
    }
  }

  const candidates =
    discovery?.runtimes.flatMap((runtime) => runtime.candidates) ?? [];
  const discoveryNotices =
    discovery?.runtimes.filter(
      (runtime) => runtime.status !== "available" && runtime.message,
    ) ?? [];

  if (
    !isLoading &&
    candidates.length === 0 &&
    discoveryNotices.length === 0 &&
    !error
  )
    return null;

  return (
    <section
      aria-labelledby="native-residents-title"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium" id="native-residents-title">
            Agents already on this Mac
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import their existing identity and configuration. Luca does not copy
            their credentials.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Continuity keeps a small encrypted handoff in Luca, separate from
            each agent&apos;s native memory. It can be disabled per resident.
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
            const identity = candidate.semanticId;
            const isImported = imported.has(identity);
            const isImporting = importing === identity;
            const unavailable = candidate.readiness.status === "unavailable";
            return (
              <div className="flex items-center gap-4 px-5 py-3" key={identity}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {candidate.displayName}
                    </span>
                    <span className="shrink-0 font-mono text-2xs uppercase tracking-caps text-muted-foreground">
                      {runtimeLabel(candidate)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {candidate.modelSummary ??
                      candidate.workspace ??
                      candidate.nativeId}
                  </p>
                  {candidate.readiness.status !== "ready" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.readiness.message}
                    </p>
                  ) : null}
                  {candidate.warnings.map((warning) => (
                    <p
                      className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                      key={warning.code}
                    >
                      {warning.message}
                    </p>
                  ))}
                  {!isImported ? (
                    <div className="mt-2 flex w-fit items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        aria-label={`Enable Luca continuity for ${candidate.displayName}`}
                        checked={continuityChoices[identity] ?? true}
                        disabled={importing !== null}
                        onCheckedChange={(enabled) =>
                          setContinuityChoices((current) => ({
                            ...current,
                            [identity]: enabled,
                          }))
                        }
                      />
                      Encrypted Luca handoff
                    </div>
                  ) : null}
                </div>
                <Button
                  disabled={isImported || unavailable || importing !== null}
                  onClick={() => void importCandidate(candidate)}
                  size="sm"
                  variant={isImported ? "ghost" : "outline"}
                >
                  {isImporting ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {isImported
                    ? "Imported"
                    : isImporting
                      ? "Importing"
                      : "Import"}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {discoveryNotices.map((runtime) => (
        <div
          className="flex items-start gap-2 border-t border-border/60 px-5 py-3 text-sm text-muted-foreground"
          key={runtime.nativeType}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{runtime.message}</span>
        </div>
      ))}

      {error ? (
        <div className="flex items-start gap-2 border-t border-border/60 px-5 py-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="border-t border-border/60 px-5 py-3 text-sm text-muted-foreground">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
