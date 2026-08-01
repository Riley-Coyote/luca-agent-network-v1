import {
  ChevronDown,
  Command,
  Hash,
  Info,
  MoreHorizontal,
  PanelLeftClose,
  Paperclip,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Smile,
  UserPlus,
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { AgentIdentitySpecimen } from "@/vision-demo/AgentIdentitySpecimen";
import { MnemosGlyph, type MnemosGlyphName } from "@/vision-demo/MnemosGlyph";
import {
  VisionModeProvider,
  useVisionMode,
} from "@/vision-demo/VisionModeContext";
import type { AgentId, DemoMessage, DemoView } from "@/vision-demo/demoRuntime";
import "@/vision-demo/mnemos-vision.css";

const destinations: Array<{
  id: DemoView;
  label: string;
  glyph: MnemosGlyphName;
}> = [
  { id: "network", label: "Network", glyph: "network" },
  { id: "agents", label: "Agents", glyph: "agents" },
  { id: "brain", label: "Brain", glyph: "brain" },
  { id: "continuity", label: "Continuity", glyph: "continuity" },
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
          <span className="mn-brand-mark">
            <MnemosGlyph name="mnemos" />
          </span>
          <div className="mn-sidebar-copy">
            <strong>MNEMOS</strong>
          </div>
        </div>
        <IconButton
          label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
        >
          {isSidebarCollapsed ? (
            <MnemosGlyph name="mnemos" />
          ) : (
            <PanelLeftClose />
          )}
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
        {destinations.map(({ id, label, glyph }) => {
          const active = runtime.view === id;
          const frozen = id !== "network";
          return (
            <button
              aria-current={active ? "page" : undefined}
              className="mn-nav-item"
              data-active={active}
              data-testid={`vision-nav-${id}`}
              key={id}
              onClick={() => runtime.setView(id)}
              title={frozen ? `${label} follows shell approval` : label}
              type="button"
            >
              <MnemosGlyph name={glyph} />
              <span className="mn-sidebar-copy">{label}</span>
              {frozen ? (
                <span className="mn-nav-phase mn-sidebar-copy">NEXT</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <section className="mn-sidebar-section mn-sidebar-copy">
        <header>
          <span>RECENT CONVERSATIONS</span>
          <button aria-label="Add room" type="button">
            +
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
              <Hash aria-hidden="true" />
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
                size={27}
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
          <MnemosGlyph name="activity" />
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
            Vision demonstration. Messages and system events are deterministic;
            composer notes stay on this device.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TopChrome() {
  const { data, setInspector } = useVisionMode();
  return (
    <header className="mn-top-chrome">
      <div className="mn-window-drag" data-tauri-drag-region />
      <div className="mn-room-heading">
        <Hash aria-hidden="true" />
        <div>
          <strong>launch-room</strong>
          <span>Where the product learns to explain itself</span>
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
        <MnemosGlyph name="memory" />
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
          <MnemosGlyph name="receipt" /> Signed receipt · 7F21…A90C
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
      <MnemosGlyph
        name={message.kind === "arrival" ? "agents" : "continuity"}
      />
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
          <MnemosGlyph name="network" />
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

  return (
    <aside
      className="mn-inspector"
      data-material="housing"
      data-pinned={isInspectorPinned}
    >
      <header>
        <div>
          <span>INSPECTOR</span>
          <strong>{memory ? "Memory provenance" : "Resident identity"}</strong>
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
            <MnemosGlyph name="memory" />
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
    </aside>
  );
}

function PendingSurface({ view }: { view: DemoView }) {
  const item =
    destinations.find((destination) => destination.id === view) ??
    destinations[0];
  const { data } = useVisionMode();
  return (
    <section className="mn-pending-surface">
      <MnemosGlyph name={item.glyph} />
      <span className="mn-engraving">FOUNDATION APPROVAL GATE</span>
      <h1>{item.label}</h1>
      <p>
        This surface will be composed from the approved shell, type, identity,
        and material primitives after the Network frame is visually accepted.
      </p>
      <button onClick={() => data.runtime.setView("network")} type="button">
        Return to Network
      </button>
    </section>
  );
}

function MobileNavigation() {
  const { data } = useVisionMode();
  return (
    <nav aria-label="Mobile destinations" className="mn-mobile-nav">
      {destinations.map((item) => (
        <button
          aria-current={data.runtime.view === item.id ? "page" : undefined}
          data-active={data.runtime.view === item.id}
          key={item.id}
          onClick={() => data.runtime.setView(item.id)}
          type="button"
        >
          <MnemosGlyph name={item.glyph} />
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
                <PendingSurface view={data.runtime.view} />
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
