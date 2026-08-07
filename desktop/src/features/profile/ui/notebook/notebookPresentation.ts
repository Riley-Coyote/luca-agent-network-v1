import type {
  ResidentMemoryNoteCategory,
  ResidentNotebookAvailability,
  ResidentNotebookItem,
} from "@/shared/api/tauriNotebook";

const CATEGORY_LABELS: Record<ResidentMemoryNoteCategory, string> = {
  decision: "Decision",
  durable_context: "Durable context",
  lesson: "Lesson",
  explicit_preference: "Explicit preference",
  commitment: "Commitment",
  open_question: "Open question",
};

export function notebookCategoryLabel(
  category: ResidentMemoryNoteCategory | null,
): string {
  return category ? CATEGORY_LABELS[category] : "Continuity note";
}

export function notebookTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Updated recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function notebookExcerpt(value: string, limit = 150): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function notebookAvailabilityCopy(
  availability: ResidentNotebookAvailability,
  kind: "notes" | "pages",
): { title: string; body: string } {
  if (availability === "locked") {
    return {
      title: "Notebook locked",
      body: "Private notebook contents are unavailable until Luca can unlock local continuity. Messaging still works normally.",
    };
  }
  if (availability === "unavailable") {
    return {
      title: "Notebook unavailable",
      body: "Luca could not open this resident’s private notebook. Messaging is unaffected.",
    };
  }
  return kind === "notes"
    ? {
        title: "No continuity notes yet",
        body: "After a meaningful exchange, this resident may keep a compact, source-backed note for future conversations.",
      }
    : {
        title: "No journal pages yet",
        body: "Ask this resident to create a private Markdown page when you want a deliberate reflection, draft, or record.",
      };
}

export function notebookItemMatchesView(
  item: ResidentNotebookItem,
  view: "notes" | "pages",
): boolean {
  return view === "notes"
    ? item.kind === "memory_note"
    : item.kind === "journal_page";
}
