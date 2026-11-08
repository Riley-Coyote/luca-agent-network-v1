import * as React from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Copy,
  Folder,
  MoreHorizontal,
  Play,
  Plus,
  Square,
} from "lucide-react";

import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import {
  RuntimeTaskConfirmationCard,
  type RuntimeTaskConfirmationDetails,
  type RuntimeTaskDraft,
} from "@/features/capabilities/ui/RuntimeTaskConfirmationCard";
import type {
  HarnessRuntimeFamily,
  HarnessSessionDetail as HarnessSessionDetailData,
} from "@/shared/api/tauriHarnessDashboard";
import {
  getRuntimeTaskResult,
  openRuntimeTaskSession,
  type StartRuntimeTaskInput,
} from "@/shared/api/tauriRuntimeTasks";
import type { PendingManagedPermission } from "@/shared/api/types";
import { Markdown } from "@/shared/ui/markdown";
import {
  canStopHarnessTask,
  harnessComposerAudience,
  harnessDraftKey,
  type HarnessRow,
} from "./model";
import { useHarnessSnapshot } from "./hooks";
import { captureHarnessDispatch, type HarnessSnapshot } from "./requestGuard";

function keyedItems<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const id = identity(item);
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    return { item, key: `${id}:${occurrence}` };
  });
}

export function HarnessSessionDetail({
  runtimeFamily,
  row,
  sourceId,
  newTask,
  folder,
  pickingFolder,
  conversationId,
  residentPubkey,
  ownerScope,
  transcript,
  visible,
  revision,
  canStart,
  targetFresh,
  sending,
  pending,
  onPickFolder,
  onBack,
  onStart,
  onRefresh,
  onAskLuca,
  onDispatch,
  onStop,
  onNotice,
}: {
  runtimeFamily: HarnessRuntimeFamily;
  row: HarnessRow | null;
  sourceId: string | null;
  newTask: boolean;
  folder: string;
  pickingFolder: boolean;
  conversationId: string | null;
  residentPubkey: string | null;
  ownerScope: string;
  transcript: HarnessSnapshot<HarnessSessionDetailData>;
  visible: boolean;
  revision: number;
  canStart: boolean;
  targetFresh: boolean;
  sending: boolean;
  pending: readonly PendingManagedPermission[];
  onPickFolder: () => void;
  onBack: () => void;
  onStart: () => void;
  onRefresh: () => void;
  onAskLuca?: () => void;
  onDispatch: (input: StartRuntimeTaskInput) => Promise<void>;
  onStop: () => void;
  onNotice: (notice: string) => void;
}) {
  const name = runtimeFamily === "codex" ? "Codex" : "Claude Code";
  const fixedAudience = React.useMemo(
    () => harnessComposerAudience(residentPubkey),
    [residentPubkey],
  );
  const [menu, setMenu] = React.useState(false);
  const [confirmation, setConfirmation] =
    React.useState<RuntimeTaskDraft | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const taskId = row?.task?.taskId ?? null;
  const loadResult = React.useCallback(
    () =>
      taskId
        ? getRuntimeTaskResult(taskId)
        : Promise.reject(new Error("No task selected.")),
    [taskId],
  );
  const taskResult = useHarnessSnapshot({
    enabled:
      visible &&
      Boolean(
        taskId &&
          row?.task &&
          ["succeeded", "stopped", "failed", "interrupted"].includes(
            row.task.state,
          ),
      ),
    load: loadResult,
    key: `task-result:${taskId ?? "none"}`,
    revision: `${revision}:${row?.task?.updatedAt ?? ""}`,
  });
  React.useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        setMenu(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menu]);

  const exactSession = row?.session ?? null;
  const canSend =
    !newTask &&
    Boolean(
      exactSession?.canSend && sourceId && targetFresh && !transcript.error,
    );
  const ownedWorking = Boolean(
    row?.task &&
      row.task.controlOwner !== "native_app" &&
      ["queued", "active", "stopping"].includes(row.task.state),
  );
  const draftKey = harnessDraftKey(
    runtimeFamily,
    conversationId,
    residentPubkey,
    newTask ? "new" : (row?.id ?? "none"),
    ownerScope,
  );
  const capturedSend = React.useRef<Readonly<StartRuntimeTaskInput> | null>(
    null,
  );
  const captureSend = () => {
    capturedSend.current =
      conversationId &&
      residentPubkey &&
      (newTask
        ? canStart && Boolean(folder)
        : canSend && exactSession && sourceId)
        ? captureHarnessDispatch({
            conversationId,
            residentPubkey,
            runtimeFamily,
            summary: "",
            prompt: "",
            workingFolder: newTask
              ? folder
              : (exactSession?.workingFolder ?? ""),
            permissionMode: "normal",
            operation: newTask ? "new_task" : "send_message",
            ...(newTask
              ? {}
              : { sourceId, sessionId: exactSession?.sessionId }),
          })
        : null;
    if (!capturedSend.current)
      onNotice(
        "This exact task source is not ready. Your draft is preserved; nothing was sent.",
      );
    return null;
  };
  const send = async (
    content: string,
    _mentions: string[],
    mediaTags?: string[][],
  ) => {
    try {
      if (mediaTags?.length)
        throw new Error(
          "This runtime workspace accepts text only. Remove attachments before sending.",
        );
      const target = capturedSend.current;
      capturedSend.current = null;
      if (!target)
        throw new Error(
          "This exact target is not ready. Your draft is preserved; nothing was sent.",
        );
      if (!content.trim()) return;
      if (newTask) {
        if (!canStart || !folder)
          throw new Error(
            "Choose a working folder and verify the runtime connection before sending.",
          );
        await onDispatch({
          ...target,
          summary: content.trim().slice(0, 160),
          prompt: content,
        });
        return;
      }
      if (
        !canSend ||
        !exactSession ||
        !sourceId ||
        target.sourceId !== sourceId ||
        target.sessionId !== exactSession.sessionId
      )
        throw new Error(
          "This exact native session is not ready for a follow-up. Refresh and select it again; nothing was sent.",
        );
      await onDispatch({
        ...target,
        summary: content.trim().slice(0, 160),
        prompt: content,
      });
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "This exact task could not be sent. Your draft is preserved.",
      );
      throw error;
    }
  };
  const reviewContinuation = () => {
    if (
      !exactSession ||
      !sourceId ||
      !conversationId ||
      !residentPubkey ||
      !targetFresh
    )
      return;
    setConfirmation({
      conversationId,
      residentPubkey,
      residentName: "Luca",
      runtimeFamily,
      summary: `Continue ${row?.title ?? "this session"}`,
      prompt: "Continue this session from where we left off.",
      operation: "continue_session",
      sourceId,
      sessionId: exactSession.sessionId,
      targetLabel: row?.title,
      targetWorkingFolder: exactSession.workingFolder,
    });
  };
  const confirmContinuation = async (
    details: RuntimeTaskConfirmationDetails,
  ) => {
    if (
      !confirmation ||
      !targetFresh ||
      details.sourceId !== sourceId ||
      details.sessionId !== exactSession?.sessionId
    ) {
      throw new Error(
        "The session selection changed. Close this review and select the session again.",
      );
    }
    await onDispatch({
      conversationId: confirmation.conversationId,
      residentPubkey: confirmation.residentPubkey,
      runtimeFamily: details.runtimeFamily,
      summary: confirmation.summary,
      prompt: confirmation.prompt,
      workingFolder: details.workingFolder,
      permissionMode: "normal",
      operation: "continue_session",
      sourceId: details.sourceId,
      sessionId: details.sessionId,
    });
  };
  if (!row && !newTask)
    return (
      <div className="hws-no-detail">
        <HarnessFace runtimeId={runtimeFamily} />
        <h2>Your {name} workspace</h2>
        <p>Start a task, or choose a session to pick up its conversation.</p>
        <button
          className="hws-primary"
          type="button"
          onClick={onStart}
          disabled={!canStart}
        >
          New task <Plus size={14} aria-hidden />
        </button>
      </div>
    );

  return (
    <>
      <header className="hws-detail-head">
        <button
          className="hws-back"
          type="button"
          onClick={onBack}
          aria-label="Back to sessions"
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div>
          <h2>{newTask ? "New task" : row?.title}</h2>
          <p>
            <Folder size={12} aria-hidden />
            {newTask
              ? folder || "Choose a working folder below"
              : row?.workingFolder || "Working folder unavailable"}
          </p>
        </div>
        {!newTask ? (
          <div className="hws-menu-wrap" ref={menuRef}>
            <button
              className="hws-icon-button"
              type="button"
              aria-label="Session actions"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} aria-hidden />
            </button>
            {menu ? (
              <div className="hws-session-menu">
                {taskId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      void openRuntimeTaskSession(taskId).catch(
                        (error: unknown) =>
                          onNotice(
                            error instanceof Error
                              ? error.message
                              : "This exact native session could not be opened.",
                          ),
                      );
                    }}
                  >
                    Open in {name}
                    <ArrowUpRight size={13} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    void navigator.clipboard
                      .writeText(exactSession?.selectionKey ?? taskId ?? "")
                      .then(
                        () => onNotice("Session reference copied."),
                        () =>
                          onNotice(
                            "The session reference could not be copied.",
                          ),
                      );
                  }}
                >
                  Copy session reference <Copy size={13} aria-hidden />
                </button>
                {onAskLuca ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      onAskLuca();
                    }}
                  >
                    Ask Luca <ArrowUpRight size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      {newTask ? (
        <div className="hws-new-task">
          <h3>What would you like to work on?</h3>
          <p>
            Start a {name} session in the right project. You can follow it here
            or return to it later.
          </p>
          <label>
            Working folder
            <button
              className="hws-folder-picker"
              type="button"
              onClick={onPickFolder}
              disabled={pickingFolder || sending}
            >
              <Folder size={14} aria-hidden />
              {pickingFolder ? "Choosing…" : folder || "Choose a folder…"}
            </button>
          </label>
          <div className="hws-new-options">
            <span>
              Model <strong>{name} default</strong>
            </span>
            <span>
              Permissions <strong>Ask when needed</strong>
            </span>
          </div>
        </div>
      ) : (
        <section
          className="hws-transcript"
          aria-label="Session messages"
          aria-busy={transcript.loading || taskResult.loading}
        >
          <div className="hws-transcript-origin">
            <span>
              {exactSession
                ? `From ${name} · ${exactSession.liveState === "live" ? "Native session" : "Saved transcript"}`
                : "Polyphonic task receipt · not a full session transcript"}
            </span>
          </div>
          {transcript.loading && !transcript.value && exactSession ? (
            <p className="hws-inline-status" role="status">
              Reading this session…
            </p>
          ) : null}
          {transcript.error ? (
            <div className="hws-inline-status hws-inline-error" role="alert">
              {transcript.error}
              <button type="button" onClick={onRefresh}>
                Refresh sessions
              </button>
            </div>
          ) : null}
          {keyedItems(
            transcript.value?.messages ?? [],
            (message) => `${message.role}:${message.text}`,
          ).map(({ item: message, key }) => (
            <article
              className="hws-turn"
              key={key}
              data-role={message.role === "user" ? "You" : name}
            >
              <h3>{message.role === "user" ? "You" : name}</h3>
              <Markdown content={message.text} />
            </article>
          ))}
          {transcript.value?.truncated ? (
            <p className="hws-inline-status">
              This is a bounded excerpt of the original session.
            </p>
          ) : null}
          {exactSession &&
          transcript.value &&
          !transcript.value.messages.length ? (
            <p className="hws-inline-status">
              No readable messages are available in this session.
            </p>
          ) : null}
          {!exactSession && row?.task ? (
            <article className="hws-turn">
              <h3>Task</h3>
              <Markdown content={row.task.summary} />
            </article>
          ) : null}
          {taskResult.value?.result && !transcript.value?.messages.length ? (
            <article className="hws-turn">
              <h3>{name}</h3>
              <Markdown content={taskResult.value.result} />
            </article>
          ) : null}
          {taskResult.error ? (
            <p className="hws-inline-status" role="alert">
              {taskResult.error}
            </p>
          ) : null}
          {(row?.task?.steps.length ?? 0) > 0 && !exactSession ? (
            <ol className="hws-task-steps">
              {keyedItems(row?.task?.steps ?? [], (step) => step.label).map(
                ({ item: step, key }) => (
                  <li key={key}>
                    <span>{step.state === "done" ? "✓" : "·"}</span>
                    {step.label}
                  </li>
                ),
              )}
            </ol>
          ) : null}
          {row ? (
            <div className="hws-work-line" role="status">
              {row.state === "working" ? (
                <span className="hws-running" />
              ) : null}
              {row.activity}
              {canStopHarnessTask(row.task) ? (
                <button type="button" onClick={onStop} disabled={sending}>
                  <Square size={10} aria-hidden />
                  Stop
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
      {pending.length ? (
        <section
          className="hws-pending"
          aria-label="Requests for Luca’s conversation"
        >
          <h3>
            Requests for Luca’s conversation · not necessarily this session
          </h3>
          {pending.map((permission) => (
            <ManagedPermissionCard
              key={permission.pendingId}
              pending={permission}
              compact
            />
          ))}
        </section>
      ) : null}
      {confirmation ? (
        <div className="hws-confirmation">
          <RuntimeTaskConfirmationCard
            draft={confirmation}
            onCancel={() => setConfirmation(null)}
            onConfirm={confirmContinuation}
            onConfirmed={() => setConfirmation(null)}
          />
        </div>
      ) : null}
      {!newTask &&
      exactSession?.canContinue &&
      !ownedWorking &&
      !confirmation ? (
        <div className="hws-resume">
          <div>
            <h3>Pick up where you left off</h3>
            <p>
              Review the original folder and native permission policy before
              continuing.
            </p>
          </div>
          <button
            className="hws-primary"
            type="button"
            onClick={reviewContinuation}
            disabled={
              !targetFresh || sending || !conversationId || !residentPubkey
            }
          >
            <Play size={13} aria-hidden />
            Continue session
          </button>
        </div>
      ) : null}
      {newTask || exactSession?.canSend ? (
        <div className="hws-composer">
          <div className="hws-composer-target">
            <span>
              {newTask
                ? folder
                  ? `New session in ${folder}`
                  : "Choose a working folder before sending"
                : `To this exact session · ${row?.workspace}`}
            </span>
            <span>{newTask ? "Ask when needed" : "Native-owned routing"}</span>
          </div>
          <MessageComposer
            key={draftKey}
            channelId={conversationId}
            channelName={name}
            draftKey={draftKey}
            fixedAudiencePubkeys={fixedAudience}
            placeholder={
              newTask ? "Describe your task…" : "Message this session…"
            }
            disabled={newTask ? !canStart || !folder : !canSend}
            isSending={sending}
            showTopBorder={false}
            onCaptureSendContext={captureSend}
            onSend={send}
          />
          <p className="hws-composer-note">
            {newTask
              ? "Send starts this task with normal native permissions."
              : `Follow-ups stay in this session. Native approvals and stopping remain in ${name}.`}
          </p>
        </div>
      ) : !newTask && !exactSession?.canContinue ? (
        <p className="hws-inline-status">
          {exactSession?.reason ??
            (ownedWorking
              ? "Follow progress here. This task is still running."
              : "Sending is unavailable for this selection. Choose its exact native session in the catalogue when available.")}
        </p>
      ) : null}
    </>
  );
}
