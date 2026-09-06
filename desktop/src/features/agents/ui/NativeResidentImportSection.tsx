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
import { OrdinaryHermesImport } from "./OrdinaryHermesImport";
import {
  importResidentProposal,
  listenResidentProposalResolutions,
  type NativeImportResult,
  type NativeImportSelection,
} from "@/shared/api/tauriResidentProposals";

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

type ImportProposalReview = {
  requestId: string;
  nativeProfileName: string;
  authorize: () => Promise<void>;
  complete: () => Promise<void>;
  close: () => void;
  closeState: { closing: boolean; pending: boolean; error: string | null };
};

export function NativeResidentImportSection({
  residents,
  proposal,
}: {
  residents: ManagedAgent[];
  proposal?: ImportProposalReview;
}) {
  return proposal ? (
    <ProposedHermesImport residents={residents} proposal={proposal} />
  ) : (
    <NativeResidentImportList residents={residents} />
  );
}

function NativeResidentImportList({
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
  const [reviewedHermes, setReviewedHermes] = React.useState<
    DiscoveredResidentCandidate[]
  >([]);
  const retainReview = React.useCallback(
    (candidate: DiscoveredResidentCandidate) => {
      setReviewedHermes((current) =>
        current.some((entry) => entry.semanticId === candidate.semanticId)
          ? current
          : [...current, candidate],
      );
    },
    [],
  );
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
        setNotice(
          `${candidate.displayName} is imported and its process started. Send a message to check the native connection.`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(null);
    }
  }

  const discovered =
    discovery?.runtimes.flatMap((runtime) => runtime.candidates) ?? [];
  // Scanning must not remount an admitted review or replace its approved
  // fingerprint. Even a disappearing profile keeps its same-key recovery row;
  // each host action rechecks current discovery before any effect.
  const candidates = [
    ...discovered.map(
      (candidate) =>
        reviewedHermes.find(
          (entry) => entry.semanticId === candidate.semanticId,
        ) ?? candidate,
    ),
    ...reviewedHermes.filter(
      (entry) =>
        !discovered.some(
          (candidate) => candidate.semanticId === entry.semanticId,
        ),
    ),
  ];
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
      ) : null}
      <div className="divide-y divide-border/60">
        {candidates.map((candidate) => {
          const identity = candidate.semanticId;
          const isImported = imported.has(identity);
          if (candidate.nativeType === "hermes") {
            return (
              <OrdinaryHermesImport
                key={identity}
                candidate={candidate}
                isImported={isImported}
                busy={isLoading || importing !== null}
                onBusy={setImporting}
                onAdmitted={retainReview}
              />
            );
          }
          if (isLoading) return null;
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
                {isImported ? "Imported" : isImporting ? "Importing" : "Import"}
              </Button>
            </div>
          );
        })}
      </div>

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

function ProposedHermesImport({
  residents,
  proposal,
}: {
  residents: ManagedAgent[];
  proposal: ImportProposalReview;
}) {
  const [discovery, setDiscovery] =
    React.useState<NativeResidentDiscoveryOutcome | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [ended, setEnded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<NativeImportResult | null>(null);
  const resultElement = React.useRef<HTMLElement>(null);
  // A saved result follows the owner's import/retry action, so reveal it once
  // without moving focus for unrelated query refreshes or review renders.
  React.useLayoutEffect(() => {
    if (!result) return;
    resultElement.current?.focus({ preventScroll: true });
    resultElement.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [result]);
  const [startNow, setStartNow] = React.useState(true);
  const [startOnAppLaunch, setStartOnAppLaunch] = React.useState(false);
  const [continuityEnabled, setContinuityEnabled] = React.useState(true);
  const attempt = React.useRef<NativeImportSelection | null>(null);
  const active = React.useRef(true);
  const endedRef = React.useRef(false);
  const callbacks = React.useRef(proposal);
  callbacks.current = proposal;

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      await callbacks.current.authorize();
      if (
        !active.current ||
        endedRef.current ||
        callbacks.current.closeState.closing
      )
        return;
      const next = await discoverNativeResidents();
      if (
        active.current &&
        !endedRef.current &&
        !callbacks.current.closeState.closing
      )
        setDiscovery(next);
    } catch (cause) {
      if (active.current)
        setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      if (active.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    active.current = true;
    let unlisten: (() => void) | undefined;
    void listenResidentProposalResolutions((requestId) => {
      if (requestId !== callbacks.current.requestId || !active.current) return;
      endedRef.current = true;
      setEnded(true);
    })
      .then((stop) => {
        if (active.current) unlisten = stop;
        else stop();
      })
      .catch((cause: unknown) => {
        if (active.current) setError(String(cause));
      });
    void refresh();
    return () => {
      active.current = false;
      unlisten?.();
    };
  }, [refresh]);

  const runtimes =
    discovery?.runtimes.filter((runtime) => runtime.nativeType === "hermes") ??
    [];
  const candidates = runtimes
    .flatMap((runtime) => runtime.candidates)
    .filter((candidate) => candidate.nativeId === proposal.nativeProfileName);
  const selected = candidates.find(
    (candidate) => candidate.semanticId === selectedId,
  );
  const existing =
    selected &&
    residents.find(
      (resident) =>
        resident.nativeRuntimeBinding &&
        bindingIdentity(resident.nativeRuntimeBinding) === selected.semanticId,
    );

  async function returnResult() {
    if (callbacks.current.closeState.closing) return;
    setBusy(true);
    setError(null);
    try {
      await callbacks.current.complete();
    } catch (cause) {
      if (active.current)
        setError(
          `The resident is saved, but the result could not be returned: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function runImport(retryStart = false, retrySettings = false) {
    if (
      busy ||
      endedRef.current ||
      callbacks.current.closeState.closing ||
      (!selected && !attempt.current)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await callbacks.current.authorize();
      if (
        !active.current ||
        endedRef.current ||
        callbacks.current.closeState.closing
      )
        return;
      let selection: NativeImportSelection | undefined;
      if (!attempt.current && selected) {
        selection = {
          semanticId: selected.semanticId,
          bindingFingerprint: selected.bindingFingerprint,
          startNow,
          startOnAppLaunch,
          continuityEnabled,
        };
        attempt.current = selection;
      }
      const saved = await importResidentProposal(
        callbacks.current.requestId,
        selection,
        retryStart,
        retrySettings,
      );
      if (
        !active.current ||
        endedRef.current ||
        callbacks.current.closeState.closing
      )
        return;
      setResult(saved);
      if (!saved.startupError && !saved.preferencesError) await returnResult();
    } catch (cause) {
      if (active.current)
        setError(
          `${cause instanceof Error ? cause.message : String(cause)}${attempt.current ? " An import may already be saved. Verify its result before doing anything else." : ""}`,
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <section
      className="flex min-h-0 flex-col gap-4"
      data-testid="hermes-import-review"
    >
      <div className="min-h-0 space-y-3 overflow-y-auto px-1">
        <p className="text-sm">
          Requested profile: <strong>{proposal.nativeProfileName}</strong>
        </p>
        <p className="text-sm text-muted-foreground">
          Hermes keeps its configuration, workspace, instructions and native
          memory. Credentials are not copied. Select the profile below before
          confirming.
        </p>
        {loading ? (
          <p className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Looking for the existing profile…
          </p>
        ) : null}
        {!loading && candidates.length === 0 ? (
          <p className="text-sm">
            No exact matching Hermes profile was found. Check the profile in
            Hermes, then scan again.
          </p>
        ) : null}
        {runtimes.map((runtime) =>
          runtime.message ? (
            <p
              className="text-sm text-muted-foreground"
              key={runtime.nativeType}
            >
              {runtime.message}
            </p>
          ) : null,
        )}
        {candidates.map((candidate) => (
          <label
            className="flex items-start gap-3 rounded-lg border border-border/70 p-3"
            key={candidate.semanticId}
          >
            <input
              type="radio"
              name="native-profile"
              aria-label={`Select ${candidate.nativeId} at ${candidate.canonicalLocation ?? candidate.semanticId}`}
              checked={selectedId === candidate.semanticId}
              disabled={
                busy ||
                ended ||
                proposal.closeState.closing ||
                attempt.current !== null ||
                candidate.readiness.status === "unavailable"
              }
              onFocus={(event) =>
                event.currentTarget
                  .closest("label")
                  ?.scrollIntoView({ block: "nearest", behavior: "instant" })
              }
              onChange={() => setSelectedId(candidate.semanticId)}
              className="mt-1 shrink-0"
            />
            <span className="min-w-0 space-y-1 text-sm">
              <span className="block font-medium">{candidate.displayName}</span>
              <span className="block break-all font-mono text-xs">
                {candidate.canonicalLocation ?? candidate.semanticId}
              </span>
              {candidate.workspace ? (
                <span className="block break-all text-xs text-muted-foreground">
                  Workspace: {candidate.workspace}
                </span>
              ) : null}
              {candidate.readiness.status !== "ready" ? (
                <span className="block text-xs text-muted-foreground">
                  {candidate.readiness.message}
                </span>
              ) : null}
              {candidate.warnings.map((warning) => (
                <span
                  className="block text-xs text-muted-foreground"
                  key={warning.code}
                >
                  {warning.message}
                </span>
              ))}
            </span>
          </label>
        ))}
        {selected && !attempt.current ? (
          <div className="space-y-3 rounded-lg bg-muted/30 p-3 text-sm">
            {existing ? (
              <p>
                This profile already has a resident identity. Its launch and
                handoff preferences will be preserved.
              </p>
            ) : null}
            <label
              className="flex items-center justify-between gap-3"
              htmlFor="hermes-import-start"
            >
              Start this profile now
              <Switch
                id="hermes-import-start"
                checked={startNow}
                onCheckedChange={setStartNow}
                aria-label="Start this profile now"
                disabled={busy || ended || proposal.closeState.closing}
              />
            </label>
            {!existing ? (
              <>
                <label
                  className="flex items-center justify-between gap-3"
                  htmlFor="hermes-import-launch"
                >
                  Start when Polyphonic opens
                  <Switch
                    id="hermes-import-launch"
                    checked={startOnAppLaunch}
                    onCheckedChange={setStartOnAppLaunch}
                    aria-label="Start when Polyphonic opens"
                    disabled={busy || ended || proposal.closeState.closing}
                  />
                </label>
                <label
                  className="flex items-center justify-between gap-3"
                  htmlFor="hermes-import-continuity"
                >
                  Encrypted Luca handoff
                  <Switch
                    id="hermes-import-continuity"
                    checked={continuityEnabled}
                    onCheckedChange={setContinuityEnabled}
                    aria-label="Encrypted Luca handoff"
                    disabled={busy || ended || proposal.closeState.closing}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  The handoff is stored in Luca, separately from Hermes memory.
                  It can be changed later in the resident&apos;s settings.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {result ? (
          <section
            ref={resultElement}
            tabIndex={-1}
            aria-label="Imported Hermes resident"
            className="space-y-1 rounded-lg text-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
            data-testid="hermes-import-result"
          >
            <p>
              {result.displayName} is{" "}
              {result.reused ? "already linked" : "imported"}.{" "}
              {result.processRunning
                ? "Its process is running. Send a message to check the native connection."
                : "Its process is not running."}
            </p>
            <p className="break-all font-mono text-xs">
              {result.residentPubkey}
            </p>
            {result.startupError ? (
              <p className="text-destructive">
                Startup failed: {result.startupError}
              </p>
            ) : null}
            {result.preferencesError ? (
              <p className="text-destructive">
                Reviewed settings need attention: {result.preferencesError}.
                This review will not start the profile until they are saved.
              </p>
            ) : null}
            {result.warning ? <p>{result.warning}</p> : null}
          </section>
        ) : null}
        {ended ? (
          <p className="text-sm text-muted-foreground">
            This request has ended. Any saved resident remains available in
            Agents.
          </p>
        ) : null}
        {proposal.closeState.error || error ? (
          <p role="alert" className="text-sm text-destructive">
            {proposal.closeState.error ?? error}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 space-y-2 border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">
          {proposal.closeState.closing
            ? "This review is closing. Any import or startup already underway may still finish; no further action will begin here."
            : "Closing the review does not undo an import or startup already underway."}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={proposal.close}
            variant="ghost"
            disabled={proposal.closeState.pending}
          >
            {proposal.closeState.pending
              ? "Closing…"
              : proposal.closeState.closing
                ? "Retry closing"
                : "Close"}
          </Button>
          {!attempt.current && !proposal.closeState.closing ? (
            <Button
              disabled={busy || loading || ended}
              onClick={() => void refresh()}
              variant="outline"
            >
              Scan again
            </Button>
          ) : null}
          {proposal.closeState.closing ? null : result?.preferencesError ? (
            <Button
              disabled={busy || ended}
              onClick={() =>
                void runImport(attempt.current?.startNow ?? false, true)
              }
            >
              Retry reviewed settings
            </Button>
          ) : result ? (
            <>
              {result.startupError ? (
                <Button
                  disabled={busy || ended || proposal.closeState.closing}
                  onClick={() => void runImport(true)}
                  variant="outline"
                >
                  Retry start
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void returnResult()}>
                {busy
                  ? "Returning result…"
                  : result.startupError
                    ? "Continue without starting"
                    : "Retry returning result"}
              </Button>
            </>
          ) : (
            <Button
              disabled={
                busy || loading || ended || (!selected && !attempt.current)
              }
              onClick={() => void runImport()}
            >
              {busy
                ? "Importing…"
                : attempt.current
                  ? "Verify saved result"
                  : existing
                    ? "Use existing resident"
                    : startNow
                      ? "Import and start"
                      : "Import profile"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
