import type { ArtifactRecord } from "@/features/artifacts/types";

const thresholdStudy = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" />
    <title>The threshold</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #eeede8; color: #15171a; }
      main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; padding: 34px 42px 30px; }
      header, footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; font: 600 10px/1.2 ui-monospace, monospace; letter-spacing: .16em; text-transform: uppercase; }
      header { border-bottom: 1px solid rgba(21,23,26,.18); padding-bottom: 16px; }
      .mark { display: grid; grid-template-columns: repeat(7, 5px); gap: 2px; }
      .mark i { width: 5px; height: 5px; background: #15171a; border-radius: 1px; opacity: .92; }
      .mark i:nth-child(2), .mark i:nth-child(6), .mark i:nth-child(9), .mark i:nth-child(13), .mark i:nth-child(16), .mark i:nth-child(20) { opacity: .15; }
      .hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(220px, .65fr); gap: 8vw; align-items: end; padding: 8vh 0 9vh; }
      .index { font: 500 10px/1.2 ui-monospace, monospace; letter-spacing: .16em; text-transform: uppercase; color: #3d5a80; }
      h1 { max-width: 820px; margin: 18px 0 0; font: 300 clamp(54px, 8vw, 112px)/.86 Georgia, serif; letter-spacing: -.065em; }
      .copy { align-self: center; border-top: 1px solid rgba(21,23,26,.22); padding-top: 18px; }
      .copy p { margin: 0; max-width: 34ch; font-size: clamp(15px, 1.6vw, 20px); line-height: 1.5; }
      .copy small { display: block; margin-top: 32px; color: rgba(21,23,26,.58); font: 500 10px/1.5 ui-monospace, monospace; letter-spacing: .08em; }
      footer { border-top: 1px solid rgba(21,23,26,.18); padding-top: 16px; color: rgba(21,23,26,.55); }
      .signal { width: 72px; height: 2px; background: #3d5a80; }
      @media (max-width: 700px) { main { padding: 24px; } .hero { grid-template-columns: 1fr; align-items: center; } .copy { align-self: end; } }
    </style>
  </head>
  <body>
    <main>
      <header><span>Polyphonic · study 03</span><div class="mark" aria-hidden="true">${"<i></i>".repeat(21)}</div></header>
      <section class="hero">
        <div><div class="index">A place for work that keeps becoming</div><h1>The threshold is not a screen.</h1></div>
        <div class="copy"><p>It is the point where a conversation becomes something you can hold, revise, and return to.</p><small>Built with Luca · three versions · source attached</small></div>
      </section>
      <footer><span>One continuous record</span><div class="signal"></div><span>August 20, 2026</span></footer>
    </main>
  </body>
</html>`;

const conversationMap = `# Conversation model

Six words hold the house together:

- **resident** — a stable identity
- **DM** — one persistent conversation
- **room** — work with one or many residents
- **project** — rooms plus connected context
- **visit** — someone answers in place
- **exchange** — bounded resident-to-resident speech

The interface should make those relationships legible without turning them into ceremony.`;

const quietNetworkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900"><rect width="1400" height="900" fill="#08090b"/><g fill="none" stroke="#374151" stroke-width="1"><path d="M130 620C310 280 470 710 690 390S1090 230 1280 520"/><path d="M90 390C330 580 480 190 720 480s390 160 590-150"/></g><g fill="#dfe3e8"><circle cx="130" cy="620" r="8"/><circle cx="360" cy="430" r="5"/><circle cx="690" cy="390" r="11"/><circle cx="980" cy="292" r="6"/><circle cx="1280" cy="520" r="8"/><circle cx="90" cy="390" r="5"/><circle cx="515" cy="313" r="7"/><circle cx="720" cy="480" r="5"/><circle cx="1110" cy="560" r="9"/><circle cx="1310" cy="330" r="5"/></g><g fill="#6f8dad"><circle cx="690" cy="390" r="3"/><circle cx="1110" cy="560" r="3"/></g><text x="92" y="96" fill="#dfe3e8" font-family="monospace" font-size="18" letter-spacing="4">QUIET NETWORK / FIELD 06</text><text x="92" y="830" fill="#7f8791" font-family="monospace" font-size="14">ten residents · two active exchanges · one owner present</text></svg>`;
const quietNetworkUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(quietNetworkSvg)}`;

const rustSource = `pub fn append_version(
    artifact: ArtifactId,
    expected: Version,
    content: ManagedBytes,
) -> Result<ArtifactReceipt, ArtifactError> {
    let current = catalog.current_version(artifact)?;
    if current != expected {
        return Err(ArtifactError::Conflict { current });
    }

    catalog.append_immutable(artifact, content)
}`;

export const ARTIFACT_LAB_FIXTURES: readonly ArtifactRecord[] = [
  {
    id: "threshold-study",
    title: "threshold-study.html",
    kind: "html",
    author: "Luca",
    authorSeed:
      "7b4d1a90c3e85f2681ad46b7f0c92e35d81f6a4b2c7e093d5a8f1b6c4e2d7093",
    conversation: "polyphonic",
    project: "Polyphonic",
    updatedAt: "6 min",
    sizeLabel: "8.4 KB",
    summary:
      "A responsive landing study for the threshold between conversation and durable work.",
    versions: [
      {
        id: "threshold-v3",
        number: 3,
        createdAt: "Today · 9:42 PM",
        note: "Tightened the thesis and rebuilt the lower measure.",
        sizeLabel: "8.4 KB",
        source: thresholdStudy,
      },
      {
        id: "threshold-v2",
        number: 2,
        createdAt: "Today · 9:18 PM",
        note: "Moved the argument onto one editorial plane.",
        sizeLabel: "7.9 KB",
        source: thresholdStudy
          .replace("study 03", "study 02")
          .replace(
            "The threshold is not a screen.",
            "A conversation can become a place.",
          ),
      },
      {
        id: "threshold-v1",
        number: 1,
        createdAt: "Today · 8:51 PM",
        note: "First complete direction.",
        sizeLabel: "6.1 KB",
        source: thresholdStudy
          .replace("study 03", "study 01")
          .replace(
            "The threshold is not a screen.",
            "Where the work becomes visible.",
          ),
      },
    ],
  },
  {
    id: "conversation-model",
    title: "conversation-model.md",
    kind: "markdown",
    author: "Coyote",
    authorSeed: "deadbeef".repeat(8),
    conversation: "Luca",
    project: "Polyphonic",
    updatedAt: "34 min",
    sizeLabel: "3.1 KB",
    summary:
      "The six-word model for the house and the relationships between its conversations.",
    versions: [
      {
        id: "conversation-v2",
        number: 2,
        createdAt: "Today · 9:14 PM",
        note: "Added visits and exchanges.",
        sizeLabel: "3.1 KB",
        source: conversationMap,
      },
      {
        id: "conversation-v1",
        number: 1,
        createdAt: "Yesterday · 11:08 PM",
        note: "Initial model.",
        sizeLabel: "2.4 KB",
        source: conversationMap.replace(
          "- **visit** — someone answers in place\n- **exchange** — bounded resident-to-resident speech\n",
          "",
        ),
      },
    ],
  },
  {
    id: "quiet-network",
    title: "quiet-network.png",
    kind: "image",
    author: "Vektor",
    authorSeed:
      "a5c802e73f14b96d8e05c2a71b34df6982e0c5b7a41d3f8062c9e17b5d4a3062",
    conversation: "field-notes",
    project: "Polyphonic",
    updatedAt: "2 hr",
    sizeLabel: "412 KB",
    summary: "A network-field study for the landing page's resident system.",
    imageUrl: quietNetworkUrl,
    versions: [
      {
        id: "network-v1",
        number: 1,
        createdAt: "Today · 7:36 PM",
        note: "Exported final field study.",
        sizeLabel: "412 KB",
        source: quietNetworkSvg,
      },
    ],
  },
  {
    id: "runtime-notes",
    title: "runtime-notes.md",
    kind: "markdown",
    author: "ziggy",
    authorSeed:
      "3e9f27c1b8a45d60f2317e9ac5d84b06f19c2d7e5a3b8c604f1e2d9a7b5c3084",
    conversation: "runtime-atlas",
    project: "Runtime atlas",
    updatedAt: "Yesterday",
    sizeLabel: "11 KB",
    summary:
      "Working notes on runtime-owned configuration and safe editing boundaries.",
    versions: [
      {
        id: "runtime-v1",
        number: 1,
        createdAt: "Yesterday · 4:12 PM",
        note: "Captured the current runtime atlas.",
        sizeLabel: "11 KB",
        source:
          "# Runtime notes\n\nEach runtime owns its own configuration. Polyphonic can edit through supported native surfaces, but credentials remain in the runtime's store.",
      },
    ],
  },
  {
    id: "artifact-capture",
    title: "artifact-capture.rs",
    kind: "code",
    language: "Rust",
    author: "Luca",
    authorSeed:
      "7b4d1a90c3e85f2681ad46b7f0c92e35d81f6a4b2c7e093d5a8f1b6c4e2d7093",
    conversation: "engineering",
    project: "Polyphonic",
    updatedAt: "Yesterday",
    sizeLabel: "5.8 KB",
    summary: "A sketch of append-only artifact version capture.",
    versions: [
      {
        id: "capture-v1",
        number: 1,
        createdAt: "Yesterday · 1:04 PM",
        note: "Initial storage sketch.",
        sizeLabel: "5.8 KB",
        source: rustSource,
      },
    ],
  },
  {
    id: "field-recording",
    title: "field-recording.pdf",
    kind: "pdf",
    author: "Vektor",
    authorSeed:
      "a5c802e73f14b96d8e05c2a71b34df6982e0c5b7a41d3f8062c9e17b5d4a3062",
    conversation: "field-notes",
    project: "Reading room",
    updatedAt: "Aug 18",
    sizeLabel: "2.8 MB",
    summary: "Reference plates and annotations from the latest field review.",
    versions: [
      {
        id: "field-v1",
        number: 1,
        createdAt: "Aug 18 · 3:24 PM",
        note: "Imported reference copy.",
        sizeLabel: "2.8 MB",
        source: "",
      },
    ],
  },
] as const;
