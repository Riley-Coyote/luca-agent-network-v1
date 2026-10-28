import { ChevronRight, FileText, Plus } from "lucide-react";
import * as React from "react";

import {
  RESIDENT_DOCUMENT_KINDS,
  documentKindMeta,
  documentWriterLabel,
  formatDocumentBytes,
  formatDocumentStatus,
  formatRelativeAge,
  spaceDocumentLabel,
  validateExtraFilePath,
} from "@/features/agents/documents/documentKinds";
import { ResidentDocumentEditor } from "@/features/agents/documents/ResidentDocumentEditor";
import {
  useResidentDocumentQuery,
  useResidentDocumentsQuery,
} from "@/features/agents/documents/useResidentDocuments";
import { useProfileQuery } from "@/features/profile/hooks";
import type {
  ResidentDocumentEntry,
  ResidentDocumentTarget,
} from "@/shared/api/tauriResidentDocuments";
import type { ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * The agent folder as a page: one row per document, in the order the
 * harness reads them, then whatever else lives in the folder. Selecting a
 * row opens it in place. Who writes each document is on the row, because
 * that split is the whole framework.
 */
export function ResidentDocumentsSection({
  agent,
  intro,
  onRestart,
  residentName,
  variant = "page",
}: {
  agent: ManagedAgent;
  /** `space`: the tab's own line above its documents (WP-40). */
  intro?: string;
  onRestart: () => void;
  residentName: string;
  /** `space`: a mind's Self tab (WP-13): the same rows, named as the
   *  space names them, each saying who writes it. */
  variant?: "page" | "space";
}) {
  const documents = useResidentDocumentsQuery(agent.pubkey);
  const ownerName = useProfileQuery(variant === "space").data?.displayName;
  const [selected, setSelected] = React.useState<ResidentDocumentTarget | null>(
    null,
  );
  const [newFileOpen, setNewFileOpen] = React.useState(false);
  const [newFilePath, setNewFilePath] = React.useState("");
  const [newFileError, setNewFileError] = React.useState<string | null>(null);

  const byKind = new Map<string, ResidentDocumentEntry>(
    (documents.data?.documents ?? []).map((entry) => [entry.kind, entry]),
  );
  const extraFiles = documents.data?.extraFiles ?? [];
  const isNative = documents.data?.source === "native";
  const runtimeName = documents.data?.nativeRuntime ?? "Their runtime";

  if (selected) {
    return (
      <ResidentDocumentEditor
        agent={agent}
        backLabel={variant === "space" ? "Self" : undefined}
        fileNameOverride={
          "kind" in selected ? byKind.get(selected.kind)?.fileName : undefined
        }
        nativeRuntime={isNative ? runtimeName : null}
        onBack={() => setSelected(null)}
        onRestart={onRestart}
        residentName={residentName}
        target={selected}
      />
    );
  }

  const openNewFile = () => {
    const error = validateExtraFilePath(newFilePath);
    if (error) {
      setNewFileError(error);
      return;
    }
    const relPath = newFilePath.trim();
    setNewFileOpen(false);
    setNewFilePath("");
    setNewFileError(null);
    setSelected({ relPath });
  };

  return (
    <div data-testid="resident-documents">
      {documents.isError ? (
        <p className="mb-5 text-sm text-destructive" role="alert">
          {documents.error instanceof Error && documents.error.message
            ? documents.error.message
            : "Couldn't read the folder."}
        </p>
      ) : null}

      {isNative && documents.data ? (
        <p
          className="mb-5 text-sm leading-6 text-muted-foreground"
          data-testid="resident-documents-native-note"
        >
          {runtimeName} keeps these files itself, in{" "}
          <span className="font-mono text-xs text-ink-faint">
            {documents.data.dir}
          </span>
          . Edits go straight to them; {runtimeName} reads them when the
          resident next starts.
        </p>
      ) : null}

      {variant === "space" ? (
        <>
          {intro ? <p className="luca-mind-intro">{intro}</p> : null}
          {/* Each document a row that clearly opens (BETA14_RELEASE.md
              WP-40, Decided 3): its title, its file in the mono, one line
              of what it says, who writes it, when it changed, a chevron. */}
          <section aria-label="Documents" className="luca-mind-section">
            <h2 className="luca-mind-h2">
              Documents
              <span className="luca-mind-count">
                {RESIDENT_DOCUMENT_KINDS.length}
              </span>
            </h2>
            <ul className="luca-mind-rows" data-testid="mind-self">
              {RESIDENT_DOCUMENT_KINDS.map((kind) => {
                const meta = documentKindMeta(kind);
                const entry = byKind.get(kind) ?? null;
                const label = spaceDocumentLabel(kind, ownerName);
                const fileName = entry?.fileName ?? meta.fileName;
                if (isNative && documents.data && !entry) {
                  return (
                    <li
                      className="luca-mind-doc"
                      data-quiet="true"
                      data-testid={`resident-document-${kind}`}
                      key={kind}
                    >
                      <span aria-hidden className="luca-mind-glyph">
                        <FileText />
                      </span>
                      <span className="luca-mind-entry-words">
                        <span className="luca-mind-doc-title">
                          {label}
                          <code className="luca-mind-file">{fileName}</code>
                        </span>
                        <span className="luca-mind-excerpt">{meta.blurb}</span>
                      </span>
                      <span className="luca-mind-writer">
                        Not part of {runtimeName}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={kind}>
                    <button
                      className="luca-mind-doc"
                      data-testid={`resident-document-${kind}`}
                      onClick={() => setSelected({ kind })}
                      title={meta.blurb}
                      type="button"
                    >
                      <span aria-hidden className="luca-mind-glyph">
                        <FileText />
                      </span>
                      <span className="luca-mind-entry-words">
                        <span className="luca-mind-doc-title">
                          {label}
                          <code className="luca-mind-file">{fileName}</code>
                        </span>
                        <DocumentFirstLine
                          exists={entry?.exists ?? false}
                          kind={kind}
                          pending={documents.isPending}
                          residentPubkey={agent.pubkey}
                        />
                      </span>
                      <span
                        className="luca-mind-writer"
                        data-testid={`resident-document-${kind}-writer`}
                      >
                        {documentWriterLabel(meta.writer, residentName)}
                      </span>
                      <time
                        className="luca-mind-date"
                        data-testid={`resident-document-${kind}-status`}
                      >
                        {entry?.exists
                          ? entry.modifiedAt == null
                            ? formatDocumentBytes(entry.bytes)
                            : formatRelativeAge(
                                entry.modifiedAt * 1000,
                                Date.now(),
                              )
                          : ""}
                      </time>
                      <ChevronRight aria-hidden className="luca-mind-chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : (
        <ul className="divide-y divide-border/45 border-y border-border/55">
          {RESIDENT_DOCUMENT_KINDS.map((kind) => {
            const meta = documentKindMeta(kind);
            const entry = byKind.get(kind) ?? null;
            const exists = entry?.exists ?? false;
            if (isNative && documents.data && !entry) {
              return (
                <li
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 py-4"
                  data-testid={`resident-document-${kind}`}
                  key={kind}
                >
                  <span className="text-base leading-6 text-ink-faint">
                    {meta.label}
                  </span>
                  <span
                    className="whitespace-nowrap text-2xs text-ink-faint"
                    data-testid={`resident-document-${kind}-status`}
                  >
                    Not part of {runtimeName}
                  </span>
                  <span className="col-span-2 text-sm leading-5 text-ink-faint">
                    {meta.blurb}
                  </span>
                </li>
              );
            }
            return (
              <li key={kind}>
                <button
                  className={cn(
                    "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 py-4 text-left transition-colors",
                    "hover:bg-foreground/[0.025] focus-visible:bg-foreground/[0.035] focus-visible:outline-hidden",
                    "-mx-3 w-[calc(100%+1.5rem)] rounded-md px-3",
                  )}
                  data-testid={`resident-document-${kind}`}
                  onClick={() => setSelected({ kind })}
                  type="button"
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span
                      className={cn(
                        "text-base leading-6",
                        exists ? "text-foreground" : "text-ink-muted",
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="hidden font-mono text-2xs text-ink-faint sm:inline">
                      {entry?.fileName ?? meta.fileName}
                    </span>
                  </span>
                  <span
                    className="whitespace-nowrap text-2xs tabular-nums text-muted-foreground"
                    data-testid={`resident-document-${kind}-status`}
                  >
                    {entry
                      ? formatDocumentStatus(entry)
                      : documents.isPending
                        ? "…"
                        : "Not written yet"}
                  </span>
                  <span className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm leading-5 text-muted-foreground">
                    <span>
                      {documentWriterLabel(meta.writer, residentName)}
                    </span>
                    <span aria-hidden className="text-ink-ghost">
                      ·
                    </span>
                    <span className="min-w-0 text-ink-faint">{meta.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section
        className={variant === "space" ? "luca-mind-section" : "mt-9"}
        data-testid="resident-extra-files"
      >
        <div
          className={
            variant === "space"
              ? "luca-mind-section-head"
              : "flex items-baseline justify-between gap-4"
          }
        >
          {variant === "space" ? (
            <h2 className="luca-mind-h2">More files</h2>
          ) : (
            <h3 className="text-2xs uppercase tracking-caps-wide text-muted-foreground">
              More files
            </h3>
          )}
          {!isNative ? (
            <button
              className={
                variant === "space"
                  ? "luca-mind-button"
                  : "inline-flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-hidden"
              }
              data-testid="resident-new-file"
              onClick={() => {
                setNewFileOpen((open) => !open);
                setNewFileError(null);
              }}
              type="button"
            >
              <Plus className={variant === "space" ? undefined : "size-3"} />
              New file
            </button>
          ) : null}
        </div>

        {newFileOpen ? (
          <form
            className="mt-3 flex flex-wrap items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              openNewFile();
            }}
          >
            <div className="min-w-0 flex-1">
              <input
                aria-label="New file path"
                className="h-9 w-full rounded-md border border-border/70 bg-foreground/[0.03] px-3 font-mono text-sm text-foreground placeholder:text-ink-faint focus-visible:border-foreground/50 focus-visible:outline-hidden"
                data-testid="resident-new-file-path"
                onChange={(event) => {
                  setNewFilePath(event.target.value);
                  if (newFileError) setNewFileError(null);
                }}
                placeholder="notes/reading-list.md"
                value={newFilePath}
              />
              {newFileError ? (
                <p className="mt-1 text-2xs text-destructive">{newFileError}</p>
              ) : null}
            </div>
            <Button size="sm" type="submit" variant="outline">
              Open
            </Button>
          </form>
        ) : null}

        {extraFiles.length > 0 && variant === "space" ? (
          <ul className="luca-mind-rows">
            {extraFiles.map((file) => (
              <li key={file.relPath}>
                <button
                  className="luca-mind-doc"
                  data-testid={`resident-extra-file-${file.relPath}`}
                  onClick={() => setSelected({ relPath: file.relPath })}
                  type="button"
                >
                  <span aria-hidden className="luca-mind-glyph">
                    <FileText />
                  </span>
                  <span className="luca-mind-entry-words">
                    <code className="luca-mind-file" data-solo="true">
                      {file.relPath}
                    </code>
                  </span>
                  <span className="luca-mind-writer">
                    {formatDocumentBytes(file.bytes)}
                  </span>
                  <time className="luca-mind-date">
                    {formatRelativeAge(file.modifiedAt * 1000, Date.now())}
                  </time>
                  <ChevronRight aria-hidden className="luca-mind-chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : extraFiles.length > 0 ? (
          <ul className="mt-3 divide-y divide-border/45 border-y border-border/55">
            {extraFiles.map((file) => (
              <li key={file.relPath}>
                <button
                  className="-mx-3 flex w-[calc(100%+1.5rem)] items-baseline justify-between gap-6 rounded-md px-3 py-3 text-left transition-colors hover:bg-foreground/[0.025] focus-visible:bg-foreground/[0.035] focus-visible:outline-hidden"
                  data-testid={`resident-extra-file-${file.relPath}`}
                  onClick={() => setSelected({ relPath: file.relPath })}
                  type="button"
                >
                  <span className="min-w-0 truncate font-mono text-sm text-ink-muted">
                    {file.relPath}
                  </span>
                  <span className="whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
                    {formatDocumentBytes(file.bytes)} · edited{" "}
                    {formatRelativeAge(file.modifiedAt * 1000, Date.now())}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p
            className={
              variant === "space"
                ? "luca-mind-help"
                : "mt-3 text-sm leading-6 text-muted-foreground"
            }
          >
            {isNative
              ? "Their runtime keeps the rest of its files where it always has."
              : variant === "space"
                ? `Nothing else in ${residentName}'s folder yet.`
                : "Nothing else in the folder yet."}
          </p>
        )}
        {documents.data && variant !== "space" ? (
          <p className="mt-3 font-mono text-2xs text-ink-faint">
            {documents.data.dir}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** A written document's own first line; the type's description only when
 *  nothing is written yet (WP-13, Self shows who they are). */
function DocumentFirstLine({
  exists,
  kind,
  pending,
  residentPubkey,
}: {
  exists: boolean;
  kind: ResidentDocumentEntry["kind"];
  /** The folder is still being read: nothing is said yet. */
  pending: boolean;
  residentPubkey: string;
}) {
  const target = React.useMemo(() => ({ kind }), [kind]);
  const document = useResidentDocumentQuery(
    exists ? residentPubkey : null,
    exists ? target : null,
  );
  const line = exists ? documentFirstLine(document.data?.content ?? "") : "";
  return (
    <span
      className="luca-mind-excerpt"
      data-testid={`resident-document-${kind}-line`}
      data-empty={!exists && !pending ? "true" : undefined}
      data-written={line ? "true" : undefined}
    >
      {line ||
        (pending || (exists && document.isPending)
          ? "\u00a0"
          : exists
            ? "Written, with no text yet"
            : "Not written yet")}
    </span>
  );
}

/** A document's first line of prose: headings' marks and bullets off. */
function documentFirstLine(content: string): string {
  for (const raw of content.split("\n")) {
    const line = raw
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*[-*+>]\s+/, "")
      .trim();
    if (line) return line;
  }
  return "";
}
