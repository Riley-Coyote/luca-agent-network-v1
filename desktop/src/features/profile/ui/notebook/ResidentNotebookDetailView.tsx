import * as React from "react";
import {
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
  ExternalLink,
  History,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Pin,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  getChannelIdFromTags,
  getThreadReference,
} from "@/features/messages/lib/threading";
import { getEventById } from "@/shared/api/tauri";
import {
  annotateResidentJournalPage,
  archiveResidentNotebookItem,
  correctResidentMemoryNote,
  forgetResidentNotebookItem,
  getResidentNotebookRevisionHistory,
  pinResidentMemoryNote,
  requestResidentJournalPageRevision,
  type ResidentMemoryNoteCategory,
  type ResidentNotebookDetail,
  type ResidentNotebookItem,
} from "@/shared/api/tauriNotebook";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/cn";

import {
  notebookCategoryLabel,
  notebookTimestamp,
} from "./notebookPresentation";

type EditorMode = "correct" | "annotate" | "revise" | null;

const NOTE_CATEGORIES: ResidentMemoryNoteCategory[] = [
  "decision",
  "durable_context",
  "lesson",
  "explicit_preference",
  "commitment",
  "open_question",
];

export function ResidentNotebookDetailView({
  detail,
  onBack,
  onChanged,
  residentPubkey,
}: {
  detail: ResidentNotebookDetail;
  onBack: () => void;
  onChanged: (detail: ResidentNotebookDetail) => Promise<void>;
  residentPubkey: string;
}) {
  const { goChannel } = useAppNavigation();
  const [mode, setMode] = React.useState<EditorMode>(null);
  const [busy, setBusy] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<
    "archive" | "forget" | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!detail.item) return null;
  const item = detail.item;
  const page = item.kind === "journal_page";

  async function update(
    action: () => Promise<ResidentNotebookDetail>,
    success: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      await onChanged(next);
      toast.success(success);
      setMode(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openSource(eventId: string) {
    try {
      const event = await getEventById(eventId);
      const channelId = getChannelIdFromTags(event.tags);
      if (!channelId)
        throw new Error("The source conversation is unavailable.");
      const thread = getThreadReference(event.tags);
      await goChannel(channelId, {
        messageId: eventId,
        threadRootId: thread.rootId,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onChanged(
        await getResidentNotebookRevisionHistory(residentPubkey, item.itemId),
      );
      setHistoryOpen(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function lifecycle(action: "archive" | "forget") {
    setBusy(true);
    try {
      if (action === "archive")
        await archiveResidentNotebookItem(residentPubkey, item.itemId);
      else await forgetResidentNotebookItem(residentPubkey, item.itemId);
      toast.success(
        action === "archive"
          ? "Notebook item archived."
          : "Encrypted notebook item forgotten.",
      );
      onBack();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="resident-notebook-detail">
      <header className="flex items-start gap-2 border-b border-border/60 pb-3">
        <Button
          aria-label="Back to notebook"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-2xs uppercase tracking-[0.11em] text-muted-foreground">
            {page
              ? "Resident-authored journal page"
              : notebookCategoryLabel(item.category)}
          </p>
          <h4 className="mt-1 text-base font-medium leading-6 text-foreground">
            {page ? item.title || "Untitled page" : "Continuity note"}
          </h4>
          <p className="mt-1 font-mono text-2xs uppercase tracking-[0.07em] text-muted-foreground">
            {item.authorship === "resident"
              ? "Kept by resident"
              : "Owner correction"}{" "}
            · rev {item.revision} · {notebookTimestamp(item.updatedAt)}
          </p>
        </div>
      </header>

      {error ? (
        <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {error}
        </div>
      ) : null}

      {page ? <JournalPageBody item={item} /> : <MemoryNoteBody item={item} />}

      <NotebookSources item={item} onOpenSource={(id) => void openSource(id)} />

      {detail.annotations.length > 0 ? (
        <section className="space-y-2 border-l border-border/70 pl-3">
          <SectionLabel>Owner annotations</SectionLabel>
          {detail.annotations.map((annotation) => (
            <div className="py-1" key={annotation.itemId}>
              <p className="text-sm leading-6 text-foreground/85">
                {annotation.body}
              </p>
              <p className="mt-1 font-mono text-2xs uppercase tracking-[0.07em] text-muted-foreground">
                Owner · {notebookTimestamp(annotation.updatedAt)}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      {mode === "correct" ? (
        <CorrectNoteForm
          busy={busy}
          item={item}
          onCancel={() => setMode(null)}
          onSave={(category, body) =>
            void update(
              () =>
                correctResidentMemoryNote({
                  residentPubkey,
                  targetNoteId: item.itemId,
                  category,
                  body,
                }),
              "Owner correction saved as a new revision.",
            )
          }
        />
      ) : null}
      {mode === "annotate" ? (
        <TextActionForm
          actionLabel="Add annotation"
          busy={busy}
          label="Owner annotation"
          onCancel={() => setMode(null)}
          onSave={(body) =>
            void update(
              () =>
                annotateResidentJournalPage(residentPubkey, item.itemId, body),
              "Owner annotation added.",
            )
          }
        />
      ) : null}
      {mode === "revise" ? (
        <TextActionForm
          actionLabel="Ask for revision"
          busy={busy}
          label="Revision direction"
          onCancel={() => setMode(null)}
          onSave={async (body) => {
            setBusy(true);
            setError(null);
            try {
              await requestResidentJournalPageRevision(
                {
                  residentPubkey,
                  ownerPrompt: body,
                  selectedPageIds: [item.itemId],
                },
                item.itemId,
              );
              toast.success("Private revision request started.");
              setMode(null);
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {historyOpen ? (
        <RevisionHistory currentId={item.itemId} revisions={detail.revisions} />
      ) : null}

      <div className="grid grid-cols-2 gap-1 border-t border-border/60 pt-3">
        {page ? (
          <>
            <QuietAction
              icon={MessageSquareText}
              label="Annotate"
              onClick={() => setMode("annotate")}
            />
            <QuietAction
              icon={RotateCcw}
              label="Request revision"
              onClick={() => setMode("revise")}
            />
          </>
        ) : (
          <>
            <QuietAction
              icon={Pencil}
              label="Correct"
              onClick={() => setMode("correct")}
            />
            <QuietAction
              icon={Pin}
              label="Pin correction"
              disabled={item.pinnedOwnerCorrection}
              onClick={() =>
                void update(
                  () => pinResidentMemoryNote(residentPubkey, item.itemId),
                  "Owner correction pinned for future recall.",
                )
              }
            />
          </>
        )}
        <QuietAction
          icon={History}
          label={historyOpen ? "Hide history" : "Revision history"}
          onClick={() => void toggleHistory()}
        />
        <QuietAction
          icon={Archive}
          label="Archive"
          onClick={() => setConfirmAction("archive")}
        />
        <QuietAction
          destructive
          icon={Trash2}
          label="Forget"
          onClick={() => setConfirmAction("forget")}
        />
      </div>

      <AlertDialog
        onOpenChange={(open) => !open && setConfirmAction(null)}
        open={confirmAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "forget"
                ? "Forget this notebook item?"
                : "Archive this notebook item?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "forget"
                ? "Luca will remove the effective encrypted body. Use Archive instead if you want to preserve it outside active recall."
                : "This item will leave the active notebook and, for continuity notes, active recall. Its revision history remains available."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (confirmAction) void lifecycle(confirmAction);
              }}
            >
              {confirmAction === "forget" ? "Forget item" : "Archive item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function JournalPageBody({ item }: { item: ResidentNotebookItem }) {
  return (
    <article
      className="border-y border-border/50 py-4"
      data-notebook-reading-plane
    >
      <Markdown
        className="prose-sm max-w-none text-foreground/90"
        content={item.body}
        interactive={false}
      />
    </article>
  );
}

function MemoryNoteBody({ item }: { item: ResidentNotebookItem }) {
  return (
    <section className="space-y-3">
      {item.pinnedOwnerCorrection ? (
        <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted-foreground">
          <Pin className="size-3" /> Pinned owner authority
        </div>
      ) : null}
      <p className="text-sm leading-6 text-foreground/90">{item.body}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-2xs uppercase tracking-[0.07em] text-muted-foreground">
        <span>{item.status}</span>
        <span>created {notebookTimestamp(item.createdAt)}</span>
      </div>
    </section>
  );
}

function NotebookSources({
  item,
  onOpenSource,
}: {
  item: ResidentNotebookItem;
  onOpenSource: (id: string) => void;
}) {
  if (item.sourceEventIds.length === 0 && item.sourcePageIds.length === 0)
    return null;
  return (
    <section className="space-y-2">
      <SectionLabel>References</SectionLabel>
      <div className="divide-y divide-border/40 border-y border-border/50">
        {item.sourceEventIds.map((id) => (
          <button
            className="flex w-full items-center justify-between gap-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
            key={id}
            onClick={() => onOpenSource(id)}
            type="button"
          >
            <span className="truncate font-mono">event · {shortId(id)}</span>
            <ExternalLink className="size-3.5 shrink-0" />
          </button>
        ))}
        {item.sourcePageIds.map((id) => (
          <div
            className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground"
            key={id}
          >
            <span className="truncate font-mono">
              notebook page · {shortId(id)}
            </span>
            <BookOpen className="size-3.5 shrink-0" />
          </div>
        ))}
      </div>
    </section>
  );
}

function RevisionHistory({
  currentId,
  revisions,
}: {
  currentId: string;
  revisions: ResidentNotebookItem[];
}) {
  return (
    <section className="space-y-2 border-t border-border/60 pt-3">
      <SectionLabel>Revision history</SectionLabel>
      <div className="divide-y divide-border/40">
        {revisions.map((revision) => (
          <div
            className={cn(
              "py-2",
              revision.itemId === currentId
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            key={revision.itemId}
          >
            <div className="flex items-center justify-between gap-3 font-mono text-2xs uppercase tracking-[0.07em]">
              <span>
                Revision {revision.revision}
                {revision.itemId === currentId ? " · current" : ""}
              </span>
              <span>{notebookTimestamp(revision.updatedAt)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5">
              {revision.title || revision.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CorrectNoteForm({
  busy,
  item,
  onCancel,
  onSave,
}: {
  busy: boolean;
  item: ResidentNotebookItem;
  onCancel: () => void;
  onSave: (category: ResidentMemoryNoteCategory, body: string) => void;
}) {
  const [category, setCategory] = React.useState<ResidentMemoryNoteCategory>(
    item.category ?? "durable_context",
  );
  const [body, setBody] = React.useState(item.body);
  return (
    <section className="space-y-3 border border-border/70 bg-background/30 p-3">
      <div>
        <p className="text-sm font-medium">Correct continuity note</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Your words become a visible owner-authored revision. The resident’s
          prior revision remains in history.
        </p>
      </div>
      <label className="block text-xs">
        Category
        <select
          className="mt-1.5 h-9 w-full border border-input/50 bg-background px-2 text-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          disabled={busy}
          onChange={(event) =>
            setCategory(event.target.value as ResidentMemoryNoteCategory)
          }
          value={category}
        >
          {NOTE_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {notebookCategoryLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs" htmlFor="notebook-note-correction">
        Correction
      </label>
      <Textarea
        className="mt-1.5 min-h-28 bg-background/50 text-sm leading-6"
        disabled={busy}
        id="notebook-note-correction"
        maxLength={1200}
        onChange={(event) => setBody(event.target.value)}
        value={body}
      />
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={busy || !body.trim()}
          onClick={() => onSave(category, body.trim())}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}Save
          correction
        </Button>
      </div>
    </section>
  );
}

function TextActionForm({
  actionLabel,
  busy,
  label,
  onCancel,
  onSave,
}: {
  actionLabel: string;
  busy: boolean;
  label: string;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = React.useState("");
  return (
    <section className="space-y-3 border border-border/70 bg-background/30 p-3">
      <label className="block text-xs" htmlFor="notebook-text-action">
        {label}
      </label>
      <Textarea
        autoFocus
        className="mt-1.5 min-h-24 bg-background/50 text-sm leading-6"
        disabled={busy}
        id="notebook-text-action"
        maxLength={4000}
        onChange={(event) => setBody(event.target.value)}
        value={body}
      />
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={busy || !body.trim()}
          onClick={() => onSave(body.trim())}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}

function QuietAction({
  destructive = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "justify-start",
        destructive && "text-destructive hover:text-destructive",
      )}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      <Icon />
      {label}
    </Button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-2xs uppercase tracking-[0.11em] text-muted-foreground">
      {children}
    </p>
  );
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
