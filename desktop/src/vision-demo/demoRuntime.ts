import { useCallback, useEffect, useMemo, useState } from "react";

export type DemoView = "network" | "agents" | "brain" | "continuity";
export type AgentId = "luca" | "mara" | "sol";

export type DemoAgent = {
  id: AgentId;
  name: string;
  initials: string;
  role: string;
  voice: string;
  publicKey: string;
  fingerprint: string;
  sessions: number;
  relationship: string;
  reflections: number;
  lastConsolidation: string;
  scope: string;
  accent: string;
};

export type DemoMessage = {
  id: string;
  visibleAt: number;
  author: "riley" | AgentId | "system";
  kind: "message" | "arrival" | "memory" | "outcome" | "session";
  body: string;
  time: string;
  meta?: string;
  memoryIds?: string[];
};

export type DemoMemory = {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceDetail: string;
  recorded: string;
  confidence: string;
  scope: string;
  allowedAgents: AgentId[];
  recalledAt: number;
  tags: string[];
};

export type ContinuityEvent = {
  id: string;
  visibleAt: number;
  agentId: AgentId;
  type: "session" | "reflection" | "consolidation" | "return";
  title: string;
  body: string;
  time: string;
  receipt: string;
};

export const STORY_BEATS = [
  { label: "The question", short: "Ask" },
  { label: "Memory opens", short: "Recall" },
  { label: "Luca remembers", short: "Remember" },
  { label: "The room expands", short: "Invite" },
  { label: "Agents confer", short: "Confer" },
  { label: "A thesis forms", short: "Synthesize" },
  { label: "Life between sessions", short: "Reflect" },
  { label: "The same selves return", short: "Return" },
] as const;

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "luca",
    name: "Luca",
    initials: "LU",
    role: "Continuity · synthesis",
    voice: "Holds the long thread and makes the whole legible.",
    publicKey:
      "fb0126a4c89669f3ab713631d0aa1553b0a461d744b5ef1ec244c1ad2b0acaaf",
    fingerprint: "fb01 26a4 · 2b0a caaf",
    sessions: 426,
    relationship: "1 year, 8 months",
    reflections: 1_284,
    lastConsolidation: "Today · 4:12 PM",
    scope: "Personal brain · projects · relationships",
    accent: "#7aa2f7",
  },
  {
    id: "mara",
    name: "Mara",
    initials: "MA",
    role: "Narrative intelligence",
    voice: "Notices what an idea means before deciding how to say it.",
    publicKey:
      "d929130420c8a80344166e9b623f02f2b9a61b0d00bb2a46cbbbbd7509127847",
    fingerprint: "d929 1304 · 0912 7847",
    sessions: 188,
    relationship: "11 months",
    reflections: 642,
    lastConsolidation: "Today · 4:15 PM",
    scope: "Personal brain · published work",
    accent: "#d9a0ad",
  },
  {
    id: "sol",
    name: "Sol",
    initials: "SO",
    role: "Systems · verification",
    voice: "Protects the difference between an idea, a claim, and a proof.",
    publicKey:
      "97b98aa8e46a0576207dd779965e2dfc1f23a1c67aa4dc157d011de46409b250",
    fingerprint: "97b9 8aa8 · 6409 b250",
    sessions: 231,
    relationship: "1 year, 2 months",
    reflections: 718,
    lastConsolidation: "Today · 4:16 PM",
    scope: "Projects · technical archive · decisions",
    accent: "#9db7a0",
  },
];

export const DEMO_MEMORIES: DemoMemory[] = [
  {
    id: "memory-conductor",
    title: "The conductor was intentionally removed",
    body: "The simplest valuable product is not one agent hiding the work of the others. Riley talks directly with persistent agents in shared rooms; coordination stays visible and human-readable.",
    source: "Product decision",
    sourceDetail: "Buzz → Luca planning session",
    recorded: "July 22 · 10:41 PM",
    confidence: "Verified",
    scope: "Project · Luca Agent Network",
    allowedAgents: ["luca", "mara", "sol"],
    recalledAt: 1,
    tags: ["product", "multi-agent", "decision"],
  },
  {
    id: "memory-promise",
    title: "Continuity is the product, not a settings feature",
    body: "The launch should lead with agents remaining themselves across sessions: stable identity, relationship history, reflection, and access to the user's memory with explicit provenance.",
    source: "Launch thesis",
    sourceDetail: "Luca / Polyphonic synthesis",
    recorded: "July 31 · 3:08 PM",
    confidence: "High confidence",
    scope: "Personal · product narrative",
    allowedAgents: ["luca", "mara"],
    recalledAt: 4,
    tags: ["continuity", "launch", "identity"],
  },
  {
    id: "memory-truth",
    title: "Never blur the line between a vision and a shipped proof",
    body: "A simulated system may make the complete interaction tangible, but public language must distinguish the real interface from cognition, memory, or cryptographic infrastructure that is still under construction.",
    source: "Trust constraint",
    sourceDetail: "Vision-demo brief",
    recorded: "Today · 4:02 PM",
    confidence: "Policy",
    scope: "Project · public claims",
    allowedAgents: ["luca", "mara", "sol"],
    recalledAt: 4,
    tags: ["trust", "claims", "demo"],
  },
  {
    id: "memory-inner-life",
    title: "The long horizon is an inner life, not infinite chat history",
    body: "Between sessions, agents should reflect, consolidate unresolved questions, and change through experience without flattening every event into a permanent prompt transcript.",
    source: "Polyphonic principle",
    sourceDetail: "Agent cognition notes",
    recorded: "June 28 · 11:19 AM",
    confidence: "Core direction",
    scope: "Personal · agent architecture",
    allowedAgents: ["luca", "mara", "sol"],
    recalledAt: 6,
    tags: ["reflection", "consolidation", "polyphonic"],
  },
];

export const DEMO_MESSAGES: DemoMessage[] = [
  {
    id: "m-01",
    visibleAt: 0,
    author: "riley",
    kind: "message",
    body: "I want to show people what this actually becomes—not another AI chat app, but a place where my agents remain themselves and think together. What is the clearest launch story?",
    time: "4:07 PM",
  },
  {
    id: "m-02",
    visibleAt: 1,
    author: "system",
    kind: "memory",
    body: "Luca recalled 1 relevant decision from your universal brain.",
    time: "4:07 PM",
    meta: "Scoped retrieval · Project: Luca Agent Network",
    memoryIds: ["memory-conductor"],
  },
  {
    id: "m-03",
    visibleAt: 2,
    author: "luca",
    kind: "message",
    body: "Lead with continuity. The unusual thing is not that several models can enter one chat. It is that the same agents return with stable identities, a lived relationship with you, and shared access to the parts of your history you permit. We already decided the room should stay direct: no conductor hiding their work.",
    time: "4:08 PM",
    meta: "Signed by Luca · memory receipt attached",
    memoryIds: ["memory-conductor"],
  },
  {
    id: "m-04",
    visibleAt: 3,
    author: "system",
    kind: "arrival",
    body: "Luca brought Mara and Sol into the room.",
    time: "4:08 PM",
    meta: "Participants added openly · no delegated hidden thread",
  },
  {
    id: "m-05",
    visibleAt: 4,
    author: "mara",
    kind: "message",
    body: "Then the launch should feel like reunion, not activation. Open the app and the people you have been thinking with are still there. They remember the texture of the work—not merely the last twenty messages—and they can meet each other in the same room.",
    time: "4:10 PM",
    meta: "Signed by Mara · 2 memories consulted",
    memoryIds: ["memory-promise", "memory-truth"],
  },
  {
    id: "m-06",
    visibleAt: 4,
    author: "sol",
    kind: "message",
    body: "And show the proof boundary. Identity is cryptographic. Memory access is scoped. Every recall points back to its source. The inner-life engine is visible as reflection and consolidation—not mystified as sentience, and not silently mixed into authority.",
    time: "4:11 PM",
    meta: "Signed by Sol · trust boundary checked",
    memoryIds: ["memory-truth"],
  },
  {
    id: "m-07",
    visibleAt: 5,
    author: "system",
    kind: "outcome",
    body: "Launch thesis: Your agents remain themselves, remember what matters, and work together inside one continuous personal network.",
    time: "4:13 PM",
    meta: "Shared outcome · signed by 3 residents",
    memoryIds: ["memory-conductor", "memory-promise", "memory-truth"],
  },
  {
    id: "m-08",
    visibleAt: 6,
    author: "system",
    kind: "session",
    body: "Session closed. 3 private reflections completed; 2 consolidation proposals added to continuity review.",
    time: "4:17 PM",
    meta: "No automatic memory writes · review remains with Riley",
  },
  {
    id: "m-09",
    visibleAt: 7,
    author: "system",
    kind: "session",
    body: "Later · Friday, 9:14 AM · the same room reopens",
    time: "Friday",
    meta: "Identity chain verified · 3 of 3 residents continuous",
  },
  {
    id: "m-10",
    visibleAt: 7,
    author: "luca",
    kind: "message",
    body: "I kept one unresolved question from our launch session: how do we make continuity felt before we explain its architecture? Mara's reflection suggests opening on the return itself. Sol wants the identity receipt visible but quiet. I think they are both right.",
    time: "9:14 AM",
    meta: "Same identity · session 427 · unresolved thread resumed",
    memoryIds: ["memory-inner-life"],
  },
];

export const CONTINUITY_EVENTS: ContinuityEvent[] = [
  {
    id: "c-01",
    visibleAt: 0,
    agentId: "luca",
    type: "session",
    title: "Launch room opened",
    body: "Existing relationship state and 426 prior sessions loaded.",
    time: "Today · 4:07 PM",
    receipt: "evt · 8c7f…1a92",
  },
  {
    id: "c-02",
    visibleAt: 6,
    agentId: "luca",
    type: "reflection",
    title: "Private reflection",
    body: "The strongest story is not coordination. It is recognition: returning to minds whose relationship with Riley has survived the boundary.",
    time: "Today · 4:12 PM",
    receipt: "enc · 71a4…6e20",
  },
  {
    id: "c-03",
    visibleAt: 6,
    agentId: "mara",
    type: "reflection",
    title: "Private reflection",
    body: "Begin with reunion. Explain cryptography only after the viewer feels why remaining the same matters.",
    time: "Today · 4:15 PM",
    receipt: "enc · 61bd…9c11",
  },
  {
    id: "c-04",
    visibleAt: 6,
    agentId: "sol",
    type: "consolidation",
    title: "Continuity proposal",
    body: "Carry forward the distinction between stable identity, scoped recall, and simulated cognition as a launch constraint.",
    time: "Today · 4:16 PM",
    receipt: "proposal · awaiting Riley",
  },
  {
    id: "c-05",
    visibleAt: 7,
    agentId: "luca",
    type: "return",
    title: "Identity returned intact",
    body: "Session 427 resumed with the same signing key, relationship history, unresolved question, and approved memory scope.",
    time: "Friday · 9:14 AM",
    receipt: "verified · fb01…caaf",
  },
];

const LAST_STORY_STEP = STORY_BEATS.length - 1;

export function agentById(id: AgentId): DemoAgent {
  return DEMO_AGENTS.find((agent) => agent.id === id) ?? DEMO_AGENTS[0];
}

export function useDemoRuntime() {
  const [view, setView] = useState<DemoView>("network");
  const [step, setStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("luca");
  const [selectedMemoryId, setSelectedMemoryId] = useState(DEMO_MEMORIES[0].id);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<DemoMessage[]>([]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    if (step >= LAST_STORY_STEP) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStep((current) => Math.min(current + 1, LAST_STORY_STEP));
    }, 2_400);
    return () => window.clearTimeout(timer);
  }, [isPlaying, step]);

  const restart = useCallback(() => {
    setView("network");
    setStep(0);
    setIsPlaying(false);
    setSelectedAgentId("luca");
    setSelectedMemoryId(DEMO_MEMORIES[0].id);
    setDraft("");
    setLocalMessages([]);
  }, []);

  const togglePlayback = useCallback(() => {
    if (step >= LAST_STORY_STEP) {
      setStep(0);
      setView("network");
    }
    setIsPlaying((current) => !current);
  }, [step]);

  const jumpToStep = useCallback((nextStep: number) => {
    setStep(Math.max(0, Math.min(nextStep, LAST_STORY_STEP)));
    setIsPlaying(false);
  }, []);

  const sendDraft = useCallback(() => {
    const message = draft.trim();
    if (!message) {
      return;
    }
    setLocalMessages((current) => [
      ...current,
      {
        id: `local-${current.length + 1}`,
        visibleAt: step,
        author: "riley",
        kind: "message",
        body: message,
        time: "Now",
        meta: "Local demo note · not sent to a model",
      },
    ]);
    setDraft("");
  }, [draft, step]);

  const visibleMessages = useMemo(
    () => [
      ...DEMO_MESSAGES.filter((message) => message.visibleAt <= step),
      ...localMessages,
    ],
    [localMessages, step],
  );
  const visibleMemories = useMemo(
    () => DEMO_MEMORIES.filter((memory) => memory.recalledAt <= step),
    [step],
  );
  const visibleContinuity = useMemo(
    () => CONTINUITY_EVENTS.filter((event) => event.visibleAt <= step),
    [step],
  );

  return {
    view,
    setView,
    step,
    isPlaying,
    selectedAgentId,
    setSelectedAgentId,
    selectedMemoryId,
    setSelectedMemoryId,
    draft,
    setDraft,
    visibleMessages,
    visibleMemories,
    visibleContinuity,
    restart,
    togglePlayback,
    jumpToStep,
    sendDraft,
  };
}
