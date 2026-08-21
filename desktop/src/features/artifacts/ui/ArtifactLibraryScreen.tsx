import {
  AppWindow,
  Braces,
  File,
  FileCode2,
  FileImage,
  FileText,
  ImageIcon,
  LoaderCircle,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import {
  useArtifactLibrary,
  useArtifactMutations,
} from "@/features/artifacts/hooks";
import type { ArtifactKind, ArtifactSummary } from "@/features/artifacts/types";
import { useArtifactProvenanceLabels } from "@/features/artifacts/useArtifactProvenanceLabels";
import { formatBytes } from "@/shared/api/tauriArtifacts";
import { cn } from "@/shared/lib/cn";

import "./artifact-library.css";

const FILTERS: readonly { label: string; value: "all" | ArtifactKind }[] = [
  { label: "All", value: "all" },
  { label: "Prototypes", value: "html" },
  { label: "Apps", value: "app" },
  { label: "Images", value: "image" },
  { label: "Documents", value: "markdown" },
  { label: "Code", value: "code" },
];

export function ArtifactLibraryScreen() {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | ArtifactKind>("all");
  const [deletedState, setDeletedState] = React.useState<"active" | "deleted">(
    "active",
  );
  const [actionMessage, setActionMessage] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const library = useArtifactLibrary({
    query: deferredQuery,
    kind: filter,
    deletedState,
  });
  const mutations = useArtifactMutations();
  const provenanceLabels = useArtifactProvenanceLabels();
  const { openArtifact, presentation } = useArtifactCanvas();
  const artifacts = library.data?.pages.flatMap((page) => page.artifacts) ?? [];
  const total = library.data?.pages[0]?.total ?? artifacts.length;

  React.useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  const open = (artifact: ArtifactSummary) =>
    openArtifact({
      artifactId: artifact.id,
      version: null,
      previewSessionId: artifact.activePreviewSessionId,
      conversationId: artifact.provenance.conversationId,
      residentPubkey: artifact.provenance.residentPubkey,
      turnId: artifact.provenance.turnId,
      source: "library",
    });

  return (
    <main
      className="artifact-library-screen"
      data-testid="artifact-library-screen"
    >
      <header className="artifact-library-screen__header">
        <div>
          <span className="artifact-library-screen__header-label">
            Created work
          </span>
          <h1>Library</h1>
          <p>Artifacts made with your residents, kept across conversations.</p>
        </div>
        <button
          disabled={mutations.importArtifact.isPending}
          onClick={() =>
            mutations.importArtifact.mutate(undefined, {
              onSuccess: (artifact) => {
                if (artifact) open(artifact);
                else setActionMessage("Import cancelled");
              },
              onError: () => setActionMessage("Could not import that file"),
            })
          }
          type="button"
        >
          {mutations.importArtifact.isPending ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <Plus aria-hidden />
          )}
          Import
        </button>
      </header>

      <div className="artifact-library-screen__controls">
        <label className="artifact-library-search">
          <Search aria-hidden />
          <span className="sr-only">Search Library</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search artifact titles"
            value={query}
          />
        </label>
        <fieldset className="artifact-library-filters">
          <legend className="sr-only">Artifact kind</legend>
          {FILTERS.map((item) => (
            <button
              aria-pressed={filter === item.value}
              className={cn(filter === item.value && "is-active")}
              key={item.value}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <button
          aria-pressed={deletedState === "deleted"}
          className={cn(
            "artifact-library-trash-toggle",
            deletedState === "deleted" && "is-active",
          )}
          onClick={() =>
            setDeletedState((value) =>
              value === "active" ? "deleted" : "active",
            )
          }
          type="button"
        >
          <Trash2 aria-hidden /> Recently deleted
        </button>
      </div>

      <div className="artifact-library-screen__body">
        {library.isLoading ? <LibraryLoading /> : null}
        {library.isError ? (
          <LibraryState
            action="Try again"
            icon={<FileCode2 aria-hidden />}
            onAction={() => void library.refetch()}
            text="Library is unavailable. Conversations and resident replies continue normally."
            title="Couldn’t open Library"
          />
        ) : null}
        {!library.isLoading && !library.isError && artifacts.length === 0 ? (
          deferredQuery || filter !== "all" || deletedState === "deleted" ? (
            <LibraryState
              action="Clear filters"
              icon={<Search aria-hidden />}
              onAction={() => {
                setQuery("");
                setFilter("all");
                setDeletedState("active");
              }}
              text="No artifact metadata matches this view."
              title="Nothing found"
            />
          ) : (
            <LibraryState
              action="Import a file"
              icon={<FileCode2 aria-hidden />}
              onAction={() => mutations.importArtifact.mutate()}
              text="When a resident creates something durable, it will appear here."
              title="Your created work lives here"
            />
          )
        ) : null}
        {artifacts.length > 0 ? (
          <ul className="artifact-library-list">
            {artifacts.map((artifact) => (
              <ArtifactRow
                artifact={artifact}
                key={artifact.id}
                onOpen={() => open(artifact)}
                onPin={() =>
                  mutations.pinArtifact.mutate(
                    {
                      artifactId: artifact.id,
                      pinned: !artifact.pinned,
                    },
                    {
                      onError: () => setActionMessage("Could not update pin"),
                    },
                  )
                }
                onDelete={() =>
                  mutations.deleteArtifact.mutate(artifact.id, {
                    onError: () =>
                      setActionMessage(
                        "Could not move artifact to Recently deleted",
                      ),
                  })
                }
                onRestore={() =>
                  mutations.restoreArtifact.mutate(artifact.id, {
                    onError: () =>
                      setActionMessage("Could not restore artifact"),
                  })
                }
                selected={presentation?.artifactId === artifact.id}
                sourceLabel={formatProvenanceLabel(
                  provenanceLabels(artifact.provenance),
                )}
              />
            ))}
          </ul>
        ) : null}
        {library.hasNextPage ? (
          <button
            className="artifact-library-load-more"
            disabled={library.isFetchingNextPage}
            onClick={() => void library.fetchNextPage()}
            type="button"
          >
            {library.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>

      <footer className="artifact-library-screen__footer">
        <span>
          {total} {deletedState === "deleted" ? "deleted " : ""}artifacts ·
          stored on this Mac
        </span>
        <span>Bodies load only when Canvas opens</span>
      </footer>
      {actionMessage ? (
        <div className="artifact-library-notice" role="status">
          {actionMessage}
        </div>
      ) : null}
    </main>
  );
}

function ArtifactRow({
  artifact,
  onOpen,
  onDelete,
  onPin,
  onRestore,
  selected,
  sourceLabel,
}: {
  artifact: ArtifactSummary;
  onOpen: () => void;
  onDelete: () => void;
  onPin: () => void;
  onRestore: () => void;
  selected: boolean;
  sourceLabel: string;
}) {
  return (
    <li
      className="artifact-library-row"
      data-deleted={artifact.deletedAt ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
    >
      <button
        className="artifact-library-row__main"
        onClick={onOpen}
        type="button"
      >
        <span className="artifact-library-row__icon">
          <KindIcon kind={artifact.kind} />
        </span>
        <span className="artifact-library-row__copy">
          <strong>{artifact.title}</strong>
          <span>{artifact.summary ?? kindLabel(artifact.kind)}</span>
        </span>
        <span className="artifact-library-row__source">{sourceLabel}</span>
        <span className="artifact-library-row__meta">
          v{artifact.currentVersion}
        </span>
        <span className="artifact-library-row__meta">
          {formatBytes(artifact.sizeBytes)}
        </span>
      </button>
      <div className="artifact-library-row__actions">
        {artifact.deletedAt ? (
          <button
            aria-label={`Restore ${artifact.title}`}
            onClick={onRestore}
            type="button"
          >
            <RotateCcw aria-hidden />
          </button>
        ) : (
          <>
            <button
              aria-label={`${artifact.pinned ? "Unpin" : "Pin"} ${artifact.title}`}
              data-active={artifact.pinned}
              onClick={onPin}
              type="button"
            >
              <Pin aria-hidden />
            </button>
            <button
              aria-label={`Move ${artifact.title} to Recently deleted`}
              onClick={onDelete}
              type="button"
            >
              <Trash2 aria-hidden />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function formatProvenanceLabel(labels: {
  resident: string;
  conversation: string | null;
}) {
  return labels.conversation
    ? `${labels.resident} · ${labels.conversation}`
    : labels.resident;
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  switch (kind) {
    case "html":
      return <AppWindow aria-hidden />;
    case "app":
      return <AppWindow aria-hidden />;
    case "image":
      return <ImageIcon aria-hidden />;
    case "svg":
      return <FileImage aria-hidden />;
    case "markdown":
      return <FileText aria-hidden />;
    case "text":
      return <FileText aria-hidden />;
    case "code":
      return <Braces aria-hidden />;
    default:
      return <File aria-hidden />;
  }
}

function kindLabel(kind: ArtifactKind) {
  return kind === "app"
    ? "Local application"
    : `${kind.toUpperCase()} artifact`;
}

function LibraryLoading() {
  return (
    <div
      aria-label="Loading Library"
      className="artifact-library-loading"
      role="status"
    >
      {[0, 1, 2, 3, 4].map((item) => (
        <i key={item} />
      ))}
    </div>
  );
}

function LibraryState({
  action,
  icon,
  onAction,
  text,
  title,
}: {
  action: string;
  icon: React.ReactNode;
  onAction: () => void;
  text: string;
  title: string;
}) {
  return (
    <div className="artifact-library-state">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      <button onClick={onAction} type="button">
        {action}
      </button>
    </div>
  );
}
