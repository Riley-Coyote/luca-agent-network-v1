import * as React from "react";
import { useBlocker, useRouter } from "@tanstack/react-router";

import { setLeaveGuard } from "@/app/navigation/leaveGuard";

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
 * After a held move completes, focus lands on the destination's heading, as
 * it does on every arrival: once this page has gone, the page's own title
 * (never the title bar's).
 */
function focusArrivalHeading() {
  const started = performance.now();
  let focusedAt: number | null = null;
  const find = () =>
    document.querySelector<HTMLElement>(
      '[data-testid="mind-settings-title"], [data-testid="mind-page-title"]',
    ) ??
    [...document.querySelectorAll<HTMLElement>("main h1, main h2")].find(
      (each) =>
        !each.closest('[data-testid="shell-lip"], [data-shell-rail]') &&
        each.getClientRects().length > 0,
    );
  const tick = () => {
    // The page has gone once the move is made (a history step can still
    // be on its way back when the move is approved, so the address alone
    // can't tell).
    const moved = !document.querySelector('[data-testid="mind-doc-pane"]');
    const now = performance.now();
    if (moved) {
      // A destination that puts focus somewhere of its own (a
      // conversation's composer) keeps it.
      const active = document.activeElement;
      const free = !active || active === document.body;
      const heading = find();
      if (heading && (free || focusedAt === null) && active !== heading) {
        if (focusedAt === null && !free) return;
        if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        focusedAt ??= now;
      }
      // Kept a moment: a page that settles after arriving can redraw its
      // heading, and focus follows it there.
      if (focusedAt !== null && now - focusedAt > 1500) return;
    }
    if (now - started < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

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
  const loaded = query.data;
  const baseline = loaded?.content ?? "";
  const value = draft ?? baseline;
  const dirty = draft !== null && draft !== baseline;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const saveRef = React.useRef<HTMLButtonElement | null>(null);
  const caret = React.useRef<[number, number] | null>(null);

  // Unsaved changes hold the move, wherever it was going (WP-43, round 3):
  // the row under the editor asks, and the answer finishes or cancels it.
  const blocker = useBlocker({
    enableBeforeUnload: () => dirtyRef.current,
    shouldBlockFn: () => dirtyRef.current,
    withResolver: true,
  });
  // A history step (the title bar's arrows, ⌘[ ⌘], the back link) is held
  // before it happens (leaveGuard.ts) and kept here until the answer.
  // The browser's own step forward is held the same way, heard before the
  // router hears it (round 4), so the address never leaves this page.
  const router = useRouter();
  const [heldStep, setHeldStep] = React.useState<(() => void) | null>(null);
  React.useEffect(() => {
    setLeaveGuard(
      (resume) => {
        if (!dirtyRef.current) return false;
        setHeldStep(() => resume);
        return true;
      },
      () => router.history.location.state.__TSR_index,
    );
    return () => setLeaveGuard(null);
  }, [router]);
  const asking = blocker.status === "blocked" || heldStep !== null;

  const save = React.useCallback(
    async (expectedHash: string | null): Promise<boolean> => {
      if (!loaded || draft === null) return false;
      setConflictHash(null);
      try {
        await write.mutateAsync({ target, content: draft, expectedHash });
        setDraft(null);
        dirtyRef.current = false;
        setSavedAt(Date.now());
        return true;
      } catch (error) {
        if (isResidentDocumentConflict(error)) {
          const fresh = await query.refetch();
          setConflictHash(fresh.data?.hash ?? "");
        }
        return false;
      }
    },
    [draft, loaded, query, target, write],
  );

  // When the question appears, Save takes focus (Return saves and leaves);
  // the caret is kept for Keep editing.
  React.useEffect(() => {
    if (!asking) return;
    const area = textareaRef.current;
    caret.current = area ? [area.selectionStart, area.selectionEnd] : null;
    saveRef.current?.focus();
  }, [asking]);

  const keepEditing = () => {
    if (heldStep) setHeldStep(null);
    else blocker.reset?.();
    requestAnimationFrame(() => {
      const area = textareaRef.current;
      if (!area) return;
      area.focus();
      if (caret.current) area.setSelectionRange(...caret.current);
    });
  };
  const leave = () => {
    if (heldStep) {
      const step = heldStep;
      setHeldStep(null);
      step();
    } else blocker.proceed?.();
    focusArrivalHeading();
  };
  const discardAndLeave = () => {
    setDraft(null);
    dirtyRef.current = false;
    leave();
  };
  const saveAndLeave = async () => {
    const saved = await save(loaded?.hash ?? null);
    // A failed save stays, with the text and the reason in the row.
    if (saved) leave();
    else if (heldStep) setHeldStep(null);
    else blocker.reset?.();
  };

  // Esc while the question is up is Keep editing; it never reaches the
  // page's own Esc, which would ask again.
  const escapeKeeps = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    keepEditing();
  });
  React.useEffect(() => {
    if (!asking) return;
    const listener = (event: KeyboardEvent) => escapeKeeps(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [asking]);

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
        ref={textareaRef}
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
      {asking ? (
        <div
          className="luca-mind-editor-foot"
          data-testid="mind-leave-question"
        >
          <p className="luca-mind-leave" role="alert">
            Save changes to {title} before leaving?
          </p>
          <div className="luca-mind-actions">
            <button
              className="luca-mind-button"
              data-testid="mind-leave-keep"
              disabled={write.isPending}
              onClick={keepEditing}
              type="button"
            >
              Keep editing
            </button>
            <button
              className="luca-mind-button"
              data-testid="mind-leave-discard"
              disabled={write.isPending}
              onClick={discardAndLeave}
              type="button"
            >
              Discard
            </button>
            <button
              className="luca-mind-button luca-mind-button-solid"
              data-testid="mind-leave-save"
              disabled={write.isPending}
              onClick={() => void saveAndLeave()}
              ref={saveRef}
              type="button"
            >
              {write.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
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
      )}
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
