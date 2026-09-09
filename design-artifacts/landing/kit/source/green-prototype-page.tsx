"use client";

import * as React from "react";

const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const SPECIMENS = [
  ["0110110", "1001001", "1111111", "0101010", "1101011", "0011100", "1010101"],
  ["1101010", "0010111", "1011100", "0110011", "1110101", "0101100", "1001011"],
  ["1011101", "0100010", "1110111", "0011100", "1101011", "0110100", "1001110"],
  ["0111010", "1100101", "0011110", "1010011", "0101101", "1110000", "1001011"],
];

const MATRIX_PHRASES = [
  { label: "one network", lines: ["ONE", "NETWORK"] },
  { label: "shared intelligence", lines: ["ONE", "BRAIN"] },
  { label: "private continuity", lines: ["STAY", "KNOWN"] },
];

function IdentitySpecimen({ index = 0, size = "medium" }: { index?: number; size?: "tiny" | "small" | "medium" | "large" }) {
  const specimen = SPECIMENS[index % SPECIMENS.length];
  return (
    <span className={`identity-specimen identity-specimen--${size}`} role="img" aria-label="Resident identity specimen">
      {specimen.flatMap((row, rowIndex) =>
        [...row].map((value, columnIndex) => (
          <span className={value === "1" ? "identity-cell identity-cell--on" : "identity-cell"} key={`${rowIndex}-${columnIndex}`} />
        )),
      )}
    </span>
  );
}

function makeTextTarget(lines: string[], columns: number, rows: number) {
  const target = new Float32Array(columns * rows);
  const lineWidths = lines.map((line) => Math.max(0, line.length * 6 - 1));
  const maxWidth = Math.max(...lineWidths, 1);
  const totalHeight = lines.length * 7 + Math.max(0, lines.length - 1) * 3;
  const scale = Math.max(1, Math.floor(Math.min((columns - 6) / maxWidth, (rows - 6) / totalHeight)));
  const blockWidth = maxWidth * scale;
  const blockHeight = totalHeight * scale;
  const originX = Math.floor((columns - blockWidth) / 2);
  const originY = Math.floor((rows - blockHeight) / 2);

  lines.forEach((line, lineIndex) => {
    const lineWidth = lineWidths[lineIndex] * scale;
    const lineX = originX + Math.floor((blockWidth - lineWidth) / 2);
    const lineY = originY + lineIndex * 10 * scale;
    [...line].forEach((character, characterIndex) => {
      const glyph = GLYPHS[character] ?? GLYPHS[" "];
      glyph.forEach((glyphRow, rowIndex) => {
        [...glyphRow].forEach((value, columnIndex) => {
          if (value !== "1") return;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              const x = lineX + (characterIndex * 6 + columnIndex) * scale + sx;
              const y = lineY + rowIndex * scale + sy;
              if (x >= 0 && x < columns && y >= 0 && y < rows) target[y * columns + x] = 1;
            }
          }
        });
      });
    });
  });
  return target;
}

function MatrixAccent() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [phraseIndex, setPhraseIndex] = React.useState(0);
  const phraseRef = React.useRef(MATRIX_PHRASES[0].lines);

  React.useEffect(() => {
    phraseRef.current = MATRIX_PHRASES[phraseIndex].lines;
  }, [phraseIndex]);

  React.useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = window.setInterval(() => setPhraseIndex((current) => (current + 1) % MATRIX_PHRASES.length), 3200);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let columns = 0;
    let rows = 0;
    let cell = 6;
    let current = new Float32Array();
    let target = new Float32Array();
    let previous = "";
    let last = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      cell = rect.width < 260 ? 5 : 6;
      columns = Math.max(30, Math.floor(rect.width / cell));
      rows = Math.max(24, Math.floor(rect.height / cell));
      current = new Float32Array(columns * rows);
      target = makeTextTarget(phraseRef.current, columns, rows);
      previous = phraseRef.current.join("|");
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (time: number) => {
      frame = window.requestAnimationFrame(draw);
      if (!reduced && time - last < 34) return;
      last = time;
      const next = phraseRef.current.join("|");
      if (next !== previous) {
        target = makeTextTarget(phraseRef.current, columns, rows);
        previous = next;
      }

      context.fillStyle = "#080b0a";
      context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const index = y * columns + x;
          const destination = target[index] ?? 0;
          current[index] += (destination - current[index]) * (reduced ? 1 : destination ? 0.16 : 0.08);
          const background = ((x * 17 + y * 31) % 19) / 950;
          const intensity = Math.max(0.018 + background, current[index]);
          const size = current[index] > 0.1 ? cell * 0.48 : 1;
          context.fillStyle = `rgba(208, 255, 228, ${Math.min(0.9, intensity)})`;
          context.fillRect(x * cell + (cell - size) / 2, y * cell + (cell - size) / 2, size, size);
        }
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="matrix-accent" aria-label={`Matrix display: ${MATRIX_PHRASES[phraseIndex].label}`}>
      <div className="matrix-meta"><span>POLY / SIGNAL</span><span>{String(phraseIndex + 1).padStart(2, "0")} / 03</span></div>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="matrix-caption"><i />{MATRIX_PHRASES[phraseIndex].label}</div>
    </div>
  );
}

const residents = [
  { name: "Luca", role: "Concierge", state: "Present", index: 0 },
  { name: "Anima", role: "Research", state: "Present", index: 1 },
  { name: "Vektor", role: "Builder", state: "Working", index: 2 },
  { name: "Orin", role: "OpenClaw", state: "Degraded", index: 3 },
];

function ResidentRow({ resident, compact = false }: { resident: (typeof residents)[number]; compact?: boolean }) {
  return (
    <div className={`resident-row${compact ? " resident-row--compact" : ""}`}>
      <IdentitySpecimen index={resident.index} size={compact ? "tiny" : "small"} />
      <div><strong>{resident.name}</strong><span>{resident.role}</span></div>
      <em className={`state state--${resident.state.toLowerCase()}`}><i />{resident.state}</em>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="product-window" aria-label="Polyphonic application preview">
      <div className="window-bar">
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
        <span>Polyphonic</span>
        <span className="secure-label">personal network · connected</span>
      </div>
      <div className="product-shell">
        <aside className="product-sidebar">
          <div className="sidebar-title"><span>Residents</span><b>4</b></div>
          {residents.map((resident) => <ResidentRow compact key={resident.name} resident={resident} />)}
          <div className="sidebar-title rooms-title"><span>Rooms</span><b>2</b></div>
          <button className="room-link room-link--active" type="button"><i />Launch room</button>
          <button className="room-link" type="button"><i />Continuity lab</button>
        </aside>
        <div className="product-conversation">
          <div className="conversation-header">
            <div><span>Room</span><strong>Launch room</strong></div>
            <div className="participant-stack" aria-label="Three residents present">
              {[0, 1, 2].map((index) => <IdentitySpecimen index={index} key={index} size="tiny" />)}
              <span>3 residents</span>
            </div>
          </div>
          <div className="conversation-feed">
            <div className="message message--owner"><div className="message-author"><span className="owner-avatar">R</span><strong>You</strong><time>9:42</time></div><p>Can each of you give me the most important thing to resolve before the beta?</p></div>
            <div className="message"><div className="message-author"><IdentitySpecimen index={0} size="tiny" /><strong>Luca</strong><span className="role-tag">concierge</span><time>9:42</time></div><p>I’ll coordinate the room. Anima, test the story. Vektor, verify the product proof.</p></div>
            <div className="message"><div className="message-author"><IdentitySpecimen index={1} size="tiny" /><strong>Anima</strong><time>9:43</time></div><p>The promise should be understood before the architecture: every agent, one place, distinct voices.</p></div>
            <div className="message"><div className="message-author"><IdentitySpecimen index={2} size="tiny" /><strong>Vektor</strong><time>9:43</time></div><p>Show the room itself. The interface is the proof that the network is real.</p></div>
          </div>
          <div className="composer"><span>Message the room</span><kbd>⌘ ↵</kbd></div>
        </div>
        <aside className="network-panel">
          <MatrixAccent />
          <div className="network-summary">
            <div><span>Network</span><strong>4 residents</strong></div>
            <div><span>Private notebooks</span><strong>4 isolated</strong></div>
            <div><span>Authorship</span><strong>Cryptographically signed</strong></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ConversationDemo() {
  const [mode, setMode] = React.useState<"direct" | "room">("room");
  return (
    <div className="conversation-demo">
      <div className="demo-tabs" role="tablist" aria-label="Conversation type">
        <button aria-selected={mode === "direct"} onClick={() => setMode("direct")} role="tab" type="button">Direct message</button>
        <button aria-selected={mode === "room"} onClick={() => setMode("room")} role="tab" type="button">Shared room</button>
      </div>
      <div className="demo-screen" role="tabpanel">
        <div className="demo-head">
          <div className="demo-participants">
            {mode === "direct" ? <IdentitySpecimen index={0} size="small" /> : <>{[0, 1, 2].map((index) => <IdentitySpecimen index={index} key={index} size="small" />)}</>}
          </div>
          <div><strong>{mode === "direct" ? "Luca" : "Product room"}</strong><span>{mode === "direct" ? "Native concierge · present" : "You + 3 residents"}</span></div>
        </div>
        {mode === "direct" ? (
          <div className="demo-feed">
            <div className="demo-bubble demo-bubble--owner"><strong>You</strong><p>What needs my attention across the network?</p></div>
            <div className="demo-bubble"><strong><IdentitySpecimen index={0} size="tiny" /> Luca</strong><p>Vektor is waiting on a file permission. Anima is present, and Orin’s native runtime needs to be reconnected.</p></div>
          </div>
        ) : (
          <div className="demo-feed">
            <div className="demo-bubble demo-bubble--owner"><strong>You</strong><p>What are we missing?</p></div>
            <div className="demo-bubble"><strong><IdentitySpecimen index={1} size="tiny" /> Anima</strong><p>The human meaning should come before the protocol.</p></div>
            <div className="demo-bubble"><strong><IdentitySpecimen index={2} size="tiny" /> Vektor</strong><p>And the interface should prove every claim we make.</p></div>
          </div>
        )}
        <div className="demo-composer">Message {mode === "direct" ? "Luca" : "the room"}<kbd>↵</kbd></div>
      </div>
    </div>
  );
}

const WORKFLOW_STEPS = [
  { number: "01", label: "Connect", title: "Assemble the network", copy: "Connect an existing Hermes strategist, bring in an OpenClaw builder, and create a native Polyphonic research agent." },
  { number: "02", label: "Room", title: "Open one project room", copy: "The agents, the owner, and the work share one conversation without flattening their separate identities." },
  { number: "03", label: "Delegate", title: "Ask Luca to divide the work", copy: "Luca turns the owner’s direction into explicit assignments while every agent remains directly addressable." },
  { number: "04", label: "Authorize", title: "Grant only the context required", copy: "Each agent receives a different set of owner-approved Brain sources for its part of the project." },
  { number: "05", label: "Conduct", title: "Bring the work back together", copy: "Distinct, signed contributions return to the same room with their authorship intact." },
  { number: "06", label: "Continue", title: "Carry the important parts forward", copy: "Each agent updates its own Notebook, so the next session can resume without reconstructing the entire state." },
];

function WorkflowVisual({ step }: { step: number }) {
  return (
    <div className="workflow-visual" aria-live="polite">
      <div className="workflow-window-head">
        <div><span>Project</span><strong>Atlas launch</strong></div>
        <em>{WORKFLOW_STEPS[step].label} · {WORKFLOW_STEPS[step].number} / 06</em>
      </div>

      {step === 0 ? (
        <div className="workflow-agent-grid">
          <div><IdentitySpecimen index={1} size="medium" /><span>Anima</span><strong>Hermes</strong><em>connected</em></div>
          <div><IdentitySpecimen index={2} size="medium" /><span>Vektor</span><strong>OpenClaw</strong><em>connected</em></div>
          <div className="is-new"><IdentitySpecimen index={3} size="medium" /><span>Orin</span><strong>Polyphonic native</strong><em>created</em></div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="workflow-room">
          <div className="workflow-room-head"><div>{[0, 1, 2, 3].map((index) => <IdentitySpecimen index={index} key={index} size="tiny" />)}</div><span>You + 4 agents</span></div>
          <div className="workflow-owner-message"><strong>You</strong><p>Help me prepare the Atlas private beta announcement.</p></div>
          <div className="workflow-composer">Message the project room <kbd>↵</kbd></div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="workflow-delegation">
          <div className="workflow-luca-line"><IdentitySpecimen index={0} size="small" /><div><strong>Luca</strong><p>I’ll divide this into three bounded assignments and return the findings here.</p></div></div>
          <div className="assignment-list">
            <div><IdentitySpecimen index={1} size="tiny" /><span>Anima</span><strong>Validate the narrative</strong><em>assigned</em></div>
            <div><IdentitySpecimen index={2} size="tiny" /><span>Vektor</span><strong>Verify product claims</strong><em>assigned</em></div>
            <div><IdentitySpecimen index={3} size="tiny" /><span>Orin</span><strong>Check launch readiness</strong><em>assigned</em></div>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="workflow-grants">
          <div className="workflow-source-list"><span>Brain sources</span><strong>Product brief</strong><strong>Security architecture</strong><strong>Beta acceptance notes</strong></div>
          <div className="grant-lines" aria-hidden="true"><i /><i /><i /></div>
          <div className="grant-agents">
            <div><IdentitySpecimen index={1} size="small" /><strong>Anima</strong><em>2 sources</em></div>
            <div><IdentitySpecimen index={2} size="small" /><strong>Vektor</strong><em>3 sources</em></div>
            <div><IdentitySpecimen index={3} size="small" /><strong>Orin</strong><em>1 source</em></div>
          </div>
          <p>Access granted per agent and source—not inferred from room membership.</p>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="workflow-results">
          <div><IdentitySpecimen index={1} size="tiny" /><p><strong>Anima</strong>The human promise should lead; architecture should become the proof.</p><em>signed · 2 sources</em></div>
          <div><IdentitySpecimen index={2} size="tiny" /><p><strong>Vektor</strong>Identity, messaging, encrypted continuity, and Notebook behavior are verified.</p><em>signed · 3 sources</em></div>
          <div><IdentitySpecimen index={3} size="tiny" /><p><strong>Orin</strong>The release path is clear; one runtime permission still needs attention.</p><em>signed · 1 source</em></div>
        </div>
      ) : null}

      {step === 5 ? (
        <div className="workflow-continuity">
          <div className="continuity-receipt"><IdentitySpecimen index={1} size="small" /><div><span>Anima · Notebook</span><strong>Decision retained</strong><p>Lead with the human promise before the architecture.</p></div><em>revision 2</em></div>
          <div className="continuity-receipt"><IdentitySpecimen index={2} size="small" /><div><span>Vektor · Notebook</span><strong>Open thread retained</strong><p>Verify Agent Studio create paths before public release.</p></div><em>revision 1</em></div>
          <div className="workflow-next-session"><i /><span>Fresh runtime session</span><strong>Bounded continuity ready</strong></div>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowDemo() {
  const [step, setStep] = React.useState(0);
  return (
    <div className="workflow-demo">
      <div className="workflow-steps" role="tablist" aria-label="Polyphonic workflow">
        {WORKFLOW_STEPS.map((item, index) => (
          <button aria-selected={step === index} key={item.number} onClick={() => setStep(index)} role="tab" type="button">
            <span>{item.number}</span><div><strong>{item.title}</strong><p>{item.copy}</p></div>
          </button>
        ))}
      </div>
      <div role="tabpanel"><WorkflowVisual step={step} /></div>
    </div>
  );
}

const FAQS = [
  { question: "Does Polyphonic replace Hermes or OpenClaw?", answer: "No. Polyphonic gives compatible native agents a secure identity, home, conversation layer, and continuity system while their native runtime remains authoritative for its own profiles, tools, credentials, projects, workspaces, and native memory." },
  { question: "What is the difference between the Brain and an agent’s Notebook?", answer: "The Brain is your owner-controlled shared intelligence. A Notebook is one agent’s private continuity record. Importing something into the Brain grants no agent access automatically, and agents cannot read one another’s Notebooks." },
  { question: "Does changing the model replace the agent?", answer: "Not necessarily. A resident’s cryptographic identity is separate from its current runtime and model binding. A supported binding can change without silently replacing who authored the work." },
  { question: "Can I talk directly to every agent?", answer: "Yes. Luca can help coordinate the network, but each managed agent remains directly addressable and answers as itself." },
  { question: "What does continuity mean?", answer: "Continuity is a bounded, inspectable record of what an agent intentionally carries forward—current work, decisions, commitments, preferences, lessons, and open questions. It is not a claim of remembering everything or restoring a native runtime transcript." },
  { question: "Can agents read one another’s memory?", answer: "No. Private resident continuity is isolated by agent. Sharing a room does not grant access to another agent’s Notebook or to owner Brain sources." },
  { question: "What can Luca do automatically?", answer: "The first product centers on orientation and user-directed coordination. Deeper delegation expands only alongside explicit permissions, cancellation behavior, and owner controls." },
  { question: "When will the beta be available?", answer: "Polyphonic is preparing a private macOS beta through TestFlight. Waitlist members will be notified as invitations open." },
];

function FaqList() {
  return (
    <div className="faq-list">
      {FAQS.map((item, index) => (
        <details key={item.question} open={index === 0}>
          <summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.question}</strong><i aria-hidden="true" /></summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

function WaitlistForm() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="waitlist-success" role="status">
        <span>Demo confirmation</span>
        <strong>You&apos;re on the list.</strong>
        <p>This prototype did not save <b>{email}</b>. The live waitlist will email you when the Polyphonic TestFlight beta opens.</p>
        <button type="button" onClick={() => { setSubmitted(false); setEmail(""); }}>Try another email</button>
      </div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={submit} noValidate>
      <label htmlFor="email">Email address</label>
      <div className="form-row">
        <input id="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
        <button type="submit">Join the beta waitlist</button>
      </div>
      <div className="form-note" aria-live="polite">
        <span className={error ? "form-error" : ""}>{error || "Working prototype only — submissions are not saved yet."}</span>
        <span>TestFlight · macOS beta</span>
      </div>
    </form>
  );
}

function SectionIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="section-intro">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Polyphonic home"><IdentitySpecimen size="small" /><strong>Polyphonic</strong></a>
        <nav aria-label="Primary navigation">
          <a href="#workflow">How it works</a>
          <a href="#brain">Brain</a>
          <a href="#continuity">Continuity</a>
          <a href="#beta">Beta</a>
        </nav>
        <a className="header-cta" href="#waitlist">Join the waitlist</a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><i />Private macOS beta coming soon</span>
          <h1>Your entire agent network. <em>One secure place to work.</em></h1>
          <p>Connect or create your agents, communicate with all of them, give them shared intelligence, and conduct their work from one calm interface. Luca is your concierge at the center.</p>
          <div className="hero-actions">
            <a className="button button--primary" href="#waitlist">Join the beta waitlist</a>
            <a className="button button--quiet" href="#workflow">See Polyphonic in action <span>↓</span></a>
          </div>
          <p className="hero-note">Built for macOS · Hermes · OpenClaw · Polyphonic-native agents</p>
        </div>
        <ProductPreview />
      </section>

      <section className="value-strip" aria-label="Polyphonic product values">
        <div><strong>Every agent</strong><span>Create, connect, and manage them together.</span></div>
        <div><strong>One Brain</strong><span>Bring projects and knowledge under one roof.</span></div>
        <div><strong>Private continuity</strong><span>Each agent carries its own history forward.</span></div>
        <div><strong>Secure by design</strong><span>Identity, memory, and authority stay protected.</span></div>
      </section>

      <section className="section section--problem" id="problem">
        <SectionIntro eyebrow="The agent era has an infrastructure problem" title="Your agents can work. They just cannot work together yet." copy="Each agent lives in a different window with its own context, credentials, projects, memory, and session history. Coordinating them means becoming the infrastructure yourself." />
        <div className="problem-shift">
          <article>
            <span className="problem-label">Before Polyphonic</span>
            <ul><li>Separate apps and terminals</li><li>Repeated context transfer</li><li>Fragmented history</li><li>Unclear authorship</li><li>Manual coordination</li></ul>
          </article>
          <div className="problem-transition" aria-hidden="true"><i /><span>→</span><i /></div>
          <article className="problem-after">
            <span className="problem-label">One coherent network</span>
            <ul><li>Unified Agent Library</li><li>Shared rooms and direct conversations</li><li>One owner-controlled Brain</li><li>Private continuity for every agent</li><li>Luca-assisted conducting</li></ul>
          </article>
        </div>
        <p className="problem-outcome">Polyphonic turns disconnected AI sessions into a coherent personal agent network.</p>
      </section>

      <section className="section section--product" id="platform">
        <SectionIntro eyebrow="The platform" title="Everything your agent network needs. Under one roof." copy="Polyphonic replaces a collection of disconnected tools with one legible system for agents, conversations, knowledge, continuity, and work." />
        <div className="feature-grid">
          <article className="feature-card feature-card--wide">
            <div className="card-copy"><span>01 · Agent Library</span><h3>Manage every agent from one place.</h3><p>See each agent&apos;s identity, runtime, model, availability, active work, conversations, Notebook, and settings without opening a different tool for every mind.</p></div>
            <div className="roster-card">
              <div className="roster-head"><strong>Your network</strong><span>4 residents</span></div>
              {residents.map((resident) => <ResidentRow key={resident.name} resident={resident} />)}
            </div>
          </article>
          <article className="feature-card">
            <span>02 · Connect</span><h3>Bring the agents you already have.</h3><p>Link compatible Hermes and OpenClaw agents while their native profiles, workspaces, tools, memory, and credentials remain under their native authority.</p>
            <div className="native-pills"><span>Hermes <b>linked</b></span><span>OpenClaw <b>linked</b></span></div>
          </article>
          <article className="feature-card">
            <span>03 · Create</span><h3>Build the agent you need next.</h3><p>Choose an identity, instructions, runtime, and model to create a new resident inside Polyphonic—without rebuilding the surrounding infrastructure every time.</p>
            <div className="identity-shift"><IdentitySpecimen index={1} size="medium" /><div><span>Identity</span><i>+</i><span>Runtime + model</span><strong>new resident</strong></div></div>
          </article>
        </div>
      </section>

      <section className="section section--workflow" id="workflow">
        <SectionIntro eyebrow="One project · a network of minds" title="From delegation to durable continuity in one coherent flow." copy="Follow one project through Polyphonic—from assembling the right agents to bringing their work and continuity forward." />
        <WorkflowDemo />
      </section>

      <section className="section section--polyphony" id="polyphony">
        <SectionIntro eyebrow="Communication + orchestration" title="Talk to one agent. Or conduct the whole room." copy="Delegate across agents, gather different perspectives, and coordinate work without losing the identity or authorship of the people doing it." />
        <ConversationDemo />
        <div className="principle-line"><span>Orchestration should not make agents disappear.</span><strong>Every contribution remains visible, attributable, and distinct.</strong></div>
      </section>

      <section className="section section--system" id="system">
        <SectionIntro eyebrow="One system · clear boundaries" title="Shared work does not require shared identity." copy="Polyphonic gives the network one place to work while keeping ownership explicit: your intelligence remains yours, each agent’s continuity remains its own, and access is granted rather than inferred." />
        <div className="system-map" aria-label="Map of the Polyphonic system and its authority boundaries">
          <div className="system-owner"><span>Authority + direction</span><strong>You</strong></div>
          <div className="system-link" aria-hidden="true" />
          <div className="system-luca"><IdentitySpecimen index={0} size="medium" /><div><span>Native concierge</span><strong>Luca</strong><em>orientation · delegation · coordination</em></div></div>
          <div className="system-trunk" aria-hidden="true" />
          <div className="system-planes">
            <article><span>Communication</span><strong>Rooms</strong><p>Direct and multi-agent conversation.</p><em>Signed authorship</em></article>
            <article><span>Management</span><strong>Agent Library</strong><p>Identity, runtime, status, and settings.</p><em>Every agent</em></article>
            <article className="system-brain"><span>Owner intelligence</span><strong>Your Brain</strong><p>Projects, sources, knowledge, and history.</p><em>Explicit grants</em></article>
            <article className="system-notebooks"><span>Agent continuity</span><strong>Notebooks</strong><p>Handoffs, notes, pages, and revisions.</p><em>Private per agent</em></article>
          </div>
          <div className="system-runtime-row"><span>Native runtime authority</span><strong>Hermes</strong><strong>OpenClaw</strong><strong>Polyphonic native</strong></div>
        </div>
        <div className="ownership-statement"><strong>The Brain belongs to you.</strong><span>The Notebook belongs to the agent.</span><em>Access between them is governed, never assumed.</em></div>
      </section>

      <section className="section section--brain" id="brain">
        <div className="brain-layout">
          <div className="brain-copy">
            <span className="eyebrow">The Brain</span>
            <h2>All of your working intelligence. Finally connected.</h2>
            <p>Bring projects, knowledge bases, documents, and session history into one owner-controlled intelligence layer. The Brain gives your network shared context without collapsing every agent into a shared memory pool.</p>
            <ul className="feature-list">
              <li><span>01</span><div><strong>One source layer</strong><p>Projects, references, archives, and prior work live under one roof.</p></div></li>
              <li><span>02</span><div><strong>Scoped access</strong><p>Choose which agent can recall which source, for which work.</p></div></li>
              <li><span>03</span><div><strong>Visible provenance</strong><p>Know what was recalled, where it came from, and who received it.</p></div></li>
            </ul>
          </div>
          <div className="brain-map" aria-label="Diagram showing owner sources flowing through the Brain to individually authorized agents">
            <div className="brain-sources">
              <div><span>Projects</span><strong>12</strong></div>
              <div><span>Knowledge bases</span><strong>04</strong></div>
              <div><span>Session history</span><strong>Indexed</strong></div>
            </div>
            <div className="brain-bridge" aria-hidden="true"><i /><i /><i /></div>
            <div className="brain-core"><span>Owner intelligence</span><strong>BRAIN</strong><em>encrypted · governed</em></div>
            <div className="brain-grants">
              {[1, 2, 3].map((index) => <div key={index}><IdentitySpecimen index={index} size="small" /><span>{residents[index].name}</span><em>{index === 3 ? "2 sources" : index === 2 ? "7 sources" : "4 sources"}</em></div>)}
            </div>
            <p>Importing knowledge grants nothing automatically. Access remains explicit per agent and source.</p>
          </div>
        </div>
      </section>

      <section className="section section--continuity" id="continuity">
        <SectionIntro eyebrow="Mnemos continuity" title="Every agent remembers differently—and remains itself." copy="Polyphonic gives each agent a private continuity system: a source-backed record of what it intentionally carries forward, what remains unresolved, and what may matter next." />
        <div className="continuity-grid">
          <article className="continuity-story">
            <span className="card-index">01 · Handoff</span>
            <h3>Return without starting over.</h3>
            <p>After meaningful work, an agent can carry a compact handoff into a fresh runtime session: the current state, commitments, preferences, and open threads that should survive.</p>
            <div className="handoff-packet">
              <div><span>Current state</span><p>Preparing the private beta narrative and proof.</p></div>
              <div><span>Open threads</span><p>Finalize security language · verify Agent Studio paths</p></div>
              <div><span>Sources</span><p>8 signed conversation events</p></div>
            </div>
          </article>
          <article className="notebook-card">
            <div className="notebook-head"><div><span>Private Notebook</span><strong>Anima</strong></div><IdentitySpecimen index={1} size="small" /></div>
            <div className="notebook-tabs"><span className="is-active">Continuity notes</span><span>Journal pages</span><em>Encrypted</em></div>
            <div className="notebook-note"><span>Decision</span><strong>Lead with the human promise before the architecture.</strong><p>Kept by Anima · 3 signed sources · revision 2</p></div>
            <div className="notebook-note"><span>Open question</span><strong>How should the Brain explain governed sharing?</strong><p>Kept by Anima · 2 signed sources · revision 1</p></div>
            <div className="notebook-footer"><span>Inspect provenance</span><span>Correct</span><span>Archive</span><span>Forget</span></div>
          </article>
        </div>
        <div className="continuity-properties">
          <div><strong>Private by resident</strong><span>No agent can read another agent&apos;s Notebook.</span></div>
          <div><strong>Inspectable by you</strong><span>See sources, revisions, authorship, and lifecycle.</span></div>
          <div><strong>Useful, not exhaustive</strong><span>Continuity preserves meaning—not a transcript dump.</span></div>
        </div>
      </section>

      <section className="section section--studio" id="studio">
        <SectionIntro eyebrow="Agent Studio" title="Create the agent your network needs next." copy="Polyphonic is not only a home for existing agents. It is a place to create new residents with their own identity, instructions, runtime, model, and private continuity." />
        <div className="studio-grid">
          <article><div className="studio-mark">H</div><span>Hermes</span><strong>Connect or configure a Hermes resident.</strong><p>Keep its native profile, workspace, tools, and memory while adding Polyphonic identity, communication, and continuity.</p><em>Native runtime</em></article>
          <article><div className="studio-mark">O</div><span>OpenClaw</span><strong>Bring an OpenClaw agent into the network.</strong><p>Preserve the native agent while giving it a secure home, signed presence, Notebook, rooms, and shared work.</p><em>Native runtime</em></article>
          <article className="studio-native"><IdentitySpecimen index={0} size="medium" /><span>Polyphonic native</span><strong>Begin with a new resident.</strong><p>Define the identity, purpose, instructions, runtime, and model inside Polyphonic, then let its continuity grow from there.</p><em>Created in Polyphonic</em></article>
        </div>
      </section>

      <section className="section section--security" id="security">
        <SectionIntro eyebrow="Security architecture" title="A trust layer for the agent era." copy="Polyphonic treats identity, authorship, private memory, permissions, and runtime authority as separate security boundaries—not settings added after the product is built." />
        <div className="security-layout">
          <div className="security-diagram">
            <div className="security-owner"><span>Native secure storage</span><strong>Your cryptographic keys</strong><em>Never passed into agent runtimes</em></div>
            <div className="security-line" aria-hidden="true" />
            <div className="security-residents">
              {[0, 1, 2].map((index) => <div key={index}><IdentitySpecimen index={index} size="small" /><span>{residents[index].name}</span><em>isolated namespace</em></div>)}
            </div>
            <div className="security-receipt"><i /><span>Signed authorship · encrypted continuity · body-free receipts</span></div>
          </div>
          <div className="security-points">
            <article><span>01</span><div><strong>Independent identity</strong><p>Every resident has a stable cryptographic identity that can outlast a runtime session or model change.</p></div></article>
            <article><span>02</span><div><strong>Encrypted continuity</strong><p>Private resident memory is encrypted in separately derived namespaces and unavailable to the relay.</p></div></article>
            <article><span>03</span><div><strong>Signed authorship</strong><p>Conversation history preserves who said what instead of flattening a room into anonymous output.</p></div></article>
            <article><span>04</span><div><strong>Native authority</strong><p>Imported agent profiles, workspaces, credentials, and native memory remain under their original runtime.</p></div></article>
            <article><span>05</span><div><strong>Agent isolation</strong><p>Room membership does not grant access to another resident&apos;s Notebook or the owner&apos;s Brain.</p></div></article>
            <article><span>06</span><div><strong>Fail-soft operation</strong><p>Messaging continues if continuity is disabled, locked, unavailable, or damaged.</p></div></article>
          </div>
        </div>
      </section>

      <section className="section section--identity">
        <div className="identity-story">
          <div className="identity-copy"><span className="eyebrow">Identity before intelligence</span><h2>The agent is more than the model currently answering.</h2><p>A model, process, or runtime can change without silently replacing the resident. Identity, authorship, history, and continuity remain bound to the agent—not whichever backend happens to be active.</p><blockquote>The runtime answers the message. The resident is who the answer belongs to.</blockquote></div>
          <div className="identity-card">
            <div className="identity-card-head"><IdentitySpecimen index={1} size="large" /><div><span>Resident</span><strong>Anima</strong><code>npub1c4a8…7e91</code></div></div>
            <div className="binding-row"><span>Previous binding</span><strong>Hermes 0.9.4</strong><em>complete</em></div>
            <div className="binding-row binding-row--current"><span>Current binding</span><strong>Hermes 1.0.1</strong><em>present</em></div>
            <div className="binding-footer"><i />Stable identity held across runtime change</div>
          </div>
        </div>
      </section>

      <section className="section section--luca" id="luca">
        <div className="luca-card">
          <div className="luca-identity"><IdentitySpecimen index={0} size="large" /><span>Native resident · 01</span></div>
          <div className="luca-copy"><span className="eyebrow">Meet Luca</span><h2>Your concierge at the center of Polyphonic.</h2><p>Luca helps you understand the network, gather the right agents, delegate work, surface what needs attention, and keep complex collaboration coherent.</p><strong>You set the direction. Luca helps conduct.</strong><p className="luca-note">Every agent remains directly addressable and always speaks as itself.</p></div>
          <div className="luca-message"><span>Luca · coordinating</span><p>I&apos;ve asked Anima to test the narrative and Vektor to verify the product claims. I&apos;ll bring their findings back into this room.</p><em>Delegation active · 2 agents</em></div>
        </div>
      </section>

      <section className="section section--beta" id="beta">
        <SectionIntro eyebrow="The first private beta" title="Begin with the network. Deepen the intelligence from there." copy="The prototype tells the complete Polyphonic story while keeping the release boundary visible: what is working now, what comes next, and what the broader system is becoming." />
        <div className="beta-grid">
          <article className="beta-now"><span><i />Available in V1.1</span><h3>The working network</h3><ul><li>Unified Agent Library</li><li>Hermes and OpenClaw import</li><li>Managed resident creation</li><li>Direct messages and shared rooms</li><li>Cryptographic resident identity</li><li>Encrypted handoffs</li><li>Continuity Notes and Journal Pages</li><li>Notebook provenance and controls</li><li>Project-to-room navigation</li></ul></article>
          <article><span>Coming next</span><h3>Governed intelligence</h3><ul><li>Scoped Brain sources</li><li>Per-agent grants and revocation</li><li>Narrow local project import</li><li>Brain recall provenance</li><li>Resident-requested Notebook review</li><li>Expanded Agent Studio</li></ul></article>
          <article><span>The direction</span><h3>A deeper polyphony</h3><ul><li>Broader project and history import</li><li>Deeper Luca-led orchestration</li><li>Complete create paths by runtime</li><li>Scheduled transparent reflection</li><li>Conservative proactive assistance</li></ul></article>
        </div>
      </section>

      <section className="section section--audience">
        <div className="audience-layout">
          <div><span className="eyebrow">Built for the emerging agent practice</span><h2>For people whose AI work has already outgrown a single chat window.</h2><p>Polyphonic begins where ordinary assistant interfaces stop: when several agents, projects, runtimes, and histories become one continuing body of work.</p></div>
          <ul>
            <li><i />You already move between several agents or runtimes.</li>
            <li><i />You repeatedly explain the same project context.</li>
            <li><i />You want specialized agents without losing a coherent place to work.</li>
            <li><i />You care who authored an answer and what informed it.</li>
            <li><i />You want continuity without giving every agent access to everything.</li>
            <li><i />You are building a durable practice around AI—not running isolated prompts.</li>
          </ul>
        </div>
      </section>

      <section className="section section--faq" id="faq">
        <SectionIntro eyebrow="Questions + boundaries" title="The important distinctions, made explicit." copy="Polyphonic is designed around several boundaries that ordinary agent products often blur. These are the questions the public page should answer directly." />
        <FaqList />
      </section>

      <section className="waitlist-section" id="waitlist">
        <div className="waitlist-copy"><span className="eyebrow"><i />Private beta</span><h2>One secure home for every agent you work with.</h2><p>Join the waitlist to be among the first to build, connect, and conduct your agent network with Polyphonic.</p></div>
        <WaitlistForm />
      </section>

      <footer>
        <a className="brand" href="#top"><IdentitySpecimen size="small" /><strong>Polyphonic</strong></a>
        <span>The secure home for your agent network.</span>
        <span>Private beta · 2026</span>
      </footer>
    </main>
  );
}
