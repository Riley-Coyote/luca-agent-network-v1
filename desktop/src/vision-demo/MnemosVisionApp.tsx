import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Command,
  Hash,
  Info,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  UserPlus,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { AgentIdentitySpecimen } from "@/vision-demo/AgentIdentitySpecimen";
import { MnemosIcon, type MnemosIconName } from "@/vision-demo/MnemosIcon";
import {
  VisionModeProvider,
  useVisionMode,
} from "@/vision-demo/VisionModeContext";
import type {
  AgentId,
  ContinuityEvent,
  DemoAgent,
  DemoMemory,
  DemoMessage,
  DemoView,
} from "@/vision-demo/demoRuntime";
import "@/vision-demo/mnemos-vision.css";

const destinations: Array<{
  id: DemoView;
  label: string;
  icon: MnemosIconName;
}> = [
  { id: "network", label: "Network", icon: "network" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "brain", label: "Brain", icon: "brain" },
  { id: "continuity", label: "Continuity", icon: "continuity" },
];

function IconButton({
  label,
  children,
  className,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={["mn-icon-button", className].filter(Boolean).join(" ")}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function Sidebar() {
  const { data, isSidebarCollapsed, setSidebarCollapsed, setInspector } =
    useVisionMode();
  const { runtime } = data;

  return (
    <aside
      aria-label="Mnemos navigation"
      className="mn-sidebar"
      data-collapsed={isSidebarCollapsed}
    >
      <div className="mn-sidebar-brand">
        <div className="mn-brand-lockup">
          <div className="mn-sidebar-copy">
            <strong>MNEMOS</strong>
          </div>
        </div>
        <IconButton
          className="mn-sidebar-toggle"
          label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
        >
          {isSidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      </div>

      <button className="mn-new-conversation" type="button">
        <Plus aria-hidden="true" />
        <span className="mn-sidebar-copy">New conversation</span>
        <kbd className="mn-sidebar-copy">⌘ N</kbd>
      </button>

      <button className="mn-command-search" type="button">
        <Search aria-hidden="true" />
        <span className="mn-sidebar-copy">Search</span>
        <kbd className="mn-sidebar-copy">
          <Command aria-hidden="true" />K
        </kbd>
      </button>

      <nav className="mn-primary-nav">
        {destinations.map(({ id, label, icon }) => {
          const active = runtime.view === id;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className="mn-nav-item"
              data-active={active}
              data-testid={`vision-nav-${id}`}
              key={id}
              onClick={() => runtime.setView(id)}
              title={label}
              type="button"
            >
              <MnemosIcon name={icon} />
              <span className="mn-sidebar-copy">{label}</span>
            </button>
          );
        })}
      </nav>

      <section className="mn-sidebar-section mn-sidebar-copy">
        <header>
          <span>RECENT CONVERSATIONS</span>
          <button aria-label="Add room" type="button">
            <Plus aria-hidden="true" />
          </button>
        </header>
        <div className="mn-room-list">
          {data.rooms.map((room) => (
            <button
              className="mn-room-row"
              data-active={room.id === data.activeRoomId}
              key={room.id}
              type="button"
            >
              <span>{room.name}</span>
              {room.unread ? <b>{room.unread}</b> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="mn-sidebar-section mn-residents mn-sidebar-copy">
        <header>
          <span>RESIDENT AGENTS</span>
          <span>{data.agents.length}</span>
        </header>
        <div>
          {data.agents.map((agent, index) => (
            <button
              className="mn-resident-row"
              key={agent.id}
              onClick={() => setInspector({ kind: "agent", id: agent.id })}
              type="button"
            >
              <AgentIdentitySpecimen
                accessibleName={agent.name}
                publicKey={agent.publicKey}
                size={26}
                state={runtime.isPlaying && index === 0 ? "working" : "present"}
              />
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <footer className="mn-sidebar-footer">
        <div className="mn-owner-specimen">RC</div>
        <div className="mn-sidebar-copy">
          <strong>{data.network.owner}</strong>
          <span>
            <i data-live={runtime.isPlaying} /> {data.network.health}
          </span>
        </div>
        <button
          aria-label="Network settings"
          className="mn-sidebar-copy"
          type="button"
        >
          <MnemosIcon name="activity" />
        </button>
      </footer>
    </aside>
  );
}

function DemoControl() {
  const { data, isNavigatorOpen, setNavigatorOpen } = useVisionMode();
  const { runtime, story } = data;

  return (
    <div className="mn-demo-control-wrap">
      <div className="mn-demo-control" data-material="housing">
        <button
          aria-expanded={isNavigatorOpen}
          className="mn-demo-index"
          data-testid="vision-demo-disclosure-desktop"
          onClick={() => setNavigatorOpen(!isNavigatorOpen)}
          type="button"
        >
          <span>DEMO</span>
          <b>{String(runtime.step + 1).padStart(2, "0")}/08</b>
          <ChevronDown aria-hidden="true" />
        </button>
        <button
          aria-label={runtime.isPlaying ? "Pause demo" : "Play demo"}
          onClick={runtime.togglePlayback}
          type="button"
        >
          {runtime.isPlaying ? <Pause /> : <Play />}
        </button>
      </div>
      {isNavigatorOpen ? (
        <div className="mn-demo-navigator" data-material="housing">
          <header>
            <span>DETERMINISTIC STORY</span>
            <button
              aria-label="Restart story"
              onClick={() => {
                runtime.restart();
                setNavigatorOpen(false);
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" />
              Restart
            </button>
          </header>
          <ol>
            {story.map((beat, index) => (
              <li key={beat.label}>
                <button
                  aria-current={runtime.step === index ? "step" : undefined}
                  data-testid={`vision-story-step-${index}`}
                  onClick={() => {
                    runtime.jumpToStep(index);
                    runtime.setView("network");
                    setNavigatorOpen(false);
                  }}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{beat.label}</strong>
                  <small>{beat.short}</small>
                </button>
              </li>
            ))}
          </ol>
          <p>
            Interactive vision · simulated activity. Messages and system events
            are deterministic; composer notes stay on this device.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TopChrome() {
  const { data, setInspector } = useVisionMode();
  const activeDestination =
    destinations.find(({ id }) => id === data.runtime.view) ?? destinations[0];
  const headings: Record<DemoView, { title: string; detail: string }> = {
    network: {
      title: "launch-room",
      detail: "Where the product learns to explain itself",
    },
    agents: {
      title: "Resident agents",
      detail: "Stable identities, relationships, and access boundaries",
    },
    brain: {
      title: "Universal brain",
      detail: "Personal memory with provenance and explicit authority",
    },
    continuity: {
      title: "Continuity ledger",
      detail: "Signed evidence across sessions, reflection, and return",
    },
  };
  const heading = headings[data.runtime.view];
  return (
    <header className="mn-top-chrome">
      <div className="mn-window-drag" data-tauri-drag-region />
      <div className="mn-room-heading">
        {data.runtime.view === "network" ? (
          <Hash aria-hidden="true" />
        ) : (
          <MnemosIcon name={activeDestination.icon} />
        )}
        <div>
          <strong>{heading.title}</strong>
          <span>{heading.detail}</span>
        </div>
      </div>
      <button
        className="mn-participant-stack"
        onClick={() => setInspector({ kind: "agent", id: "luca" })}
        type="button"
      >
        <span className="mn-participant-marks">
          {data.agents.map((agent) => (
            <AgentIdentitySpecimen
              accessibleName={agent.name}
              key={agent.id}
              publicKey={agent.publicKey}
              size={24}
            />
          ))}
        </span>
        <span>Add participant</span>
        <UserPlus aria-hidden="true" />
      </button>
      <div className="mn-header-tools">
        <IconButton label="Search this conversation">
          <Search />
        </IconButton>
        <IconButton
          label="Open thread context"
          onClick={() => setInspector({ kind: "agent", id: "luca" })}
        >
          <Info />
        </IconButton>
        <IconButton label="More conversation actions">
          <MoreHorizontal />
        </IconButton>
      </div>
      <DemoControl />
    </header>
  );
}

function SurfaceHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
}) {
  return (
    <header className="mn-surface-header">
      <div>
        <span className="mn-engraving">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <span className="mn-surface-meta">{meta}</span>
    </header>
  );
}

function AgentRosterRow({ agent }: { agent: DemoAgent }) {
  const { data, setInspector } = useVisionMode();
  const { runtime } = data;
  const selected = runtime.selectedAgentId === agent.id;
  const isWorking =
    runtime.step >= 4 && runtime.step <= 5 && agent.id === "luca";

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className="mn-directory-row"
      data-selected={selected}
      data-testid={`vision-agent-row-${agent.id}`}
      onClick={() => runtime.setSelectedAgentId(agent.id)}
      onDoubleClick={() => setInspector({ kind: "agent", id: agent.id })}
      type="button"
    >
      <AgentIdentitySpecimen
        accessibleName={agent.name}
        publicKey={agent.publicKey}
        size={38}
        state={isWorking ? "working" : "present"}
      />
      <span className="mn-directory-copy">
        <strong>{agent.name}</strong>
        <small>{agent.role}</small>
      </span>
      <span className="mn-directory-state">
        <i data-live={isWorking} />
        {isWorking ? "Working" : "Continuous"}
      </span>
    </button>
  );
}

function AgentsSurface() {
  const { data, setInspector } = useVisionMode();
  const { runtime } = data;
  const selected = data.agentById(runtime.selectedAgentId);
  const working = runtime.step >= 4 && runtime.step <= 5;

  return (
    <section className="mn-product-surface" data-testid="vision-agents-surface">
      <SurfaceHeader
        description="The same collaborators return with an inspectable identity, relationship history, and permission boundary."
        eyebrow="PERSONAL NETWORK / RESIDENT DIRECTORY"
        meta={`${data.agents.length} residents · identity chain healthy`}
        title="Agents are residents, not disposable sessions."
      />
      <div className="mn-list-detail">
        <aside className="mn-directory-list" aria-label="Resident agent roster">
          <header>
            <span>RESIDENT</span>
            <span>CONTINUITY</span>
          </header>
          {data.agents.map((agent) => (
            <AgentRosterRow agent={agent} key={agent.id} />
          ))}
          <footer>
            <ShieldCheck aria-hidden="true" />
            Three signing identities verified locally
          </footer>
        </aside>
        <article
          className="mn-agent-dossier"
          data-testid="vision-agent-dossier"
        >
          <header className="mn-dossier-heading">
            <AgentIdentitySpecimen
              accessibleName={selected.name}
              publicKey={selected.publicKey}
              size={68}
              state={working && selected.id === "luca" ? "working" : "present"}
            />
            <div>
              <span className="mn-engraving">RESIDENT DOSSIER / VERIFIED</span>
              <h2>{selected.name}</h2>
              <p>{selected.role}</p>
            </div>
            <button
              aria-label={`Open ${selected.name} identity inspector`}
              onClick={() => setInspector({ kind: "agent", id: selected.id })}
              type="button"
            >
              Full identity <ArrowUpRight aria-hidden="true" />
            </button>
          </header>

          {working && selected.id === "luca" ? (
            <section className="mn-cognition-well" data-material="display">
              <header>
                <span className="mn-display-live">
                  <i /> LIVE COGNITION
                </span>
                <span>SESSION {selected.sessions + 1}</span>
              </header>
              <strong>
                Holding the launch thread while the network synthesizes.
              </strong>
              <p>
                Consulting scoped product memory · preserving unresolved
                questions · no durable write
              </p>
            </section>
          ) : null}

          <blockquote>{selected.voice}</blockquote>
          <dl className="mn-dossier-ledger">
            <div>
              <dt>Relationship age</dt>
              <dd>{selected.relationship}</dd>
            </div>
            <div>
              <dt>Shared sessions</dt>
              <dd>{selected.sessions}</dd>
            </div>
            <div>
              <dt>Private reflections</dt>
              <dd>{selected.reflections.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last consolidation</dt>
              <dd>{selected.lastConsolidation}</dd>
            </div>
            <div className="mn-dossier-ledger-wide">
              <dt>Universal brain access</dt>
              <dd>{selected.scope}</dd>
            </div>
          </dl>
          <section className="mn-identity-receipt">
            <div>
              <MnemosIcon name="receipt" />
              <span>
                <strong>Continuity receipt</strong>
                <small>
                  Same signing identity across {selected.sessions} sessions
                </small>
              </span>
            </div>
            <code>{selected.fingerprint}</code>
            <button
              onClick={() => setInspector({ kind: "receipt", id: selected.id })}
              type="button"
            >
              Inspect receipt
            </button>
          </section>
        </article>
      </div>
    </section>
  );
}

function MemoryRow({ memory }: { memory: DemoMemory }) {
  const { data } = useVisionMode();
  const { runtime } = data;
  const selected = runtime.selectedMemoryId === memory.id;
  const recalled = memory.recalledAt <= runtime.step;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className="mn-memory-row"
      data-selected={selected}
      data-testid={`vision-memory-row-${memory.id}`}
      onClick={() => runtime.setSelectedMemoryId(memory.id)}
      type="button"
    >
      <span className="mn-memory-row-mark">
        <MnemosIcon name="memory" />
      </span>
      <span className="mn-directory-copy">
        <strong>{memory.title}</strong>
        <small>
          {memory.source} · {memory.recorded}
        </small>
      </span>
      <span className="mn-memory-row-state" data-active={recalled}>
        {recalled ? "Recalled" : "Stored"}
      </span>
    </button>
  );
}

function BrainSurface() {
  const { data, setInspector } = useVisionMode();
  const { runtime } = data;
  const selected =
    data.memoryById(runtime.selectedMemoryId) ?? data.memories[0];
  const inUse =
    selected.recalledAt <= runtime.step && runtime.step > 0 && runtime.step < 7;

  return (
    <section className="mn-product-surface" data-testid="vision-brain-surface">
      <SurfaceHeader
        description="A shared personal memory system where every useful fragment retains its origin, scope, and authority."
        eyebrow="UNIVERSAL BRAIN / PROVENANCE FIRST"
        meta={`${data.memories.length} selected memories · reviewable`}
        title="Shared memory without a black box."
      />
      <div className="mn-list-detail mn-brain-layout">
        <aside className="mn-directory-list" aria-label="Memory directory">
          <header>
            <span>MEMORY</span>
            <span>STATE</span>
          </header>
          {data.memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </aside>
        <article
          className="mn-memory-detail"
          data-testid="vision-memory-detail"
        >
          <header>
            <div>
              <span className="mn-engraving">
                {selected.source.toUpperCase()} / DURABLE MEMORY
              </span>
              <h2>{selected.title}</h2>
            </div>
            <button
              aria-label="Open selected memory provenance"
              onClick={() => setInspector({ kind: "memory", id: selected.id })}
              type="button"
            >
              Open provenance <ArrowUpRight aria-hidden="true" />
            </button>
          </header>
          {inUse ? (
            <section className="mn-memory-use-well" data-material="display">
              <header>
                <span className="mn-display-live">
                  <i /> IN ACTIVE RECALL
                </span>
                <span>CONFIDENCE / {selected.confidence}</span>
              </header>
              <p>{selected.body}</p>
              <footer>
                <span>
                  <MnemosIcon name="receipt" /> RECEIPT 7F21 · A90C
                </span>
                <span>Scoped retrieval · simulated</span>
              </footer>
            </section>
          ) : (
            <p className="mn-memory-body">{selected.body}</p>
          )}
          <dl className="mn-provenance-ledger">
            <div>
              <dt>Source</dt>
              <dd>{selected.sourceDetail}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{selected.recorded}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{selected.scope}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{selected.confidence}</dd>
            </div>
          </dl>
          <section className="mn-memory-authority">
            <header>
              <span className="mn-engraving">AUTHORIZED TO RECALL</span>
              <span>{selected.allowedAgents.length} residents</span>
            </header>
            <div>
              {selected.allowedAgents.map((id) => {
                const agent = data.agentById(id);
                return (
                  <button
                    key={id}
                    onClick={() => setInspector({ kind: "agent", id })}
                    type="button"
                  >
                    <AgentIdentitySpecimen
                      accessibleName={agent.name}
                      publicKey={agent.publicKey}
                      size={32}
                    />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.role}</small>
                    </span>
                    <b>READ</b>
                  </button>
                );
              })}
            </div>
          </section>
          <footer className="mn-tag-line">
            {selected.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </footer>
        </article>
      </div>
    </section>
  );
}

function ContinuityLedgerEvent({ event }: { event: ContinuityEvent }) {
  const { data, setInspector } = useVisionMode();
  const agent = data.agentById(event.agentId);
  return (
    <button
      className="mn-continuity-event"
      data-event-type={event.type}
      data-testid={`vision-continuity-event-${event.id}`}
      onClick={() => setInspector({ kind: "continuity", id: event.id })}
      type="button"
    >
      <span className="mn-continuity-spine">
        <i />
      </span>
      <AgentIdentitySpecimen
        accessibleName={agent.name}
        publicKey={agent.publicKey}
        size={38}
        state={event.type === "return" ? "present" : "idle"}
      />
      <span className="mn-continuity-copy">
        <span>
          <b>{event.type}</b>
          <time>{event.time}</time>
        </span>
        <strong>{event.title}</strong>
        <small>{event.body}</small>
      </span>
      <code>{event.receipt}</code>
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

function ContinuitySurface() {
  const { data } = useVisionMode();
  const { runtime } = data;
  const visible = data.continuity.filter(
    (event) => event.visibleAt <= runtime.step,
  );
  const next = data.continuity.find((event) => event.visibleAt > runtime.step);

  return (
    <section
      className="mn-product-surface"
      data-testid="vision-continuity-surface"
    >
      <SurfaceHeader
        description="Sessions end. Identity, unresolved questions, and reviewed learning remain connected as signed evidence."
        eyebrow="CONTINUITY / EVIDENCE LEDGER"
        meta={`Session ${runtime.step === 7 ? "427" : "426"} · ${visible.length} signed events`}
        title="The relationship survives the session boundary."
      />
      <div className="mn-continuity-layout">
        <div className="mn-evidence-ledger">
          <header>
            <span>EVENT CHAIN</span>
            <span>IDENTITY / RECEIPT</span>
          </header>
          {visible.map((event) => (
            <ContinuityLedgerEvent event={event} key={event.id} />
          ))}
          {next ? (
            <div className="mn-continuity-pending">
              <Clock3 aria-hidden="true" />
              <span>
                <strong>Next evidence boundary</strong>
                <small>
                  {next.type === "return"
                    ? "A later session verifies the same identity and unresolved thread."
                    : "Reflection begins only after the room closes."}
                </small>
              </span>
            </div>
          ) : null}
        </div>
        <aside className="mn-review-authority">
          <header>
            <MnemosIcon name="continuity" />
            <span>
              <b>RILEY'S AUTHORITY</b>
              <strong>Review boundary</strong>
            </span>
          </header>
          <p>
            Private reflection may shape a proposal. It does not become durable
            personal memory without review.
          </p>
          <dl>
            <div>
              <dt>Private reflections</dt>
              <dd>{runtime.step >= 6 ? "3 complete" : "Not started"}</dd>
            </div>
            <div>
              <dt>Proposals</dt>
              <dd>{runtime.step >= 6 ? "2 waiting" : "None"}</dd>
            </div>
            <div>
              <dt>Automatic writes</dt>
              <dd>Disabled</dd>
            </div>
          </dl>
          <div className="mn-review-verdict">
            <Check aria-hidden="true" />
            <span>
              <strong>Human review retained</strong>
              <small>
                No private reflection silently enters the universal brain.
              </small>
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PersonMessage({ message }: { message: DemoMessage }) {
  const { data, setInspector } = useVisionMode();
  const agent =
    message.author === "riley" || message.author === "system"
      ? null
      : data.agentById(message.author);

  return (
    <article
      className="mn-message"
      data-author={message.author}
      data-testid={`vision-message-${message.id}`}
    >
      <button
        aria-label={agent ? `Inspect ${agent.name}` : "Riley"}
        className="mn-message-identity"
        disabled={!agent}
        onClick={() =>
          agent ? setInspector({ kind: "agent", id: agent.id }) : undefined
        }
        type="button"
      >
        {agent ? (
          <AgentIdentitySpecimen
            accessibleName={agent.name}
            publicKey={agent.publicKey}
            size={32}
          />
        ) : (
          <span className="mn-owner-specimen">RC</span>
        )}
      </button>
      <div className="mn-message-content">
        <header>
          <strong>{agent?.name ?? "Riley"}</strong>
          <span>{message.time}</span>
          {agent ? <small>{agent.role}</small> : null}
        </header>
        <p>{message.body}</p>
        {message.meta ? <footer>{message.meta}</footer> : null}
      </div>
    </article>
  );
}

function MemoryRecall({ message }: { message: DemoMessage }) {
  const { data, setInspector } = useVisionMode();
  const memory =
    data.memoryById(message.memoryIds?.[0] ?? "") ?? data.recalledMemory;
  return (
    <section
      aria-label="Recalled memory"
      className="mn-memory-well"
      data-material="display"
      data-testid={`vision-message-${message.id}`}
    >
      <header>
        <div>
          <span className="mn-display-live">
            <i /> Remembered context
          </span>
          <span>{message.time}</span>
        </div>
        <MnemosIcon name="memory" />
      </header>
      <button
        className="mn-memory-content"
        onClick={() => setInspector({ kind: "memory", id: memory.id })}
        type="button"
      >
        <span className="mn-memory-index">RECALLED FROM YOUR BRAIN</span>
        <h2>{memory.title}</h2>
        <p>{memory.body}</p>
        <dl>
          <div>
            <dt>SOURCE</dt>
            <dd>{memory.sourceDetail}</dd>
          </div>
          <div>
            <dt>SCOPE</dt>
            <dd>{memory.scope}</dd>
          </div>
          <div>
            <dt>CONFIDENCE</dt>
            <dd>{memory.confidence}</dd>
          </div>
          <div>
            <dt>AUTHORIZED</dt>
            <dd className="mn-memory-agents">
              {memory.allowedAgents.map((id) => {
                const agent = data.agentById(id);
                return (
                  <AgentIdentitySpecimen
                    accessibleName={agent.name}
                    key={id}
                    publicKey={agent.publicKey}
                    size={20}
                  />
                );
              })}
            </dd>
          </div>
        </dl>
      </button>
      <footer>
        <span>
          <MnemosIcon name="receipt" /> Signed receipt · 7F21…A90C
        </span>
        <span>Open provenance</span>
      </footer>
    </section>
  );
}

function SystemEvent({ message }: { message: DemoMessage }) {
  const { data } = useVisionMode();
  if (message.kind === "outcome") {
    return (
      <section
        className="mn-outcome-ledger"
        data-testid={`vision-message-${message.id}`}
      >
        <header>
          <span>SHARED OUTCOME / 001</span>
          <span>{message.time}</span>
        </header>
        <h2>{message.body.replace("Launch thesis: ", "")}</h2>
        <footer>
          <span>CONTRIBUTORS</span>
          <div>
            {data.agents.map((agent) => (
              <span key={agent.id}>
                <AgentIdentitySpecimen
                  accessibleName={agent.name}
                  publicKey={agent.publicKey}
                  size={24}
                />
                {agent.name}
              </span>
            ))}
          </div>
        </footer>
      </section>
    );
  }

  return (
    <div
      className="mn-system-event"
      data-kind={message.kind}
      data-testid={`vision-message-${message.id}`}
    >
      <span className="mn-system-rule" />
      <MnemosIcon name={message.kind === "arrival" ? "agents" : "continuity"} />
      <div>
        <strong>{message.body}</strong>
        {message.meta ? <span>{message.meta}</span> : null}
      </div>
      <time>{message.time}</time>
      <span className="mn-system-rule" />
    </div>
  );
}

function Thread() {
  const { data } = useVisionMode();
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = data.messages.length;

  useEffect(() => {
    if (messageCount > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messageCount]);

  return (
    <div className="mn-thread-scroll" data-testid="vision-network-thread">
      <section className="mn-thread-intro">
        <div className="mn-thread-intro-mark">
          <MnemosIcon name="network" />
        </div>
        <span className="mn-engraving">PRIVATE ROOM · CREATED JUL 22</span>
        <h1>#launch-room</h1>
        <p>
          A continuous room for shaping the Mnemos launch with Luca, Mara, and
          Sol. Identity, recall, and authorship stay inspectable.
        </p>
        <div>
          {data.agents.map((agent) => (
            <span key={agent.id}>
              <AgentIdentitySpecimen
                accessibleName={agent.name}
                publicKey={agent.publicKey}
                size={22}
              />
              <span>{agent.name}</span>
            </span>
          ))}
        </div>
      </section>
      <div className="mn-message-list">
        {data.messages.map((message) => {
          if (message.kind === "memory") {
            return <MemoryRecall key={message.id} message={message} />;
          }
          if (message.kind !== "message") {
            return <SystemEvent key={message.id} message={message} />;
          }
          return <PersonMessage key={message.id} message={message} />;
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function Composer() {
  const { data } = useVisionMode();
  const { runtime } = data;

  function submit(event: FormEvent) {
    event.preventDefault();
    runtime.sendDraft();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      runtime.sendDraft();
    }
  }

  return (
    <form className="mn-composer" onSubmit={submit}>
      <div className="mn-composer-input">
        <textarea
          aria-label="Message the launch room"
          onChange={(event) => runtime.setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message #launch-room"
          rows={1}
          value={runtime.draft}
        />
        <div className="mn-composer-actions">
          <div>
            <IconButton label="Attach file">
              <Paperclip />
            </IconButton>
            <IconButton label="Add expression">
              <Smile />
            </IconButton>
          </div>
          <div>
            <span>Vision demo · local note</span>
            <button
              aria-label="Send local note"
              className="mn-send-button"
              disabled={!runtime.draft.trim()}
              type="submit"
            >
              <Send aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Inspector() {
  const {
    data,
    inspector,
    setInspector,
    isInspectorPinned,
    setInspectorPinned,
  } = useVisionMode();
  if (!inspector) return null;

  const memory =
    inspector.kind === "memory" ? data.memoryById(inspector.id) : null;
  const agent =
    inspector.kind === "agent" ? data.agentById(inspector.id as AgentId) : null;
  const continuity =
    inspector.kind === "continuity"
      ? data.continuity.find((event) => event.id === inspector.id)
      : null;
  const receiptAgent =
    inspector.kind === "receipt"
      ? data.agentById(inspector.id as AgentId)
      : null;
  const continuityAgent = continuity
    ? data.agentById(continuity.agentId)
    : null;
  const inspectorTitle = memory
    ? "Memory provenance"
    : agent
      ? "Resident identity"
      : receiptAgent
        ? "Continuity receipt"
        : "Signed continuity event";

  return (
    <aside
      className="mn-inspector"
      data-material="housing"
      data-pinned={isInspectorPinned}
    >
      <header>
        <div>
          <span>INSPECTOR</span>
          <strong>{inspectorTitle}</strong>
        </div>
        <div>
          <IconButton
            label={isInspectorPinned ? "Unpin inspector" : "Pin inspector"}
            onClick={() => setInspectorPinned(!isInspectorPinned)}
          >
            {isInspectorPinned ? <PinOff /> : <Pin />}
          </IconButton>
          <IconButton
            label="Close inspector"
            onClick={() => setInspector(null)}
          >
            <X />
          </IconButton>
        </div>
      </header>
      {memory ? (
        <div className="mn-inspector-body">
          <div className="mn-inspector-display" data-material="display">
            <MnemosIcon name="memory" />
            <span>RECALL / VERIFIED</span>
            <strong>7F21 A90C</strong>
          </div>
          <section>
            <span className="mn-engraving">DURABLE MEMORY</span>
            <h2>{memory.title}</h2>
            <p>{memory.body}</p>
          </section>
          <dl className="mn-inspector-ledger">
            <div>
              <dt>Source type</dt>
              <dd>{memory.source}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{memory.sourceDetail}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{memory.recorded}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{memory.scope}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{memory.confidence}</dd>
            </div>
          </dl>
          <section className="mn-authority-section">
            <span className="mn-engraving">AUTHORIZED AGENTS</span>
            {memory.allowedAgents.map((id) => {
              const authorized = data.agentById(id);
              return (
                <div key={id}>
                  <AgentIdentitySpecimen
                    accessibleName={authorized.name}
                    publicKey={authorized.publicKey}
                    size={28}
                  />
                  <span>
                    <strong>{authorized.name}</strong>
                    <small>{authorized.fingerprint}</small>
                  </span>
                  <b>READ</b>
                </div>
              );
            })}
          </section>
        </div>
      ) : null}
      {agent ? (
        <div className="mn-inspector-body">
          <div className="mn-agent-specimen-large">
            <AgentIdentitySpecimen
              accessibleName={agent.name}
              publicKey={agent.publicKey}
              size={76}
            />
            <div>
              <span>RESIDENT AGENT</span>
              <strong>{agent.name}</strong>
              <small>{agent.role}</small>
            </div>
          </div>
          <section>
            <p>{agent.voice}</p>
            <code>{agent.publicKey}</code>
          </section>
          <dl className="mn-inspector-ledger">
            <div>
              <dt>Fingerprint</dt>
              <dd>{agent.fingerprint}</dd>
            </div>
            <div>
              <dt>Shared sessions</dt>
              <dd>{agent.sessions}</dd>
            </div>
            <div>
              <dt>Relationship</dt>
              <dd>{agent.relationship}</dd>
            </div>
            <div>
              <dt>Reflections</dt>
              <dd>{agent.reflections}</dd>
            </div>
            <div>
              <dt>Last consolidation</dt>
              <dd>{agent.lastConsolidation}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{agent.scope}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {receiptAgent ? (
        <div className="mn-inspector-body">
          <div className="mn-inspector-display" data-material="display">
            <MnemosIcon name="receipt" />
            <span>IDENTITY / VERIFIED</span>
            <strong>{receiptAgent.fingerprint}</strong>
          </div>
          <section>
            <span className="mn-engraving">SIGNED CONTINUITY RECEIPT</span>
            <h2>
              {receiptAgent.name} remained {receiptAgent.name}.
            </h2>
            <p>
              The same public signing identity anchors authorship, relationship
              history, and session continuity.
            </p>
          </section>
          <dl className="mn-inspector-ledger">
            <div>
              <dt>Public identity</dt>
              <dd>{receiptAgent.fingerprint}</dd>
            </div>
            <div>
              <dt>Shared sessions</dt>
              <dd>{receiptAgent.sessions}</dd>
            </div>
            <div>
              <dt>Relationship</dt>
              <dd>{receiptAgent.relationship}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Chain verified</dd>
            </div>
          </dl>
          <section>
            <code>{receiptAgent.publicKey}</code>
          </section>
        </div>
      ) : null}
      {continuity && continuityAgent ? (
        <div className="mn-inspector-body">
          <div className="mn-agent-specimen-large">
            <AgentIdentitySpecimen
              accessibleName={continuityAgent.name}
              publicKey={continuityAgent.publicKey}
              size={64}
            />
            <div>
              <span>{continuity.type.toUpperCase()} / SIGNED EVENT</span>
              <strong>{continuityAgent.name}</strong>
              <small>{continuity.time}</small>
            </div>
          </div>
          <section>
            <h2>{continuity.title}</h2>
            <p>{continuity.body}</p>
          </section>
          <dl className="mn-inspector-ledger">
            <div>
              <dt>Event kind</dt>
              <dd>{continuity.type}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>{continuity.receipt}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>
                {continuity.type === "consolidation"
                  ? "Awaiting Riley"
                  : "Agent-private or signed"}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </aside>
  );
}

function ProductSurface({ view }: { view: Exclude<DemoView, "network"> }) {
  if (view === "agents") return <AgentsSurface />;
  if (view === "brain") return <BrainSurface />;
  return <ContinuitySurface />;
}

function MobileNavigation() {
  const { data } = useVisionMode();
  return (
    <nav aria-label="Mobile destinations" className="mn-mobile-nav">
      {destinations.map((item) => (
        <button
          aria-current={data.runtime.view === item.id ? "page" : undefined}
          data-active={data.runtime.view === item.id}
          data-testid={`vision-mobile-nav-${item.id}`}
          key={item.id}
          onClick={() => data.runtime.setView(item.id)}
          type="button"
        >
          <MnemosIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function MnemosVisionShell() {
  const { data, inspector } = useVisionMode();
  return (
    <div className="mn-vision" data-mnemos-vision data-testid="vision-demo-app">
      <Sidebar />
      <main className="mn-main" data-inspector-open={Boolean(inspector)}>
        <div className="mn-workspace">
          <section className="mn-conversation-card">
            <TopChrome />
            <div className="mn-conversation">
              {data.runtime.view === "network" ? (
                <Thread />
              ) : (
                <ProductSurface view={data.runtime.view} />
              )}
              {data.runtime.view === "network" ? <Composer /> : null}
            </div>
          </section>
          <Inspector />
        </div>
      </main>
      <MobileNavigation />
    </div>
  );
}

export function MnemosVisionApp() {
  return (
    <VisionModeProvider>
      <MnemosVisionShell />
    </VisionModeProvider>
  );
}
