import * as React from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Folder,
  RefreshCw,
  Search,
} from "lucide-react";

import { isHarnessRowOpen, type HarnessRow } from "./model";

function updatedLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
}

export function HarnessSessions({
  rows,
  selectedId,
  loading,
  error,
  truncated,
  notice,
  canStart,
  onSelect,
  onStart,
  onRefresh,
}: {
  rows: readonly HarnessRow[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  notice: string | null;
  canStart: boolean;
  onSelect: (id: string) => void;
  onStart: () => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("All sessions");
  const matches = rows.filter(
    (row) =>
      (filter === "All sessions" || isHarnessRowOpen(row)) &&
      `${row.title} ${row.workspace}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <aside
      className="hws-catalogue"
      aria-label="Session catalogue"
      aria-busy={loading}
    >
      <div className="hws-search">
        <Search size={15} aria-hidden />
        <input
          aria-label="Find a session"
          placeholder="Find a session…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="hws-list-head">
        <label className="hws-filter">
          <span className="sr-only">Filter sessions</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option>All sessions</option>
            <option>Open sessions</option>
          </select>
          <ChevronDown size={12} aria-hidden />
        </label>
        <button
          type="button"
          className="hws-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh sessions"
        >
          <RefreshCw size={13} aria-hidden />
        </button>
      </div>
      <div className="hws-session-groups">
        {error ? (
          <div className="hws-empty-list" role="alert">
            <h2>Sessions couldn’t be refreshed</h2>
            <p>{error}</p>
            <button type="button" onClick={onRefresh}>
              Try again
            </button>
          </div>
        ) : loading && !rows.length ? (
          <div className="hws-empty-list" role="status">
            <p>Reading local sessions…</p>
          </div>
        ) : !rows.length ? (
          <div className="hws-empty-list">
            <Folder size={20} aria-hidden />
            <h2>No sessions yet</h2>
            <p>Start a task in a project. Its conversation stays here.</p>
            <button type="button" onClick={onStart} disabled={!canStart}>
              Start your first task
            </button>
          </div>
        ) : !matches.length ? (
          <div className="hws-empty-list">
            <h2>No matching sessions</h2>
            <p>Try a project name or a few words from the task.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("All sessions");
              }}
            >
              Clear search
            </button>
          </div>
        ) : (
          ["Open now", "Earlier"].map((group) => {
            const groupRows = matches.filter(
              (row) => isHarnessRowOpen(row) === (group === "Open now"),
            );
            return groupRows.length ? (
              <section key={group} aria-label={group}>
                <h2>
                  {group}
                  <span>{groupRows.length}</span>
                </h2>
                {groupRows.map((row) => (
                  <button
                    className="hws-session-row"
                    type="button"
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    aria-current={selectedId === row.id ? "true" : undefined}
                  >
                    <span className="hws-session-title">
                      <span className="hws-state-icon" data-state={row.state}>
                        {row.state === "working" ? (
                          <span className="hws-running" />
                        ) : row.state === "waiting" ? (
                          <Circle size={11} />
                        ) : row.state === "saved" ? (
                          <Clock3 size={12} />
                        ) : row.state === "ready" ? (
                          <Check size={12} />
                        ) : (
                          <Circle size={11} />
                        )}
                      </span>
                      <span>{row.title}</span>
                    </span>
                    <span className="hws-session-meta">
                      <span className="hws-session-project">
                        {row.workspace}
                      </span>
                      <span title={row.updatedAt ?? undefined}>
                        {updatedLabel(row.updatedAt)}
                      </span>
                    </span>
                    <span
                      className="hws-session-activity"
                      data-waiting={row.state === "waiting" || undefined}
                    >
                      {row.activity}
                    </span>
                  </button>
                ))}
              </section>
            ) : null;
          })
        )}
      </div>
      <div className="hws-catalogue-foot">
        <span>
          {rows.length} sessions & task receipts · On this Mac
          {truncated ? " · Limited list" : ""}
        </span>
        {notice ? <p>{notice}</p> : null}
      </div>
    </aside>
  );
}
