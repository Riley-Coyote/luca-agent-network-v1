import { ArrowLeft } from "lucide-react";
import * as React from "react";

import {
  documentKindMeta,
  documentWriterLabel,
  formatDocumentBytes,
  formatRelativeAge,
} from "@/features/agents/documents/documentKinds";
import {
  useResidentDocumentQuery,
  useWriteResidentDocumentMutation,
} from "@/features/agents/documents/useResidentDocuments";
import {
  isResidentDocumentConflict,
  type ResidentDocumentTarget,
} from "@/shared/api/tauriResidentDocuments";
import type { ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * One document, open. A plain text area over the file — no rendering, no
 * toolbar — with the two facts that matter beside it: who writes this, and
 * whether the resident is running the version you're looking at. Saves are
 * atomic and guarded: if the file changed on disk since you opened it, you
 * are told before anything is overwritten.
 */
export function ResidentDocumentEditor({
  agent,
  onBack,
  onRestart,
  residentName,
  target,
}: {
  agent: ManagedAgent;
  onBack: () => void;
  onRestart: () => void;
  residentName: string;
  target: ResidentDocumentTarget;
}) {
  const query = useResidentDocumentQuery(agent.pubkey, target);
  const write = useWriteResidentDocumentMutation(agent.pubkey);
  const meta = "kind" in target ? documentKindMeta(target.kind) : null;
  const relPath = "relPath" in target ? target.relPath : null;
  const title = meta?.label ?? relPath ?? "";
  const fileName = meta?.fileName ?? relPath ?? "";

  const [draft, setDraft] = React.useState<string | null>(null);
  const [conflictHash, setConflictHash] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const loaded = query.data;
  const baseline = loaded?.content ?? "";
  const value = draft ?? baseline;
  const dirty = draft !== null && draft !== baseline;

  // A fresh open: put the cursor where the writing is.
  React.useEffect(() => {
    if (loaded && draft === null) textareaRef.current?.focus();
  }, [loaded, draft]);

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
          // Learn what is on disk now, keep the draft, and ask.
          const fresh = await query.refetch();
          setConflictHash(fresh.data?.hash ?? "");
        }
      }
    },
    [draft, loaded, query, target, write],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (dirty && !write.isPending) void save(loaded?.hash ?? null);
      }
    },
    [dirty, loaded?.hash, save, write.isPending],
  );

  const isRunning = agent.status === "running" || agent.status === "deployed";
  const writerLine = meta
    ? documentWriterLabel(meta.writer, residentName)
    : "A file in the folder";
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
              ? `${formatDocumentBytes(new TextEncoder().encode(baseline).length)}${
                  loaded.modifiedAt
                    ? ` · edited ${formatRelativeAge(loaded.modifiedAt * 1000, Date.now())}`
                    : ""
                }`
              : "Not written yet";

  return (
    <div
      className="flex min-h-0 flex-col"
      data-testid="resident-document-editor"
    >
      <div className="flex items-center gap-3">
        <button
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden"
          data-testid="resident-document-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="size-3.5" />
          Documents
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <h3 className="text-base text-foreground">{title}</h3>
          <span className="font-mono text-2xs text-muted-foreground/75">
            {fileName}
          </span>
        </div>
        <span className="text-2xs text-muted-foreground">{writerLine}</span>
      </div>
      {meta ? (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {meta.blurb}
        </p>
      ) : null}

      <textarea
        aria-label={`${title} contents`}
        autoCapitalize="none"
        autoCorrect="off"
        className={cn(
          "resident-document-textarea mt-4 min-h-[26rem] w-full flex-1 resize-y rounded-md border border-border/60 bg-foreground/[0.02] px-4 py-3 text-base leading-[1.68] text-foreground/90 transition-colors",
          "placeholder:text-muted-foreground/60 hover:border-border/80 focus-visible:border-foreground/40 focus-visible:outline-hidden",
          "disabled:opacity-60",
        )}
        data-testid="resident-document-textarea"
        disabled={!loaded || write.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          meta
            ? `Nothing here yet. ${meta.writer === "owner" ? "Write it in your own words." : `${residentName} will fill this in over time — or start it yourself.`}`
            : "Empty file."
        }
        ref={textareaRef}
        spellCheck
        value={value}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p
          className={cn(
            "text-2xs leading-4",
            conflictHash !== null || (write.error && !conflictHash)
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          data-testid="resident-document-status"
        >
          {status}
        </p>
        <div className="flex items-center gap-2">
          {conflictHash !== null ? (
            <>
              <Button
                onClick={() => {
                  setDraft(null);
                  setConflictHash(null);
                }}
                size="sm"
                variant="ghost"
              >
                Reload theirs
              </Button>
              <Button
                data-testid="resident-document-overwrite"
                disabled={write.isPending}
                onClick={() => void save(conflictHash || null)}
                size="sm"
                variant="outline"
              >
                Keep mine
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={!dirty || write.isPending}
                onClick={() => setDraft(null)}
                size="sm"
                variant="ghost"
              >
                Discard
              </Button>
              <Button
                data-testid="resident-document-save"
                disabled={!dirty || write.isPending}
                onClick={() => void save(loaded?.hash ?? null)}
                size="sm"
              >
                {write.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {meta?.assembled ? (
        <p
          className="mt-4 border-t border-border/45 pt-3 text-2xs leading-4 text-muted-foreground"
          data-testid="resident-document-restart-note"
        >
          {agent.needsRestart && isRunning ? (
            agent.autoRestartOnConfigChange ? (
              `${residentName} restarts on their own to pick this up.`
            ) : (
              <>
                {residentName} is still running the previous version.{" "}
                <button
                  className="text-foreground/80 underline decoration-foreground/30 underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-hidden"
                  data-testid="resident-document-restart"
                  onClick={onRestart}
                  type="button"
                >
                  Restart now
                </button>
              </>
            )
          ) : isRunning ? (
            `${residentName} reads this when they start; saving asks for a restart.`
          ) : (
            `${residentName} reads this when they next start.`
          )}
        </p>
      ) : null}
    </div>
  );
}
