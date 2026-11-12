import { useQuery } from "@tanstack/react-query";
import { FolderOpen, ShieldCheck, X } from "lucide-react";
import * as React from "react";

import {
  pickRuntimeTaskFolder,
  type RuntimeTaskOperation,
  type RuntimeTaskOptions,
} from "@/shared/api/tauriRuntimeTasks";
import { listRuntimeConnectionStatus } from "@/shared/api/tauriMcp";
import { getResidentCapabilitySettings } from "@/shared/api/residentCapabilities";
import { PlaceQuietButton } from "@/app/shell/placeRails/PlaceAskRow";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { Button } from "@/shared/ui/button";
import {
  hasExactRuntimeTaskTarget,
  isExistingRuntimeTask,
  type RuntimeTaskTarget,
} from "@/features/capabilities/lib/runtimeTaskPresentation";

type RuntimeTarget = RuntimeTaskTarget;

function runtimeTargetLabel(target: RuntimeTarget) {
  return target === "codex" ? "Codex" : "Claude Code";
}

export type RuntimeTaskDraft = {
  /** Host-bound eligibility only; never inferred from the prompt. */
  canRememberPrivateAsk?: boolean;
  options?: RuntimeTaskOptions;
  conversationId: string;
  residentPubkey: string;
  residentName: string;
  runtimeFamily: RuntimeTarget;
  summary: string;
  prompt: string;
  workingFolder?: string | null;
  operation?: RuntimeTaskOperation;
  sourceId?: string | null;
  sessionId?: string | null;
  targetLabel?: string | null;
  targetWorkingFolder?: string | null;
};

export type RuntimeTaskConfirmationDetails = {
  useClaudeApi?: boolean;
  rememberAccess?: boolean;
  runtimeFamily: RuntimeTarget;
  workingFolder: string;
  permissionMode: "normal" | "full_access";
  operation?: RuntimeTaskOperation;
  sourceId?: string | null;
  sessionId?: string | null;
};

/** Explicit API access is narrow, and remembering never implies selecting it. */
export function privateAskAccessSelection(
  draft: RuntimeTaskDraft,
  useClaudeApi: boolean,
  rememberAccess: boolean,
): Partial<RuntimeTaskConfirmationDetails> {
  return draft.canRememberPrivateAsk === true && useClaudeApi
    ? {
        useClaudeApi: true,
        rememberAccess: rememberAccess === true,
        runtimeFamily: "claude_code",
        permissionMode: "normal",
        workingFolder: draft.targetWorkingFolder ?? "",
      }
    : {};
}

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
  // Under the frame its confirm is the ask's quiet answer: Talk stays the only
  // solid action on a screen (SHELL_BUILD.md WP-16, Decided 2).
  const shellFrame = useShellFrameEnabled();
  const apiDisclosureId = React.useId();
  const existingSession = isExistingRuntimeTask(draft.operation);
  const operationLabel =
    draft.operation === "send_message" ? "Send" : "Continue";
  const runtimeQuery = useQuery({
    queryKey: ["runtime-task-targets"],
    queryFn: listRuntimeConnectionStatus,
    enabled: !existingSession,
    retry: false,
    staleTime: 10_000,
  });
  const capabilitySettingsQuery = useQuery({
    queryKey: ["resident-capability-settings"],
    queryFn: getResidentCapabilitySettings,
    enabled: !existingSession,
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
  const [selectedTarget, setTarget] = React.useState<RuntimeTarget>(
    draft.runtimeFamily,
  );
  const [selectedFolder, setWorkingFolder] = React.useState(
    draft.workingFolder ?? "",
  );
  const [useClaudeApi, setUseClaudeApi] = React.useState(false);
  const [rememberAccess, setRememberAccess] = React.useState(false);
  const apiSelected = draft.canRememberPrivateAsk === true && useClaudeApi;
  const target = apiSelected
    ? "claude_code"
    : existingSession
      ? draft.runtimeFamily
      : selectedTarget;
  const workingFolder =
    apiSelected || existingSession
      ? (draft.targetWorkingFolder ?? "")
      : selectedFolder;
  const exactTargetReady = hasExactRuntimeTaskTarget(draft);
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
    if (!existingSession && !selectedFolder && draft.workingFolder) {
      setWorkingFolder(draft.workingFolder);
    }
  }, [draft.workingFolder, existingSession, selectedFolder]);

  const targetReady = apiSelected
    ? Boolean(draft.targetWorkingFolder?.trim())
    : existingSession
      ? exactTargetReady
      : availableTargets.some((runtime) => runtime.runtimeId === target);

  const confirm = () => {
    if (isStarting || !targetReady || !workingFolder.trim()) return;
    setIsStarting(true);
    setError(null);
    void onConfirm({
      runtimeFamily: target,
      workingFolder,
      permissionMode:
        apiSelected || existingSession ? "normal" : permissionMode,
      ...(existingSession
        ? {
            operation: draft.operation,
            sourceId: draft.sourceId,
            sessionId: draft.sessionId,
          }
        : {}),
      ...privateAskAccessSelection(draft, apiSelected, rememberAccess),
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
  };
  const confirmLabel = isStarting
    ? existingSession
      ? "Sending…"
      : apiSelected
        ? "Asking…"
        : "Starting…"
    : existingSession
      ? operationLabel
      : apiSelected
        ? "Ask"
        : "Run";

  return (
    <section
      aria-label="Confirm runtime task"
      className="pointer-events-auto mb-2 rounded-2xl border border-border/55 bg-plate/95 p-4 shadow-xl backdrop-blur-xl"
      data-testid="runtime-task-confirmation"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {existingSession
              ? draft.operation === "send_message"
                ? "Send to existing session"
                : "Continue existing session"
              : draft.canRememberPrivateAsk
                ? "Ask Claude Code"
                : "Run task"}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {existingSession
              ? "Only this exact session and its working folder will be used."
              : "Nothing starts until you confirm these exact details."}
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

      {draft.canRememberPrivateAsk === true ? (
        <div className="mt-4 grid gap-3 text-xs text-ink-muted">
          <label className="flex items-start gap-2">
            <input
              aria-describedby={apiDisclosureId}
              checked={apiSelected}
              disabled={isStarting}
              onChange={(event) => {
                setUseClaudeApi(event.currentTarget.checked);
                setRememberAccess(false);
              }}
              type="checkbox"
            />
            <span>Use the connected Claude API account for this answer</span>
          </label>
          <p id={apiDisclosureId}>
            Only your current message goes to{" "}
            {draft.options?.model ?? "the selected Claude model"}. No project
            files or tools. Claude Code uses a $0.25 task budget. Final charges
            come from Anthropic.
          </p>
          {apiSelected ? (
            <label className="flex items-start gap-2">
              <input
                checked={rememberAccess}
                disabled={isStarting}
                onChange={(event) =>
                  setRememberAccess(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                Remember for matching asks in this private chat
                <span className="mt-1 block">
                  Same model and account. No project access.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {!apiSelected ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-ink-muted">
              Runtime
              <select
                className="h-9 rounded-lg border border-border/55 bg-background px-2.5 text-sm text-ink outline-none focus-visible:border-ring"
                disabled={
                  existingSession ||
                  isStarting ||
                  runtimeQuery.isLoading ||
                  availableTargets.length === 0
                }
                onChange={(event) =>
                  setTarget(event.currentTarget.value as RuntimeTarget)
                }
                value={target}
              >
                {existingSession ? (
                  <option value={target}>{runtimeTargetLabel(target)}</option>
                ) : !targetReady ? (
                  <option disabled value={target}>
                    {runtimeTargetLabel(target)} —{" "}
                    {runtimeQuery.isLoading
                      ? "checking"
                      : runtimeQuery.isError
                        ? "could not verify"
                        : "unavailable"}
                  </option>
                ) : null}
                {!existingSession &&
                  availableTargets.map((runtime) => (
                    <option key={runtime.runtimeId} value={runtime.runtimeId}>
                      {runtime.label}
                    </option>
                  ))}
              </select>
            </label>
            {existingSession ? (
              <div className="grid gap-1 text-xs text-ink-muted">
                <span>Permission policy</span>
                <span>Keep this session's native permissions</span>
              </div>
            ) : (
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
            )}
          </div>

          <div className="mt-3 grid gap-1">
            <span className="text-xs text-ink-muted">Working folder</span>
            <button
              className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background px-2.5 text-left text-sm text-ink hover:bg-plate"
              disabled={isStarting || existingSession}
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
              <FolderOpen
                aria-hidden
                className="size-4 shrink-0 text-ink-muted"
              />
              <span className="truncate">
                {workingFolder || "Choose a project or working folder"}
              </span>
            </button>
          </div>
        </>
      ) : null}

      <div className="mt-3 rounded-xl bg-background/70 px-3 py-2.5">
        {existingSession && draft.targetLabel ? (
          <p className="line-clamp-2 text-sm font-medium text-ink">
            {draft.targetLabel}
          </p>
        ) : null}
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {draft.summary}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Requested with {draft.residentName}
        </p>
      </div>

      {existingSession ? (
        <p className="mt-3 text-xs text-ink-muted">
          {draft.operation === "send_message"
            ? `This sends a queued follow-up to ${runtimeTargetLabel(target)}. Delivery is not work completion; handle approvals and stopping in the native app.`
            : "Before continuing, confirm this exact saved CLI session is not running in another client. File metadata and Polyphonic's local lease do not prove that it is idle everywhere. Continuation keeps its original folder, identity, and native permission policy."}
        </p>
      ) : null}
      {draft.operation !== "send_message" ? (
        <p className="mt-3 text-xs text-ink-muted">
          {apiSelected ? (
            rememberAccess ? (
              "Matching asks can run without another review. Answers come back here. You can forget this access in Settings."
            ) : (
              "This approves one answer in this private chat."
            )
          ) : (
            <>
              Confirming authorizes this exact task and one result summary by{" "}
              {draft.residentName} back into this same conversation. It does not
              authorize another provider task.
            </>
          )}
        </p>
      ) : null}
      {existingSession && !exactTargetReady ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          The exact session or its working folder is unavailable. Ask your
          resident to resolve the target again; no work will be sent.
        </p>
      ) : null}
      {apiSelected && !targetReady ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          The private answer workspace is unavailable. Ask again; no API request
          will be sent.
        </p>
      ) : null}
      {!apiSelected && !existingSession && permissionMode === "full_access" ? (
        <div className="mt-3 flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Full Access lets this runtime work without individual approval prompts
          for this task.
        </div>
      ) : null}
      {!apiSelected && !existingSession && capabilitySettingsQuery.isError ? (
        <p className="mt-3 text-xs text-ink-muted">
          Full Access could not be verified, so this task will ask when needed.
        </p>
      ) : null}
      {!apiSelected && !existingSession && runtimeQuery.isError ? (
        <p className="mt-3 text-xs text-destructive">
          Polyphonic could not check which runtimes are ready. Reconnect Codex
          or Claude Code, then try this task again.
        </p>
      ) : null}
      {!apiSelected &&
      !existingSession &&
      runtimeQuery.isSuccess &&
      availableTargets.length === 0 ? (
        <p className="mt-3 text-xs text-destructive">
          Connect and authenticate Codex or Claude Code before running a task.
        </p>
      ) : null}
      {!apiSelected &&
      !existingSession &&
      runtimeQuery.isSuccess &&
      availableTargets.length > 0 &&
      !targetReady ? (
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
        {shellFrame ? (
          <PlaceQuietButton disabled={isStarting} onClick={onCancel}>
            Cancel
          </PlaceQuietButton>
        ) : (
          <Button
            disabled={isStarting}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        )}
        {shellFrame ? (
          <PlaceQuietButton
            data-testid="runtime-task-confirm"
            disabled={isStarting || !targetReady || !workingFolder}
            onClick={confirm}
          >
            {confirmLabel}
          </PlaceQuietButton>
        ) : (
          <Button
            disabled={isStarting || !targetReady || !workingFolder}
            onClick={confirm}
            type="button"
          >
            {confirmLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
