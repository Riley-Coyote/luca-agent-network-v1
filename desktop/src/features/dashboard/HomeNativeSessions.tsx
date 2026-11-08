import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import {
  listHarnessSessions,
  type HarnessRuntimeFamily,
  type HarnessSession,
} from "@/shared/api/tauriHarnessDashboard";
import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import type { useCompanionHome } from "./useCompanionHome";
import { HARNESS_NAMES, dashboardTaskTime } from "./dashboardModel";

/** Metadata only. Selecting a row opens its harness; it never reads or continues it here. */
export function HomeNativeSessions({
  companion,
  tasks,
  onOpen,
}: {
  companion: ReturnType<typeof useCompanionHome>;
  tasks: readonly RuntimeTaskProjection[];
  onOpen: (runtime: HarnessRuntimeFamily, session: HarnessSession) => void;
}) {
  const [visible, setVisible] = React.useState(!document.hidden);
  React.useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const catalogues = useQueries({
    queries: (["claude_code", "codex"] as const).map((runtimeFamily) => ({
      queryKey: [
        "harness-sessions",
        runtimeFamily,
        companion.channel?.id ?? null,
        companion.residentPubkey,
        companion.scope,
      ],
      queryFn: () =>
        listHarnessSessions(
          runtimeFamily,
          companion.channel?.id ?? "",
          companion.residentPubkey ?? "",
        ),
      enabled: visible && Boolean(companion.channel && companion.ready),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const recorded = new Set(tasks.map((task) => task.taskId));
  return (
    <section className="pf-home-work" aria-label="Native session catalogue">
      <div className="pf-home-section-head">
        <h2>Native sessions</h2>
      </div>
      {catalogues.map((catalogue, index) => {
        const runtime = index === 0 ? "claude_code" : "codex";
        const sessions = (catalogue.data?.sessions ?? []).filter(
          (session) =>
            !session.latestTaskId || !recorded.has(session.latestTaskId),
        );
        return (
          <React.Fragment key={runtime}>
            {catalogue.isError ? (
              <p className="pf-home-card-error" role="status">
                {HARNESS_NAMES[runtime]} sessions could not be read. Open its
                workspace to retry.
              </p>
            ) : null}
            {catalogue.isLoading ? (
              <p className="pf-home-empty">
                Loading {HARNESS_NAMES[runtime]} sessions…
              </p>
            ) : null}
            {sessions.map((session) => (
              <div className="pf-home-work-row" key={session.selectionKey}>
                <button
                  type="button"
                  className="pf-home-work-open"
                  onClick={() => onOpen(runtime, session)}
                >
                  <HarnessFace runtimeId={runtime} size={19} />
                  <span className="pf-home-work-title">
                    {session.title}
                    <small>{session.workspace || HARNESS_NAMES[runtime]}</small>
                  </span>
                  <span className="pf-home-work-state">
                    {session.liveState === "live"
                      ? "Open in native app"
                      : session.liveState === "saved"
                        ? "Saved session"
                        : "Activity unknown"}
                    <small>
                      {session.updatedAt
                        ? dashboardTaskTime(session.updatedAt)
                        : "Time unavailable"}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </div>
            ))}
            {catalogue.data?.truncated ? (
              <p className="pf-home-card-error">
                Showing the most recent {HARNESS_NAMES[runtime]} sessions.
              </p>
            ) : null}
          </React.Fragment>
        );
      })}
      {catalogues.every(
        (query) => query.isSuccess && !query.data.sessions.length,
      ) ? (
        <p className="pf-home-empty">
          No native sessions found in your current profiles.
        </p>
      ) : null}
    </section>
  );
}
