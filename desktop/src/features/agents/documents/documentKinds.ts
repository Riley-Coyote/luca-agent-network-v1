import type {
  ResidentDocumentEntry,
  ResidentDocumentKind,
  ResidentDocumentWriter,
} from "@/shared/api/tauriResidentDocuments";

/**
 * The agent folder, as the page presents it: one row per kind, in the order
 * the harness assembles them. Copy lives here so the Documents section and
 * the editor say the same things, and so it can be tested without React.
 */

export type ResidentDocumentKindMeta = {
  kind: ResidentDocumentKind;
  fileName: string;
  label: string;
  writer: ResidentDocumentWriter;
  /** One line under the label: what this document is for. */
  blurb: string;
  /** Whether the harness folds this document into the prompt at spawn. */
  assembled: boolean;
};

/** Slot order — soul → convictions → self-model → user model → lessons → instructions. */
export const RESIDENT_DOCUMENT_KINDS: readonly ResidentDocumentKind[] = [
  "soul",
  "convictions",
  "selfModel",
  "userModel",
  "lessons",
  "instructions",
] as const;

const META: Record<ResidentDocumentKind, ResidentDocumentKindMeta> = {
  soul: {
    kind: "soul",
    fileName: "soul.md",
    label: "Soul",
    writer: "owner",
    blurb:
      "Who they are — the persona as scenarios, what they value, what they refuse.",
    assembled: true,
  },
  convictions: {
    kind: "convictions",
    fileName: "convictions.md",
    label: "Convictions",
    writer: "owner",
    blurb:
      "What they hold to. Earned over time; promoted from evidence, never guessed.",
    assembled: true,
  },
  selfModel: {
    kind: "selfModel",
    fileName: "self-model.md",
    label: "Self-model",
    writer: "agent",
    blurb:
      "How they understand themselves, every line cited to something that happened.",
    assembled: true,
  },
  userModel: {
    kind: "userModel",
    fileName: "user-model.md",
    label: "User model",
    writer: "agent",
    blurb: "You, as they have come to know you.",
    assembled: true,
  },
  lessons: {
    kind: "lessons",
    fileName: "lessons.md",
    label: "Lessons",
    writer: "agent",
    blurb: "The mistake, the tell, the correction.",
    assembled: false,
  },
  instructions: {
    kind: "instructions",
    fileName: "instructions.md",
    label: "Instructions",
    writer: "owner",
    blurb:
      "How they operate — the same shape as the AGENTS.md their runtime already reads.",
    assembled: true,
  },
};

export function documentKindMeta(
  kind: ResidentDocumentKind,
): ResidentDocumentKindMeta {
  return META[kind];
}

/** "You write this" / "Luca writes this" — who holds the pen. */
export function documentWriterLabel(
  writer: ResidentDocumentWriter,
  residentName: string,
): string {
  return writer === "owner" ? "You write this" : `${residentName} writes this`;
}

export function formatDocumentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KB`;
}

/**
 * "1.2 KB · edited 3 min ago" for a written document, "Not written yet" for
 * an absent one. `now` is injectable for tests.
 */
export function formatDocumentStatus(
  entry: Pick<ResidentDocumentEntry, "exists" | "bytes" | "modifiedAt">,
  now: number = Date.now(),
): string {
  if (!entry.exists) return "Not written yet";
  const size = formatDocumentBytes(entry.bytes);
  if (entry.modifiedAt == null) return size;
  return `${size} · edited ${formatRelativeAge(entry.modifiedAt * 1000, now)}`;
}

export function formatRelativeAge(atMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - atMs) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(atMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Extra files must be relative, inside the folder, and text. */
export const EXTRA_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
] as const;

export function validateExtraFilePath(relPath: string): string | null {
  const trimmed = relPath.trim();
  if (!trimmed) return "Give the file a name.";
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return "Use a path inside the folder, not an absolute one.";
  }
  if (trimmed.split(/[\\/]/).some((part) => part === "..")) {
    return "The path can't climb out of the folder.";
  }
  if (trimmed.split(/[\\/]/).some((part) => part.startsWith("."))) {
    return "Hidden files aren't editable here.";
  }
  const lower = trimmed.toLowerCase();
  if (!EXTRA_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `Text files only (${EXTRA_FILE_EXTENSIONS.join(", ")}).`;
  }
  return null;
}
