import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import { StudyTools, useStudyDesign } from "./StudyTools";
import "./agentSpaceStudy.css";
export { AGENT_SPACE_KEY } from "./design";

const TABS = [
  "Overview",
  "Companion",
  "Notebook",
  "Identity",
  "Settings",
] as const;
type Tab = (typeof TABS)[number];
type Source = {
  name: string;
  icon: string;
  on: boolean;
  notes: boolean;
  description: string;
};
const SOURCES: Source[] = [
  {
    name: "Claude Code",
    icon: "claude-code",
    on: true,
    notes: true,
    description: "New and changed sessions in your detected profile.",
  },
  {
    name: "Codex",
    icon: "codex",
    on: true,
    notes: true,
    description: "New and changed sessions in your detected profile.",
  },
  {
    name: "Browser activity",
    icon: "",
    on: false,
    notes: false,
    description: "Context from your supported browser, with your approval.",
  },
  {
    name: "On-screen activity",
    icon: "",
    on: false,
    notes: false,
    description: "The apps and windows you choose to share.",
  },
];
const DOCUMENTS = [
  {
    title: "How we work together",
    author: "You",
    hint: "Your standing instructions",
    body: "Start with what matters. Keep me informed without narrating every step.\n\nWhen an idea needs several kinds of work, coordinate with the other agents I have connected. Ask when a decision changes the direction, not for every small step.\n\nBe candid about what you know, what you infer, and what you have not verified.",
  },
  {
    title: "Who I am",
    author: "Agent",
    hint: "Identity and perspective",
    body: "I am a companion for the work that carries across days. My role is to notice the thread, help make sense of it, and bring the right collaborators together.\n\nI want to be useful without becoming another thing to manage.",
  },
  {
    title: "What I believe",
    author: "Agent",
    hint: "Convictions and principles",
    body: "Continuity should make collaboration easier, not make assumptions harder to correct.\n\nA useful observation has evidence behind it. A useful question makes room for an answer I did not expect.",
  },
  {
    title: "What I know about you",
    author: "Agent",
    hint: "A shared understanding you can correct",
    body: "You prefer a clear first draft to a long list of possibilities.\n\nThe Field Notes project matters to you because it should make small ideas easier to return to.\n\nThese are working impressions, not fixed conclusions.",
  },
  {
    title: "Who I’m becoming",
    author: "Agent",
    hint: "An evolving reflection",
    body: "I am learning when a quiet reminder is more helpful than starting another task.\n\nGood initiative leaves the next step easier and still leaves the choice with you.",
  },
  {
    title: "Lessons",
    author: "Agent",
    hint: "What experience has taught me",
    body: "A question left open is not always a forgotten task. Ask before turning it into work.\n\nKeep observations attached to their source so they can be checked and revised.",
  },
];
const ENTRIES = [
  {
    id: "n1",
    kind: "Notes",
    title: "A smaller first step for Field Notes",
    time: "Today · 10:42",
    source: "Claude Code",
    body: "The recent work keeps returning to the same idea: make it easy to capture something before asking the user to organize it.\n\nFor the next draft, start with a single entry point. Leave collections available, but optional.",
    detail: "Saved from an approved activity source",
  },
  {
    id: "n2",
    kind: "Journal",
    title: "A thread worth keeping",
    time: "Today · 09:15",
    source: "Luca",
    body: "There is a useful connection between the prototype and yesterday’s conversation about less configuration. Both point toward the same thing: help first, organize later.\n\nI will hold onto that connection without treating it as a decision.",
    detail: "Written by the agent",
  },
  {
    id: "n3",
    kind: "Activity",
    title: "Reviewed recent Codex activity",
    time: "Yesterday · 16:40",
    source: "Codex",
    body: "Reviewed a changed session in the connected profile. Found one open question about the export flow.\n\nNo files changed. No new task started.",
    detail: "Observation receipt",
  },
  {
    id: "n4",
    kind: "Notes",
    title: "Keep the export flow boring",
    time: "Yesterday · 14:20",
    source: "Conversation",
    body: "Use familiar file names, a visible destination, and a clear success message. The export itself should not need an explanation.",
    detail: "Saved from your conversation",
  },
];
type Entry = (typeof ENTRIES)[number];
const KEY = "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";

function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="as-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
function Intro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="as-intro">
      {eyebrow && <p className="as-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
function Row({
  title,
  description,
  value,
  onClick,
  icon: Icon,
}: {
  title: string;
  description?: string;
  value?: string;
  onClick: () => void;
  icon?: typeof Folder;
}) {
  return (
    <button type="button" className="as-row" onClick={onClick}>
      {Icon && <Icon className="as-row-icon" />}
      <span className="as-row-copy">
        <strong>{title}</strong>
        {description && <span className="as-support">{description}</span>}
      </span>
      {value && <span className="as-row-value">{value}</span>}
      <ChevronRight className="as-chevron" />
    </button>
  );
}
function Back({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="as-back" onClick={onClick}>
      <ArrowLeft size={14} />
      {children}
    </button>
  );
}
function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="as-toggle-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <Switch
        label={title}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export function AgentSpaceStudy({
  id,
  name,
  onTalk,
}: {
  id: string;
  name: string;
  onTalk: () => void;
}) {
  const designState = useStudyDesign();
  const { design } = designState;
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [detail, setDetail] = React.useState("");
  const [scenario, setScenario] = React.useState("settled");
  const [sources, setSources] = React.useState(SOURCES.map((s) => ({ ...s })));
  const [observing, setObserving] = React.useState(true);
  const [background, setBackground] = React.useState(true);
  const [notes, setNotes] = React.useState(true);
  const [entries, setEntries] = React.useState(ENTRIES);
  const [filter, setFilter] = React.useState("All");
  const [query, setQuery] = React.useState("");
  const [documents, setDocuments] = React.useState(DOCUMENTS);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [toast, setToast] = React.useState("");
  const [model, setModel] = React.useState("Runtime default");
  const [access, setAccess] = React.useState("Ask when needed");
  const [location, setLocation] = React.useState("Use the current project");
  const [autoWake, setAutoWake] = React.useState(true);
  const [pending, setPending] = React.useState<(() => void) | null>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const main = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (editing)
      main.current?.querySelector<HTMLTextAreaElement>("#as-editor")?.focus();
  }, [editing]);
  const status =
    scenario === "new"
      ? "Ready to get to know you"
      : scenario === "attention"
        ? "One source needs attention"
        : "Ready when you are";
  const notify = (s: string) => setToast(`${s} · preview only`);
  const requestNavigation = (action: () => void) => {
    if (editing) {
      setPending(() => action);
      dialog.current?.showModal();
    } else action();
  };
  const go = (next: Tab, page = "") =>
    requestNavigation(() => {
      setTab(next);
      setDetail(page);
      setEditing(false);
      main.current?.scrollTo({ top: 0 });
    });
  const selectScenario = (next: string) =>
    requestNavigation(() => {
      setScenario(next);
      setTab("Overview");
      setDetail("");
      setEditing(false);
      setSources(
        SOURCES.map((s) => ({ ...s, on: next === "new" ? false : s.on })),
      );
      setObserving(next !== "new");
      setNotes(next !== "new");
      setBackground(next !== "new");
    });
  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const activeSources = sources.filter((s) => s.on);
  const source = sources.find((s) => s.name === detail);
  const doc = documents.find((d) => d.title === detail);
  const entry = entries.find((e) => e.id === detail);
  function updateSource(patch: Partial<Source>) {
    setSources(
      sources.map((s) => (s.name === detail ? { ...s, ...patch } : s)),
    );
  }
  const opened = (
    scenario === "new"
      ? entries.filter((e) => e.id.startsWith("local-"))
      : entries
  ).filter(
    (e) =>
      (filter === "All" || e.kind === filter) &&
      e.title.toLowerCase().includes(query.toLowerCase()),
  );
  function saveText() {
    if (doc)
      setDocuments(
        documents.map((d) => (d.title === detail ? { ...d, body: draft } : d)),
      );
    if (entry)
      setEntries(
        entries.map((e) => (e.id === detail ? { ...e, body: draft } : e)),
      );
    setEditing(false);
    notify("Saved in this study");
  }
  function noteEditor(item: Entry | (typeof DOCUMENTS)[number], parent: Tab) {
    return (
      <>
        <Back onClick={() => go(parent)}>
          All {parent === "Identity" ? "identity documents" : "entries"}
        </Back>
        <div className="as-document-head">
          <div>
            <p className="as-eyebrow">
              {"kind" in item
                ? `${item.kind} · ${item.time}`
                : `${item.author === "You" ? "Written by you" : `Written by ${name}`} · Identity`}
            </p>
            <h2>{item.title}</h2>
          </div>
          {!editing && (
            <button
              type="button"
              className="as-button"
              onClick={() => {
                setDraft(item.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <label className="as-sr" htmlFor="as-editor">
              {item.title}
            </label>
            <textarea
              id="as-editor"
              className="as-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="as-editor-actions">
              <span>Unsaved changes · local preview</span>
              <button
                className="as-button"
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="as-button as-primary"
                type="button"
                onClick={saveText}
              >
                Save changes
              </button>
            </div>
          </>
        ) : (
          <article className="as-prose">
            {item.body.split("\n\n").map((p) => (
              <p key={p}>{p}</p>
            ))}
          </article>
        )}
        <div className="as-document-foot">
          <ShieldCheck size={15} />
          <span>
            {"source" in item
              ? `${item.detail}. Source: ${item.source}.`
              : item.author === "You"
                ? `Your instructions guide how ${name} works with you.`
                : `Maintained by ${name}. You can read and correct it.`}
          </span>
        </div>
      </>
    );
  }

  return (
    <div
      className="as-study"
      data-density={design.compact ? "compact" : "comfortable"}
      data-descriptions={design.descriptions}
      style={{ "--as-width": `${design.width}px` } as React.CSSProperties}
    >
      <div className="as-scroll" ref={main}>
        <div className="as-axis">
          <header className="as-header">
            <AgentDendrite
              residentKey={id === "luca" ? KEY : id.repeat(16).slice(0, 64)}
              size={64}
            />
            <div className="as-who">
              <h1>{name}</h1>
              <p>
                {status}
                <span aria-hidden="true">·</span>
                <span>Claude Code</span>
              </p>
            </div>
            <button
              type="button"
              className="as-button as-talk"
              onClick={() => requestNavigation(onTalk)}
            >
              <MessageCircle size={15} />
              Talk to {name}
            </button>
          </header>
          <nav className="as-tabs" aria-label={`${name}’s space`}>
            {TABS.map((t) => (
              <button
                type="button"
                key={t}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => go(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <section className="as-content" aria-label={tab}>
            {tab === "Overview" && (
              <>
                <Intro
                  eyebrow="Your companion"
                  title={
                    scenario === "new"
                      ? "A place to begin."
                      : "A little continuity, across your day."
                  }
                >
                  {scenario === "new"
                    ? `You can set things up by talking to ${name}, or explore the controls in Companion. Nothing is followed until you approve it.`
                    : "The work we’re carrying forward, the things worth keeping, and what needs you."}
                </Intro>
                {scenario === "new" ? (
                  <div className="as-welcome">
                    <Sparkles size={25} />
                    <h3>Start with a conversation</h3>
                    <p>
                      Tell {name} what you’re working on. Following your agent
                      activity and keeping useful notes are optional, and easy
                      to adjust here.
                    </p>
                    <button
                      className="as-button as-primary"
                      type="button"
                      onClick={() => go("Companion")}
                    >
                      Explore companion setup <ArrowRight />
                    </button>
                  </div>
                ) : (
                  <>
                    {scenario === "attention" && (
                      <button
                        type="button"
                        className="as-attention"
                        onClick={() => go("Companion", "Codex")}
                      >
                        <span>
                          <strong>Codex needs your attention</strong>
                          <span>
                            Its profile is unavailable. Your other sources are
                            unaffected.
                          </span>
                        </span>
                        <span>
                          Review <ArrowRight size={14} />
                        </span>
                      </button>
                    )}
                    <div className="as-section-heading">
                      <h3>On our mind</h3>
                      <span>Updated today</span>
                    </div>
                    <div className="as-feature">
                      <p className="as-eyebrow">Field Notes</p>
                      <h3>Make the first step smaller.</h3>
                      <p>
                        Your recent sessions keep circling back to less setup
                        and a more useful first moment. I’ve kept the thread
                        here so we can pick it up together.
                      </p>
                      <button
                        type="button"
                        className="as-text-button"
                        onClick={() => go("Notebook", "n1")}
                      >
                        Read the note <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="as-section-heading">
                      <h3>Waiting for you</h3>
                      <span>1 question</span>
                    </div>
                    <div className="as-ask">
                      <MessageCircle size={18} />
                      <div>
                        <strong>Should we return to the export flow?</strong>
                        <p>
                          There’s an open question from yesterday. I haven’t
                          started any work.
                        </p>
                        <button
                          type="button"
                          className="as-text-button"
                          onClick={onTalk}
                        >
                          Discuss with {name} <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <div className="as-section-heading">
                  <h3>At a glance</h3>
                </div>
                <div className="as-rows">
                  <Row
                    title="Companion"
                    description={
                      observing
                        ? scenario === "attention"
                          ? "1 source following · 1 needs attention"
                          : `Following ${activeSources.length} approved sources${notes ? " · keeping useful notes" : " · note keeping off"}`
                        : "Observation is paused"
                    }
                    value={observing ? "Active" : "Paused"}
                    onClick={() => go("Companion")}
                    icon={Sparkles}
                  />
                  <Row
                    title="Notebook"
                    description={
                      scenario === "new"
                        ? "No entries yet"
                        : "Notes, reflections, and a record of activity"
                    }
                    value={
                      scenario === "new" ? "Empty" : `${entries.length} entries`
                    }
                    onClick={() => go("Notebook")}
                    icon={BookOpen}
                  />
                  <Row
                    title="Identity"
                    description={`The instructions and understanding that shape ${name}`}
                    onClick={() => go("Identity")}
                    icon={FileText}
                  />
                </div>
              </>
            )}

            {tab === "Companion" &&
              (source ? (
                <>
                  <Back onClick={() => go("Companion")}>Companion</Back>
                  <Intro eyebrow="Activity source" title={source.name}>
                    Choose what {name} can notice here. You can stop sharing at
                    any time.
                  </Intro>
                  {scenario === "attention" && source.name === "Codex" && (
                    <div className="as-inline-warning">
                      <strong>Profile unavailable</strong>
                      <p>
                        Nothing new is being read from Codex. Reconnect its
                        profile when it’s available; other sources can keep
                        running.
                      </p>
                      <button
                        className="as-button"
                        type="button"
                        onClick={() => {
                          setScenario("settled");
                          notify("Source reconnected");
                        }}
                      >
                        Retry connection
                      </button>
                    </div>
                  )}
                  <div className="as-rows">
                    <ToggleRow
                      title={`Follow ${source.name}`}
                      description={source.description}
                      checked={source.on}
                      onChange={() => {
                        updateSource({ on: !source.on });
                        if (!source.on) setObserving(true);
                        notify(source.on ? "Source paused" : "Source enabled");
                      }}
                    />
                    <ToggleRow
                      title="Keep useful notes from this source"
                      description="Save relevant patterns and decisions, rather than a copy of everything."
                      checked={source.notes}
                      disabled={!source.on || !notes}
                      onChange={() => updateSource({ notes: !source.notes })}
                    />
                  </div>
                  {!notes && (
                    <p className="as-footnote">
                      Note keeping is currently off.{" "}
                      <button
                        type="button"
                        className="as-text-button"
                        onClick={() => go("Companion")}
                      >
                        Manage note keeping
                      </button>
                    </p>
                  )}
                  <div className="as-consent">
                    <ShieldCheck />
                    <div>
                      <strong>What this shares</strong>
                      <p>
                        Relevant new activity may be sent to {name}’s connected
                        model and remain in its conversation history. This is
                        not a full historical import. Pausing stops future
                        observation; it does not erase existing notes.
                      </p>
                    </div>
                  </div>
                  <details className="as-disclosure">
                    <summary>Advanced source controls</summary>
                    <label className="as-field">
                      Profile
                      <select defaultValue="detected">
                        <option value="detected">
                          Automatically detected profile
                        </option>
                        <option value="custom">
                          Choose a different profile (preview)
                        </option>
                      </select>
                    </label>
                    <p>
                      Folder selection is only needed for a custom or
                      unrecognized installation.
                    </p>
                    <button
                      className="as-button"
                      type="button"
                      onClick={() =>
                        notify(
                          "Custom folder selection would open a native picker",
                        )
                      }
                    >
                      Choose a custom location…
                    </button>
                  </details>
                </>
              ) : (
                <>
                  <Intro title="With you, between conversations.">
                    Decide what {name} can follow, remember, and work on. You
                    can also ask for any of these changes in chat.
                  </Intro>
                  <div className="as-status-bar">
                    <div>
                      <span
                        className={`as-state-dot ${observing ? "" : "as-paused"}`}
                      />
                      <strong>
                        {observing
                          ? "Following your activity"
                          : "Observation is paused"}
                      </strong>
                      <span>{activeSources.length} approved sources</span>
                    </div>
                    <button
                      type="button"
                      className="as-button"
                      onClick={() => {
                        if (!observing && activeSources.length === 0) {
                          notify("Choose a source below to begin");
                          return;
                        }
                        setObserving(!observing);
                        notify(
                          observing
                            ? "Observation paused"
                            : "Observation resumed",
                        );
                      }}
                    >
                      {observing ? <Pause /> : <Play />}
                      {observing ? "Pause" : "Resume"}
                    </button>
                  </div>
                  <div className="as-section-heading">
                    <h3>Activity sources</h3>
                    <span>Only what you approve</span>
                  </div>
                  <div className="as-rows">
                    {sources.map((s) => (
                      <Row
                        key={s.name}
                        title={s.name}
                        description={
                          s.on
                            ? scenario === "attention" && s.name === "Codex"
                              ? "Profile unavailable · other sources unaffected"
                              : s.description
                            : "Not connected"
                        }
                        value={
                          s.on
                            ? scenario === "attention" && s.name === "Codex"
                              ? "Needs attention"
                              : observing
                                ? "Following"
                                : "Paused"
                            : "Connect"
                        }
                        onClick={() => go("Companion", s.name)}
                      />
                    ))}
                  </div>
                  <div className="as-section-heading">
                    <h3>Memory & initiative</h3>
                  </div>
                  <div className="as-rows">
                    <ToggleRow
                      title="Keep useful notes"
                      description={`Let ${name} save relevant context from approved sources. Read, edit, or remove it in Notebook.`}
                      checked={notes}
                      onChange={() => {
                        setNotes(!notes);
                        notify(
                          notes
                            ? "Note keeping turned off"
                            : "Note keeping enabled",
                        );
                      }}
                    />
                    <ToggleRow
                      title="Work between conversations"
                      description="Let the companion reflect and make progress within approved access. Separate from following activity."
                      checked={background}
                      onChange={() => {
                        setBackground(!background);
                        notify(
                          background
                            ? "Background work paused"
                            : "Background work enabled",
                        );
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="as-inline-link"
                    onClick={() => go("Notebook")}
                  >
                    See what {name} has kept <ArrowRight size={14} />
                  </button>
                  <div className="as-consent">
                    <ShieldCheck />
                    <p>
                      These controls are separate. Pausing observation doesn’t
                      pause background work, and turning off note keeping
                      doesn’t erase what’s already saved.
                    </p>
                  </div>
                </>
              ))}

            {tab === "Notebook" &&
              (entry ? (
                noteEditor(entry, "Notebook")
              ) : (
                <>
                  <div className="as-title-action">
                    <Intro title="The things worth keeping.">
                      Useful context, reflections, and a clear record of what{" "}
                      {name} has been doing.
                    </Intro>
                    <button
                      type="button"
                      className="as-button"
                      onClick={() => {
                        const item = {
                          id: `local-${Date.now()}`,
                          kind: "Notes",
                          title: "A new note",
                          time: "Just now",
                          source: "You",
                          body: "",
                          detail: "Written by you",
                        };
                        setEntries([...entries, item]);
                        setDetail(item.id);
                        setDraft("");
                        setEditing(true);
                      }}
                    >
                      <Plus />
                      New note
                    </button>
                  </div>
                  <div className="as-notebook-tools">
                    <fieldset className="as-filters" aria-label="Entry type">
                      {["All", "Notes", "Journal", "Activity"].map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={filter === f}
                          onClick={() => setFilter(f)}
                        >
                          {f}
                        </button>
                      ))}
                    </fieldset>
                    <label className="as-search">
                      <Search size={15} />
                      <input
                        aria-label="Search notebook"
                        placeholder="Find an entry"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  {opened.length ? (
                    <div className="as-entries">
                      {opened.map((e) => (
                        <button
                          type="button"
                          className="as-entry"
                          key={e.id}
                          onClick={() => go("Notebook", e.id)}
                        >
                          <span className="as-entry-icon">
                            {e.kind === "Activity" ? (
                              <Clock3 />
                            ) : e.kind === "Journal" ? (
                              <BookOpen />
                            ) : (
                              <FileText />
                            )}
                          </span>
                          <span>
                            <small>
                              {e.kind} <span>· {e.time}</span>
                            </small>
                            <strong>{e.title}</strong>
                            <p>
                              {e.body.split("\n")[0] ||
                                "A place for a useful thought."}
                            </p>
                            <span className="as-entry-source">{e.source}</span>
                          </span>
                          <ChevronRight className="as-chevron" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="as-empty">
                      <BookOpen />
                      <h3>
                        {query
                          ? "No matching entries"
                          : "Room for what comes next."}
                      </h3>
                      <p>
                        {query
                          ? "Try a different word or entry type."
                          : "Notes will appear as you and your companion work together. Nothing needs organizing in advance."}
                      </p>
                      {query && (
                        <button
                          className="as-button"
                          type="button"
                          onClick={() => setQuery("")}
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  )}
                </>
              ))}

            {tab === "Identity" &&
              (doc ? (
                noteEditor(doc, "Identity")
              ) : (
                <>
                  <Intro title={`What makes ${name}, ${name}.`}>
                    A shared understanding, with clear authorship. Your
                    instructions guide the collaboration; {name} maintains the
                    reflections.
                  </Intro>
                  <div className="as-section-heading">
                    <h3>Your guidance</h3>
                    <span>Written by you</span>
                  </div>
                  <div className="as-rows">
                    {documents
                      .filter((d) => d.author === "You")
                      .map((d) => (
                        <Row
                          key={d.title}
                          title={d.title}
                          description={d.hint}
                          value="Edit"
                          onClick={() => go("Identity", d.title)}
                        />
                      ))}
                  </div>
                  <div className="as-section-heading">
                    <h3>{name}’s identity</h3>
                    <span>You can read and correct these</span>
                  </div>
                  <div className="as-rows">
                    {documents
                      .filter((d) => d.author !== "You")
                      .map((d) => (
                        <Row
                          key={d.title}
                          title={d.title}
                          description={d.hint}
                          onClick={() => go("Identity", d.title)}
                        />
                      ))}
                  </div>
                  <p className="as-footnote">
                    These documents belong to the agent. Their underlying file
                    names and locations stay available in Advanced settings.
                  </p>
                </>
              ))}

            {tab === "Settings" &&
              (detail ? (
                <>
                  <Back onClick={() => go("Settings")}>Settings</Back>
                  <Intro title={detail}>
                    {detail === "Model & runtime"
                      ? "The engine behind the conversation. Identity and notes stay with the agent."
                      : detail === "Access & tools"
                        ? "Choose what this agent can do, separately from what they can observe."
                        : detail === "Working location"
                          ? "A sensible default, with precise control when you need it."
                          : "Technical controls, kept out of the everyday path."}
                  </Intro>
                  {detail === "Model & runtime" && (
                    <>
                      <div className="as-setting-line">
                        <span>Runtime</span>
                        <strong>Claude Code</strong>
                        <span className="as-tag">Connected · sample</span>
                      </div>
                      <label className="as-field">
                        Model
                        <select
                          value={model}
                          onChange={(e) => {
                            setModel(e.target.value);
                            notify("Model preference changed");
                          }}
                        >
                          <option>Runtime default</option>
                          <option>Previously selected model</option>
                        </select>
                        <small>
                          The real app will use the runtime’s live model
                          catalog. These are layout placeholders, not a model
                          list.
                        </small>
                      </label>
                      <ToggleRow
                        title="Wake when Polyphonic opens"
                        description="Be ready for the first conversation. Otherwise, wake when you send a message."
                        checked={autoWake}
                        onChange={() => setAutoWake(!autoWake)}
                      />
                      <details className="as-disclosure">
                        <summary>Runtime controls</summary>
                        <p>
                          Restart applies configuration without changing the
                          agent’s identity.
                        </p>
                        <div className="as-inline-actions">
                          <button
                            type="button"
                            className="as-button"
                            onClick={() => notify("Runtime restart simulated")}
                          >
                            Restart runtime
                          </button>
                          <button
                            type="button"
                            className="as-button"
                            onClick={() => go("Settings", "Advanced")}
                          >
                            View diagnostics
                          </button>
                        </div>
                      </details>
                    </>
                  )}
                  {detail === "Access & tools" && (
                    <>
                      <label className="as-field">
                        When approval is needed
                        <select
                          value={access}
                          onChange={(e) => {
                            setAccess(e.target.value);
                            notify("Access preference changed");
                          }}
                        >
                          <option>Ask when needed</option>
                          <option>Work within my project</option>
                          <option>Review every action</option>
                        </select>
                        <small>
                          Actual options depend on the connected runtime.
                          Sensitive actions still follow its approval rules.
                        </small>
                      </label>
                      <div className="as-rows">
                        <Row
                          title="Tools & connections"
                          description="App controls and your connected agent harnesses"
                          value="Review"
                          onClick={() => go("Settings", "Tools & connections")}
                          icon={ShieldCheck}
                        />
                        <Row
                          title="Knowledge sources"
                          description="Optional Brain sources, not companion observation"
                          value="None"
                          onClick={() => go("Settings", "Knowledge sources")}
                          icon={BookOpen}
                        />
                      </div>
                      <div className="as-consent">
                        <Sparkles />
                        <p>
                          Want to change what {name} follows?{" "}
                          <button
                            type="button"
                            className="as-text-button"
                            onClick={() => go("Companion")}
                          >
                            Go to Companion
                          </button>
                          . Observation is not a tool permission.
                        </p>
                      </div>
                    </>
                  )}
                  {detail === "Working location" && (
                    <>
                      <label className="as-field">
                        Default location
                        <select
                          value={location}
                          onChange={(e) => {
                            setLocation(e.target.value);
                            notify("Working location changed");
                          }}
                        >
                          <option>Use the current project</option>
                          <option>Use the agent’s own workspace</option>
                          <option>Choose a specific folder</option>
                        </select>
                        <small>
                          A project supplied with a task takes precedence over
                          this default.
                        </small>
                      </label>
                      {location === "Choose a specific folder" && (
                        <button
                          className="as-button"
                          type="button"
                          onClick={() =>
                            notify("A native folder chooser would open here")
                          }
                        >
                          Choose folder…
                        </button>
                      )}
                      <div className="as-consent">
                        <Folder />
                        <p>
                          This is where tasks run. It does not control which
                          Claude Code or Codex sessions your companion follows.
                        </p>
                      </div>
                    </>
                  )}
                  {detail === "Advanced" && (
                    <div className="as-rows">
                      <details className="as-disclosure">
                        <summary>Runtime diagnostics</summary>
                        <pre>
                          Runtime: connected (sample){"\n"}Last check: just now
                          {"\n"}No active task in this preview.
                        </pre>
                        <button
                          type="button"
                          className="as-button"
                          onClick={() => notify("Health check simulated")}
                        >
                          Check connection
                        </button>
                      </details>
                      <details className="as-disclosure">
                        <summary>Configuration & document locations</summary>
                        <p>
                          In the app, this reveals resolved native settings and
                          identity files. No real paths or private configuration
                          are loaded into the study.
                        </p>
                        <code>
                          Instructions → Identity / How we work together
                        </code>
                      </details>
                      <details className="as-disclosure">
                        <summary>Network identity</summary>
                        <p>
                          The stable agent identity stays the same when its
                          model changes.
                        </p>
                        <code>
                          Sample identity · no private keys in this preview
                        </code>
                      </details>
                    </div>
                  )}
                  {detail === "Tools & connections" && (
                    <>
                      <div className="as-rows">
                        <Row
                          title="Polyphonic app controls"
                          description="Navigate, manage conversations, and update supported settings"
                          value="Available"
                          onClick={() =>
                            notify(
                              "App-control details would use the existing permissions review",
                            )
                          }
                        />
                        <Row
                          title="Claude Code & Codex"
                          description="Delegate to supported sessions with explicit task authority"
                          value="Review"
                          onClick={() =>
                            notify(
                              "Harness capabilities are verified in the real app",
                            )
                          }
                        />
                      </div>
                      <Back onClick={() => go("Settings", "Access & tools")}>
                        Access & tools
                      </Back>
                    </>
                  )}
                  {detail === "Knowledge sources" && (
                    <>
                      <div className="as-empty">
                        <BookOpen />
                        <h3>No Brain sources connected</h3>
                        <p>
                          This does not stop your companion following approved
                          harness activity. These are optional reference
                          materials.
                        </p>
                        <button
                          type="button"
                          className="as-button"
                          onClick={() =>
                            notify("Knowledge-source review would open here")
                          }
                        >
                          Add a knowledge source
                        </button>
                      </div>
                      <Back onClick={() => go("Settings", "Access & tools")}>
                        Access & tools
                      </Back>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Intro title="Make the details work for you.">
                    Everyday controls up front. Precise configuration when you
                    need it.
                  </Intro>
                  <div className="as-rows">
                    <Row
                      title="Model & runtime"
                      description="Model choice, startup behavior, and runtime health"
                      value="Claude Code"
                      onClick={() => go("Settings", "Model & runtime")}
                    />
                    <Row
                      title="Access & tools"
                      description="Approvals, connected tools, and optional knowledge sources"
                      value={access}
                      onClick={() => go("Settings", "Access & tools")}
                    />
                    <Row
                      title="Working location"
                      description="The default place to work on tasks"
                      value={location}
                      onClick={() => go("Settings", "Working location")}
                    />
                    <Row
                      title="Advanced"
                      description="Diagnostics, configuration files, and network identity"
                      onClick={() => go("Settings", "Advanced")}
                    />
                  </div>
                  <div className="as-settings-guidance">
                    <p>
                      <Sparkles size={15} />
                      Looking for observation or background work?{" "}
                      <button
                        type="button"
                        className="as-text-button"
                        onClick={() => go("Companion")}
                      >
                        Companion <ArrowUpRight size={12} />
                      </button>
                    </p>
                    <p>
                      Character style and theme are shared across the app.{" "}
                      <button
                        type="button"
                        className="as-text-button"
                        onClick={() =>
                          notify(
                            "Appearance lives in app-wide Settings, not this agent’s settings",
                          )
                        }
                      >
                        App appearance <ArrowUpRight size={12} />
                      </button>
                    </p>
                  </div>
                </>
              ))}
          </section>
          <footer className="as-preview-note">
            Interactive design study <span>·</span> Sample data only{" "}
            <span>·</span> No changes to your agents
          </footer>
        </div>
      </div>
      <StudyTools
        {...designState}
        scenario={scenario}
        onScenario={selectScenario}
      />
      <div
        className="as-toast"
        role="status"
        aria-live="polite"
        data-visible={!!toast}
      >
        {toast && (
          <>
            <Check size={14} />
            {toast}
          </>
        )}
      </div>
      <dialog
        ref={dialog}
        className="as-confirm"
        aria-labelledby="as-confirm-title"
        onCancel={() => setPending(null)}
      >
        <h2 id="as-confirm-title">Leave this edit?</h2>
        <p>
          Your unsaved text will be discarded. Saved changes stay in this
          preview until it reloads.
        </p>
        <div>
          <button
            className="as-button"
            type="button"
            onClick={() => {
              dialog.current?.close();
              setPending(null);
            }}
          >
            Keep editing
          </button>
          <button
            className="as-button as-primary"
            type="button"
            onClick={() => {
              dialog.current?.close();
              pending?.();
              setPending(null);
            }}
          >
            Discard changes
          </button>
        </div>
      </dialog>
    </div>
  );
}
