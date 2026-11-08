import { ArrowUpRight, Check, ChevronRight, MessageCircle } from "lucide-react";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { folderName } from "@/app/shell/placeRails/appTask";
import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import {
  HARNESS_NAMES,
  dashboardTaskActive,
  dashboardTaskTime,
  dashboardTaskWord,
} from "./dashboardModel";
import type { HomeContext } from "./HomeCompanion";

export function DashboardWork({
  tasks,
  all,
  onOpen,
  onAsk,
}: {
  tasks: readonly RuntimeTaskProjection[];
  all: boolean;
  onOpen: (task: RuntimeTaskProjection) => void;
  onAsk: (context: HomeContext) => void;
}) {
  const shown = all
    ? tasks
    : tasks
        .filter(
          (task) =>
            dashboardTaskActive(task) || task.state === "awaiting_native",
        )
        .slice(0, 8);
  return (
    <section
      className="pf-home-work"
      aria-label={all ? "All recorded work" : "Work in motion"}
    >
      <div className="pf-home-section-head">
        <h2>
          {all ? "All recorded work" : "Work in motion"}
          <span>{tasks.filter(dashboardTaskActive).length} working</span>
        </h2>
      </div>
      {shown.length ? (
        shown.map((task) => (
          <div className="pf-home-work-row" key={task.taskId}>
            <button
              type="button"
              className="pf-home-work-open"
              onClick={() => onOpen(task)}
            >
              <HarnessFace runtimeId={task.runtimeFamily} size={19} />
              <span className="pf-home-work-title">
                {task.summary}
                <small>
                  {folderName(task.workingFolder)}
                  <span>·</span>
                  {task.currentStep ?? HARNESS_NAMES[task.runtimeFamily]}
                </small>
              </span>
              <span className="pf-home-work-state">
                {dashboardTaskActive(task) ? (
                  <span className="pf-home-working-dot" />
                ) : task.state === "succeeded" ? (
                  <Check size={13} />
                ) : null}
                {dashboardTaskWord(task)}
                <small>{dashboardTaskTime(task.updatedAt)}</small>
              </span>
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              className="pf-home-work-ask"
              aria-label={`Ask Luca about ${task.summary}`}
              onClick={() =>
                onAsk({
                  title: task.summary,
                  runtimeFamily: task.runtimeFamily,
                  taskId: task.taskId,
                })
              }
            >
              <MessageCircle size={15} />
            </button>
          </div>
        ))
      ) : (
        <p className="pf-home-empty">
          {all
            ? "No tasks recorded here yet. Start in a harness workspace, or ask Luca to handle something."
            : "No Polyphonic tasks are running. Saved native sessions remain in their harness workspace."}
        </p>
      )}
    </section>
  );
}

/** Receipt times only: open files never become imaginary work intervals. */
export function DashboardTimeline({
  tasks,
  now,
  onOpen,
}: {
  tasks: readonly RuntimeTaskProjection[];
  now: number;
  onOpen: (task: RuntimeTaskProjection) => void;
}) {
  const start = now - 2 * 60 * 60 * 1000;
  const rows = tasks
    .filter(
      (task) =>
        Number.isFinite(Date.parse(task.startedAt)) &&
        (dashboardTaskActive(task) ||
          Date.parse(task.completedAt ?? task.updatedAt) >= start) &&
        Date.parse(task.startedAt) <= now,
    )
    .slice(0, 8);
  if (!rows.length) return null;
  return (
    <section
      className="pf-home-timeline"
      aria-label="Recorded activity timeline"
    >
      <div className="pf-home-section-head">
        <h2>Today</h2>
        <span className="pf-home-secondary">
          Last two hours · Recorded tasks
        </span>
      </div>
      <div className="pf-home-time-axis">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <span key={fraction}>
            {fraction === 1
              ? "Now"
              : new Date(start + fraction * (now - start)).toLocaleTimeString(
                  undefined,
                  { hour: "numeric", minute: "2-digit" },
                )}
          </span>
        ))}
      </div>
      {rows.map((task) => {
        const from = Math.max(start, Date.parse(task.startedAt));
        const until = Math.min(
          now,
          dashboardTaskActive(task)
            ? now
            : Date.parse(task.completedAt ?? task.updatedAt),
        );
        const left = ((from - start) / (now - start)) * 100;
        const width = Math.max(
          0.4,
          ((Math.max(from, until) - from) / (now - start)) * 100,
        );
        return (
          <div className="pf-home-time-row" key={task.taskId}>
            <span>
              <HarnessFace runtimeId={task.runtimeFamily} size={14} />
              {HARNESS_NAMES[task.runtimeFamily]}
            </span>
            <div className="pf-home-time-track">
              <button
                type="button"
                data-working={dashboardTaskActive(task) || undefined}
                title={`${task.summary} · ${dashboardTaskWord(task)}`}
                aria-label={`${HARNESS_NAMES[task.runtimeFamily]}: ${task.summary}, ${dashboardTaskWord(task)}`}
                onClick={() => onOpen(task)}
                style={{
                  left: `${Math.min(99.6, left)}%`,
                  width: `${Math.min(width, 100 - left)}%`,
                }}
              >
                <span>{folderName(task.workingFolder)}</span>
                {dashboardTaskActive(task) ? <i /> : null}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function DashboardResults({
  tasks,
  onOpen,
}: {
  tasks: readonly RuntimeTaskProjection[];
  onOpen: (task: RuntimeTaskProjection) => void;
}) {
  const results = tasks
    .filter((task) => task.state === "succeeded")
    .slice(0, 4);
  if (!results.length) return null;
  return (
    <section className="pf-home-results" aria-label="Recent results">
      <div className="pf-home-section-head">
        <h2>Ready to pick up</h2>
        <span className="pf-home-secondary">Completed here</span>
      </div>
      <div className="pf-home-result-grid">
        {results.map((task) => (
          <button
            className="pf-home-result"
            type="button"
            onClick={() => onOpen(task)}
            key={task.taskId}
          >
            <div className="pf-home-result-preview">
              <HarnessFace runtimeId={task.runtimeFamily} size={22} />
              <span>
                {task.completedSteps
                  ? `${task.completedSteps} recorded steps`
                  : "Task completed"}
              </span>
              <Check size={14} />
            </div>
            <div className="pf-home-result-description">
              <span>
                <strong>{task.summary}</strong>
                <small>
                  {HARNESS_NAMES[task.runtimeFamily]} ·{" "}
                  {dashboardTaskTime(task.completedAt ?? task.updatedAt)}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DashboardUsage({
  tasks,
  onOpen,
}: {
  tasks: readonly RuntimeTaskProjection[];
  onOpen: (runtime: "claude_code" | "codex") => void;
}) {
  return (
    <div className="pf-home-scroll">
      <div className="pf-home-page-heading">
        <div>
          <span className="pf-home-eyebrow">Recorded on this Mac</span>
          <h1>Usage</h1>
          <p>
            Task receipts are not your provider’s allowance or billing
            statement.
          </p>
        </div>
      </div>
      <div className="pf-home-result-grid">
        {(["claude_code", "codex"] as const).map((runtime) => {
          const own = tasks.filter((task) => task.runtimeFamily === runtime);
          return (
            <section key={runtime} className="pf-home-ask-card">
              <div className="pf-home-card-kicker">
                <HarnessFace runtimeId={runtime} size={20} />
                {HARNESS_NAMES[runtime]}
              </div>
              <h2>{own.length} recorded tasks</h2>
              <p>
                {own.filter(dashboardTaskActive).length} working ·{" "}
                {own.filter((task) => task.state === "succeeded").length}{" "}
                completed
              </p>
              <p>
                Account allowance, remaining credits and total API spending are
                not reported by this connection.
              </p>
              <div className="pf-home-card-actions">
                <button
                  type="button"
                  className="pf-home-action-button"
                  onClick={() => onOpen(runtime)}
                >
                  Open workspace <ArrowUpRight size={13} />
                </button>
              </div>
            </section>
          );
        })}
      </div>
      <p className="pf-home-empty">
        Counts cover the locally retained task receipts, not every session or
        activity in your native apps. Failed, stopped and interrupted work
        remains visible in All work.
      </p>
    </div>
  );
}
