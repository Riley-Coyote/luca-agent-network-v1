import {
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  ChevronDown,
  Clock3,
  Code2,
  FileImage,
  FileText,
  History,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import * as React from "react";

import type {
  ArtifactKind,
  ArtifactRecord,
  ArtifactView,
} from "@/features/artifacts/types";
import { ArtifactPreview } from "@/features/artifacts/ui/ArtifactPreview";
import { cn } from "@/shared/lib/cn";

import "./artifact-workspace.css";

const FILTERS: readonly { label: string; value: "all" | ArtifactKind }[] = [
  { label: "All", value: "all" },
  { label: "Prototypes", value: "html" },
  { label: "Images", value: "image" },
  { label: "Documents", value: "markdown" },
  { label: "Code", value: "code" },
] as const;

function KindIcon({ kind }: { kind: ArtifactKind }) {
  switch (kind) {
    case "html":
      return <LayoutTemplate aria-hidden />;
    case "image":
      return <FileImage aria-hidden />;
    case "code":
      return <Code2 aria-hidden />;
    case "markdown":
    case "pdf":
      return <FileText aria-hidden />;
  }
}

function kindLabel(artifact: ArtifactRecord) {
  if (artifact.kind === "html") return "HTML prototype";
  if (artifact.kind === "markdown") return "Markdown";
  if (artifact.kind === "image") return "Image";
  if (artifact.kind === "code") return artifact.language ?? "Code";
  return "PDF";
}

export function ArtifactWorkspace({
  artifacts,
  initialArtifactId,
}: {
  artifacts: readonly ArtifactRecord[];
  initialArtifactId: string;
}) {
  const [selectedId, setSelectedId] = React.useState(initialArtifactId);
  const [view, setView] = React.useState<ArtifactView>("preview");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | ArtifactKind>("all");
  const [libraryOpen, setLibraryOpen] = React.useState(true);
  const selected =
    artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0];
  const visibleArtifacts = artifacts.filter((artifact) => {
    const matchesFilter = filter === "all" || artifact.kind === filter;
    const haystack =
      `${artifact.title} ${artifact.author} ${artifact.project}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  });

  function selectArtifact(id: string) {
    setSelectedId(id);
    setView("preview");
    if (window.matchMedia("(max-width: 760px)").matches) setLibraryOpen(false);
  }

  return (
    <section className="artifact-workspace" data-testid="artifact-workspace">
      <aside
        className={cn(
          "artifact-library",
          !libraryOpen && "artifact-library--closed",
        )}
      >
        <header className="artifact-library__header">
          <div>
            <span className="artifact-kicker">Created work</span>
            <h1>Library</h1>
            <p>{artifacts.length} things kept across conversations</p>
          </div>
          <button
            aria-label="Import artifact"
            className="artifact-icon-button"
            type="button"
          >
            <Plus aria-hidden />
          </button>
        </header>

        <label className="artifact-search">
          <Search aria-hidden />
          <span className="sr-only">Search Library</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search Library"
            value={query}
          />
          <kbd>⌘K</kbd>
        </label>

        <fieldset className="artifact-filters">
          <legend className="sr-only">Artifact filters</legend>
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

        <div className="artifact-list">
          {visibleArtifacts.map((artifact) => (
            <button
              aria-pressed={artifact.id === selected.id}
              className="artifact-row"
              data-selected={artifact.id === selected.id ? "true" : "false"}
              key={artifact.id}
              onClick={() => selectArtifact(artifact.id)}
              type="button"
            >
              <span className="artifact-row__icon">
                <KindIcon kind={artifact.kind} />
              </span>
              <span className="artifact-row__copy">
                <strong>{artifact.title}</strong>
                <span>
                  {artifact.author} · {artifact.updatedAt}
                </span>
              </span>
              <span className="artifact-row__version">
                v{artifact.versions[0].number}
              </span>
            </button>
          ))}
          {visibleArtifacts.length === 0 ? (
            <div className="artifact-list__empty">
              <Search aria-hidden />
              <p>Nothing in Library matches this view.</p>
              <button
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
                type="button"
              >
                Clear search
              </button>
            </div>
          ) : null}
        </div>

        <footer className="artifact-library__footer">
          <span>
            <Clock3 aria-hidden /> Updated locally
          </span>
          <button type="button">Recently deleted</button>
        </footer>
      </aside>

      <div className="artifact-canvas">
        <header className="artifact-canvas__header">
          <button
            className="artifact-canvas__back"
            onClick={() => setLibraryOpen(true)}
            type="button"
          >
            Library
          </button>
          <div className="artifact-canvas__identity">
            <span className="artifact-kicker">
              {kindLabel(selected)} · {selected.project}
            </span>
            <h2>{selected.title}</h2>
            <p>{selected.summary}</p>
          </div>
          <div className="artifact-canvas__actions">
            <button className="artifact-quiet-button" type="button">
              <ArrowUpRight aria-hidden /> Open conversation
            </button>
            <button
              aria-label="Export artifact"
              className="artifact-icon-button"
              type="button"
            >
              <ArrowDownToLine aria-hidden />
            </button>
            <button
              aria-label="More artifact actions"
              className="artifact-icon-button"
              type="button"
            >
              <MoreHorizontal aria-hidden />
            </button>
          </div>
        </header>

        <div className="artifact-canvas__bar">
          <div
            aria-label="Artifact view"
            className="artifact-tabs"
            role="tablist"
          >
            {(["preview", "source", "versions"] as const).map((item) => (
              <button
                aria-selected={view === item}
                className={cn(view === item && "is-active")}
                key={item}
                onClick={() => setView(item)}
                role="tab"
                type="button"
              >
                {item === "preview"
                  ? "Preview"
                  : item === "source"
                    ? "Source"
                    : "Versions"}
                {item === "versions" ? (
                  <span>{selected.versions.length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <button className="artifact-version-picker" type="button">
            v{selected.versions[0].number} · current <ChevronDown aria-hidden />
          </button>
        </div>

        <div className="artifact-canvas__body">
          {view === "preview" ? (
            <div className="artifact-preview">
              <ArtifactPreview artifact={selected} />
            </div>
          ) : null}
          {view === "source" ? (
            <div className="artifact-source">
              <div className="artifact-source__header">
                <span>
                  <Braces aria-hidden /> {selected.title}
                </span>
                <span>{selected.sizeLabel}</span>
              </div>
              <pre>
                <code>
                  {selected.versions[0].source ||
                    "Source preview is unavailable for this file."}
                </code>
              </pre>
            </div>
          ) : null}
          {view === "versions" ? (
            <div className="artifact-versions">
              <header>
                <History aria-hidden />
                <div>
                  <h3>Version history</h3>
                  <p>
                    Every change remains available. Restoring creates another
                    version.
                  </p>
                </div>
              </header>
              <ol>
                {selected.versions.map((version, index) => (
                  <li key={version.id}>
                    <span className="artifact-version__number">
                      {version.number}
                    </span>
                    <div>
                      <div className="artifact-version__title">
                        <strong>Version {version.number}</strong>
                        {index === 0 ? <span>Current</span> : null}
                      </div>
                      <p>{version.note}</p>
                      <small>
                        {version.createdAt} · {version.sizeLabel} ·{" "}
                        {selected.author}
                      </small>
                    </div>
                    {index > 0 ? (
                      <button type="button">Restore as new</button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        <footer className="artifact-canvas__footer">
          <div>
            <span className="artifact-author-mark" aria-hidden>
              {selected.author.slice(0, 1)}
            </span>
            <span>
              Created by <strong>{selected.author}</strong> in{" "}
              <button type="button">#{selected.conversation}</button>
            </span>
          </div>
          <span>{selected.sizeLabel} · stored on this Mac</span>
        </footer>
      </div>
    </section>
  );
}
