import * as React from "react";
import { Download, LoaderCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { managedAgentsQueryKey } from "@/features/agents/hooks";
import type { DiscoveredResidentCandidate } from "@/shared/api/types";
import {
  importNativeResident,
  prepareNativeResidentImport,
  type NativeImportResult,
  type NativeImportSelection,
} from "@/shared/api/tauriResidentProposals";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

export function OrdinaryHermesImport({
  candidate,
  isImported,
  busy,
  onBusy,
  onAdmitted,
}: {
  candidate: DiscoveredResidentCandidate;
  isImported: boolean;
  busy: boolean;
  onBusy: (identity: string | null) => void;
  onAdmitted: (candidate: DiscoveredResidentCandidate) => void;
}) {
  const queryClient = useQueryClient();
  const controlsId = React.useId();
  const [choices, setChoices] = React.useState({
    startNow: true,
    startOnAppLaunch: false,
    continuityEnabled: true,
  });
  const [admitted, setAdmitted] = React.useState(false);
  const [resumed, setResumed] = React.useState(false);
  const [result, setResult] = React.useState<NativeImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const attempt = React.useRef<{
    id: string;
    selection: NativeImportSelection;
  } | null>(null);
  const pending = React.useRef(false);
  const active = React.useRef(true);
  const resultElement = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  React.useLayoutEffect(() => {
    if (!result) return;
    resultElement.current?.focus({ preventScroll: true });
    resultElement.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [result]);

  async function run(action: Parameters<typeof importNativeResident>[1]) {
    if (busy || pending.current) return;
    pending.current = true;
    onBusy(candidate.semanticId);
    setError(null);
    try {
      if (!attempt.current) {
        const selection = {
          semanticId: candidate.semanticId,
          bindingFingerprint: candidate.bindingFingerprint,
          ...choices,
        };
        const prepared = await prepareNativeResidentImport(selection);
        if (!active.current) return;
        attempt.current = {
          id: prepared.attemptId,
          selection: prepared.selection,
        };
        onAdmitted(candidate);
        setAdmitted(true);
        if (prepared.admitted) {
          setResumed(true);
          action = "verify";
        }
      }
      const saved = await importNativeResident(attempt.current.id, action);
      if (active.current) setResult(saved);
    } catch (cause) {
      if (active.current)
        setError(
          `${cause instanceof Error ? cause.message : String(cause)}${attempt.current ? " An import may already be saved. Verify its result before another action." : ""}`,
        );
    } finally {
      void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
      pending.current = false;
      if (active.current) onBusy(null);
    }
  }

  const location =
    candidate.canonicalLocation ??
    (candidate.bindingPreview.kind === "hermes"
      ? candidate.bindingPreview.hermesHome
      : candidate.nativeId);
  const unavailable = candidate.readiness.status === "unavailable";
  return (
    <section
      className="space-y-3 px-5 py-4"
      aria-label={`Hermes profile ${candidate.nativeId} at ${location}`}
      data-testid={`ordinary-hermes-import-${candidate.semanticId}`}
    >
      <div>
        <h3 className="text-sm font-medium">{candidate.displayName}</h3>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {candidate.nativeId} · {location}
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
      </div>
      {!admitted ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <label
            className="flex items-center gap-2"
            htmlFor={`${controlsId}-start`}
          >
            <Switch
              id={`${controlsId}-start`}
              aria-label={`Start ${candidate.displayName} now`}
              checked={choices.startNow}
              disabled={busy || unavailable}
              onCheckedChange={(startNow) =>
                setChoices((current) => ({ ...current, startNow }))
              }
            />
            Start now
          </label>
          {isImported ? (
            <p>
              This profile is already imported. Reuse its identity and keep its
              existing handoff and launch settings.
            </p>
          ) : (
            <>
              <label
                className="flex items-center gap-2"
                htmlFor={`${controlsId}-launch`}
              >
                <Switch
                  id={`${controlsId}-launch`}
                  aria-label={`Start ${candidate.displayName} with Luca`}
                  checked={choices.startOnAppLaunch}
                  disabled={busy || unavailable}
                  onCheckedChange={(startOnAppLaunch) =>
                    setChoices((current) => ({ ...current, startOnAppLaunch }))
                  }
                />
                Start with Luca
              </label>
              <label
                className="flex items-center gap-2"
                htmlFor={`${controlsId}-continuity`}
              >
                <Switch
                  id={`${controlsId}-continuity`}
                  aria-label={`Enable Luca continuity for ${candidate.displayName}`}
                  checked={choices.continuityEnabled}
                  disabled={busy || unavailable}
                  onCheckedChange={(continuityEnabled) =>
                    setChoices((current) => ({ ...current, continuityEnabled }))
                  }
                />
                Encrypted Luca handoff
              </label>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {resumed ? "Resumed earlier review:" : "Original review:"}{" "}
          {attempt.current?.selection.startNow ? "start now" : "leave stopped"}.
          {result?.reused
            ? " Existing handoff and launch settings stay unchanged."
            : ` Luca handoff ${attempt.current?.selection.continuityEnabled ? "on" : "off"}; start with Luca ${attempt.current?.selection.startOnAppLaunch ? "on" : "off"}.`}
        </p>
      )}
      {result ? (
        <section
          ref={resultElement}
          tabIndex={-1}
          className="space-y-2 rounded-lg border border-border/70 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Import result for ${candidate.displayName}`}
          data-resident-pubkey={result.residentPubkey}
        >
          <p>
            {result.displayName}{" "}
            {result.processRunning
              ? "is imported and its process is started. Send a message to check its native connection."
              : "is imported and stopped."}
          </p>
          {result.reused ? (
            <p className="text-xs text-muted-foreground">
              Reused the existing identity. Its handoff and launch settings are
              unchanged.
            </p>
          ) : null}
          {result.preferencesError ? (
            <p role="alert">
              Reviewed settings were not saved. Startup from this review is
              blocked: {result.preferencesError}
            </p>
          ) : null}
          {result.startupError ? (
            <p role="alert">Could not start: {result.startupError}</p>
          ) : null}
          {result.warning ? (
            <p className="text-xs text-muted-foreground">{result.warning}</p>
          ) : null}
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!admitted ? (
          <Button
            disabled={busy || unavailable}
            size="sm"
            variant="outline"
            onClick={() => void run("import")}
          >
            <Download />
            {isImported ? "Reuse profile" : "Import profile"}
          </Button>
        ) : (
          <>
            <Button
              disabled={busy}
              size="sm"
              variant="outline"
              onClick={() => void run("verify")}
            >
              Verify import
            </Button>
            {result?.preferencesError ? (
              <Button
                disabled={busy}
                size="sm"
                onClick={() => void run("retry_settings")}
              >
                {attempt.current?.selection.startNow
                  ? "Retry settings and start"
                  : "Retry reviewed settings"}
              </Button>
            ) : null}
            {result &&
            !result.preferencesError &&
            !result.processRunning &&
            attempt.current?.selection.startNow ? (
              <Button
                disabled={busy}
                size="sm"
                onClick={() => void run("retry_start")}
              >
                Retry start
              </Button>
            ) : null}
          </>
        )}
        {pending.current ? (
          <span
            role="status"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Checking import…
          </span>
        ) : null}
      </div>
    </section>
  );
}
