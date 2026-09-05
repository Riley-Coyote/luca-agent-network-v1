import { useQuery } from "@tanstack/react-query";
import { FolderOpen, ShieldCheck, X } from "lucide-react";
import * as React from "react";

import { pickRuntimeTaskFolder } from "@/shared/api/tauriRuntimeTasks";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import { getResidentCapabilitySettings } from "@/shared/api/residentCapabilities";
import { Button } from "@/shared/ui/button";
import type { RuntimeTaskTarget } from "@/features/capabilities/lib/runtimeTaskPresentation";

type RuntimeTarget = RuntimeTaskTarget;

function runtimeTargetLabel(target: RuntimeTarget) {
  return target === "codex" ? "Codex" : "Claude Code";
}

export type RuntimeTaskDraft = {
  conversationId: string;
  residentPubkey: string;
  residentName: string;
  runtimeFamily: RuntimeTarget;
  summary: string;
  prompt: string;
  workingFolder?: string | null;
};

export type RuntimeTaskConfirmationDetails = {
  runtimeFamily: RuntimeTarget;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
};

export function RuntimeTaskConfirmationCard({
  draft,
  onCancel,
  onConfirm,
  onConfirmed,
}: {
  draft: RuntimeTaskDraft;
  onCancel: () => void;
  onConfirm: (details: RuntimeTaskConfirmationDetails) => Promise<unknown>;
  onConfirmed: () => void;
}) {
  const runtimeQuery = useQuery({
    queryKey: ["runtime-task-targets"],
    queryFn: listRuntimeConnectionStatus,
    retry: false,
    staleTime: 10_000,
  });
  const capabilitySettingsQuery = useQuery({
    queryKey: ["resident-capability-settings"],
    queryFn: getResidentCapabilitySettings,
    retry: false,
    staleTime: 10_000,
  });
  const availableTargets = React.useMemo(
    () =>
      (runtimeQuery.data ?? []).filter(
        (runtime): runtime is typeof runtime & { runtimeId: RuntimeTarget } =>
          (runtime.runtimeId === "codex" ||
            runtime.runtimeId === "claude_code") &&
          runtime.readiness === "ready" &&
          runtime.authentication === "ready",
      ),
    [runtimeQuery.data],
  );
  const [target, setTarget] = React.useState<RuntimeTarget>(
    draft.runtimeFamily,
  );
  const [workingFolder, setWorkingFolder] = React.useState(
    draft.workingFolder ?? "",
  );
  const [permissionMode, setPermissionMode] = React.useState<
    "normal" | "full_access"
  >("normal");
  const [isStarting, setIsStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const residentAccess = capabilitySettingsQuery.data
    ? (capabilitySettingsQuery.data.residentAccess[draft.residentPubkey] ??
      capabilitySettingsQuery.data.householdDefault)
    : null;
  const fullAccessEnabled = residentAccess === "full";

  React.useEffect(() => {
    if (!fullAccessEnabled && permissionMode === "full_access") {
      setPermissionMode("normal");
    }
  }, [fullAccessEnabled, permissionMode]);

  React.useEffect(() => {
    if (!workingFolder && draft.workingFolder) {
      setWorkingFolder(draft.workingFolder);
    }
  }, [draft.workingFolder, workingFolder]);

  const targetReady = availableTargets.some(
    (runtime) => runtime.runtimeId === target,
  );

  return (
    <section
      aria-label="Confirm runtime task"
      className="mb-2 rounded-2xl border border-border/55 bg-plate/95 p-4 shadow-xl backdrop-blur-xl"
      data-testid="runtime-task-confirmation"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Run task</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Nothing starts until you confirm these exact details.
          </p>
        </div>
        <Button
          aria-label="Cancel runtime task"
          className="size-7 rounded-full"
          onClick={onCancel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-ink-muted">
          Runtime
          <select
            className="h-9 rounded-lg border border-border/55 bg-background px-2.5 text-sm text-ink outline-none focus-visible:border-ring"
            disabled={
              isStarting ||
              runtimeQuery.isLoading ||
              availableTargets.length === 0
            }
            onChange={(event) =>
              setTarget(event.currentTarget.value as RuntimeTarget)
            }
            value={target}
          >
            {!targetReady ? (
              <option disabled value={target}>
                {runtimeTargetLabel(target)} —{" "}
                {runtimeQuery.isLoading
                  ? "checking"
                  : runtimeQuery.isError
                    ? "could not verify"
                    : "unavailable"}
              </option>
            ) : null}
            {availableTargets.map((runtime) => (
              <option key={runtime.runtimeId} value={runtime.runtimeId}>
                {runtime.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-muted">
          Permission mode
          <select
            className="h-9 rounded-lg border border-border/55 bg-background px-2.5 text-sm text-ink outline-none focus-visible:border-ring"
            disabled={isStarting}
            onChange={(event) =>
              setPermissionMode(
                event.currentTarget.value as "normal" | "full_access",
              )
            }
            value={permissionMode}
          >
            <option value="normal">Ask when needed</option>
            <option disabled={!fullAccessEnabled} value="full_access">
              {fullAccessEnabled
                ? "Full Access"
                : "Full Access — enable in Settings"}
            </option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-1">
        <span className="text-xs text-ink-muted">Working folder</span>
        <button
          className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background px-2.5 text-left text-sm text-ink hover:bg-plate"
          disabled={isStarting}
          onClick={() => {
            void pickRuntimeTaskFolder().then((folder) => {
              if (folder) {
                setWorkingFolder(folder);
                setError(null);
              }
            });
          }}
          type="button"
        >
          <FolderOpen aria-hidden className="size-4 shrink-0 text-ink-muted" />
          <span className="truncate">
            {workingFolder || "Choose a project or working folder"}
          </span>
        </button>
      </div>

      <div className="mt-3 rounded-xl bg-background/70 px-3 py-2.5">
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {draft.summary}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Requested with {draft.residentName}
        </p>
      </div>

      {permissionMode === "full_access" ? (
        <div className="mt-3 flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Full Access lets this runtime work without individual approval prompts
          for this task.
        </div>
      ) : null}
      {capabilitySettingsQuery.isError ? (
        <p className="mt-3 text-xs text-ink-muted">
          Full Access could not be verified, so this task will ask when needed.
        </p>
      ) : null}
      {runtimeQuery.isSuccess && availableTargets.length === 0 ? (
        <p className="mt-3 text-xs text-destructive">
          Connect and authenticate Codex or Claude Code before running a task.
        </p>
      ) : null}
      {runtimeQuery.isSuccess && availableTargets.length > 0 && !targetReady ? (
        <p className="mt-3 text-xs text-destructive">
          {runtimeTargetLabel(target)} is not ready. Choose another verified
          runtime or reconnect it before running this task.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button
          disabled={isStarting}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          disabled={isStarting || !targetReady || !workingFolder}
          onClick={() => {
            setIsStarting(true);
            setError(null);
            void onConfirm({
              runtimeFamily: target,
              workingFolder,
              permissionMode,
            })
              .then(onConfirmed)
              .catch((cause: unknown) => {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "The runtime task could not start.",
                );
              })
              .finally(() => setIsStarting(false));
          }}
          type="button"
        >
          {isStarting ? "Starting…" : "Run"}
        </Button>
      </div>
    </section>
  );
}
