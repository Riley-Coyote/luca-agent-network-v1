import { invoke } from "@tauri-apps/api/core";

/**
 * A resident's documents — the agent folder. Plain markdown under
 * `<app_data_dir>/residents/<pubkey>/`, one file per kind, split by who
 * writes it. The desktop is the one writer for every runtime; the harness
 * receives the folder assembled in slot order at spawn.
 *
 * Wire contract shared with `src-tauri/src/commands/resident_documents.rs`
 * and the e2e mock bridge. Keep the three in step.
 */

/** Slot order is the assembly order: soul → convictions → self-model → user → instructions. */
export type ResidentDocumentKind =
  | "soul"
  | "convictions"
  | "selfModel"
  | "userModel"
  | "lessons"
  | "instructions";

/** Who is allowed to write this document. The owner may always edit from the desktop. */
export type ResidentDocumentWriter = "owner" | "agent";

/** A document by kind, or any other file in the folder by relative path. */
export type ResidentDocumentTarget =
  | { kind: ResidentDocumentKind }
  | { relPath: string };

export type ResidentDocumentEntry = {
  kind: ResidentDocumentKind;
  fileName: string;
  writer: ResidentDocumentWriter;
  exists: boolean;
  bytes: number;
  /** Unix seconds; null when the file does not exist. */
  modifiedAt: number | null;
};

export type ResidentExtraFileEntry = {
  relPath: string;
  bytes: number;
  modifiedAt: number;
};

/**
 * Where the documents come from. `folder` is the resident's own agent folder;
 * `native` means the kinds resolve to a native runtime's files in place
 * (Hermes profile, OpenClaw workspace) and there is no assembly.
 */
export type ResidentDocumentsSource = "folder" | "native";

export type ResidentDocumentsInspector = {
  residentPubkey: string;
  /** Relative to the app data dir, e.g. `residents/<pubkey>`. */
  dir: string;
  source: ResidentDocumentsSource;
  documents: ResidentDocumentEntry[];
  extraFiles: ResidentExtraFileEntry[];
  /** Content hash over every document and extra file; changes on any write. */
  hash: string;
};

export type ResidentDocumentContent = {
  target: ResidentDocumentTarget;
  exists: boolean;
  content: string;
  /** Hash of this file's content; pass back as `expectedHash` when saving. */
  hash: string | null;
  modifiedAt: number | null;
};

export type ResidentDocumentWriteReceipt = {
  target: ResidentDocumentTarget;
  hash: string;
  documentsHash: string;
  bytes: number;
  modifiedAt: number;
};

/** Error prefix the write command returns when `expectedHash` no longer matches. */
export const RESIDENT_DOCUMENT_CONFLICT_PREFIX = "document_conflict:";

export function isResidentDocumentConflict(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message.startsWith(RESIDENT_DOCUMENT_CONFLICT_PREFIX);
}

export function listResidentDocuments(
  residentPubkey: string,
): Promise<ResidentDocumentsInspector> {
  return invoke("list_resident_documents", { residentPubkey });
}

export function readResidentDocument(
  residentPubkey: string,
  target: ResidentDocumentTarget,
): Promise<ResidentDocumentContent> {
  return invoke("read_resident_document", { residentPubkey, target });
}

/**
 * Atomic write. `expectedHash` is the hash the editor loaded (null for a file
 * that did not exist); a mismatch fails with `RESIDENT_DOCUMENT_CONFLICT_PREFIX`
 * so the editor can offer to reload rather than overwrite silently.
 */
export function writeResidentDocument(
  residentPubkey: string,
  target: ResidentDocumentTarget,
  content: string,
  expectedHash: string | null,
): Promise<ResidentDocumentWriteReceipt> {
  return invoke("write_resident_document", {
    residentPubkey,
    target,
    content,
    expectedHash,
  });
}
