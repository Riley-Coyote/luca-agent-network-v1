import * as React from "react";
import { createPortal } from "react-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  Download,
  Folder,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createBuzzQueryClient } from "@/shared/api/queryClient";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Markdown } from "@/shared/ui/markdown";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_THEME_NAME,
  PAPER_THEME_NAME,
} from "@/shared/theme/theme-loader";
import {
  DEFAULT_DESIGN,
  designBrief,
  HARNESS_STUDY_KEY,
  normalizeDesign,
  PROJECTS,
  SESSIONS,
  type StudyDesign,
  type StudySession,
  type Turn,
} from "./fixtures";
import "./harnessDashboardStudy.css";
import { Usage, Connection } from "./HarnessInformation";
import { HomeStudy } from "./HomeStudy";
import { HomeNavigation } from "./HomeNavigation";

type View = "Sessions" | "Usage" | "Connection";
type Saved = {
  id: string;
  name: string;
  createdAt: string;
  design: StudyDesign;
};

/** A lab-only portal into the real app's harness page. Production is unchanged. */
export function HarnessDashboardStudy() {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [client] = React.useState(createBuzzQueryClient);
  const [router] = React.useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: StudyRoot }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    }),
  );
  React.useEffect(() => {
    let attached: HTMLElement | null = null;
    const find = () => {
      if (attached?.isConnected) return;
      const target = document.querySelector<HTMLElement>(
        '[data-testid="connected-app-card"]',
      );
      if (target === attached) return;
      attached = target;
      setHost(target);
    };
    const observer = new MutationObserver(find);
    observer.observe(document.getElementById("root") ?? document.body, {
      childList: true,
      subtree: true,
    });
    find();
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    host?.classList.add("hds-host");
    return () => host?.classList.remove("hds-host");
  }, [host]);
  return (
    <>
      <HomeNavigation />
      {host
        ? createPortal(
            <QueryClientProvider client={client}>
              <RouterProvider router={router} />
            </QueryClientProvider>,
            host,
          )
        : null}
    </>
  );
}

function readSaved(): { design: StudyDesign; saved: Saved[]; error: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(HARNESS_STUDY_KEY) ?? "null");
    return {
      design: normalizeDesign(raw?.design),
      saved: Array.isArray(raw?.saved)
        ? raw.saved
            .filter((s: Saved) => typeof s?.name === "string")
            .map((s: Saved) => ({
              id: typeof s.id === "string" ? s.id : crypto.randomUUID(),
              createdAt:
                typeof s.createdAt === "string"
                  ? s.createdAt
                  : new Date().toISOString(),
              name: s.name,
              design: normalizeDesign(s.design),
            }))
        : [],
      error: "",
    };
  } catch {
    return {
      design: DEFAULT_DESIGN,
      saved: [],
      error:
        "Saved settings could not be read. The preview still works; export the brief to keep your choices.",
    };
  }
}

function StudyRoot() {
  return (
    <HomeStudy
      renderWorkspace={(runtime, session, state) => (
        <Dashboard
          key={`${runtime}:${session ?? "catalogue"}`}
          runtime={runtime}
          initialSession={session}
          initialState={state}
        />
      )}
    />
  );
}

function Dashboard({
  runtime = "claude_code",
  initialSession,
  initialState,
}: {
  runtime?: "claude_code" | "codex";
  initialSession?: string;
  initialState?: "working" | "waiting" | "ready";
}) {
  const name = runtime === "codex" ? "Codex" : "Claude Code";
  const seedSessions = React.useCallback(
    () =>
      structuredClone(SESSIONS).map((s) => ({
        ...s,
        ...(s.id === initialSession && initialState
          ? {
              state: initialState,
              activity:
                initialState === "waiting"
                  ? "Waiting for your reply"
                  : initialState === "working"
                    ? "Continuing this task"
                    : "Ready for a follow-up",
            }
          : {}),
        origin: s.origin === "Claude Code" ? name : s.origin,
        turns: s.turns.map((t) => ({
          ...t,
          role: t.role === "Claude Code" ? name : t.role,
        })),
      })) as StudySession[],
    [name, initialSession, initialState],
  );
  const [initial] = React.useState(readSaved);
  const [design, setDesign] = React.useState(initial.design);
  const [saved, setSaved] = React.useState(initial.saved);
  const [tools, setTools] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [storageError, setStorageError] = React.useState(initial.error);
  const [copy, setCopy] = React.useState(false);
  const [view, setView] = React.useState<View>("Sessions");
  const [sessions, setSessions] = React.useState<StudySession[]>(() =>
    seedSessions(),
  );
  const [selected, setSelected] = React.useState<string | null>(
    initialSession ?? "onboarding",
  );
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("All sessions");
  const [mobileDetail, setMobileDetail] = React.useState(
    Boolean(initialSession),
  );
  const [newTask, setNewTask] = React.useState(false);
  const [project, setProject] = React.useState(PROJECTS[0]);
  const [billing, setBilling] = React.useState(
    runtime === "codex" ? "Subscription" : "API key",
  );
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  const { isDark, setTheme } = useTheme();
  const current = sessions.find((s) => s.id === selected);
  const empty = sessions.length === 0;
  const disconnected = design.scene === "disconnected";
  const matches = sessions.filter(
    (s) =>
      (filter === "All sessions" || s.state !== "saved") &&
      `${s.title} ${s.project}`.toLowerCase().includes(query.toLowerCase()),
  );

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  React.useEffect(() => {
    if (initial.error) return;
    try {
      localStorage.setItem(
        HARNESS_STUDY_KEY,
        JSON.stringify({ schema: 1, design, saved }),
      );
      setStorageError("");
    } catch {
      setStorageError(
        "Saving is unavailable. Export the brief to keep this direction.",
      );
    }
  }, [design, saved, initial.error]);
  React.useEffect(() => {
    setSessions(design.scene === "empty" ? [] : seedSessions());
    if (design.scene === "approval") {
      setSelected("release");
      setMobileDetail(true);
    }
    if (design.scene === "working") setSelected(initialSession ?? "onboarding");
    setNewTask(false);
  }, [design.scene, initialSession, seedSessions]);

  const update = (id: string, patch: Partial<StudySession>) =>
    setSessions((all) =>
      all.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  function openSession(id: string) {
    setSelected(id);
    setNewTask(false);
    setMobileDetail(true);
    setMenu(false);
  }
  function startTask() {
    setView("Sessions");
    setNewTask(true);
    setMobileDetail(true);
    setMenu(false);
  }
  async function send(content: string) {
    if (busy || disconnected) return;
    let id = current?.id;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "You", content };
    if (newTask) {
      id = crypto.randomUUID();
      setSessions((all) => [
        {
          id: id as string,
          title: content.replace(/[#*`]/g, "").slice(0, 72),
          project,
          branch: "current branch",
          state: "working",
          origin: "You",
          updated: "Now",
          activity: "Reading your task",
          context: 1,
          turns: [userTurn],
        },
        ...all,
      ]);
      setSelected(id);
      setNewTask(false);
    } else if (current && current.state !== "saved") {
      update(current.id, {
        state: "working",
        activity: "Reading your follow-up",
        updated: "Now",
        turns: [...current.turns, userTurn],
      });
    } else return;
    const target = id;
    setBusy(true);
    timer.current = setTimeout(() => {
      setSessions((all) =>
        all.map((s) =>
          s.id === target
            ? {
                ...s,
                state: "ready",
                activity: "Ready for a follow-up",
                turns: [
                  ...s.turns,
                  {
                    id: crypto.randomUUID(),
                    role: name,
                    content: `Your message reached this same session in the preview. In the app, ${name} would continue here with this project and its existing context.\n\nNo harness was run and no files were changed.`,
                  },
                ],
              }
            : s,
        ),
      );
      setBusy(false);
    }, 850);
  }
  function resume() {
    if (!current) return;
    update(current.id, {
      state: "ready",
      activity: "Ready for a follow-up",
      updated: "Now",
    });
    setNotice(
      "Preview: continued the original session, keeping its project and history.",
    );
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    if (current)
      update(current.id, {
        state: "ready",
        activity: "Stopped · ready for a follow-up",
      });
    setNotice("Preview: stopped this session only.");
  }

  return (
    <section
      className="hds"
      data-density={design.density}
      data-detail={mobileDetail || newTask || undefined}
      aria-label={`${name} workspace preview`}
    >
      <div className="hds-lab-strip">
        <span>
          Design preview{" "}
          <span className="hds-lab-long">
            · Simulated sessions & usage · Browser glass
          </span>
        </span>
        <button
          type="button"
          onClick={() => setTools(!tools)}
          aria-expanded={tools}
        >
          <Settings2 size={13} /> Design lab
        </button>
      </div>
      <div className="hds-heading">
        <PlacePageHead
          face={<HarnessFace runtimeId={runtime} />}
          title={name}
          state={
            disconnected
              ? "Connection needs attention"
              : "On this Mac · Example connection"
          }
          action={
            <button
              className="hds-primary"
              type="button"
              onClick={startTask}
              disabled={disconnected}
            >
              <Plus size={15} /> New task
            </button>
          }
        />
      </div>
      <div className="hds-navigation">
        <nav aria-label="Harness sections">
          {(["Sessions", "Usage", "Connection"] as View[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              aria-current={view === tab ? "page" : undefined}
            >
              {tab}
              {tab === "Sessions" &&
                !empty &&
                !disconnected &&
                sessions.some((s) => s.state === "waiting") && (
                  <span
                    className="hds-nav-count"
                    title="Sessions needing approval"
                  >
                    {sessions.filter((s) => s.state === "waiting").length || ""}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <button
          className="hds-account"
          type="button"
          onClick={() => setView("Usage")}
        >
          {billing === "API key" ? "$2.84 today · API" : "Subscription"}{" "}
          <ChevronDown size={12} />
        </button>
      </div>
      {disconnected && (
        <div className="hds-connection-warning">
          <span>Claude Code isn’t connected. Saved sessions stay here.</span>
          <button type="button" onClick={() => setView("Connection")}>
            Review connection <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {view === "Sessions" ? (
        <div className="hds-workspace">
          <aside className="hds-catalogue" aria-label="Session catalogue">
            <div className="hds-search">
              <Search size={15} />
              <input
                aria-label="Find a session"
                placeholder="Find a session…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="hds-list-head">
              <label className="hds-filter">
                <span className="sr-only">Filter sessions</span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option>All sessions</option>
                  <option>Open sessions</option>
                </select>
                <ChevronDown size={12} />
              </label>
              <span>{empty ? 0 : matches.length}</span>
            </div>
            {empty ? (
              <div className="hds-empty-list">
                <Folder size={20} />
                <h2>No sessions yet</h2>
                <p>Start a task in a project. Its conversation stays here.</p>
                <button type="button" onClick={startTask}>
                  Start your first task <ArrowUpRight size={13} />
                </button>
              </div>
            ) : (
              <div className="hds-session-groups">
                {["Open now", "Earlier"].map((group) => {
                  const rows = matches.filter(
                    (s) => (s.state === "saved") === (group === "Earlier"),
                  );
                  return rows.length ? (
                    <section key={group} aria-label={group}>
                      <h2>
                        {group}
                        <span>{rows.length}</span>
                      </h2>
                      {rows.map((s) => (
                        <button
                          className="hds-session-row"
                          type="button"
                          key={s.id}
                          onClick={() => openSession(s.id)}
                          aria-current={
                            selected === s.id && !newTask ? "true" : undefined
                          }
                        >
                          <span className="hds-session-title">
                            <span
                              className="hds-state-icon"
                              data-state={s.state}
                            >
                              {s.state === "working" ? (
                                <span className="hds-running" />
                              ) : s.state === "waiting" ? (
                                <Circle size={11} />
                              ) : s.state === "saved" ? (
                                <Clock3 size={12} />
                              ) : (
                                <Check size={12} />
                              )}
                            </span>
                            <span>{s.title}</span>
                          </span>
                          <span className="hds-session-meta">
                            {s.project}
                            <span>{s.updated}</span>
                          </span>
                          <span
                            className="hds-session-activity"
                            data-waiting={s.state === "waiting" || undefined}
                          >
                            {s.activity}
                          </span>
                        </button>
                      ))}
                    </section>
                  ) : null;
                })}
                {!matches.length && (
                  <div className="hds-empty-list">
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
                )}
              </div>
            )}
            <div className="hds-catalogue-foot">
              <span>{empty ? 0 : sessions.length} sessions · On this Mac</span>
            </div>
          </aside>
          <section
            className="hds-session-detail"
            aria-label={newTask ? "New task" : "Selected session"}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                className="hds-detail-inner"
                key={newTask ? "new" : (current?.id ?? "empty")}
                initial={{ opacity: reduced ? 1 : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: reduced ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.12 }}
              >
                {((current || newTask) && !empty) || newTask ? (
                  <>
                    <header className="hds-detail-head">
                      <button
                        className="hds-back"
                        type="button"
                        onClick={() => setMobileDetail(false)}
                        aria-label="Back to sessions"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <div>
                        <h2>{newTask ? "New task" : current?.title}</h2>
                        <p>
                          <Folder size={12} />
                          {newTask ? project : current?.project}
                          <span>·</span>
                          {newTask ? "Choose a project below" : current?.branch}
                        </p>
                      </div>
                      {!newTask && (
                        <div className="hds-menu-wrap">
                          <button
                            className="hds-icon-button"
                            type="button"
                            aria-label="Session actions"
                            aria-expanded={menu}
                            onClick={() => setMenu(!menu)}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {menu && (
                            <div className="hds-session-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setNotice(
                                    "Preview only: the app would open this exact session in Claude Code.",
                                  );
                                  setMenu(false);
                                }}
                              >
                                Open in {name} <ArrowUpRight size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNotice(
                                    "Preview only: this would copy the exact session reference.",
                                  );
                                  setMenu(false);
                                }}
                              >
                                Copy session reference <Copy size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </header>
                    {newTask ? (
                      <div className="hds-new-task">
                        <h3>What would you like to work on?</h3>
                        <p>
                          Start a {name} session in the right project. You can
                          follow it here or return to it later.
                        </p>
                        <label>
                          Project
                          <select
                            aria-label="Project"
                            value={project}
                            onChange={(e) => setProject(e.target.value)}
                          >
                            {PROJECTS.map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                        <div className="hds-new-options">
                          <span>
                            Model <strong>{name} default</strong>
                          </span>
                          <span>
                            Permissions <strong>Project defaults</strong>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <section
                        className="hds-transcript"
                        aria-label="Session messages"
                      >
                        <div className="hds-transcript-origin">
                          <span>
                            {current?.origin === "Luca"
                              ? "Luca started this task"
                              : current?.origin === "You"
                                ? "Started in Polyphonic"
                                : `From ${name}`}
                          </span>
                        </div>
                        {current?.turns.map((turn) => (
                          <article
                            className="hds-turn"
                            key={turn.id}
                            data-role={turn.role}
                          >
                            <h3>{turn.role}</h3>
                            <Markdown content={turn.content} />
                          </article>
                        ))}
                        {current?.state === "working" && (
                          <div className="hds-work-line">
                            <span className="hds-running" />
                            {current.activity}
                            <button type="button" onClick={stop}>
                              <Square size={10} /> Stop
                            </button>
                          </div>
                        )}
                      </section>
                    )}
                    {current?.state === "waiting" &&
                      current.id === "release" &&
                      !newTask && (
                        <section
                          className="hds-ask"
                          aria-label="Approval request"
                        >
                          <div>
                            <ShieldCheck size={17} />
                            <h3>Run the focused tests?</h3>
                          </div>
                          <p>
                            Only in Polyphonic. No publishing or installed-app
                            changes.
                          </p>
                          <code>pnpm test conversation</code>
                          <div className="hds-ask-actions">
                            <button
                              type="button"
                              onClick={() => {
                                update(current.id, {
                                  state: "ready",
                                  activity: "Test run declined",
                                });
                                setNotice("Preview: declined this test run.");
                              }}
                            >
                              Not now
                            </button>
                            <button
                              className="hds-primary"
                              type="button"
                              onClick={() => {
                                update(current.id, {
                                  state: "working",
                                  activity: "Running focused tests",
                                });
                                setNotice(
                                  "Preview: approved this request once. No command was run.",
                                );
                              }}
                            >
                              Allow once
                            </button>
                          </div>
                          <small>
                            Example request owned by Polyphonic. Native-owned
                            approvals open in {name}.
                          </small>
                        </section>
                      )}
                    {current?.state === "saved" && !newTask ? (
                      <div className="hds-resume">
                        <div>
                          <h3>Pick up where you left off</h3>
                          <p>
                            Continue this session with its original project and
                            context.
                          </p>
                        </div>
                        <button
                          className="hds-primary"
                          type="button"
                          onClick={resume}
                          disabled={disconnected}
                        >
                          <Play size={13} /> Continue session
                        </button>
                      </div>
                    ) : (
                      <div className="hds-composer">
                        <div className="hds-composer-target">
                          <span>
                            {newTask
                              ? `New session in ${project}`
                              : `To this session · ${current?.project}`}
                          </span>
                          {newTask ? (
                            <span>{name} default</span>
                          ) : (
                            <span
                              className="hds-context"
                              title={`${(current?.context ?? 0) * 2}K of 200K example context tokens; not your account allowance`}
                            >
                              <meter
                                aria-label="Example session context used"
                                min={0}
                                max={100}
                                value={current?.context ?? 0}
                              />
                              {current?.context}% context
                            </span>
                          )}
                        </div>
                        <MessageComposer
                          key={newTask ? "new-task" : current?.id}
                          channelId={null}
                          channelName={name}
                          draftKey={`harness-study:${runtime}:${newTask ? "new" : current?.id}`}
                          placeholder={
                            newTask
                              ? "Describe your task…"
                              : "Message this session…"
                          }
                          disabled={disconnected}
                          isSending={busy}
                          showTopBorder={false}
                          onSend={send}
                        />
                        <div className="sr-only">
                          Preview only · messages stay in this browser
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="hds-no-detail">
                    <HarnessFace runtimeId={runtime} />
                    <h2>Your {name} workspace</h2>
                    <p>
                      Start a task, or choose a session to pick up its
                      conversation.
                    </p>
                    <button
                      className="hds-primary"
                      type="button"
                      onClick={startTask}
                    >
                      New task <Plus size={14} />
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      ) : view === "Usage" ? (
        <Usage billing={billing} />
      ) : (
        <Connection
          billing={billing}
          setBilling={setBilling}
          disconnected={disconnected}
          reconnect={() => {
            setDesign({ ...design, scene: "working" });
            setNotice(
              "Preview: connection restored. No real credentials were used.",
            );
          }}
          explain={(value) => setNotice(value)}
        />
      )}
      {notice && (
        <div className="hds-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {tools && (
        <aside className="hds-tools" aria-label="Harness design lab">
          <header>
            <h2>Harness workspace</h2>
            <button
              type="button"
              aria-label="Close design lab"
              onClick={() => setTools(false)}
            >
              <X size={16} />
            </button>
          </header>
          <p>
            One direction in the current production shell. All data and actions
            are simulated.
          </p>
          <label>
            Scene
            <select
              aria-label="Scene"
              value={design.scene}
              onChange={(e) =>
                setDesign({
                  ...design,
                  scene: e.target.value as StudyDesign["scene"],
                })
              }
            >
              <option value="working">Working</option>
              <option value="approval">Needs approval</option>
              <option value="empty">No sessions</option>
              <option value="disconnected">Disconnected</option>
            </select>
          </label>
          <label>
            Session density
            <select
              aria-label="Session density"
              value={design.density}
              onChange={(e) =>
                setDesign({
                  ...design,
                  density: e.target.value as StudyDesign["density"],
                })
              }
            >
              <option>comfortable</option>
              <option>compact</option>
            </select>
          </label>
          <label>
            Appearance
            <select
              aria-label="Appearance"
              value={isDark ? "dark" : "light"}
              onChange={(e) =>
                setTheme(
                  e.target.value === "dark"
                    ? DEFAULT_THEME_NAME
                    : PAPER_THEME_NAME,
                )
              }
            >
              <option value="dark">Night</option>
              <option value="light">Day</option>
            </select>
          </label>
          <div className="hds-save">
            <input
              aria-label="Name this view"
              placeholder="Name this view"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <button
              type="button"
              disabled={!saveName.trim()}
              onClick={() => {
                setSaved([
                  ...saved,
                  {
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    name: saveName.trim(),
                    design: { ...design },
                  },
                ]);
                setSaveName("");
              }}
            >
              Save
            </button>
          </div>
          {saved.map((s, i) => (
            <div className="hds-saved" key={s.id}>
              <button type="button" onClick={() => setDesign(s.design)}>
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={() => setSaved(saved.filter((_, n) => n !== i))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {storageError && <p role="alert">{storageError}</p>}
          <button type="button" onClick={() => setDesign(DEFAULT_DESIGN)}>
            Reset direction
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(designBrief(design));
                setCopy(true);
              } catch {
                setCopy(false);
                setStorageError(
                  "Copy unavailable. Select the brief below and copy it manually.",
                );
              }
            }}
          >
            {copy ? <Check size={13} /> : <Copy size={13} />}
            {copy ? "Copied" : "Copy design brief"}
          </button>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        schema: 1,
                        project: "Polyphonic",
                        design,
                        brief: designBrief(design),
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "polyphonic-harness-workspace.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={13} />
            Export direction
          </button>
          <details>
            <summary>Design brief</summary>
            <pre>{designBrief(design)}</pre>
          </details>
        </aside>
      )}
    </section>
  );
}
