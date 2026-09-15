import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, TerminalSquare } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";
import {
  managedAgentsQueryKey,
  personasQueryKey,
  useAcpAuthMethodsQuery,
  useAcpRuntimesQuery,
  useConnectAcpRuntimeMutation,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import {
  operatorForgeSettingsQueryKey,
  useOperatorForgeSettingsQuery,
  useSaveOperatorForgePreferencesMutation,
} from "@/features/agents/operatorForgeQueries";
import { listManagedAgents } from "@/shared/api/tauri";
import { listPersonas } from "@/shared/api/tauriPersonas";
import type {
  AgentRuntimeTargetV1,
  OperatorForgeSettingsV1,
  RuntimeTargetOptionV1,
} from "@/shared/api/tauriOperatorForge";
import type { AcpAuthMethod, AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import { runtimeIsReadyForOnboarding } from "./onboardingRuntimeSelection";
import { PolyphonicStepHeading } from "./PolyphonicSetupFrame";
import { RuntimeIcon } from "./RuntimeIcon";

export type PolyphonicRuntimeStepHandle = {
  /** The chosen runtime, at once; the write follows behind the next page. */
  commit: () => AgentRuntimeTargetV1 | undefined;
};

function targetKey(target: AgentRuntimeTargetV1) {
  return target.kind === "managed"
    ? `managed:${target.runtimeId}`
    : `native:${target.runtime}`;
}

function matchingRuntime(
  option: RuntimeTargetOptionV1,
  runtimes: AcpRuntimeCatalogEntry[],
) {
  if (option.target.kind !== "managed") return null;
  const runtimeId = option.target.runtimeId;
  return runtimes.find((runtime) => runtime.id === runtimeId) ?? null;
}

function supportedAuthMethods(
  runtime: AcpRuntimeCatalogEntry,
  methods: AcpAuthMethod[],
) {
  const supported = methods.filter(
    (method) =>
      runtime.id !== "codex" ||
      !/api[-_ ]?key/i.test(`${method.id} ${method.name}`),
  );
  if (runtime.id !== "claude") return supported.slice(0, 1);
  const preferred = supported.find((method) =>
    [
      method.id,
      method.name,
      method.description ?? "",
      method.command.join(" "),
      method.args.join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .match(/claude\s?ai|claude\.ai|subscription/),
  );
  return preferred ? [preferred] : supported.slice(0, 1);
}

function ManagedRecovery({ runtime }: { runtime: AcpRuntimeCatalogEntry }) {
  const runtimes = useAcpRuntimesQuery();
  const settings = useOperatorForgeSettingsQuery();
  const install = useInstallAcpRuntimeMutation();
  const methods = useAcpAuthMethodsQuery(runtime.id, {
    enabled:
      runtime.availability === "available" &&
      runtime.authStatus.status === "logged_out",
  });
  const connect = useConnectAcpRuntimeMutation();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const refetchSettings = settings.refetch;
  const refetchRuntimes = runtimes.refetch;
  const refresh = React.useCallback(async () => {
    setChecking(true);
    try {
      await Promise.all([refetchSettings(), refetchRuntimes()]);
    } finally {
      setChecking(false);
    }
  }, [refetchSettings, refetchRuntimes]);

  // Sign-in launches an external flow. Refresh the authoritative readiness
  // while this recovery is visible so returning to Luca needs no extra click.
  React.useEffect(() => {
    if (!connect.data?.launched) return;
    let cancelled = false;
    let timer: ReturnType<typeof window.setTimeout>;
    const check = async () => {
      await Promise.all([refetchSettings(), refetchRuntimes()]);
      if (!cancelled) timer = window.setTimeout(() => void check(), 1500);
    };
    timer = window.setTimeout(() => void check(), 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connect.data?.launched, refetchSettings, refetchRuntimes]);

  const pending = install.isPending || connect.isPending;
  const error = actionError ?? connect.error?.message ?? install.error?.message;
  const needsSignIn =
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out";

  // The bridge between Luca and a runtime the owner already has is our
  // business, not theirs. When the only thing missing is the adapter, install
  // it without asking — one honest progress line, no button, no npm
  // vocabulary. (WP-SETUP1 decision 3.)
  const adapterOnly =
    !needsSignIn &&
    runtime.canAutoInstall &&
    !runtime.nodeRequired &&
    (runtime.availability === "adapter_missing" ||
      runtime.availability === "adapter_outdated");
  const [autoSetupFailed, setAutoSetupFailed] = React.useState(false);
  const startAutoSetup = React.useCallback(async () => {
    setActionError(null);
    setAutoSetupFailed(false);
    try {
      const result = await install.mutateAsync(runtime.id);
      if (!result.success) {
        throw new Error(
          `Luca couldn’t finish setting up ${runtime.label}. You can try again.`,
        );
      }
      await refresh();
    } catch (cause) {
      setAutoSetupFailed(true);
      setActionError(
        cause instanceof Error
          ? cause.message
          : `Luca couldn’t finish setting up ${runtime.label}. You can try again.`,
      );
    }
    // `install` and `refresh` are stable mutation/callback handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install, refresh, runtime.id, runtime.label]);

  const autoSetupStarted = React.useRef(false);
  React.useEffect(() => {
    if (!adapterOnly || autoSetupStarted.current || autoSetupFailed) return;
    autoSetupStarted.current = true;
    void startAutoSetup();
  }, [adapterOnly, autoSetupFailed, startAutoSetup]);

  async function recover() {
    setActionError(null);
    try {
      if (needsSignIn) {
        const result = await methods.refetch();
        if (result.error) throw result.error;
        const method = supportedAuthMethods(
          runtime,
          result.data?.methods ?? [],
        )[0];
        if (!method) {
          throw new Error(
            "Sign-in isn’t available yet. Open the setup guide, then check again.",
          );
        }
        const resultOfConnect = await connect.mutateAsync({
          runtimeId: runtime.id,
          methodId: method.id,
        });
        if (!resultOfConnect.launched)
          throw new Error("Sign-in couldn’t open. Try again.");
      } else if (
        runtime.canAutoInstall &&
        !runtimeIsReadyForOnboarding(runtime)
      ) {
        const result = await install.mutateAsync(runtime.id);
        if (!result.success) {
          throw new Error(
            result.steps.find((step) => !step.success)?.hint ||
              "Installation didn’t finish. Try again or open the setup guide.",
          );
        }
      } else if (
        runtime.installInstructionsUrl &&
        !runtimeIsReadyForOnboarding(runtime)
      ) {
        await openUrl(runtime.installInstructionsUrl);
      }
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {adapterOnly && !autoSetupFailed ? (
        <p
          className="flex items-center gap-2"
          data-testid="runtime-silent-setup"
          role="status"
        >
          <Spinner className="h-3.5 w-3.5" />
          Setting up {runtime.label}…
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {adapterOnly && autoSetupFailed ? (
          <Button
            className="h-8"
            disabled={pending}
            onClick={() => void startAutoSetup()}
            type="button"
            variant="outline"
          >
            {install.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Try again
          </Button>
        ) : null}
        {!adapterOnly &&
        !runtimeIsReadyForOnboarding(runtime) &&
        (needsSignIn ||
          runtime.canAutoInstall ||
          runtime.installInstructionsUrl) ? (
          <Button
            className="h-8"
            disabled={pending || methods.isFetching}
            onClick={() => void recover()}
            type="button"
            variant="outline"
          >
            {pending || methods.isFetching ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : null}
            {needsSignIn
              ? connect.isPending
                ? "Opening sign-in…"
                : "Sign in"
              : runtime.canAutoInstall
                ? install.isPending
                  ? "Installing…"
                  : "Install"
                : "Open setup guide"}
          </Button>
        ) : null}
        <Button
          className="h-8"
          disabled={pending || checking}
          onClick={() => void refresh()}
          type="button"
          variant="ghost"
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
      {connect.data?.launched && !error ? (
        <p role="status">
          Finish signing in in the window that opened. Luca will continue
          checking here.
        </p>
      ) : null}
      {error ? (
        <p className="break-words text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {error && runtime.installInstructionsUrl ? (
        <Button
          className="h-8 self-start"
          onClick={() =>
            void openUrl(runtime.installInstructionsUrl).catch(() =>
              setActionError(
                "The setup guide couldn’t open. Please try again.",
              ),
            )
          }
          type="button"
          variant="outline"
        >
          Open setup guide
        </Button>
      ) : null}
    </div>
  );
}

export const PolyphonicRuntimeStep = React.forwardRef<
  PolyphonicRuntimeStepHandle,
  { onReadyChange: (ready: boolean) => void }
>(function PolyphonicRuntimeStep({ onReadyChange }, ref) {
  const settings = useOperatorForgeSettingsQuery();
  const runtimes = useAcpRuntimesQuery();
  const queryClient = useQueryClient();
  const save = useSaveOperatorForgePreferencesMutation();
  const savePreferences = save.mutateAsync;
  const [selected, setSelected] = React.useState<AgentRuntimeTargetV1 | null>(
    null,
  );
  const [showOtherRuntimes, setShowOtherRuntimes] = React.useState(false);

  // What the pages after this one open on, fetched while the owner is reading
  // this one: the residents already here and the personas they can be made
  // from — the agents chapter's rows, and the two lists the waking step will
  // not start without.
  React.useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: managedAgentsQueryKey,
      queryFn: listManagedAgents,
    });
    void queryClient.prefetchQuery({
      queryKey: personasQueryKey,
      queryFn: listPersonas,
    });
  }, [queryClient]);

  React.useEffect(() => {
    if (!settings.data || selected) return;
    setSelected(
      settings.data.preferences.runtimeConfirmed
        ? settings.data.preferences.defaultRuntimeTarget
        : settings.data.recommendation,
    );
  }, [selected, settings.data]);

  const selectedOption = settings.data?.runtimeOptions.find(
    (option) => selected && targetKey(option.target) === targetKey(selected),
  );
  const selectedRuntime = selectedOption
    ? matchingRuntime(selectedOption, runtimes.data ?? [])
    : null;
  const ready = selectedOption?.readiness === "ready";
  React.useEffect(() => onReadyChange(ready), [onReadyChange, ready]);

  const commit = React.useCallback(() => {
    if (!selected || !ready) return undefined;
    // The owner has answered; the waking page can start on that answer at
    // once. Publish it to the cache the waking page reads, then write it
    // through behind the page rather than holding "Meet Luca" on "Working…"
    // for a round trip. The mutation's own onSuccess replaces this with the
    // authoritative settings when it lands.
    const current = queryClient.getQueryData<OperatorForgeSettingsV1>(
      operatorForgeSettingsQueryKey,
    );
    if (current) {
      queryClient.setQueryData(operatorForgeSettingsQueryKey, {
        ...current,
        preferences: {
          ...current.preferences,
          defaultRuntimeTarget: selected,
          runtimeConfirmed: true,
          lucaEnabled: true,
        },
      });
    }
    void savePreferences({
      defaultRuntimeTarget: selected,
      runtimeConfirmed: true,
      lucaEnabled: true,
    }).catch(() => {
      // The choice is already what the rest of setup is acting on, and the
      // waking step surfaces anything that actually cannot be done with it.
    });
    return selected;
  }, [queryClient, ready, savePreferences, selected]);
  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const options = settings.data?.runtimeOptions ?? [];
  // Everything the owner actually has on this Mac shows by default — ready
  // first, then the ones Luca is still finishing setting up. Only runtimes
  // that are genuinely not installed go behind the toggle. Burying a runtime
  // they already have is the failure WP-SETUP1 exists to end.
  const presentOptions = options
    .filter((option) => option.readiness !== "unavailable")
    .sort((left, right) => {
      const byReadiness =
        Number(right.readiness === "ready") -
        Number(left.readiness === "ready");
      if (byReadiness !== 0) return byReadiness;
      return (
        Number(Boolean(right.recommended)) - Number(Boolean(left.recommended))
      );
    });
  const absentOptions = options.filter(
    (option) => option.readiness === "unavailable",
  );
  const revealAllRuntimes = showOtherRuntimes || presentOptions.length === 0;
  const visibleOptions = revealAllRuntimes
    ? [...presentOptions, ...absentOptions]
    : presentOptions;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PolyphonicStepHeading
        description="Luca is the same either way. This only chooses the voice."
        stage="runtime"
        title="Who speaks for Luca?"
      />
      <div
        className="mt-5 min-h-0 flex-1 overflow-y-auto pb-1"
        data-prototype-scroll-owner="true"
        data-testid="polyphonic-runtime-scroll"
      >
        <div
          aria-busy={settings.isPending}
          aria-label="Luca runtime"
          className={cn(
            "grid grid-cols-1 gap-1",
            // Five rows, then it scrolls: a list that runs past the card's
            // bottom edge is a list nobody reads the end of.
            "max-h-[17.25rem] overflow-y-auto overscroll-contain",
            // Hold three rows' worth of height until the options resolve, so
            // the card does not collapse and re-grow in the frames between
            // this chapter mounting and its query returning.
            !settings.data && "min-h-[10rem] place-items-center",
          )}
          data-testid="polyphonic-runtime-rows"
          role="radiogroup"
        >
          {!settings.data ? (
            settings.isError ? (
              <div className="flex flex-col items-start gap-3 p-4" role="alert">
                <p className="text-sm text-[var(--prototype-ink)]">
                  Couldn’t check the AI available on this Mac.
                </p>
                <Button
                  disabled={settings.isFetching}
                  onClick={() => void settings.refetch()}
                  type="button"
                  variant="outline"
                >
                  {settings.isFetching ? "Checking…" : "Try again"}
                </Button>
              </div>
            ) : (
              <Spinner className="h-4 w-4 text-[var(--prototype-muted)]" />
            )
          ) : null}
          {settings.data && options.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-4" role="status">
              <p className="text-sm text-[var(--prototype-ink)]">
                No AI connections are available yet. Check again after setting
                one up.
              </p>
              <Button
                disabled={settings.isFetching}
                onClick={() => void settings.refetch()}
                type="button"
                variant="outline"
              >
                Check again
              </Button>
            </div>
          ) : null}
          {visibleOptions.map((option) => {
            const runtime = matchingRuntime(option, runtimes.data ?? []);
            const checked = selected
              ? targetKey(selected) === targetKey(option.target)
              : false;
            return (
              <label
                className={cn(
                  "group relative flex h-[52px] w-full cursor-pointer items-center gap-3 rounded-[12px] border px-3.5 text-left outline-none transition-[border-color,background-color] duration-[90ms]",
                  // Focus is this row's own border coming up, in place.
                  "has-[:focus-visible]:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)]",
                  checked
                    ? "border-[color-mix(in_srgb,var(--prototype-ink)_28%,transparent)]"
                    : "border-[var(--prototype-hairline)] hover:border-[color-mix(in_srgb,var(--prototype-ink)_18%,transparent)]",
                )}
                key={targetKey(option.target)}
              >
                <span className="grid size-5 shrink-0 place-items-center">
                  {runtime ? (
                    <RuntimeIcon
                      className="h-[1.125rem] w-[1.125rem] rounded-none"
                      runtime={runtime}
                    />
                  ) : (
                    <TerminalSquare className="h-4 w-4 text-[var(--prototype-muted)]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--prototype-ink)]">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
                    {option.readiness === "ready"
                      ? [
                          runtime?.signedInAs
                            ? `Signed in with ${runtime.signedInAs}`
                            : "Ready on this Mac",
                          // Never imply a check that cannot happen.
                          runtime && runtime.authCheckable === false
                            ? "Luca can’t tell if you’re signed in"
                            : null,
                          option.recommended ? "Recommended" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : (option.reason ??
                        (option.readiness === "setup_required"
                          ? "Set up"
                          : "Unavailable"))}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="grid size-4 shrink-0 place-items-center"
                >
                  {checked ? (
                    <span className="size-1.5 rounded-full bg-[var(--prototype-ink)]" />
                  ) : null}
                </span>
                <input
                  checked={checked}
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                  name="polyphonic-runtime"
                  onChange={() => setSelected(option.target)}
                  type="radio"
                />
              </label>
            );
          })}
        </div>
        {absentOptions.length > 0 && !revealAllRuntimes ? (
          <button
            aria-expanded="false"
            className="mt-3 -ml-1 flex w-fit items-center gap-1 rounded-[6px] border border-transparent px-1 py-1 text-xs text-[var(--prototype-muted-strong)] outline-none hover:text-[var(--prototype-ink)] focus-visible:border-[color-mix(in_srgb,var(--prototype-ink)_50%,transparent)] focus-visible:outline-none"
            onClick={() => setShowOtherRuntimes(true)}
            type="button"
          >
            Show other options
            <ChevronDown aria-hidden="true" className="size-3" />
          </button>
        ) : null}
        {selectedOption ? (
          <p className="mt-3 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted-strong)]">
            {selectedOption.target.kind === "managed"
              ? "Direct conversations with Luca, plus every collaboration tool."
              : "Direct conversations with Luca and the agents already on your Mac. Some collaboration tools aren’t available on this runtime yet."}
          </p>
        ) : null}
      </div>
      {/*
        A required step must never sit below the fold. This block is a sibling
        of the scroll container, not a child of it, so whatever the window
        height the action to unblock setup is on screen. (WP-SETUP1 decision 6.)
      */}
      {selectedOption && selectedOption.readiness !== "ready" ? (
        <div
          className="mt-4 flex shrink-0 flex-col items-start gap-3 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted-strong)]"
          data-testid="polyphonic-runtime-action"
        >
          <span>
            {selectedOption.reason ?? "This runtime needs attention."}
          </span>
          {selectedRuntime ? (
            <ManagedRecovery
              key={selectedRuntime.id}
              runtime={selectedRuntime}
            />
          ) : (
            <Button
              className="h-8"
              onClick={() => void settings.refetch()}
              type="button"
              variant="outline"
            >
              Check again
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
});
