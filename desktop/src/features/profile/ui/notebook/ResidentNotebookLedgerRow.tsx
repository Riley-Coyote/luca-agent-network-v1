import { BookOpen, ChevronRight, FileText } from "lucide-react";

import type { ResidentNotebookItem } from "@/shared/api/tauriNotebook";

import {
  notebookCategoryLabel,
  notebookExcerpt,
  notebookTimestamp,
} from "./notebookPresentation";

export function ResidentNotebookLedgerRow({
  item,
  onClick,
}: {
  item: ResidentNotebookItem;
  onClick: () => void;
}) {
  const isJournalPage = item.kind === "journal_page";
  const sourceCount = item.sourceEventIds.length + item.sourcePageIds.length;
  const title = isJournalPage
    ? item.title || "Untitled page"
    : notebookExcerpt(item.body, 110);

  return (
    <button
      className="group flex w-full items-start gap-3 px-1 py-3 text-left transition-colors duration-150 hover:bg-muted/25 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-border/60 text-muted-foreground"
      >
        {isJournalPage ? (
          <BookOpen className="size-3.5" />
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3 font-mono text-2xs uppercase tracking-caps text-muted-foreground">
          <span className="truncate">
            {isJournalPage
              ? "Journal page"
              : notebookCategoryLabel(item.category)}
          </span>
          <span className="shrink-0 normal-case tracking-normal">
            {notebookTimestamp(item.updatedAt)}
          </span>
        </span>

        <span className="mt-1 block truncate text-sm font-medium leading-5 text-foreground">
          {title}
        </span>

        <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-2xs uppercase tracking-caps text-muted-foreground">
          <span>
            {item.authorship === "resident"
              ? "resident authored"
              : "owner authored"}
          </span>
          {item.pinnedOwnerCorrection ? <span>pinned correction</span> : null}
          <span>rev {item.revision}</span>
          {sourceCount > 0 ? (
            <span>
              {sourceCount} source{sourceCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {item.status !== "active" ? <span>{item.status}</span> : null}
        </span>
      </span>

      <ChevronRight
        aria-hidden="true"
        className="mt-2 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
