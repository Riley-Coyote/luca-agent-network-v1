import { invoke } from "@tauri-apps/api/core";

export type ResidentNotebookAvailability =
  | "ready"
  | "empty"
  | "locked"
  | "unavailable";

export type ResidentNotebookItemKind =
  | "memory_note"
  | "journal_page"
  | "journal_annotation";

export type ResidentNotebookItemStatus =
  | "active"
  | "superseded"
  | "archived"
  | "forgotten";

export type ResidentNotebookAuthorship = "resident" | "owner";

export type ResidentMemoryNoteCategory =
  | "decision"
  | "durable_context"
  | "lesson"
  | "explicit_preference"
  | "commitment"
  | "open_question";

export type ResidentNotebookItem = {
  itemId: string;
  lineageRootId: string;
  kind: ResidentNotebookItemKind;
  status: ResidentNotebookItemStatus;
  authorship: ResidentNotebookAuthorship;
  revision: number;
  pinnedOwnerCorrection: boolean;
  title: string | null;
  body: string;
  category: ResidentMemoryNoteCategory | null;
  sourceEventIds: string[];
  sourcePageIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ResidentNotebookList = {
  availability: ResidentNotebookAvailability;
  items: ResidentNotebookItem[];
  nextCursor: number | null;
};

export type ResidentNotebookDetail = {
  availability: ResidentNotebookAvailability;
  item: ResidentNotebookItem | null;
  revisions: ResidentNotebookItem[];
  annotations: ResidentNotebookItem[];
};

export type ResidentJournalJobState =
  | "pending"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type ResidentJournalJob = {
  jobId: string;
  state: ResidentJournalJobState;
  lastErrorCode: string | null;
  updatedAt: string;
  canCancel: boolean;
  canRetry: boolean;
};

export type ResidentNotebookFixtures = {
  ready: ResidentNotebookList;
  empty: ResidentNotebookList;
  locked: ResidentNotebookList;
  unavailable: ResidentNotebookList;
  detail: ResidentNotebookDetail;
  jobs: ResidentJournalJob[];
};

export type CreateResidentJournalPageInput = {
  residentPubkey: string;
  conversationId?: string | null;
  ownerPrompt?: string | null;
  selectedEventIds?: string[];
  selectedPageIds?: string[];
};

export type CorrectResidentMemoryNoteInput = {
  residentPubkey: string;
  targetNoteId: string;
  category: ResidentMemoryNoteCategory;
  body: string;
};

export function listResidentNotebookItems(
  residentPubkey: string,
  cursor?: number,
  pageSize?: number,
): Promise<ResidentNotebookList> {
  return invoke("list_resident_notebook_items", {
    residentPubkey,
    cursor,
    pageSize,
  });
}

export function getResidentNotebookItem(
  residentPubkey: string,
  itemId: string,
): Promise<ResidentNotebookDetail> {
  return invoke("get_resident_notebook_item", { residentPubkey, itemId });
}

export function getResidentNotebookRevisionHistory(
  residentPubkey: string,
  itemId: string,
): Promise<ResidentNotebookDetail> {
  return invoke("get_resident_notebook_revision_history", {
    residentPubkey,
    itemId,
  });
}

export function createResidentJournalPage(
  input: CreateResidentJournalPageInput,
): Promise<ResidentJournalJob> {
  return invoke("create_resident_journal_page", { input });
}

export function requestResidentJournalPageRevision(
  input: CreateResidentJournalPageInput,
  targetPageId: string,
): Promise<ResidentJournalJob> {
  return invoke("request_resident_journal_page_revision", {
    input,
    targetPageId,
  });
}

export function cancelResidentJournalPage(jobId: string): Promise<boolean> {
  return invoke("cancel_resident_journal_page", { jobId });
}

export function retryResidentJournalPage(jobId: string): Promise<boolean> {
  return invoke("retry_resident_journal_page", { jobId });
}

export function getResidentJournalActivity(
  residentPubkey: string,
): Promise<ResidentJournalJob | null> {
  return invoke("get_resident_journal_activity", { residentPubkey });
}

export function correctResidentMemoryNote(
  input: CorrectResidentMemoryNoteInput,
): Promise<ResidentNotebookDetail> {
  return invoke("correct_resident_memory_note", { input });
}

export function pinResidentMemoryNote(
  residentPubkey: string,
  noteId: string,
): Promise<ResidentNotebookDetail> {
  return invoke("pin_resident_memory_note", { residentPubkey, noteId });
}

export function annotateResidentJournalPage(
  residentPubkey: string,
  pageId: string,
  body: string,
): Promise<ResidentNotebookDetail> {
  return invoke("annotate_resident_journal_page", {
    input: { residentPubkey, pageId, body },
  });
}

export function archiveResidentNotebookItem(
  residentPubkey: string,
  itemId: string,
): Promise<ResidentNotebookList> {
  return invoke("archive_resident_notebook_item", { residentPubkey, itemId });
}

export function forgetResidentNotebookItem(
  residentPubkey: string,
  itemId: string,
): Promise<ResidentNotebookList> {
  return invoke("forget_resident_notebook_item", { residentPubkey, itemId });
}

export function getResidentNotebookFixtures(): Promise<ResidentNotebookFixtures> {
  return invoke("get_resident_notebook_fixtures");
}
