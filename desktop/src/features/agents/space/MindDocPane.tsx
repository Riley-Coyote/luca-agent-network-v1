import * as React from "react";
import { useBlocker } from "@tanstack/react-router";

import {
  documentKindMeta,
  documentWriterLabel,
  formatDocumentBytes,
  formatRelativeAge,
  spaceDocumentLabel,
} from "@/features/agents/documents/documentKinds";
import {
  useResidentDocumentQuery,
  useWriteResidentDocumentMutation,
} from "@/features/agents/documents/useResidentDocuments";
import { useProfileQuery } from "@/features/profile/hooks";
import {
  isResidentDocumentConflict,
  type ResidentDocumentTarget,
} from "@/shared/api/tauriResidentDocuments";
import type { ManagedAgent } from "@/shared/api/types";
import { MindPageHead } from "./MindPageKit";

/**
 * A document, as a page (BETA14_RELEASE.md WP-43, Decided 12): today's
 * editor at reading width, with Discard and Save. With unsaved changes the
 * page stays put, whatever tries to leave it (the back link, the title
 * bar's arrows, Esc, ⌘[, the rail), and says so.
 */
export function MindDocPane({
  agent,
  backLabel,
  nativeRuntime,
  onBack,
  onRestart,
  residentName,
  target,
  titleRef,
}: {
  agent: ManagedAgent;
  backLabel: string;
  nativeRuntime: string | null;
  onBack: () => void;
  onRestart: () => void;
  residentName: string;
  target: ResidentDocumentTarget;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const query = useResidentDocumentQuery(agent.pubkey, target);
  const write = useWriteResidentDocumentMutation(agent.pubkey);
  const ownerName = useProfileQuery(true).data?.displayName;
  const meta = "kind" in target ? documentKindMeta(target.kind) : null;
  const relPath = "relPath" in target ? target.relPath : null;
  const title = meta
    ? spaceDocumentLabel(meta.kind, ownerName)
    : (relPath ?? "");
  const fileName = meta?.fileName ?? relPath ?? "";

  const [draft, setDraft] = React.useState<string | null>(null);
  const [conflictHash, setConflictHash] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [stopped, setStopped] = React.useState(false);
  const loaded = query.data;
  const baseline = loaded?.content ?? "";
  const value = draft ?? baseline;
  const dirty = draft !== null && draft !== baseline;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;

  // Unsaved changes hold the page (Decided 12).
  useBlocker({
    enableBeforeUnload: () => dirtyRef.current,
    shouldBlockFn: () => {
      if (!dirtyRef.current) return false;
      setStopped(true);
      return true;
    },
  });
  React.useEffect(() => {
    if (!dirty) setStopped(false);
  }, [dirty]);

  const save = React.useCallback(
    async (expectedHash: string | null) => {
      if (!loaded || draft === null) return;
      setConflictHash(null);
      try {
        await write.mutateAsync({ target, content: draft, expectedHash });
        setDraft(null);
        setSavedAt(Date.now());
      } catch (error) {
        if (isResidentDocumentConflict(error)) {
          const fresh = await query.refetch();
          setConflictHash(fresh.data?.hash ?? "");
        }
      }
    },
    [draft, loaded, query, target, write],
  );

  const isRunning = agent.status === "running" || agent.status === "deployed";
  const writer = meta
    ? documentWriterLabel(meta.writer, residentName)
    : "A file in their folder";
  const edited = loaded?.modifiedAt
    ? `edited ${formatRelativeAge(loaded.modifiedAt * 1000, Date.now())}`
    : loaded && !loaded.exists
      ? "not written yet"
      : null;
  const status =
    write.error && !conflictHash
      ? write.error.message || "Couldn't save."
      : conflictHash !== null
        ? "Changed on disk since you opened it."
        : dirty
          ? "Unsaved changes"
          : savedAt
            ? `Saved ${formatRelativeAge(savedAt, Date.now())}`
            : loaded?.exists
              ? `${formatDocumentBytes(new TextEncoder().encode(baseline).length)}${edited ? ` · ${edited}` : ""}`
              : "Not written yet";

  return (
    <div data-testid="mind-doc-pane">
      <MindPageHead
        back={backLabel}
        lede={
          <>
            <span className="luca-mind-lede-meta">
              {[writer, edited].filter(Boolean).join(" · ")}
              <span className="luca-mind-file"> {fileName}</span>
            </span>
            {meta ? (
              <span className="luca-mind-lede-line">{meta.blurb}</span>
            ) : null}
          </>
        }
        onBack={onBack}
        title={title}
        titleRef={titleRef}
      />
      <textarea
        aria-label={`${title} contents`}
        autoCapitalize="none"
        autoCorrect="off"
        className="luca-mind-editor"
        data-testid="resident-document-textarea"
        disabled={!loaded || write.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            if (dirty && !write.isPending) void save(loaded?.hash ?? null);
          }
        }}
        placeholder={
          meta
            ? `Nothing here yet. ${meta.writer === "owner" ? "Write it in your own words." : `${residentName} will fill this in over time, or start it yourself.`}`
            : "Empty file."
        }
        spellCheck
        value={value}
      />
      <div className="luca-mind-editor-foot">
        <p
          className="luca-mind-meta"
          data-state={
            conflictHash !== null || (write.error && !conflictHash)
              ? "error"
              : undefined
          }
          data-testid="resident-document-status"
        >
          {status}
        </p>
        <div className="luca-mind-actions">
          {conflictHash !== null ? (
            <>
              <button
                className="luca-mind-button"
                onClick={() => {
                  setDraft(null);
                  setConflictHash(null);
                }}
                type="button"
              >
                Reload theirs
              </button>
              <button
                className="luca-mind-button"
                data-testid="resident-document-overwrite"
                disabled={write.isPending}
                onClick={() => void save(conflictHash || null)}
                type="button"
              >
                Keep mine
              </button>
            </>
          ) : (
            <>
              <button
                className="luca-mind-button"
                data-testid="resident-document-discard"
                disabled={!dirty || write.isPending}
                onClick={() => setDraft(null)}
                type="button"
              >
                Discard
              </button>
              <button
                className="luca-mind-button luca-mind-button-solid"
                data-testid="resident-document-save"
                disabled={!dirty || write.isPending}
                onClick={() => void save(loaded?.hash ?? null)}
                type="button"
              >
                {write.isPending ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
      {stopped && dirty ? (
        <p
          className="luca-mind-stop"
          data-testid="mind-unsaved-stop"
          role="alert"
        >
          Save or discard your changes first.
        </p>
      ) : null}
      {nativeRuntime ? (
        <p
          className="luca-mind-footnote"
          data-testid="resident-document-restart-note"
        >
          {nativeRuntime} keeps this file; it reads it when {residentName} next
          starts.
          {agent.needsRestart && isRunning ? (
            <>
              {" "}
              <button
                className="luca-mind-inline"
                data-testid="resident-document-restart"
                onClick={onRestart}
                type="button"
              >
                Restart now
              </button>
            </>
          ) : null}
        </p>
      ) : meta?.assembled ? (
        <p
          className="luca-mind-footnote"
          data-testid="resident-document-restart-note"
        >
          {agent.needsRestart &&
          isRunning &&
          !agent.autoRestartOnConfigChange ? (
            <>
              {residentName} is still running the previous version.{" "}
              <button
                className="luca-mind-inline"
                data-testid="resident-document-restart"
                onClick={onRestart}
                type="button"
              >
                Restart now
              </button>
            </>
          ) : (
            `${residentName} reads this each time they start. After you save, they restart with it once they're idle.`
          )}
        </p>
      ) : null}
    </div>
  );
}
