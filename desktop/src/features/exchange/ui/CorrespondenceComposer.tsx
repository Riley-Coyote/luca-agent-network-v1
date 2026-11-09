import type * as React from "react";
import type { AgentInboxTask } from "@/shared/api/agentInbox";
import type { ExchangePhase } from "@/shared/api/types";
import type { CorrespondenceIntent } from "../correspondenceNavigation";
import { exchangeStatusLabel } from "../sideConversations";

/** Same composer chrome in the main conversation and the explicit beside view. */
export function CorrespondenceComposer({
  embedded,
  partial,
  needsContinuation,
  mayCompose,
  nameOf,
  recipient,
  composeMode,
  replyEventId,
  sendError,
  stopError,
  sending,
  stopping,
  capabilities,
  task,
  subject,
  state,
  exchangeState,
  continuationRequested,
  children,
  setComposeMode,
  setReplyEventId,
  setSendError,
  setRecipient,
  setContinuationRequested,
  cancelReply,
  stopSelectedExchange,
}: {
  embedded: boolean;
  partial: boolean | undefined;
  needsContinuation: boolean;
  mayCompose: boolean;
  nameOf: (pubkey: string) => string;
  recipient: string;
  composeMode: CorrespondenceIntent;
  replyEventId?: string;
  sendError: string | null;
  stopError: string | null;
  sending: boolean;
  stopping: boolean;
  capabilities?: { newMessage?: boolean; continuation?: boolean };
  task: AgentInboxTask;
  subject: string;
  state?: ExchangePhase;
  exchangeState: {
    data?: { phase: ExchangePhase; replyReceived?: boolean } | null;
  };
  continuationRequested: boolean;
  children: React.ReactNode;
  setComposeMode: React.Dispatch<React.SetStateAction<CorrespondenceIntent>>;
  setReplyEventId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setSendError: React.Dispatch<React.SetStateAction<string | null>>;
  setRecipient: React.Dispatch<React.SetStateAction<string>>;
  setContinuationRequested: React.Dispatch<React.SetStateAction<boolean>>;
  cancelReply: () => void;
  stopSelectedExchange: () => Promise<void>;
}) {
  return (
    <footer className="shrink-0 pb-3 pt-2">
      {embedded ? (
        <div className="luca-measure mb-2 text-xs text-muted-foreground">
          {partial ? <p>Some history is unavailable.</p> : null}
          {composeMode === "reply" && needsContinuation && mayCompose ? (
            <p>Sending a message resumes this task with {nameOf(recipient)}.</p>
          ) : null}
          {!mayCompose ? (
            <p>This task is read-only under its current permissions.</p>
          ) : null}
          {composeMode === "new-message" ? (
            <div className="flex items-center gap-3">
              <span>New message</span>
              <button
                type="button"
                className="hover:underline focus-visible:outline focus-visible:outline-2"
                disabled={sending}
                onClick={() => {
                  setComposeMode("reply");
                  setReplyEventId(undefined);
                }}
              >
                Reply to this task
              </button>
            </div>
          ) : null}
          {replyEventId ? (
            <button type="button" onClick={cancelReply}>
              Replying to {nameOf(recipient)} · Cancel reply
            </button>
          ) : null}
          {sendError || stopError ? (
            <p role="alert" className="text-destructive">
              {sendError ?? stopError} Your draft is kept.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="luca-measure grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <div className="col-start-2 row-start-1 mb-2 text-xs">
            {composeMode === "new-message" ? (
              <button
                className="text-primary hover:underline"
                disabled={sending}
                onClick={() => {
                  setComposeMode("reply");
                  setReplyEventId(undefined);
                  setSendError(null);
                }}
                type="button"
              >
                Back to task
              </button>
            ) : (
              <button
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                disabled={sending || capabilities?.newMessage !== true}
                onClick={() => {
                  setComposeMode("new-message");
                  setContinuationRequested(false);
                  setReplyEventId(undefined);
                  setSendError(null);
                }}
                title={
                  capabilities?.newMessage
                    ? undefined
                    : "New topics are not available from this host yet."
                }
                type="button"
              >
                New message
              </button>
            )}
          </div>
          <label className="col-start-1 row-start-1 mb-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {composeMode === "new-message" ? "Message to" : "Reply to"}
            <select
              aria-label="Reply recipient"
              className="min-w-0 rounded-md bg-plate px-2 py-1 text-sm text-foreground"
              onChange={(event) => {
                setRecipient(event.target.value);
                setReplyEventId(undefined);
              }}
              value={recipient}
            >
              <option value="">Choose an agent</option>
              {task.record.members.map((key) => (
                <option key={key} value={key}>
                  {nameOf(key)}
                </option>
              ))}
            </select>
          </label>
          <p className="col-start-1 row-start-2 mb-2 min-w-0 truncate text-xs text-muted-foreground">
            {composeMode === "new-message"
              ? `Source: ${subject}`
              : `${subject} · ${exchangeStatusLabel(state, exchangeState.data?.replyReceived ?? task.outcome === "reply_received")}`}
          </p>
          {composeMode === "reply" &&
          exchangeState.data &&
          ["open", "paused"].includes(exchangeState.data.phase) ? (
            <button
              className="col-start-2 row-start-2 mb-2 text-xs text-destructive hover:underline disabled:opacity-50"
              disabled={stopping || sending}
              onClick={() => void stopSelectedExchange()}
              type="button"
            >
              {stopping ? "Stopping exchange…" : "Stop exchange"}
            </button>
          ) : null}
          {stopError ? (
            <p
              className="col-span-2 mb-2 text-xs text-destructive"
              role="alert"
            >
              {stopError}
            </p>
          ) : null}
          {composeMode === "reply" &&
          needsContinuation &&
          capabilities?.continuation ? (
            <label className="col-span-2 mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={continuationRequested}
                onChange={(event) =>
                  setContinuationRequested(event.target.checked)
                }
                disabled={sending}
              />
              Continue this task with a new bounded attempt
            </label>
          ) : composeMode === "reply" && needsContinuation ? (
            <p className="col-span-2 mb-2 text-xs text-muted-foreground">
              This task is {state}. Continuing it is not available here yet.
            </p>
          ) : null}
          {sendError ? (
            <p
              className="col-span-2 mb-2 text-xs text-destructive"
              role="alert"
            >
              {sendError} Your draft is kept. Sending it again uses the same
              request identity.
            </p>
          ) : null}
        </div>
      )}
      {children}
    </footer>
  );
}
