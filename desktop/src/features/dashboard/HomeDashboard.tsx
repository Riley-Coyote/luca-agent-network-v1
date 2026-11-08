import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import {
  ArrowUpRight,
  LayoutGrid,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
} from "lucide-react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { PermissionAsk, QuestionAsk } from "@/app/shell/placeRails/ManagedAsks";
import { useNeedsYou } from "@/app/shell/placeRails/useNeedsYou";
import {
  ALL_RUNTIME_TASKS_KEY,
  useAllRuntimeTasks,
} from "@/features/capabilities/useAllRuntimeTasks";
import { useRuntimeConnectionsQuery } from "@/features/runtime-sessions/hooks";
import {
  listAllRuntimeTasks,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_THEME_NAME,
  PAPER_THEME_NAME,
} from "@/shared/theme/theme-loader";
import { useCompanionHome } from "./useCompanionHome";
import { HomeNativeSessions } from "./HomeNativeSessions";
import {
  HomeCompanion,
  useHomeConversation,
  type HomeContext,
} from "./HomeCompanion";
import {
  DashboardResults,
  DashboardTimeline,
  DashboardUsage,
  DashboardWork,
} from "./DashboardSections";
import {
  HARNESS_NAMES,
  dashboardSummary,
  dashboardTaskActive,
  dashboardContextForScope,
  type DashboardTab,
} from "./dashboardModel";
import "./dashboard.css";
import "./dashboardPanels.css";

function useVisibleClock() {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!document.hidden) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 60_000);
      }
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return now;
}

/** Approved Home composition, driven only by real task receipts and existing asks. */
export function HomeDashboard({
  aboutTaskId,
  initialContext,
}: {
  aboutTaskId?: string;
  initialContext?: HomeContext;
}) {
  const companion = useCompanionHome();
  const queryClient = useQueryClient();
  const tasks = useAllRuntimeTasks();
  const taskQuery = useQuery({
    queryKey: ALL_RUNTIME_TASKS_KEY,
    queryFn: listAllRuntimeTasks,
    enabled: false,
  });
  const connections = useRuntimeConnectionsQuery();
  const needs = useNeedsYou();
  const [tab, setTab] = React.useState<DashboardTab>("overview");
  const [chat, setChat] = React.useState(
    Boolean(aboutTaskId || initialContext),
  );
  const [paneLeaving, setPaneLeaving] = React.useState(false);
  const setChatOpen = React.useCallback((next: boolean) => {
    if (!next) setPaneLeaving(true);
    setChat(next);
  }, []);
  const [context, setContext] = React.useState<HomeContext | null>(
    dashboardContextForScope(initialContext, companion.contextScope),
  );
  const contextKey = JSON.stringify(
    dashboardContextForScope(initialContext, companion.contextScope),
  );
  const previousScope = React.useRef(companion.contextScope);
  React.useEffect(() => {
    if (previousScope.current === companion.contextScope) return;
    previousScope.current = companion.contextScope;
    setContext(null);
    setChat(false);
    setPaneLeaving(false);
  }, [companion.contextScope]);
  React.useEffect(() => {
    const next = JSON.parse(contextKey) as HomeContext | null;
    if (next) {
      setContext(next);
      setChat(true);
    }
  }, [contextKey]);
  const [modules, setModules] = React.useState({
    timeline: true,
    results: true,
  });
  const preferencesKey = `polyphonic-home-v1:${companion.scope}`;
  const loadedPreferences = React.useRef("");
  React.useEffect(() => {
    loadedPreferences.current = "";
    try {
      const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
      setModules({
        timeline: saved?.timeline !== false,
        results: saved?.results !== false,
      });
    } catch {
      setModules({ timeline: true, results: true });
    }
    loadedPreferences.current = preferencesKey;
  }, [preferencesKey]);
  const changeModule = (key: "timeline" | "results", value: boolean) => {
    const next = { ...modules, [key]: value };
    setModules(next);
    if (loadedPreferences.current === preferencesKey)
      try {
        localStorage.setItem(preferencesKey, JSON.stringify(next));
      } catch {
        /* Live choice survives this view; no authority stored. */
      }
  };
  const selectedTask = tasks.find((task) => task.taskId === aboutTaskId);
  const appliedTask = React.useRef("");
  React.useEffect(() => {
    const selection = `${companion.contextScope}:${aboutTaskId ?? ""}`;
    if (!aboutTaskId) {
      appliedTask.current = "";
      return;
    }
    if (selectedTask && appliedTask.current !== selection) {
      appliedTask.current = selection;
      setContext({
        title: selectedTask.summary,
        origin: companion.contextScope,
        runtimeFamily: selectedTask.runtimeFamily,
        taskId: selectedTask.taskId,
      });
      setChat(true);
    }
  }, [selectedTask, companion.contextScope, aboutTaskId]);
  const conversation = useHomeConversation(companion, chat);
  const { goChannel, goNeedsYou, goAgents } = useAppNavigation();
  const navigate = useNavigate();
  const { isDark, setTheme } = useTheme();
  const now = useVisibleClock();
  const openRuntime = (
    runtime: "claude_code" | "codex",
    task?: RuntimeTaskProjection,
  ) =>
    void navigate({
      to: "/apps/$appId",
      params: { appId: runtime === "claude_code" ? "claude" : "codex" },
      search: task ? { task: task.taskId } : {},
    } as never);
  const openTask = (task: RuntimeTaskProjection) =>
    openRuntime(task.runtimeFamily, task);
  const ask = (next: HomeContext) => {
    setContext({ ...next, origin: companion.contextScope });
    setChat(true);
  };
  const attention = [
    ...needs.permissions.map((pending) => ({
      kind: "permission" as const,
      pending,
    })),
    ...needs.questions.map((pending) => ({
      kind: "question" as const,
      pending,
    })),
  ].slice(0, 6);
  const dock = (
    <HomeCompanion
      companion={companion}
      conversation={conversation}
      open={chat}
      setOpen={setChatOpen}
      context={dashboardContextForScope(context, companion.contextScope)}
      clearContext={() => setContext(null)}
    />
  );
  return (
    <section
      className="pf-dashboard"
      data-testid="home-dashboard"
      data-luca-open={chat || paneLeaving || undefined}
      aria-label="Polyphonic Home"
    >
      <header className="pf-home-bar">
        <nav aria-label="Home sections">
          {(["overview", "work", "usage"] as const).map((next) => (
            <button
              type="button"
              key={next}
              aria-current={tab === next ? "page" : undefined}
              onClick={() => setTab(next)}
            >
              {next === "overview" ? <LayoutGrid size={15} /> : null}
              {next === "overview"
                ? "Overview"
                : next === "work"
                  ? "All work"
                  : "Usage"}
            </button>
          ))}
        </nav>
        <div className="pf-home-bar-tools">
          <button
            type="button"
            className="pf-home-icon-button"
            aria-label="Refresh recorded work"
            disabled={taskQuery.isFetching}
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: ["harness-sessions"],
              });
              void connections.refetch();
              void taskQuery.refetch();
            }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="pf-home-icon-button"
            aria-label={
              isDark
                ? "Switch to light appearance"
                : "Switch to dark appearance"
            }
            onClick={() =>
              setTheme(isDark ? PAPER_THEME_NAME : DEFAULT_THEME_NAME)
            }
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      <div className="pf-home-body">
        <div className="pf-home-main">
          {tab === "usage" ? (
            <DashboardUsage tasks={tasks} onOpen={openRuntime} />
          ) : (
            <div
              className={`pf-home-scroll${tab === "overview" ? " pf-home-overview" : ""}`}
            >
              <div className="pf-home-page-heading">
                <div>
                  <span className="pf-home-eyebrow">
                    {new Date(now).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                    <span>·</span>On this Mac
                  </span>
                  <h1>
                    {tab === "work"
                      ? "All your work."
                      : taskQuery.isError
                        ? "Work status needs a refresh."
                        : taskQuery.isPending
                          ? "Loading your work…"
                          : dashboardSummary(tasks, needs.count)}
                  </h1>
                  <p>
                    {tab === "work"
                      ? "Recorded tasks and sessions in your current native profiles."
                      : needs.count
                        ? "Review what’s waiting, or ask Luca to help with the next step."
                        : tasks.length
                          ? "Follow the work across your tools, or pick up a result with Luca."
                          : "Connect your chosen harness and tell Luca what you’d like to work on."}
                  </p>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="pf-home-text-button">
                      Customize <Settings2 size={14} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-56 space-y-3 text-sm"
                  >
                    <p className="font-medium">Home modules</p>
                    {(["timeline", "results"] as const).map((key) => (
                      <label className="flex items-center gap-2" key={key}>
                        <input
                          type="checkbox"
                          checked={modules[key]}
                          onChange={(e) =>
                            changeModule(key, e.currentTarget.checked)
                          }
                        />
                        {key === "timeline"
                          ? "Activity timeline"
                          : "Recent results"}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
              {taskQuery.isError ? (
                <p className="pf-home-card-error" role="alert">
                  Recorded tasks could not be refreshed. Any previously loaded
                  receipts are shown below; this does not mean the work stopped.
                </p>
              ) : null}
              {tab === "overview" && needs.count > 0 ? (
                <section className="pf-home-attention" aria-label="Needs you">
                  {attention.map(({ kind, pending }) => {
                    const common = {
                      "data-testid": `home-${kind}-${pending.pendingId}`,
                      onOpen: () =>
                        void goChannel(pending.request.conversationId),
                    };
                    return (
                      <article
                        className="pf-home-ask-card"
                        key={`${kind}:${pending.pendingId}`}
                      >
                        <ul>
                          {kind === "permission" ? (
                            <PermissionAsk
                              common={common}
                              pending={pending}
                              summary="Waiting for your approval"
                            />
                          ) : (
                            <QuestionAsk
                              common={common}
                              pending={pending}
                              summary="Waiting for your answer"
                            />
                          )}
                        </ul>
                      </article>
                    );
                  })}
                  {needs.count > attention.length ? (
                    <article className="pf-home-ask-card">
                      <h2>{needs.count - attention.length} more waiting</h2>
                      <p>
                        Task proposals and agent exchanges keep their existing
                        review controls.
                      </p>
                      <div className="pf-home-card-actions">
                        <button
                          type="button"
                          className="pf-home-action-button"
                          onClick={() => void goNeedsYou()}
                        >
                          Review all <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </article>
                  ) : null}
                </section>
              ) : null}
              {tab === "overview" ? (
                <section
                  className="pf-home-harnesses"
                  aria-label="Harness workspaces"
                >
                  {(["claude_code", "codex"] as const).map((runtime) => {
                    const status = connections.data?.find(
                      (entry) => entry.runtimeId === runtime,
                    );
                    const running = tasks.filter(
                      (task) =>
                        task.runtimeFamily === runtime &&
                        dashboardTaskActive(task),
                    ).length;
                    return (
                      <button
                        type="button"
                        key={runtime}
                        className="pf-home-harness"
                        onClick={() => openRuntime(runtime)}
                      >
                        <HarnessFace runtimeId={runtime} size={23} />
                        <span className="pf-home-harness-name">
                          {HARNESS_NAMES[runtime]}
                          <small>
                            {running
                              ? `${running} working here`
                              : connections.isError
                                ? "Status unavailable"
                                : !status
                                  ? connections.isLoading
                                    ? "Checking connection…"
                                    : "Not connected"
                                  : status.readiness === "ready" &&
                                      status.authentication === "ready"
                                    ? "Available on this Mac"
                                    : (status.reason ??
                                      "Connection needs attention")}
                          </small>
                        </span>
                        <ArrowUpRight size={15} />
                      </button>
                    );
                  })}
                </section>
              ) : null}
              {!companion.ready && !companion.isLoading ? (
                <section className="pf-home-start">
                  <h2>Set up your companion.</h2>
                  <p>
                    Luca’s conversation is where your requests and returned
                    results stay together.
                  </p>
                  <button
                    type="button"
                    className="pf-home-action-button"
                    onClick={() => void goAgents()}
                  >
                    Open Agents <ArrowUpRight size={13} />
                  </button>
                </section>
              ) : null}
              <DashboardWork
                tasks={tasks}
                all={tab === "work"}
                onOpen={openTask}
                onAsk={ask}
              />
              {tab === "work" ? (
                <HomeNativeSessions
                  companion={companion}
                  tasks={tasks}
                  onOpen={(runtime, session) =>
                    void navigate({
                      to: "/apps/$appId",
                      params: {
                        appId: runtime === "claude_code" ? "claude" : "codex",
                      },
                      search: { session: session.selectionKey },
                    })
                  }
                />
              ) : null}
              {tab === "overview" && modules.timeline ? (
                <DashboardTimeline tasks={tasks} now={now} onOpen={openTask} />
              ) : null}
              {tab === "overview" && modules.results ? (
                <DashboardResults tasks={tasks} onOpen={openTask} />
              ) : null}
              <footer className="pf-home-freshness">
                <span>
                  {taskQuery.isError
                    ? "Last loaded receipts"
                    : taskQuery.dataUpdatedAt
                      ? `Updated ${new Date(taskQuery.dataUpdatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                      : "Loading local receipts"}
                </span>
                <span>
                  Open a harness workspace for session history and actions.
                </span>
              </footer>
            </div>
          )}
          {!chat && !paneLeaving ? dock : null}
        </div>
        <AnimatePresence
          initial={false}
          onExitComplete={() => setPaneLeaving(false)}
        >
          {chat ? (
            <React.Fragment key="luca-pane">{dock}</React.Fragment>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
