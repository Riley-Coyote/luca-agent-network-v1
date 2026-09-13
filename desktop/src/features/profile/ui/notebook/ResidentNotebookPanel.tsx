import * as React from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import {
  cancelResidentJournalPage,
  createResidentJournalPage,
  getResidentJournalActivity,
  getResidentNotebookItem,
  listResidentNotebookItems,
  retryResidentJournalPage,
  type ResidentJournalJob,
  type ResidentNotebookDetail,
  type ResidentNotebookItem,
  type ResidentNotebookList,
} from "@/shared/api/tauriNotebook";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/cn";

import { ResidentNotebookDetailView } from "./ResidentNotebookDetailView";
import { ResidentNotebookIntro } from "./ResidentNotebookIntro";
import { ResidentNotebookLedgerRow } from "./ResidentNotebookLedgerRow";
import {
  notebookAvailabilityCopy,
  notebookCountWhenComplete,
  notebookItemMatchesView,
  mergeNotebookItemsById,
} from "./notebookPresentation";
import { isNotebookRequestCurrent } from "./notebookViewState";
import { useNotebookViewState } from "./useNotebookViewState";

const MAX_LIST_RESTORE_PAGES = 4;

export function ResidentNotebookPanel({
  handoffSlot,
  residentName,
  residentPubkey,
}: {
  handoffSlot?: React.ReactNode;
  residentName: string;
  residentPubkey: string;
}) {
  const {
    clearSelection: clearSavedSelection,
    scopeKey,
    selectItem: saveSelectedItem,
    setDetailAnchor,
    setListAnchor,
    setView,
    state: viewState,
  } = useNotebookViewState(residentPubkey);
  const view = viewState.view;
  const [list, setList] = React.useState<ResidentNotebookList | null>(null);
  const [selected, setSelected] = React.useState<ResidentNotebookDetail | null>(
    null,
  );
  const [job, setJob] = React.useState<ResidentJournalJob | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const activeResidentRef = React.useRef(residentPubkey);
  const mountedRef = React.useRef(false);
  const refreshGenerationRef = React.useRef(0);
  const refreshInFlightRef = React.useRef<Promise<void> | null>(null);
  const restoredSelectionRef = React.useRef<string | null>(null);
  const restoredAnchorRef = React.useRef<string | null>(null);
  const listRestoreRef = React.useRef({
    key: null as string | null,
    pages: 0,
    cursor: null as number | null,
  });
  const focusOnBackRef = React.useRef<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const isCurrentRequest = React.useCallback(
    (request: {
      residentPubkey: string;
      scopeKey: string | null;
      generation: number;
    }) =>
      mountedRef.current &&
      isNotebookRequestCurrent(request, {
        residentPubkey: activeResidentRef.current,
        scopeKey,
        generation: refreshGenerationRef.current,
      }),
    [scopeKey],
  );

  const refresh = React.useCallback((): Promise<void> => {
    const inFlight = refreshInFlightRef.current;
    if (inFlight) return inFlight;

    const requestedResident = residentPubkey;
    const requestContext = {
      residentPubkey: requestedResident,
      scopeKey,
      generation: refreshGenerationRef.current,
    };
    const isCurrent = () => isCurrentRequest(requestContext);
    const request = (async () => {
      if (isCurrent()) {
        setLoading(true);
        setError(null);
      }
      try {
        const [nextList, nextJob] = await Promise.all([
          listResidentNotebookItems(requestedResident, 0, 25),
          getResidentJournalActivity(requestedResident),
        ]);
        if (isCurrent()) {
          setList(nextList);
          setJob(nextJob);
        }
      } catch (cause) {
        if (isCurrent()) setError(errorMessage(cause));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    refreshInFlightRef.current = request;
    void request.finally(() => {
      if (refreshInFlightRef.current === request) {
        refreshInFlightRef.current = null;
      }
    });
    return request;
  }, [isCurrentRequest, residentPubkey, scopeKey]);

  React.useEffect(() => {
    mountedRef.current = true;
    activeResidentRef.current = residentPubkey;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    refreshInFlightRef.current = null;
    restoredSelectionRef.current = null;
    restoredAnchorRef.current = null;
    setSelected(null);
    setCreating(false);
    void refresh();
    return () => {
      if (refreshGenerationRef.current === generation) {
        mountedRef.current = false;
        refreshGenerationRef.current += 1;
      }
    };
  }, [refresh, residentPubkey]);

  React.useEffect(() => {
    if (job?.state !== "pending" && job?.state !== "running") return;
    let cancelled = false;
    let timeout: number | undefined;
    const pollAfterCompletion = async () => {
      await refresh();
      if (!cancelled) {
        timeout = window.setTimeout(() => void pollAfterCompletion(), 2_500);
      }
    };
    timeout = window.setTimeout(() => void pollAfterCompletion(), 2_500);
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [job?.state, refresh]);

  const openItem = React.useCallback(
    async (itemId: string, restored = false) => {
      const requestContext = {
        residentPubkey,
        scopeKey,
        generation: refreshGenerationRef.current,
      };
      setError(null);
      try {
        const detail = await getResidentNotebookItem(residentPubkey, itemId);
        if (!isCurrentRequest(requestContext)) return;
        if (!detail.item) {
          clearSavedSelection();
          setError(
            restored
              ? "Your saved notebook item is no longer available."
              : "That notebook item is no longer available.",
          );
          return;
        }
        saveSelectedItem(detail.item.itemId, detail.item.revision);
        if (!restored) setDetailAnchor("body");
        setSelected(detail);
      } catch (cause) {
        if (!isCurrentRequest(requestContext)) return;
        if (restored) {
          clearSavedSelection();
          setError("Your saved notebook item is no longer available.");
        } else {
          setError(errorMessage(cause));
        }
      }
    },
    [
      clearSavedSelection,
      isCurrentRequest,
      residentPubkey,
      saveSelectedItem,
      setDetailAnchor,
      scopeKey,
    ],
  );

  async function loadMore() {
    if (list?.nextCursor === null || list?.nextCursor === undefined) return;
    const requestContext = {
      residentPubkey,
      scopeKey,
      generation: refreshGenerationRef.current,
    };
    setLoadingMore(true);
    try {
      const next = await listResidentNotebookItems(
        residentPubkey,
        list.nextCursor,
        25,
      );
      if (!isCurrentRequest(requestContext)) return;
      setList({
        ...next,
        items: mergeNotebookItemsById(list.items, next.items),
      });
    } catch (cause) {
      if (isCurrentRequest(requestContext)) setError(errorMessage(cause));
    } finally {
      if (isCurrentRequest(requestContext)) setLoadingMore(false);
    }
  }

  React.useEffect(() => {
    const saved = viewState.selected;
    if (!saved || selected || !list) return;
    const restoreKey = `${scopeKey}:${saved.itemId}:${saved.revision ?? ""}`;
    if (restoredSelectionRef.current === restoreKey) return;
    restoredSelectionRef.current = restoreKey;
    void openItem(saved.itemId, true);
  }, [list, openItem, scopeKey, selected, viewState.selected]);

  React.useEffect(() => {
    const anchor = viewState.listAnchor;
    if (
      !anchor ||
      selected ||
      !list ||
      list.items.some((item) => item.itemId === anchor)
    )
      return;
    const key = `${scopeKey}:${anchor}`;
    if (listRestoreRef.current.key !== key) {
      listRestoreRef.current = { key, pages: 0, cursor: null };
    }
    if (
      list.nextCursor === null ||
      listRestoreRef.current.pages >= MAX_LIST_RESTORE_PAGES
    ) {
      setListAnchor(null);
      return;
    }
    const cursor = list.nextCursor;
    if (listRestoreRef.current.cursor === cursor) return;
    const requestContext = {
      residentPubkey,
      scopeKey,
      generation: refreshGenerationRef.current,
    };
    listRestoreRef.current.pages += 1;
    listRestoreRef.current.cursor = cursor;
    void listResidentNotebookItems(residentPubkey, cursor, 50)
      .then((next) => {
        if (!isCurrentRequest(requestContext)) return;
        setList((current) => {
          if (!current || current.nextCursor !== cursor) return current;
          return {
            ...next,
            items: mergeNotebookItemsById(current.items, next.items),
          };
        });
      })
      .catch(() => {
        if (isCurrentRequest(requestContext)) setListAnchor(null);
      })
      .finally(() => {
        if (listRestoreRef.current.key === key) {
          listRestoreRef.current.cursor = null;
        }
      });
  }, [
    isCurrentRequest,
    list,
    residentPubkey,
    scopeKey,
    selected,
    setListAnchor,
    viewState.listAnchor,
  ]);

  const listAnchorCount = list?.items.length ?? 0;

  React.useLayoutEffect(() => {
    const anchor = selected ? viewState.detailAnchor : viewState.listAnchor;
    if (!anchor || !panelRef.current || (!selected && listAnchorCount === 0))
      return;
    const restoreKey = `${scopeKey}:${selected?.item?.itemId ?? view}:${anchor}`;
    if (restoredAnchorRef.current === restoreKey) return;
    const attribute = selected
      ? "data-notebook-detail-anchor"
      : "data-notebook-list-anchor";
    const element = panelRef.current.querySelector<HTMLElement>(
      `[${attribute}="${CSS.escape(anchor)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    restoredAnchorRef.current = restoreKey;
  }, [
    listAnchorCount,
    scopeKey,
    selected,
    view,
    viewState.detailAnchor,
    viewState.listAnchor,
  ]);

  React.useLayoutEffect(() => {
    const itemId = focusOnBackRef.current;
    if (!itemId || selected || !panelRef.current || listAnchorCount === 0)
      return;
    const row = panelRef.current.querySelector<HTMLButtonElement>(
      `[data-notebook-list-anchor="${CSS.escape(itemId)}"]`,
    );
    if (!row) return;
    focusOnBackRef.current = null;
    row.focus({ preventScroll: true });
  }, [listAnchorCount, selected]);

  if (selected?.item) {
    return (
      <div ref={panelRef}>
        <ResidentNotebookDetailView
          detail={selected}
          initialDetailAnchor={viewState.detailAnchor}
          onBack={() => {
            const item = selected.item;
            if (!item) return;
            focusOnBackRef.current = item.itemId;
            setListAnchor(item.itemId);
            clearSavedSelection();
            setSelected(null);
          }}
          onDetailAnchorChange={setDetailAnchor}
          onChanged={async (next) => {
            if (activeResidentRef.current !== residentPubkey) return;
            if (!next.item) {
              clearSavedSelection();
              setSelected(null);
              return;
            }
            saveSelectedItem(next.item.itemId, next.item.revision);
            setSelected(next);
            await refresh();
          }}
          residentPubkey={residentPubkey}
        />
      </div>
    );
  }

  const items = (list?.items ?? []).filter((item) =>
    notebookItemMatchesView(item, view),
  );
  const availability = list?.availability ?? "unavailable";
  const empty = notebookAvailabilityCopy(availability, view);

  return (
    <div
      className="space-y-3"
      data-testid="resident-notebook-panel"
      ref={panelRef}
    >
      <header className="space-y-3">
        <ResidentNotebookIntro
          actions={
            view === "pages" ? (
              <Button
                className="shrink-0"
                onClick={() => setCreating(true)}
                size="sm"
                variant="outline"
              >
                <Plus /> New page
              </Button>
            ) : undefined
          }
          availability={list?.availability ?? null}
          residentName={residentName}
          residentPubkey={residentPubkey}
        />
        {handoffSlot}
        <div
          aria-label="Notebook sections"
          className="grid grid-cols-2 border-b border-border/60"
          role="tablist"
        >
          <NotebookTab
            active={view === "notes"}
            count={countKindWhenComplete(list, "memory_note")}
            icon={FileText}
            label="Continuity Notes"
            onClick={() => {
              setCreating(false);
              setView("notes");
            }}
          />
          <NotebookTab
            active={view === "pages"}
            count={countKindWhenComplete(list, "journal_page")}
            icon={BookOpen}
            label="Journal Pages"
            onClick={() => setView("pages")}
          />
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {job ? (
        <JournalJobStrip
          job={job}
          onCancel={async () => {
            await cancelResidentJournalPage(job.jobId);
            await refresh();
          }}
          onRetry={async () => {
            await retryResidentJournalPage(job.jobId);
            await refresh();
          }}
        />
      ) : null}

      {creating ? (
        <NewJournalPageForm
          busy={job?.state === "pending" || job?.state === "running"}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            try {
              const nextJob = await createResidentJournalPage({
                residentPubkey,
                ownerPrompt: input.prompt || null,
                selectedEventIds: input.eventIds,
                selectedPageIds: input.pageIds,
              });
              setJob(nextJob);
              setCreating(false);
              toast.success("Private journal request started.");
            } catch (cause) {
              setError(errorMessage(cause));
            }
          }}
        />
      ) : loading && !list ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          Opening notebook…
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-border/60 px-6 py-8 text-center">
          {view === "notes" ? (
            <FileText className="size-5 text-muted-foreground" />
          ) : (
            <BookOpen className="size-5 text-muted-foreground" />
          )}
          <p className="mt-3 text-sm font-medium">{empty.title}</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            {empty.body}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50 border-y border-border/50">
          {items.map((item) => (
            <ResidentNotebookLedgerRow
              item={item}
              key={item.itemId}
              anchorId={item.itemId}
              onClick={() => {
                setListAnchor(item.itemId);
                void openItem(item.itemId);
              }}
            />
          ))}
        </div>
      )}

      {list?.nextCursor !== null && list?.nextCursor !== undefined ? (
        <Button
          className="w-full"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          variant="ghost"
        >
          {loadingMore ? <LoaderCircle className="animate-spin" /> : null}
          Load older items
        </Button>
      ) : null}
    </div>
  );
}

function NotebookTab({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number | null;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "relative flex min-h-10 items-center justify-center gap-2 px-2 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      {count !== null ? (
        <span className="font-mono text-2xs text-muted-foreground">
          {count}
        </span>
      ) : null}
      {active ? (
        <span className="absolute inset-x-3 bottom-0 h-px bg-foreground" />
      ) : null}
    </button>
  );
}

function JournalJobStrip({
  job,
  onCancel,
  onRetry,
}: {
  job: ResidentJournalJob;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const active = job.state === "pending" || job.state === "running";
  return (
    <div className="flex items-center gap-3 border border-border/60 bg-muted/15 px-3 py-2">
      {active ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <BookOpen className="size-3.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-2xs uppercase tracking-caps text-foreground">
          Journal · {job.state}
        </p>
        {job.lastErrorCode ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {job.lastErrorCode}
          </p>
        ) : null}
      </div>
      {job.canCancel ? (
        <Button
          aria-label="Cancel journal request"
          onClick={() => void onCancel()}
          size="icon"
          variant="ghost"
        >
          <Square />
        </Button>
      ) : null}
      {job.canRetry ? (
        <Button
          aria-label="Retry journal request"
          onClick={() => void onRetry()}
          size="icon"
          variant="ghost"
        >
          <RotateCcw />
        </Button>
      ) : null}
    </div>
  );
}

function NewJournalPageForm({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: {
    prompt: string;
    eventIds: string[];
    pageIds: string[];
  }) => Promise<void>;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const [eventIds, setEventIds] = React.useState("");
  const [pageIds, setPageIds] = React.useState("");
  return (
    <section className="space-y-4 border border-border/70 bg-background/30 p-4">
      <div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Close new page"
            onClick={onCancel}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <div>
            <p className="text-sm font-medium">New journal page</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Authored privately by this resident using its current runtime and
              model.
            </p>
          </div>
        </div>
      </div>
      <div>
        <label
          className="text-xs font-medium"
          htmlFor="resident-journal-prompt"
        >
          What should this page hold?
        </label>
        <Textarea
          className="mt-1.5 min-h-28 resize-y bg-background/50 text-sm leading-6"
          disabled={busy}
          id="resident-journal-prompt"
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Optional direction, question, or invitation…"
          value={prompt}
        />
      </div>
      <button
        className="font-mono text-2xs uppercase tracking-caps text-muted-foreground hover:text-foreground"
        onClick={() => setSourcesOpen((value) => !value)}
        type="button"
      >
        {sourcesOpen ? "Hide references" : "Add exact references"}
      </button>
      {sourcesOpen ? (
        <div className="space-y-3 border-l border-border/60 pl-3">
          <ReferenceField
            label="Signed event IDs"
            onChange={setEventIds}
            value={eventIds}
          />
          <ReferenceField
            label="Notebook page IDs"
            onChange={setPageIds}
            value={pageIds}
          />
          <p className="text-2xs leading-4 text-muted-foreground">
            One ID per line. Only explicitly selected material enters this
            private request.
          </p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void onCreate({
              prompt: prompt.trim(),
              eventIds: lines(eventIds),
              pageIds: lines(pageIds),
            })
          }
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
          Ask resident
        </Button>
      </div>
    </section>
  );
}

function ReferenceField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = React.useId();
  return (
    <div>
      <label className="block text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Textarea
        className="mt-1 min-h-16 resize-y bg-background/50 font-mono text-2xs"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </div>
  );
}

function countKindWhenComplete(
  list: ResidentNotebookList | null,
  kind: ResidentNotebookItem["kind"],
): number | null {
  if (!list) return null;
  return notebookCountWhenComplete(
    list.items,
    list.nextCursor,
    (item) => item.kind === kind,
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
