import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TerminalSquare } from "lucide-react";

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
  return (
    <>
      <PolyphonicStepHeading
        description="Pick the AI Luca should use on this Mac. You can change it later without changing who Luca is."
        stage="runtime"
        title="Choose what powers Luca"
      />
      <div
        aria-label="Luca runtime"
        className="mt-7 overflow-hidden rounded-xl bg-foreground/[0.055] p-1"
        role="radiogroup"
      >
        {options.map((option) => {
          const runtime = matchingRuntime(option, runtimes.data ?? []);
          const checked = selected
            ? targetKey(selected) === targetKey(option.target)
            : false;
          return (
            <label
              className={cn(
                "flex min-h-[3.5rem] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                checked && "bg-background shadow-sm ring-1 ring-foreground/10",
              )}
              key={targetKey(option.target)}
            >
              {runtime ? (
                <RuntimeIcon
                  className="h-[1.125rem] w-[1.125rem] rounded-none"
                  runtime={runtime}
                />
              ) : (
                <TerminalSquare className="h-4 w-4 text-foreground/55" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {option.label}
                </span>
                <span className="block text-[0.8125rem] leading-[1.125rem] text-foreground/55">
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
              <input
                checked={checked}
                className="h-4 w-4 accent-foreground"
                name="polyphonic-runtime"
                onChange={() => setSelected(option.target)}
                type="radio"
              />
            </label>
          );
        })}
      </div>
      {selectedOption && selectedOption.readiness !== "ready" ? (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm text-foreground/60">
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
    </>
  );
});
