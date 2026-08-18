import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, TerminalSquare } from "lucide-react";

import {
  useAcpAuthMethodsQuery,
  useAcpRuntimesQuery,
  useConnectAcpRuntimeMutation,
  useInstallAcpRuntimeMutation,
} from "@/features/agents/hooks";
import {
  useOperatorForgeSettingsQuery,
  useSaveOperatorForgePreferencesMutation,
} from "@/features/agents/operatorForgeQueries";
import type {
  AgentRuntimeTargetV1,
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
  commit: () => Promise<AgentRuntimeTargetV1 | undefined>;
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
  const install = useInstallAcpRuntimeMutation();
  const methods = useAcpAuthMethodsQuery(runtime.id, {
    enabled:
      runtime.availability === "available" &&
      runtime.authStatus.status === "logged_out",
  });
  const connect = useConnectAcpRuntimeMutation();

  if (runtimeIsReadyForOnboarding(runtime)) return null;
  if (
    runtime.availability === "available" &&
    runtime.authStatus.status === "logged_out"
  ) {
    return (
      <Button
        className="h-8"
        disabled={connect.isPending}
        onClick={() => {
          const method = supportedAuthMethods(
            runtime,
            methods.data?.methods ?? [],
          )[0];
          if (method) {
            connect.mutate({ runtimeId: runtime.id, methodId: method.id });
          } else {
            void methods.refetch();
          }
        }}
        type="button"
        variant="outline"
      >
        {connect.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
        Sign in
      </Button>
    );
  }
  if (runtime.canAutoInstall) {
    return (
      <Button
        className="h-8"
        disabled={install.isPending}
        onClick={() => install.mutate(runtime.id)}
        type="button"
        variant="outline"
      >
        {install.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
        Install
      </Button>
    );
  }
  if (runtime.installInstructionsUrl) {
    return (
      <Button
        className="h-8"
        onClick={() => void openUrl(runtime.installInstructionsUrl)}
        type="button"
        variant="outline"
      >
        Open setup guide
      </Button>
    );
  }
  return (
    <Button
      className="h-8"
      onClick={() => void runtimes.refetch()}
      type="button"
      variant="outline"
    >
      Check again
    </Button>
  );
}

export const PolyphonicRuntimeStep = React.forwardRef<
  PolyphonicRuntimeStepHandle,
  { onReadyChange: (ready: boolean) => void }
>(function PolyphonicRuntimeStep({ onReadyChange }, ref) {
  const settings = useOperatorForgeSettingsQuery();
  const runtimes = useAcpRuntimesQuery();
  const save = useSaveOperatorForgePreferencesMutation();
  const [selected, setSelected] = React.useState<AgentRuntimeTargetV1 | null>(
    null,
  );
  const [showOtherRuntimes, setShowOtherRuntimes] = React.useState(false);

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

  const commit = React.useCallback(async () => {
    if (!selected || !ready) return undefined;
    await save.mutateAsync({
      defaultRuntimeTarget: selected,
      runtimeConfirmed: true,
      lucaEnabled: true,
    });
    return selected;
  }, [ready, save, selected]);
  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const options = settings.data?.runtimeOptions ?? [];
  const readyOptions = options
    .filter((option) => option.readiness === "ready")
    .sort(
      (left, right) =>
        Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)),
    );
  const unreadyOptions = options.filter(
    (option) => option.readiness !== "ready",
  );
  const revealAllRuntimes =
    showOtherRuntimes ||
    readyOptions.length === 0 ||
    selectedOption?.readiness !== "ready";
  const visibleOptions = revealAllRuntimes
    ? [...readyOptions, ...unreadyOptions]
    : readyOptions;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PolyphonicStepHeading
        description="Pick the AI Luca should use on this Mac. You can change it later without changing who Luca is."
        stage="runtime"
        title="Choose what powers Luca"
      />
      <div
        className="mt-5 min-h-0 flex-1 overflow-y-auto pb-1"
        data-prototype-scroll-owner="true"
        data-testid="polyphonic-runtime-scroll"
      >
        <div
          aria-busy={!settings.data}
          aria-label="Luca runtime"
          className={cn(
            "grid grid-cols-1 rounded-[10px] bg-[var(--prototype-recessed)] p-1",
            // Hold three rows' worth of height until the options resolve, so
            // the card does not collapse and re-grow in the frames between
            // this chapter mounting and its query returning.
            !settings.data && "min-h-[10.25rem] place-items-center",
          )}
          role="radiogroup"
        >
          {!settings.data ? (
            <Spinner className="h-4 w-4 text-[var(--prototype-muted)]" />
          ) : null}
          {visibleOptions.map((option) => {
            const runtime = matchingRuntime(option, runtimes.data ?? []);
            const checked = selected
              ? targetKey(selected) === targetKey(option.target)
              : false;
            return (
              <label
                className={cn(
                  "group relative flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left outline-none transition-[background-color,box-shadow] duration-[90ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-[var(--prototype-focus)]",
                  checked
                    ? "bg-[var(--prototype-raised)] shadow-[0_1px_2px_var(--prototype-shadow)]"
                    : "hover:bg-[var(--prototype-selection)]",
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
                      ? option.recommended
                        ? "Ready on this Mac · Recommended"
                        : "Ready on this Mac"
                      : (option.reason ??
                        (option.readiness === "setup_required"
                          ? "Set up"
                          : "Unavailable"))}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    checked
                      ? "border-[var(--prototype-ink)]"
                      : "border-[var(--prototype-hairline)]",
                  )}
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
        {unreadyOptions.length > 0 && !revealAllRuntimes ? (
          <button
            aria-expanded="false"
            className="mt-2.5 flex w-fit items-center gap-1 rounded-[6px] py-1 text-xs text-[var(--prototype-muted-strong)] outline-none hover:text-[var(--prototype-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--prototype-focus)]"
            onClick={() => setShowOtherRuntimes(true)}
            type="button"
          >
            Show other runtimes
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
        {selectedOption && selectedOption.readiness !== "ready" ? (
          <div className="mt-4 flex items-start justify-between gap-4 text-[length:var(--prototype-support-size)] leading-[1.125rem] text-[var(--prototype-muted)]">
            <span>
              {selectedOption.reason ?? "This runtime needs attention."}
            </span>
            {selectedRuntime ? (
              <ManagedRecovery runtime={selectedRuntime} />
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
    </div>
  );
});
