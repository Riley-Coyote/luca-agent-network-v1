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

import { LIBRARY_KINDS, pickIdOf } from "@/app/shell/placeRails/placePicks";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import {
  HarnessFace,
  LIBRARY_DELETED_FACE,
  LIBRARY_KIND_FACES,
  LIBRARY_SKILLS_FACE,
} from "@/app/shell/placeRails/placeFaces";
import { useKeepPickInAddress } from "@/app/shell/placeRails/usePlaceRails";
import { SkillLibraryPanel } from "@/features/capabilities/ui/SkillLibraryPanel";
import { skillRuntimeLabel } from "@/features/capabilities/lib/skillHandoff";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
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

const LIBRARY_SEARCH_KEYS = ["deleted", "import", "made", "skills"] as const;

export function ArtifactLibraryScreen() {
  const [localView, setLibraryView] = React.useState<"artifacts" | "skills">(
    "artifacts",
  );
  const [query, setQuery] = React.useState("");
  const [localFilter, setFilter] = React.useState<"all" | ArtifactKind>("all");
  const [localDeletedState, setDeletedState] = React.useState<
    "active" | "deleted"
  >("active");
  // Under the shell the rail picks the list, in the address (WP-10,
  // Decided 6): Made by kind, Skills by runtime, or Recently deleted. The
  // mode tabs, kind chips and the deleted toggle go; the search stays.
  const shellFrame = useShellFrameEnabled();
  const { applyPatch, values } = useHistorySearchState(LIBRARY_SEARCH_KEYS);
  const pick = shellFrame
    ? (pickIdOf("library", values as Record<string, unknown>) ?? "made:all")
    : null;
  const pickedKind = LIBRARY_KINDS.find((each) => pick === `made:${each.id}`);
  const libraryView = shellFrame
    ? pick?.startsWith("skills:")
      ? "skills"
      : "artifacts"
    : localView;
  const filter: "all" | ArtifactKind = shellFrame
    ? (pickedKind?.kind ?? "all")
    : localFilter;
  const deletedState = shellFrame
    ? pick === "deleted"
      ? "deleted"
      : "active"
    : localDeletedState;
  const skillsRuntime =
    shellFrame && pick?.startsWith("skills:")
      ? pick.slice("skills:".length)
      : null;
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

  // The rail's Import (at Made's heading) asks through the address, as the
  // Agents page's `+` does; the file picker opens here, where the Canvas is.
  const importRequested = shellFrame && values.import === "file";
  const importArtifact = mutations.importArtifact.mutate;
  // `open` is rebuilt each render; the request is what matters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  React.useEffect(() => {
    if (!importRequested) return;
    applyPatch({ import: null }, { replace: true });
    importArtifact(undefined, {
      onSuccess: (artifact) => {
        if (artifact) open(artifact);
        else setActionMessage("Import cancelled");
      },
      onError: () => setActionMessage("Could not import that file"),
    });
  }, [applyPatch, importArtifact, importRequested]);

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

  const HeadFace =
    pick === "deleted"
      ? LIBRARY_DELETED_FACE
      : libraryView === "skills"
        ? LIBRARY_SKILLS_FACE
        : LIBRARY_KIND_FACES[pickedKind?.id ?? "all"];
  const head = shellFrame ? (
    <PlacePageHead
      eyebrow={
        pick === "deleted"
          ? "Library"
          : libraryView === "skills"
            ? "Skills"
            : "Made"
      }
      face={
        skillsRuntime && skillsRuntime !== "all" ? (
          <HarnessFace runtimeId={skillsRuntime} />
        ) : (
          <HeadFace />
        )
      }
      title={
        pick === "deleted"
          ? "Recently deleted"
          : skillsRuntime && skillsRuntime !== "all"
            ? skillRuntimeLabel(skillsRuntime)
            : (pickedKind?.label ?? "All")
      }
    />
  ) : null;

  // Under the shell the list the rail picked sits on the shared place page
  // (WP-10): the head, the search without an outline, the study's flat rows
  // on the page's axis, and the count as a quiet line under them.
  if (shellFrame) {
    return (
      <main
        className="artifact-library-screen"
        data-luca-floor-host
        data-testid="artifact-library-screen"
      >
        <KeepLibraryPick applyPatch={applyPatch} />
        <div
          className="artifact-library-screen__focal-card relative z-10 bg-background"
          data-luca-conversation-surface
          data-place-pick=""
        >
          {libraryView === "skills" ? (
            <SkillLibraryPanel
              head={head}
              runtimeFilter={skillsRuntime ?? "all"}
            />
          ) : (
            <PlacePage>
              {head}
              <label className="luca-place-search">
                <Search aria-hidden />
                <span className="sr-only">Search Library</span>
                <input
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search artifact titles"
                  value={query}
                />
              </label>
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
              {!library.isLoading &&
              !library.isError &&
              artifacts.length === 0 &&
              deletedState === "deleted" &&
              !deferredQuery ? (
                // Nothing in Recently deleted (its last piece restored, say):
                // said plainly, with nothing to clear.
                <p
                  className="luca-place-page-line"
                  data-testid="library-deleted-empty"
                >
                  Nothing recently deleted.
                </p>
              ) : !library.isLoading &&
                !library.isError &&
                artifacts.length === 0 ? (
                deferredQuery ||
                filter !== "all" ||
                deletedState === "deleted" ? (
                  <LibraryState
                    action="Clear filters"
                    icon={<Search aria-hidden />}
                    onAction={() => {
                      setQuery("");
                      applyPatch({ deleted: null, made: "all", skills: null });
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
                <PlaceList testId="artifact-library-list">
                  {artifacts.map((artifact) => (
                    <PlaceListRow
                      action={
                        artifact.deletedAt ? (
                          <button
                            aria-label={`Restore ${artifact.title}`}
                            onClick={() =>
                              mutations.restoreArtifact.mutate(artifact.id, {
                                onError: () =>
                                  setActionMessage(
                                    "Could not restore artifact",
                                  ),
                              })
                            }
                            type="button"
                          >
                            <RotateCcw aria-hidden />
                            Restore
                          </button>
                        ) : (
                          <>
                            <button
                              aria-label={`${artifact.pinned ? "Unpin" : "Pin"} ${artifact.title}`}
                              data-active={artifact.pinned ? "true" : undefined}
                              onClick={() =>
                                mutations.pinArtifact.mutate(
                                  {
                                    artifactId: artifact.id,
                                    pinned: !artifact.pinned,
                                  },
                                  {
                                    onError: () =>
                                      setActionMessage("Could not update pin"),
                                  },
                                )
                              }
                              type="button"
                            >
                              <Pin aria-hidden />
                            </button>
                            <button
                              aria-label={`Move ${artifact.title} to Recently deleted`}
                              onClick={() =>
                                mutations.deleteArtifact.mutate(artifact.id, {
                                  onError: () =>
                                    setActionMessage(
                                      "Could not move artifact to Recently deleted",
                                    ),
                                })
                              }
                              type="button"
                            >
                              <Trash2 aria-hidden />
                            </button>
                          </>
                        )
                      }
                      data-selected={
                        presentation?.artifactId === artifact.id
                          ? "true"
                          : undefined
                      }
                      key={artifact.id}
                      note={placeNoteTime(artifact.updatedAt)}
                      onOpen={() => open(artifact)}
                      openLabel={`Open ${artifact.title}`}
                      summary={`${artifact.summary ?? kindName(artifact.kind)} · ${formatProvenanceLabel(provenanceLabels(artifact.provenance))}`}
                      testId={`artifact-row-${artifact.id}`}
                      title={artifact.title}
                    />
                  ))}
                </PlaceList>
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
              <p className="luca-place-footnote" data-testid="library-footnote">
                {total} {deletedState === "deleted" ? "deleted " : ""}
                artifacts · stored on this Mac
              </p>
            </PlacePage>
          )}
          {actionMessage ? (
            <div className="artifact-library-notice" role="status">
              {actionMessage}
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      className="artifact-library-screen"
      data-luca-floor-host
      data-testid="artifact-library-screen"
    >
      <div
        className="artifact-library-screen__focal-card relative z-10 bg-background"
        data-luca-conversation-surface
      >
        <header className="artifact-library-screen__header">
          <div>
            <span className="artifact-library-screen__header-label">
              On this Mac
            </span>
            <h1>Library</h1>
            <p>
              {libraryView === "artifacts"
                ? "Artifacts made with your residents, kept across conversations."
                : "Skills your runtimes already know how to use."}
            </p>
          </div>
          {libraryView === "artifacts" ? (
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
          ) : null}
        </header>

        <fieldset className="artifact-library-mode-tabs">
          <legend className="sr-only">Library view</legend>
          <button
            aria-pressed={libraryView === "artifacts"}
            onClick={() => setLibraryView("artifacts")}
            type="button"
          >
            Artifacts
          </button>
          <button
            aria-pressed={libraryView === "skills"}
            onClick={() => setLibraryView("skills")}
            type="button"
          >
            Skills
          </button>
        </fieldset>

        {libraryView === "skills" ? (
          <SkillLibraryPanel />
        ) : (
          <>
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
              {!library.isLoading &&
              !library.isError &&
              artifacts.length === 0 ? (
                deferredQuery ||
                filter !== "all" ||
                deletedState === "deleted" ? (
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
                            onError: () =>
                              setActionMessage("Could not update pin"),
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
                {total} {deletedState === "deleted" ? "deleted " : ""}
                artifacts · stored on this Mac
              </span>
              <span>Bodies load only when Canvas opens</span>
            </footer>
          </>
        )}
        {actionMessage ? (
          <div className="artifact-library-notice" role="status">
            {actionMessage}
          </div>
        ) : null}
      </div>
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

/** A kind's name in sentence case, as the shell's rows say it (WP-19):
 *  "Image", "Markdown", "HTML", never "IMAGE artifact". */
function kindName(kind: ArtifactKind) {
  switch (kind) {
    case "app":
      return "Local application";
    case "html":
    case "svg":
    case "pdf":
      return kind.toUpperCase();
    default:
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  }
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

/** Under the shell the rail picks, and the pick is in the address (WP-10). */
function KeepLibraryPick({
  applyPatch,
}: {
  applyPatch: (
    patch: Record<string, string | null>,
    options?: { replace?: boolean },
  ) => void;
}) {
  useKeepPickInAddress("library", applyPatch);
  return null;
}
