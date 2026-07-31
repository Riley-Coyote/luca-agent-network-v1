import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Fingerprint,
  KeyRound,
  Link2,
  MessageCircle,
  Orbit,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  agentById,
  type AgentId,
  type DemoAgent,
  type DemoMemory,
  type DemoMessage,
  type DemoView,
  DEMO_AGENTS,
  DEMO_MEMORIES,
  STORY_BEATS,
  useDemoRuntime,
} from "@/vision-demo/demoRuntime";
import "@/vision-demo/vision-demo.css";

const VIEW_META: Array<{
  id: DemoView;
  label: string;
  icon: typeof MessageCircle;
}> = [
  { id: "network", label: "Network", icon: MessageCircle },
  { id: "agents", label: "Agents", icon: Users },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "continuity", label: "Continuity", icon: Orbit },
];

function AgentAvatar({
  agent,
  size = "medium",
}: {
  agent: DemoAgent;
  size?: "small" | "medium" | "large";
}) {
  return (
    <span
      aria-hidden="true"
      className={`vd-avatar vd-avatar--${size}`}
      style={{ "--agent-accent": agent.accent } as CSSProperties}
    >
      <span>{agent.initials}</span>
      <i />
    </span>
  );
}

function ProductMark() {
  return (
    <div className="vd-product-mark">
      <span className="vd-product-glyph">L</span>
      <span className="vd-product-name">LUCA</span>
    </div>
  );
}

function VisionRail({
  view,
  onViewChange,
}: {
  view: DemoView;
  onViewChange: (view: DemoView) => void;
}) {
  return (
    <nav className="vd-rail" aria-label="Primary">
      <button
        className="vd-rail__mark"
        onClick={() => onViewChange("network")}
        type="button"
        aria-label="Open Luca network"
      >
        L
      </button>
      <div className="vd-rail__views">
        {VIEW_META.map(({ id, label, icon: Icon }) => (
          <button
            aria-current={view === id ? "page" : undefined}
            aria-label={label}
            className="vd-rail__button"
            data-active={view === id}
            data-testid={`vision-nav-${id}`}
            key={id}
            onClick={() => onViewChange(id)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" size={17} strokeWidth={1.65} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="vd-rail__footer">
        <div className="vd-owner-avatar" title="Riley · owner">
          RC
        </div>
      </div>
    </nav>
  );
}

function WorkspaceSidebar({
  selectedAgentId,
  onSelectAgent,
  onViewChange,
}: {
  selectedAgentId: AgentId;
  onSelectAgent: (id: AgentId) => void;
  onViewChange: (view: DemoView) => void;
}) {
  return (
    <aside className="vd-sidebar">
      <div className="vd-sidebar__header">
        <ProductMark />
        <button className="vd-icon-button" aria-label="Search" type="button">
          <Search size={15} strokeWidth={1.6} />
        </button>
      </div>

      <section className="vd-sidebar__section">
        <div className="vd-section-label">
          <span>Rooms</span>
          <button aria-label="Create room" type="button">
            <Plus size={13} />
          </button>
        </div>
        <button className="vd-room vd-room--active" type="button">
          <span className="vd-room__hash">#</span>
          <span>
            <strong>launch-room</strong>
            <small>3 agents · continuous</small>
          </span>
          <i />
        </button>
        <button className="vd-room" type="button">
          <span className="vd-room__hash">#</span>
          <span>
            <strong>product</strong>
            <small>Last active Tuesday</small>
          </span>
        </button>
        <button className="vd-room" type="button">
          <span className="vd-room__hash">#</span>
          <span>
            <strong>research</strong>
            <small>12 unread traces</small>
          </span>
        </button>
      </section>

      <section className="vd-sidebar__section vd-sidebar__section--residents">
        <div className="vd-section-label">
          <span>Residents</span>
          <button onClick={() => onViewChange("agents")} type="button">
            View all
          </button>
        </div>
        <div className="vd-resident-list">
          {DEMO_AGENTS.map((agent) => (
            <button
              className="vd-resident-row"
              data-selected={selectedAgentId === agent.id}
              key={agent.id}
              onClick={() => {
                onSelectAgent(agent.id);
                onViewChange("network");
              }}
              type="button"
            >
              <AgentAvatar agent={agent} size="small" />
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
              <i className="vd-presence-dot" />
            </button>
          ))}
        </div>
      </section>

      <div className="vd-sidebar__status">
        <ShieldCheck size={14} strokeWidth={1.6} />
        <span>
          <strong>Personal network</strong>
          <small>Identity chain healthy</small>
        </span>
      </div>
    </aside>
  );
}

function DemoDisclosure({ testId }: { testId: string }) {
  return (
    <span
      className="vd-disclosure"
      data-testid={testId}
      title="The interface is real. Agent activity is deterministic demo data."
    >
      <Radio size={11} strokeWidth={1.8} />
      <span className="vd-disclosure__full">
        Interactive vision · simulated activity
      </span>
      <span className="vd-disclosure__compact">Simulated</span>
    </span>
  );
}

function StoryControls({
  step,
  isPlaying,
  onToggle,
  onRestart,
}: {
  step: number;
  isPlaying: boolean;
  onToggle: () => void;
  onRestart: () => void;
}) {
  const isComplete = step === STORY_BEATS.length - 1;
  return (
    <div className="vd-story-controls">
      <button
        className="vd-story-primary"
        data-testid="vision-story-toggle"
        onClick={onToggle}
        type="button"
      >
        {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        {isPlaying ? "Pause" : isComplete ? "Run again" : "Run the story"}
      </button>
      <button
        className="vd-icon-button"
        onClick={onRestart}
        type="button"
        aria-label="Restart demo"
      >
        <RotateCcw size={14} strokeWidth={1.7} />
      </button>
    </div>
  );
}

function StoryStrip({
  step,
  onJump,
}: {
  step: number;
  onJump: (step: number) => void;
}) {
  return (
    <nav className="vd-story-strip" aria-label="Demo story progress">
      <div className="vd-story-strip__line" aria-hidden="true">
        <span
          style={{ width: `${(step / (STORY_BEATS.length - 1)) * 100}%` }}
        />
      </div>
      {STORY_BEATS.map((beat, index) => (
        <button
          aria-current={index === step ? "step" : undefined}
          className="vd-story-step"
          data-state={
            index < step ? "complete" : index === step ? "active" : "future"
          }
          data-testid={`vision-story-step-${index}`}
          key={beat.short}
          onClick={() => onJump(index)}
          type="button"
        >
          <i>{index < step ? <Check size={9} /> : index + 1}</i>
          <span>{beat.short}</span>
        </button>
      ))}
    </nav>
  );
}

function ViewHeader({
  view,
  step,
  isPlaying,
  onToggle,
  onRestart,
}: {
  view: DemoView;
  step: number;
  isPlaying: boolean;
  onToggle: () => void;
  onRestart: () => void;
}) {
  const titles: Record<DemoView, { title: string; detail: string }> = {
    network: { title: "launch-room", detail: "Riley, Luca, Mara, Sol" },
    agents: {
      title: "Your agents",
      detail: "Persistent residents of your personal network",
    },
    brain: {
      title: "Universal brain",
      detail: "Shared context, explicit scope, visible provenance",
    },
    continuity: {
      title: "Continuity",
      detail: "What survives the boundary between sessions",
    },
  };
  return (
    <header className="vd-view-header">
      <div className="vd-view-title">
        <div>
          <span>{view === "network" ? "#" : null}</span>
          <h1>{titles[view].title}</h1>
        </div>
        <p>{titles[view].detail}</p>
      </div>
      <div className="vd-view-actions">
        <DemoDisclosure testId="vision-demo-disclosure-desktop" />
        <StoryControls
          isPlaying={isPlaying}
          onRestart={onRestart}
          onToggle={onToggle}
          step={step}
        />
      </div>
    </header>
  );
}

function MemoryReferences({
  memoryIds,
  onSelectMemory,
}: {
  memoryIds?: string[];
  onSelectMemory: (id: string) => void;
}) {
  if (!memoryIds?.length) {
    return null;
  }
  return (
    <div className="vd-memory-references">
      {memoryIds.map((id) => {
        const memory = DEMO_MEMORIES.find((candidate) => candidate.id === id);
        if (!memory) return null;
        return (
          <button key={id} onClick={() => onSelectMemory(id)} type="button">
            <Link2 size={11} />
            {memory.title}
          </button>
        );
      })}
    </div>
  );
}

function SystemMessage({
  message,
  onSelectMemory,
}: {
  message: DemoMessage;
  onSelectMemory: (id: string) => void;
}) {
  const icon =
    message.kind === "memory" ? (
      <Brain size={14} />
    ) : message.kind === "outcome" ? (
      <Check size={14} />
    ) : message.kind === "session" ? (
      <Clock3 size={14} />
    ) : (
      <Users size={14} />
    );
  return (
    <motion.article
      className={`vd-system-message vd-system-message--${message.kind}`}
      data-testid={`vision-message-${message.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34 }}
    >
      <span className="vd-system-message__icon">{icon}</span>
      <div>
        <strong>{message.body}</strong>
        {message.meta ? <small>{message.meta}</small> : null}
        <MemoryReferences
          memoryIds={message.memoryIds}
          onSelectMemory={onSelectMemory}
        />
      </div>
      <time>{message.time}</time>
    </motion.article>
  );
}

function ChatMessage({
  message,
  onSelectMemory,
}: {
  message: DemoMessage;
  onSelectMemory: (id: string) => void;
}) {
  if (message.author === "system") {
    return <SystemMessage message={message} onSelectMemory={onSelectMemory} />;
  }
  const isOwner = message.author === "riley";
  const agent = message.author === "riley" ? null : agentById(message.author);
  return (
    <motion.article
      animate={{ opacity: 1, y: 0 }}
      className={`vd-chat-message ${isOwner ? "vd-chat-message--owner" : ""}`}
      data-testid={`vision-message-${message.id}`}
      initial={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.38 }}
    >
      <div className="vd-message-avatar">
        {agent ? (
          <AgentAvatar agent={agent} />
        ) : (
          <span className="vd-owner-avatar vd-owner-avatar--message">RC</span>
        )}
      </div>
      <div className="vd-message-content">
        <header>
          <strong>{agent?.name ?? "Riley"}</strong>
          <span>{agent?.role ?? "Owner"}</span>
          <time>{message.time}</time>
        </header>
        <p>{message.body}</p>
        <MemoryReferences
          memoryIds={message.memoryIds}
          onSelectMemory={onSelectMemory}
        />
        {message.meta ? (
          <div className="vd-message-meta">
            <Fingerprint size={11} />
            {message.meta}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

function Composer({
  draft,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="vd-composer" onSubmit={submit}>
      <button
        aria-label="Add attachment"
        className="vd-icon-button"
        type="button"
      >
        <Plus size={16} />
      </button>
      <input
        aria-label="Message the launch room"
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Message Luca, Mara, and Sol…"
        value={draft}
      />
      <span className="vd-composer__scope">3 agents · shared room</span>
      <button
        aria-label="Send message"
        className="vd-composer__send"
        disabled={!draft.trim()}
        type="submit"
      >
        <ArrowUp size={15} strokeWidth={2} />
      </button>
    </form>
  );
}

function NetworkView({
  runtime,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const messageCount = runtime.visibleMessages.length;
  useEffect(() => {
    if (messageCount === 0) {
      return;
    }
    endRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messageCount, reduceMotion]);

  const selectMemory = (id: string) => {
    runtime.setSelectedMemoryId(id);
    runtime.setView("brain");
  };

  return (
    <div className="vd-network-view">
      <div className="vd-thread" data-testid="vision-network-thread">
        <div className="vd-thread__intro">
          <span className="vd-thread__glyph">#</span>
          <div>
            <h2>launch-room</h2>
            <p>A continuous room for shaping the Luca Agent Network launch.</p>
          </div>
          <div className="vd-thread__participants">
            {DEMO_AGENTS.map((agent) => (
              <AgentAvatar agent={agent} key={agent.id} size="small" />
            ))}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {runtime.visibleMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onSelectMemory={selectMemory}
            />
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
      <div className="vd-composer-wrap">
        <Composer
          draft={runtime.draft}
          onDraftChange={runtime.setDraft}
          onSubmit={runtime.sendDraft}
        />
        <p>Local demo notes stay on this device and are not sent to a model.</p>
      </div>
    </div>
  );
}

function IdentityLine({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="vd-identity-line">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  onSelect,
  step,
}: {
  agent: DemoAgent;
  selected: boolean;
  onSelect: () => void;
  step: number;
}) {
  const status =
    step >= 6
      ? "Reflecting"
      : step >= 3
        ? "In launch-room"
        : agent.id === "luca"
          ? "Present"
          : "Available";
  return (
    <button
      className="vd-agent-card"
      data-selected={selected}
      onClick={onSelect}
      style={{ "--agent-accent": agent.accent } as CSSProperties}
      type="button"
    >
      <header>
        <AgentAvatar agent={agent} size="large" />
        <div>
          <h3>{agent.name}</h3>
          <p>{agent.role}</p>
        </div>
        <span className="vd-agent-state">
          <i />
          {status}
        </span>
      </header>
      <blockquote>{agent.voice}</blockquote>
      <div className="vd-agent-card__metrics">
        <span>
          <strong>{agent.sessions}</strong>
          <small>shared sessions</small>
        </span>
        <span>
          <strong>{agent.reflections.toLocaleString()}</strong>
          <small>reflections</small>
        </span>
        <span>
          <strong>100%</strong>
          <small>continuity</small>
        </span>
      </div>
      <footer>
        <Fingerprint size={12} />
        <code>{agent.fingerprint}</code>
        <ChevronRight size={14} />
      </footer>
    </button>
  );
}

function AgentsView({
  runtime,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
}) {
  const selected = agentById(runtime.selectedAgentId);
  return (
    <div className="vd-agents-view" data-testid="vision-agents-view">
      <section className="vd-agents-intro">
        <div>
          <span className="vd-eyebrow">Persistent residents</span>
          <h2>Not sessions. Relationships.</h2>
          <p>
            Each resident has one durable identity across every room, runtime,
            and return. Their memory scope is explicit; their history belongs to
            the relationship.
          </p>
        </div>
        <div className="vd-network-health">
          <ShieldCheck size={18} />
          <span>
            <strong>3 / 3 continuous</strong>
            <small>Identity chain verified</small>
          </span>
        </div>
      </section>
      <div className="vd-agent-grid">
        {DEMO_AGENTS.map((agent) => (
          <AgentCard
            agent={agent}
            key={agent.id}
            onSelect={() => runtime.setSelectedAgentId(agent.id)}
            selected={selected.id === agent.id}
            step={runtime.step}
          />
        ))}
      </div>
      <section
        className="vd-agent-detail"
        style={{ "--agent-accent": selected.accent } as CSSProperties}
      >
        <div className="vd-agent-detail__portrait">
          <AgentAvatar agent={selected} size="large" />
          <div>
            <span>Selected resident</span>
            <h3>{selected.name}</h3>
            <p>{selected.role}</p>
          </div>
        </div>
        <div className="vd-agent-detail__identity">
          <IdentityLine
            icon={<KeyRound size={14} />}
            label="Public identity"
            value={selected.fingerprint}
          />
          <IdentityLine
            icon={<Clock3 size={14} />}
            label="Relationship"
            value={selected.relationship}
          />
          <IdentityLine
            icon={<Brain size={14} />}
            label="Brain access"
            value={selected.scope}
          />
          <IdentityLine
            icon={<Orbit size={14} />}
            label="Last consolidation"
            value={selected.lastConsolidation}
          />
        </div>
        <div className="vd-agent-detail__receipt">
          <span>
            <Fingerprint size={13} /> Continuity receipt
          </span>
          <code>{selected.publicKey}</code>
          <small>
            Same signing identity observed across {selected.sessions} sessions.
          </small>
        </div>
      </section>
    </div>
  );
}

function MemoryScope({ memory }: { memory: DemoMemory }) {
  return (
    <div className="vd-memory-scope">
      <span>{memory.scope}</span>
      <div>
        {memory.allowedAgents.map((id) => (
          <AgentAvatar agent={agentById(id)} key={id} size="small" />
        ))}
      </div>
    </div>
  );
}

function BrainView({
  runtime,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
}) {
  const selected =
    DEMO_MEMORIES.find((memory) => memory.id === runtime.selectedMemoryId) ??
    runtime.visibleMemories[0] ??
    DEMO_MEMORIES[0];
  return (
    <div className="vd-brain-view" data-testid="vision-brain-view">
      <section className="vd-memory-list">
        <header>
          <div>
            <span className="vd-eyebrow">Retrieved for this story</span>
            <h2>{runtime.visibleMemories.length} memories</h2>
          </div>
          <button
            className="vd-icon-button"
            type="button"
            aria-label="Search memory"
          >
            <Search size={15} />
          </button>
        </header>
        <div className="vd-memory-list__items">
          {runtime.visibleMemories.map((memory) => (
            <button
              data-selected={selected.id === memory.id}
              key={memory.id}
              onClick={() => runtime.setSelectedMemoryId(memory.id)}
              type="button"
            >
              <span className="vd-memory-type">
                <Brain size={12} />
                {memory.source}
              </span>
              <strong>{memory.title}</strong>
              <p>{memory.body}</p>
              <footer>
                <span>{memory.recorded}</span>
                <MemoryScope memory={memory} />
              </footer>
            </button>
          ))}
        </div>
      </section>
      <section className="vd-memory-detail">
        <header>
          <span className="vd-eyebrow">Memory record</span>
          <div className="vd-verified">
            <ShieldCheck size={13} />
            {selected.confidence}
          </div>
        </header>
        <h2>{selected.title}</h2>
        <p className="vd-memory-detail__body">{selected.body}</p>
        <div className="vd-memory-detail__tags">
          {selected.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="vd-memory-detail__provenance">
          <h3>Provenance</h3>
          <IdentityLine
            icon={<Link2 size={14} />}
            label="Source"
            value={selected.sourceDetail}
          />
          <IdentityLine
            icon={<Clock3 size={14} />}
            label="Recorded"
            value={selected.recorded}
          />
          <IdentityLine
            icon={<ShieldCheck size={14} />}
            label="Scope"
            value={selected.scope}
          />
        </div>
        <div className="vd-memory-detail__access">
          <h3>Agents with access</h3>
          {selected.allowedAgents.map((id) => {
            const agent = agentById(id);
            return (
              <div key={id}>
                <AgentAvatar agent={agent} size="small" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                </span>
                <Check size={13} />
              </div>
            );
          })}
        </div>
        <div className="vd-receipt-bar">
          <Fingerprint size={13} />
          <span>Recall receipt</span>
          <code>mem · {selected.id.slice(-8)} · scoped</code>
        </div>
      </section>
    </div>
  );
}

function ContinuityView({
  runtime,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
}) {
  const selected = agentById(runtime.selectedAgentId);
  const events = runtime.visibleContinuity.filter(
    (event) => event.agentId === selected.id || runtime.step >= 6,
  );
  return (
    <div className="vd-continuity-view" data-testid="vision-continuity-view">
      <section className="vd-continuity-intro">
        <div>
          <span className="vd-eyebrow">Between sessions</span>
          <h2>The thread does not close.</h2>
          <p>
            Sessions become reflection. Reflection becomes a reviewable
            consolidation. The next encounter begins with the same identity and
            the questions that still matter.
          </p>
        </div>
        <div className="vd-continuity-agent-picker">
          {DEMO_AGENTS.map((agent) => (
            <button
              data-selected={selected.id === agent.id}
              key={agent.id}
              onClick={() => runtime.setSelectedAgentId(agent.id)}
              type="button"
            >
              <AgentAvatar agent={agent} size="small" />
              <span>{agent.name}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="vd-continuity-body">
        <section className="vd-continuity-timeline">
          <div className="vd-timeline-axis" aria-hidden="true" />
          {events.map((event, index) => {
            const agent = agentById(event.agentId);
            return (
              <motion.article
                animate={{ opacity: 1, x: 0 }}
                className={`vd-continuity-event vd-continuity-event--${event.type}`}
                initial={{ opacity: 0, x: -10 }}
                key={event.id}
                transition={{ delay: index * 0.07 }}
              >
                <div className="vd-continuity-event__node">
                  <i />
                </div>
                <header>
                  <span>{event.type}</span>
                  <time>{event.time}</time>
                </header>
                <div className="vd-continuity-event__author">
                  <AgentAvatar agent={agent} size="small" />
                  <strong>{agent.name}</strong>
                </div>
                <h3>{event.title}</h3>
                <p>{event.body}</p>
                <footer>
                  <Fingerprint size={11} />
                  {event.receipt}
                </footer>
              </motion.article>
            );
          })}
          {runtime.step < 6 ? (
            <div className="vd-continuity-locked">
              <Orbit size={15} />
              <span>
                Advance the story to close the session and begin reflection.
              </span>
            </div>
          ) : null}
        </section>
        <aside
          className="vd-inner-life-panel"
          style={{ "--agent-accent": selected.accent } as CSSProperties}
        >
          <header>
            <AgentAvatar agent={selected} size="large" />
            <div>
              <span>Inner-life record</span>
              <h3>{selected.name}</h3>
            </div>
          </header>
          <div className="vd-inner-life-stat">
            <span>Relationship continuity</span>
            <strong>100%</strong>
            <i>
              <b />
            </i>
          </div>
          <div className="vd-inner-life-stat">
            <span>Shared sessions</span>
            <strong>{selected.sessions}</strong>
          </div>
          <div className="vd-inner-life-stat">
            <span>Private reflections</span>
            <strong>{selected.reflections.toLocaleString()}</strong>
          </div>
          <div className="vd-inner-life-question">
            <span>Unresolved thread</span>
            <p>
              How do we make continuity felt before we explain its architecture?
            </p>
          </div>
          <div className="vd-inner-life-boundary">
            <ShieldCheck size={13} />
            <p>
              Reflections are private. Consolidation proposals require Riley's
              review before entering shared memory.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ContextPanel({
  runtime,
}: {
  runtime: ReturnType<typeof useDemoRuntime>;
}) {
  const selected = agentById(runtime.selectedAgentId);
  const currentBeat = STORY_BEATS[runtime.step];
  return (
    <aside className="vd-context-panel">
      <section className="vd-now-card">
        <span className="vd-eyebrow">Now</span>
        <div className="vd-now-card__title">
          {runtime.isPlaying ? (
            <CirclePause size={16} />
          ) : (
            <CirclePlay size={16} />
          )}
          <h3>{currentBeat.label}</h3>
        </div>
        <p>
          {runtime.step >= 6
            ? "The conversation has become continuity: reflection, review, and return."
            : "The room is forming a launch thesis from relationship history and explicit memory."}
        </p>
        <div className="vd-now-card__progress">
          <i
            style={{
              width: `${((runtime.step + 1) / STORY_BEATS.length) * 100}%`,
            }}
          />
        </div>
        <small>
          Beat {runtime.step + 1} of {STORY_BEATS.length}
        </small>
      </section>
      <section className="vd-context-section">
        <header>
          <span>In this room</span>
          <button onClick={() => runtime.setView("agents")} type="button">
            Inspect
          </button>
        </header>
        {DEMO_AGENTS.map((agent) => (
          <button
            className="vd-context-agent"
            key={agent.id}
            onClick={() => runtime.setSelectedAgentId(agent.id)}
            type="button"
          >
            <AgentAvatar agent={agent} size="small" />
            <span>
              <strong>{agent.name}</strong>
              <small>
                {runtime.step >= 6
                  ? "Reflecting"
                  : runtime.step >= 3 || agent.id === "luca"
                    ? "Present"
                    : "Available"}
              </small>
            </span>
            <i />
          </button>
        ))}
      </section>
      <section className="vd-context-section">
        <header>
          <span>Memory in use</span>
          <button onClick={() => runtime.setView("brain")} type="button">
            Open brain
          </button>
        </header>
        {runtime.visibleMemories.length ? (
          runtime.visibleMemories.slice(-2).map((memory) => (
            <button
              className="vd-context-memory"
              key={memory.id}
              onClick={() => {
                runtime.setSelectedMemoryId(memory.id);
                runtime.setView("brain");
              }}
              type="button"
            >
              <Brain size={13} />
              <span>
                <strong>{memory.title}</strong>
                <small>
                  {memory.source} · {memory.confidence}
                </small>
              </span>
              <ChevronRight size={12} />
            </button>
          ))
        ) : (
          <p className="vd-context-empty">No memory has been opened yet.</p>
        )}
      </section>
      <section
        className="vd-selected-identity"
        style={{ "--agent-accent": selected.accent } as CSSProperties}
      >
        <header>
          <AgentAvatar agent={selected} />
          <span>
            <small>Selected identity</small>
            <strong>{selected.name}</strong>
          </span>
        </header>
        <code>{selected.fingerprint}</code>
        <div>
          <ShieldCheck size={12} />
          Continuous across {selected.sessions} sessions
        </div>
      </section>
    </aside>
  );
}

export function VisionDemoApp() {
  const runtime = useDemoRuntime();
  const viewContent = useMemo(() => {
    switch (runtime.view) {
      case "agents":
        return <AgentsView runtime={runtime} />;
      case "brain":
        return <BrainView runtime={runtime} />;
      case "continuity":
        return <ContinuityView runtime={runtime} />;
      default:
        return <NetworkView runtime={runtime} />;
    }
  }, [runtime]);

  useEffect(() => {
    document.title = "Luca Agent Network · Interactive Vision";
    document.documentElement.dataset.visionDemo = "true";
    return () => {
      delete document.documentElement.dataset.visionDemo;
    };
  }, []);

  return (
    <div className="vd-app" data-testid="vision-demo-app">
      <VisionRail onViewChange={runtime.setView} view={runtime.view} />
      <WorkspaceSidebar
        onSelectAgent={runtime.setSelectedAgentId}
        onViewChange={runtime.setView}
        selectedAgentId={runtime.selectedAgentId}
      />
      <main className="vd-main">
        <ViewHeader
          isPlaying={runtime.isPlaying}
          onRestart={runtime.restart}
          onToggle={runtime.togglePlayback}
          step={runtime.step}
          view={runtime.view}
        />
        <StoryStrip onJump={runtime.jumpToStep} step={runtime.step} />
        <div className="vd-view-stage" key={runtime.view}>
          {viewContent}
        </div>
      </main>
      {runtime.view === "network" ? <ContextPanel runtime={runtime} /> : null}
      <div className="vd-mobile-disclosure">
        <DemoDisclosure testId="vision-demo-disclosure-mobile" />
      </div>
    </div>
  );
}
