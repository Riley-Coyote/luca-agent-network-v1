import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  LayoutGrid,
  MessageCircle,
  Moon,
  Plus,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Markdown } from "@/shared/ui/markdown";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_THEME_NAME,
  PAPER_THEME_NAME,
} from "@/shared/theme/theme-loader";
import {
  ActivityTimeline,
  HomeTools,
  HomeUsage,
  readDesign,
} from "./HomeSections";
import { HOME_KEY, HOME_NAMES, HOME_WORK, type Runtime } from "./homeFixtures";
import "./homeStudy.css";
import "./homePanels.css";
import {
  goHomeStudy,
  useHomeStudyDestination,
  type HomeView,
} from "./HomeNavigation";

type ChatTurn = { id: string; role: "You" | "Luca"; content: string };
type Selection = { title: string; runtime: Runtime; id: string };

/** An isolated, synthetic Home inside the current production shell. */
export function HomeStudy({
  renderWorkspace,
}: {
  renderWorkspace: (
    runtime: Runtime,
    session?: string,
    state?: "working" | "waiting" | "ready",
  ) => React.ReactNode;
}) {
  const [initial] = React.useState(readDesign);
  const [design, setDesign] = React.useState(initial.design);
  const [saved, setSaved] = React.useState(initial.saved);
  const { view, session: inspected } = useHomeStudyDestination();
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [tools, setTools] = React.useState(false);
  const [dialog, setDialog] = React.useState<
    "approval" | "question" | "result" | "grok" | null
  >(null);
  const [approved, setApproved] = React.useState(false);
  const [declined, setDeclined] = React.useState(false);
  const [answered, setAnswered] = React.useState(false);
  const [questionAnswer, setQuestionAnswer] = React.useState(
    "Keep the existing index and refresh only changed notes.",
  );
  const [chat, setChat] = React.useState(false);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const replyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScroll = React.useRef<HTMLDivElement>(null);
  const modalRef = React.useRef<HTMLDialogElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const { isDark, setTheme } = useTheme();
  const reduced = useReducedMotion();
  const quiet = design.scene === "quiet";
  const empty = design.scene === "empty";
  const disconnected = design.scene === "disconnected";
  const needs =
    empty || quiet || disconnected ? 0 : Number(!approved) + Number(!answered);

  React.useEffect(() => {
    if (initial.error) return;
    try {
      localStorage.setItem(
        HOME_KEY,
        JSON.stringify({ schema: 1, design, saved }),
      );
    } catch {
      setNotice(
        "This browser could not save the direction. Copy or export it from Design lab.",
      );
    }
  }, [design, saved, initial.error]);
  React.useEffect(() => {
    document.documentElement.setAttribute(
      "data-home-preview",
      view === "claude_code"
        ? "Claude Code"
        : view === "codex"
          ? "Codex"
          : "Home",
    );
    return () => document.documentElement.removeAttribute("data-home-preview");
  }, [view]);
  React.useEffect(
    () => () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    },
    [],
  );
  React.useEffect(() => {
    if (turns.length)
      chatScroll.current?.scrollTo({
        top: chatScroll.current.scrollHeight,
        behavior: "instant",
      });
  }, [turns.length]);
  React.useEffect(() => {
    if (dialog) {
      returnFocus.current = document.activeElement as HTMLElement;
      modalRef.current?.showModal();
    } else {
      modalRef.current?.close();
      returnFocus.current?.focus();
    }
  }, [dialog]);

  function open(runtime: Runtime, id?: string) {
    goHomeStudy(runtime, id);
  }
  function askAbout(title: string, runtime: Runtime, id: string) {
    setSelection({ title, runtime, id });
    setChat(true);
  }
  async function send(content: string) {
    if (busy) return;
    const context = selection;
    setTurns((all) => [
      ...all,
      {
        id: crypto.randomUUID(),
        role: "You",
        content: context
          ? `${content}\n\n*About: ${context.title} · ${HOME_NAMES[context.runtime]}*`
          : content,
      },
    ]);
    setSelection(null);
    setChat(true);
    setBusy(true);
    replyTimer.current = setTimeout(() => {
      setTurns((all) => [
        ...all,
        {
          id: crypto.randomUUID(),
          role: "Luca",
          content: context
            ? `I’d take this back to the existing ${HOME_NAMES[context.runtime]} session for **${context.title.toLowerCase()}**, so its project and history stay together. You could keep following it here.\n\nThis is a design preview—nothing was sent to a harness.`
            : "I can help you keep track of work across your tools, follow up in the right session, or start something new in a project.\n\nIn this preview, I’m only showing how that conversation would feel. No agents are running.",
        },
      ]);
      setBusy(false);
    }, 700);
  }
  function returnHome(next: HomeView) {
    goHomeStudy(next);
  }
  const transition = {
    duration: reduced ? 0 : 0.18,
    ease: [0.2, 0.8, 0.2, 1] as const,
  };

  return (
    <section
      className="hds hds-home"
      data-density={design.density}
      data-luca-open={chat || undefined}
      aria-label="Polyphonic Home preview"
    >
      <header className="home-bar">
        <nav aria-label="Home sections">
          <button
            type="button"
            aria-current={view === "overview" ? "page" : undefined}
            onClick={() => returnHome("overview")}
          >
            <LayoutGrid size={15} />
            Overview
          </button>
          <button
            type="button"
            aria-current={view === "work" ? "page" : undefined}
            onClick={() => returnHome("work")}
          >
            All work
          </button>
          <button
            type="button"
            aria-current={view === "usage" ? "page" : undefined}
            onClick={() => returnHome("usage")}
          >
            Usage
          </button>
        </nav>
        <div className="home-bar-tools">
          <span className="home-preview-label">
            Design preview · Sample data
          </span>
          <button
            type="button"
            className="home-icon-button"
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
          <button
            type="button"
            aria-label="Open Home design lab"
            onClick={() => setTools(true)}
          >
            <Settings2 size={15} />
            <span className="home-lab-label">Design lab</span>
          </button>
        </div>
      </header>
      <div className="home-body">
        <div className="home-main">
          {view === "claude_code" || view === "codex" ? (
            <div className="home-harness-detail">
              <div className="home-breadcrumb">
                <button type="button" onClick={() => returnHome("overview")}>
                  <ArrowLeft size={14} />
                  Overview
                </button>
                <span>/</span>
                <span>{HOME_NAMES[view]}</span>
                <button
                  type="button"
                  className="home-breadcrumb-luca"
                  onClick={() =>
                    askAbout(
                      inspected
                        ? (HOME_WORK.find((w) => w.id === inspected)?.title ??
                            "Verify the release candidate")
                        : `${HOME_NAMES[view]} workspace`,
                      view,
                      inspected ?? "onboarding",
                    )
                  }
                >
                  <MessageCircle size={14} />
                  Ask Luca
                </button>
              </div>
              {renderWorkspace(
                view,
                inspected,
                inspected === "search"
                  ? quiet
                    ? "ready"
                    : answered
                      ? "working"
                      : "waiting"
                  : inspected === "release"
                    ? approved
                      ? declined
                        ? "ready"
                        : "working"
                      : "waiting"
                    : quiet
                      ? "ready"
                      : undefined,
              )}
            </div>
          ) : view === "usage" ? (
            <HomeUsage open={open} />
          ) : (
            <div
              className={
                view === "overview"
                  ? "home-scroll home-overview"
                  : "home-scroll"
              }
            >
              <div className="home-page-heading">
                <div>
                  <span className="home-eyebrow">
                    Friday, November 6 <span>·</span> On this Mac
                  </span>
                  <h1>
                    {view === "work"
                      ? "All your work."
                      : empty
                        ? "Start with Luca."
                        : disconnected
                          ? "Claude Code needs a reconnect."
                          : needs
                            ? `${needs === 1 ? "One thing needs" : "Two things need"} you.`
                            : quiet
                              ? "You’re caught up."
                              : "Your work is moving."}
                  </h1>
                  <p>
                    {view === "work"
                      ? "The original sessions, together. Open any one to pick up its context."
                      : empty
                        ? "Connect a tool or tell Luca what you’d like to work on."
                        : disconnected
                          ? "Your saved work is safe. Codex is still available."
                          : needs
                            ? approved
                              ? "Codex has a question about the search index."
                              : answered
                                ? "Vektor is waiting to run the focused tests."
                                : "A test run is waiting. There’s a question about the search index."
                            : "Nothing is waiting on you. Pick up a result, or start something with Luca."}
                  </p>
                </div>
                <button
                  type="button"
                  className="home-text-button"
                  onClick={() => setTools(true)}
                >
                  Customize <Settings2 size={14} />
                </button>
              </div>
              {empty ? (
                <section className="home-start">
                  <HarnessFace runtimeId="claude_code" size={30} />
                  <h2>Bring your tools together.</h2>
                  <p>
                    This preview starts with Claude Code and Codex. Connecting a
                    tool in the app would require your approval.
                  </p>
                  <button
                    type="button"
                    className="hds-primary"
                    onClick={() => setDesign({ ...design, scene: "working" })}
                  >
                    Explore a sample day
                    <ArrowRight size={15} />
                  </button>
                </section>
              ) : (
                <>
                  {view === "overview" && needs > 0 && (
                    <section className="home-attention" aria-label="Needs you">
                      {!approved && (
                        <article className="home-ask-card">
                          <div className="home-card-kicker">
                            <HarnessFace runtimeId="claude_code" size={16} />
                            <span>
                              Claude Code<span> · Polyphonic</span>
                            </span>
                            <span className="home-card-time">2m</span>
                          </div>
                          <h2>Run the focused tests?</h2>
                          <p>
                            Vektor is ready to check the candidate. No
                            publishing or installed-app changes.
                          </p>
                          <div className="home-card-actions">
                            <button
                              type="button"
                              className="home-quiet-button"
                              onClick={() => setDialog("approval")}
                            >
                              Review
                            </button>
                            <button
                              type="button"
                              className="home-action-button"
                              onClick={() => {
                                setApproved(true);
                                setNotice(
                                  "Preview: approved once. No command was run.",
                                );
                              }}
                            >
                              Allow once
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        </article>
                      )}
                      {!answered && (
                        <article className="home-ask-card">
                          <div className="home-card-kicker">
                            <HarnessFace runtimeId="codex" size={16} />
                            <span>
                              Codex<span> · Field Notes</span>
                            </span>
                            <span className="home-card-time">4m</span>
                          </div>
                          <h2>Keep the existing search index?</h2>
                          <p>
                            Codex can refresh changed notes without rebuilding
                            everything. It needs your preference.
                          </p>
                          <div className="home-card-actions">
                            <button
                              type="button"
                              className="home-quiet-button"
                              onClick={() =>
                                askAbout(
                                  "Keep search fast as the library grows",
                                  "codex",
                                  "search",
                                )
                              }
                            >
                              Ask Luca
                            </button>
                            <button
                              type="button"
                              className="home-action-button"
                              onClick={() => setDialog("question")}
                            >
                              Answer
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        </article>
                      )}
                    </section>
                  )}
                  {view === "overview" && (
                    <section
                      className="home-harnesses"
                      aria-label="Harness workspaces"
                    >
                      {(["claude_code", "codex"] as Runtime[]).map(
                        (runtime) => (
                          <button
                            type="button"
                            key={runtime}
                            className="home-harness"
                            onClick={() =>
                              disconnected && runtime === "claude_code"
                                ? setNotice(
                                    "Preview: reconnect in Claude Code’s Connection tab. No credentials are read here.",
                                  )
                                : open(runtime)
                            }
                          >
                            <HarnessFace runtimeId={runtime} size={23} />
                            <span className="home-harness-name">
                              {HOME_NAMES[runtime]}
                              <small>
                                {disconnected && runtime === "claude_code"
                                  ? "Reconnect needed"
                                  : quiet
                                    ? "Available"
                                    : runtime === "claude_code"
                                      ? `${approved ? (declined ? "1 working" : "2 working") : "1 working · 1 waiting"}`
                                      : `${answered ? "1 working" : "1 waiting on you"}`}
                              </small>
                            </span>
                            <ArrowUpRight size={15} />
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        className="home-harness"
                        onClick={() => setDialog("grok")}
                      >
                        <HarnessFace runtimeId="grok" size={23} />
                        <span className="home-harness-name">
                          GrokBot<small>Proposed connection</small>
                        </span>
                        <Plus size={15} />
                      </button>
                    </section>
                  )}
                  <section className="home-work" aria-label="Work in motion">
                    <div className="home-section-head">
                      <h2>
                        {view === "work" ? "Sessions" : "Work in motion"}
                        <span>
                          {quiet
                            ? "0 working"
                            : `${Number(!disconnected) + Number(answered) + Number(approved && !declined)} working`}
                        </span>
                      </h2>
                      <button
                        type="button"
                        onClick={() =>
                          view === "work" ? setChat(true) : returnHome("work")
                        }
                      >
                        {view === "work" ? "New task with Luca" : "All work"}
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    {HOME_WORK.filter(
                      (w) => view === "work" || w.state !== "done",
                    ).map((w) => (
                      <div key={w.id} className="home-work-row">
                        <button
                          type="button"
                          className="home-work-open"
                          onClick={() => open(w.runtime, w.id)}
                        >
                          <HarnessFace runtimeId={w.runtime} size={19} />
                          <span className="home-work-title">
                            {w.title}
                            <small>
                              {w.project}
                              <span>·</span>
                              {w.agent}
                              <span>·</span>
                              {disconnected && w.runtime === "claude_code"
                                ? "Connection unavailable · Last known activity"
                                : quiet
                                  ? "Ready for a follow-up"
                                  : w.runtime === "codex" && !answered
                                    ? "Waiting for your preference"
                                    : w.detail}
                            </small>
                          </span>
                          <span className="home-work-state">
                            {quiet ||
                            w.state === "done" ||
                            (w.runtime === "codex" && !answered) ? (
                              <Check size={13} />
                            ) : (
                              <span className="hds-running" />
                            )}
                            {disconnected && w.runtime === "claude_code"
                              ? "Unavailable"
                              : quiet
                                ? "Ready"
                                : w.state === "done"
                                  ? "Done"
                                  : w.runtime === "codex" && !answered
                                    ? "Waiting"
                                    : "Working"}
                            <small>{w.time}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                        <button
                          type="button"
                          className="home-work-ask"
                          aria-label={`Ask Luca about ${w.title}`}
                          onClick={() => askAbout(w.title, w.runtime, w.id)}
                        >
                          <MessageCircle size={15} />
                        </button>
                      </div>
                    ))}
                    {approved && (
                      <div className="home-inline-update" role="status">
                        <Check size={13} />
                        <span>
                          {declined
                            ? "Test run declined. The session is ready for a follow-up."
                            : "Test run approved once. Vektor is continuing in the same session."}
                        </span>
                        <button
                          type="button"
                          onClick={() => open("claude_code", "release")}
                        >
                          Open
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                    )}
                  </section>
                  {view === "overview" && design.timeline && (
                    <ActivityTimeline
                      quiet={quiet}
                      codexWaiting={!answered}
                      open={open}
                    />
                  )}
                  {view === "overview" && design.results && (
                    <section
                      className="home-results"
                      aria-label="Recent results"
                    >
                      <div className="home-section-head">
                        <h2>Ready to pick up</h2>
                        <span className="home-secondary">
                          Since you last checked
                        </span>
                      </div>
                      <div className="home-result-grid">
                        <button
                          type="button"
                          className="home-result"
                          onClick={() => setDialog("result")}
                        >
                          <div
                            className="home-result-preview home-preview-flow"
                            aria-hidden="true"
                          >
                            <span>Connect</span>
                            <ArrowRight size={15} />
                            <span>Meet Luca</span>
                            <ArrowRight size={15} />
                            <span>Start</span>
                          </div>
                          <div className="home-result-description">
                            <span>
                              <strong>A simpler first meeting</strong>
                              <small>Vektor · Polyphonic · 18m ago</small>
                            </span>
                            <ArrowUpRight size={15} />
                          </div>
                        </button>
                        <button
                          type="button"
                          className="home-result"
                          onClick={() => open("claude_code", "capture")}
                        >
                          <div
                            className="home-result-preview home-preview-note"
                            aria-hidden="true"
                          >
                            <FileText size={19} />
                            <div>
                              <span>A note, without the setup.</span>
                              <i />
                              <i />
                            </div>
                            <Check size={14} />
                          </div>
                          <div className="home-result-description">
                            <span>
                              <strong>Quick capture is ready to try</strong>
                              <small>Claude Code · Field Notes · 12m ago</small>
                            </span>
                            <ArrowUpRight size={15} />
                          </div>
                        </button>
                      </div>
                    </section>
                  )}
                  {view === "overview" && design.journal && (
                    <section className="home-journal">
                      <div className="home-section-head">
                        <h2>Luca’s journal</h2>
                        <span className="home-secondary">
                          Optional module · Sample entry
                        </span>
                      </div>
                      <p>
                        “The same friction came up in two projects today: having
                        to organize something before you can begin. I’m keeping
                        that in mind when we look at the next first-run flow.”
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setChat(true);
                          setNotice(
                            "Preview: this journal is a design example. Mnemos is not connected.",
                          );
                        }}
                      >
                        Talk about this
                        <MessageCircle size={14} />
                      </button>
                    </section>
                  )}
                </>
              )}
              <footer className="home-freshness">
                <span>
                  <span className="home-fresh-dot" />
                  Sample activity · Just now
                </span>
                <span>No live accounts or private history</span>
              </footer>
            </div>
          )}
          {!chat && view !== "claude_code" && view !== "codex" && (
            <div className="home-dock">
              <div className="home-dock-heading">
                <span>Luca</span>
                <button type="button" onClick={() => setChat(true)}>
                  Open conversation
                  <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="hds-composer home-composer">
                <MessageComposer
                  channelId={null}
                  channelName="Luca"
                  draftKey="home-study:luca"
                  placeholder="Ask Luca to handle something…"
                  showTopBorder={false}
                  onSend={send}
                />
              </div>
            </div>
          )}
        </div>
        <AnimatePresence initial={false}>
          {chat && (
            <motion.aside
              className="home-luca"
              aria-label="Luca conversation"
              initial={{ opacity: 0, width: reduced ? 340 : 0 }}
              animate={{ opacity: 1, width: 340 }}
              exit={{ opacity: 0, width: reduced ? 340 : 0 }}
              transition={transition}
            >
              <div className="home-luca-inner">
                <header>
                  <div>
                    <MessageCircle size={16} />
                    <span>
                      Luca<small>Your companion</small>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="home-icon-button"
                    aria-label="Close Luca conversation"
                    onClick={() => setChat(false)}
                  >
                    <X size={16} />
                  </button>
                </header>
                <div className="home-luca-messages" ref={chatScroll}>
                  <div className="home-luca-intro">
                    <span className="home-eyebrow">Luca</span>
                    <p>
                      {needs
                        ? "I’m following the work here. There’s a test run waiting for your approval and a question from Codex. Want me to help with either?"
                        : "You’re caught up. I’m here if you want to pick up a result or start something new."}
                    </p>
                  </div>
                  {turns.map((turn) => (
                    <article
                      key={turn.id}
                      className="home-chat-turn"
                      data-role={turn.role}
                    >
                      <span>{turn.role}</span>
                      <Markdown content={turn.content} />
                    </article>
                  ))}
                  {busy && (
                    <div className="home-chat-working" role="status">
                      <span className="hds-running" />
                      Thinking
                    </div>
                  )}
                </div>
                <div className="home-luca-foot">
                  {selection && (
                    <div className="home-context-chip">
                      <HarnessFace runtimeId={selection.runtime} size={13} />
                      <span>{selection.title}</span>
                      <button
                        type="button"
                        aria-label="Remove selected work context"
                        onClick={() => setSelection(null)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <div className="hds-composer home-composer">
                    <MessageComposer
                      channelId={null}
                      channelName="Luca"
                      draftKey="home-study:luca"
                      placeholder={
                        selection ? "Ask about this task…" : "Message Luca…"
                      }
                      showTopBorder={false}
                      isSending={busy}
                      onSend={send}
                    />
                  </div>
                  <small>Same Luca conversation · Preview only</small>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      {notice && (
        <div className="home-toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss preview notice"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        ref={modalRef}
        className="home-dialog"
        onCancel={() => setDialog(null)}
        onClose={() => setDialog(null)}
        aria-labelledby="home-dialog-title"
      >
        <button
          type="button"
          className="home-dialog-close"
          aria-label="Close preview dialog"
          onClick={() => setDialog(null)}
        >
          <X size={17} />
        </button>
        {dialog === "approval" ? (
          <>
            <div className="home-dialog-kicker">
              <HarnessFace runtimeId="claude_code" />
              Claude Code · Polyphonic
            </div>
            <h2 id="home-dialog-title">Run the focused tests?</h2>
            <p>
              Vektor wants to check the conversation changes in the current
              project. This does not publish anything or change the installed
              app.
            </p>
            <code>pnpm test conversation</code>
            <small>
              Example approval owned by Polyphonic. An approval owned by a
              native app would open there.
            </small>
            <div className="home-dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setApproved(true);
                  setDialog(null);
                  setNotice("Preview: request declined. No command was run.");
                  setDeclined(true);
                }}
              >
                Not now
              </button>
              <button
                type="button"
                className="hds-primary"
                onClick={() => {
                  setApproved(true);
                  setDialog(null);
                  setNotice("Preview: approved once. No command was run.");
                }}
              >
                Allow once
              </button>
            </div>
          </>
        ) : dialog === "question" ? (
          <>
            <div className="home-dialog-kicker">
              <HarnessFace runtimeId="codex" />
              Codex · Field Notes
            </div>
            <h2 id="home-dialog-title">Keep the existing search index?</h2>
            <p>
              “I can reuse the index and update just the new or changed notes.
              Should I preserve the current index or start from scratch?”
            </p>
            <label>
              Your reply
              <textarea
                value={questionAnswer}
                onChange={(e) => setQuestionAnswer(e.target.value)}
                rows={3}
              />
            </label>
            <div className="home-dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="hds-primary"
                disabled={!questionAnswer.trim()}
                onClick={() => {
                  setAnswered(true);
                  setDialog(null);
                  setNotice(
                    "Preview: reply added to the same Codex session. No message was sent.",
                  );
                }}
              >
                Send reply
                <ArrowUpRight size={14} />
              </button>
            </div>
          </>
        ) : dialog === "grok" ? (
          <>
            <div className="home-dialog-kicker">
              <HarnessFace runtimeId="grok" />
              Proposed integration
            </div>
            <h2 id="home-dialog-title">A place for GrokBot, too.</h2>
            <p>
              The intended experience is the same: see its work here, start
              tasks and continue the right session.
            </p>
            <p>
              GrokBot session control and access to X still need capability
              verification. This mock does not connect to GrokBot, Grok or your
              social accounts.
            </p>
            <div className="home-dialog-actions">
              <button
                type="button"
                className="hds-primary"
                onClick={() => setDialog(null)}
              >
                Back to overview
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="home-dialog-kicker">
              <FileText size={17} />
              Vektor · Sample result
            </div>
            <h2 id="home-dialog-title">A simpler first meeting</h2>
            <p>
              The proposed flow keeps the required connection step, then moves
              setup into the conversation with Luca.
            </p>
            <ol>
              <li>Connect your chosen harness.</li>
              <li>Meet Luca and talk about what you need.</li>
              <li>Review optional observation and background work once.</li>
            </ol>
            <div className="home-dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setDialog(null);
                  askAbout(
                    "Finish the first-run setup",
                    "claude_code",
                    "onboarding",
                  );
                }}
              >
                Ask Luca
              </button>
              <button
                type="button"
                className="hds-primary"
                onClick={() => {
                  setDialog(null);
                  open("claude_code", "onboarding");
                }}
              >
                Open source session
                <ArrowUpRight size={14} />
              </button>
            </div>
          </>
        )}
      </dialog>
      {tools && (
        <HomeTools
          design={design}
          setDesign={setDesign}
          saved={saved}
          setSaved={setSaved}
          storageError={initial.error}
          close={() => setTools(false)}
        />
      )}
    </section>
  );
}
