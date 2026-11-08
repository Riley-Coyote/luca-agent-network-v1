/** Export-safe examples, never a claim about the host's running agents. */
export type Runtime = "claude_code" | "codex";
export type HomeDesign = {
  density: "comfortable" | "compact";
  timeline: boolean;
  results: boolean;
  journal: boolean;
  scene: "working" | "quiet" | "empty" | "disconnected";
};
export const HOME_KEY = "ui-design-lab.polyphonic.home.v1";
export const HOME_DEFAULT: HomeDesign = {
  density: "comfortable",
  timeline: true,
  results: true,
  journal: false,
  scene: "working",
};
export const HOME_PRESETS: Record<string, HomeDesign> = {
  Overview: HOME_DEFAULT,
  Focus: {
    ...HOME_DEFAULT,
    density: "compact",
    timeline: false,
    results: false,
  },
  Review: { ...HOME_DEFAULT, journal: true, scene: "quiet" },
};
export function normalizeHome(value: unknown): HomeDesign {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    density: v.density === "compact" ? "compact" : "comfortable",
    timeline: typeof v.timeline === "boolean" ? v.timeline : true,
    results: typeof v.results === "boolean" ? v.results : true,
    journal: v.journal === true,
    scene: ["quiet", "empty", "disconnected"].includes(String(v.scene))
      ? (v.scene as HomeDesign["scene"])
      : "working",
  };
}
export const HOME_WORK = [
  {
    id: "onboarding",
    runtime: "claude_code" as Runtime,
    title: "Finish the first-run setup",
    project: "Polyphonic",
    agent: "Vektor",
    detail: "Checking the fresh-install path",
    time: "14 min",
    state: "working",
    start: 57,
    end: 99,
  },
  {
    id: "search",
    runtime: "codex" as Runtime,
    title: "Keep search fast as the library grows",
    project: "Field Notes",
    agent: "Luca",
    detail: "Comparing incremental refreshes",
    time: "8 min",
    state: "working",
    start: 74,
    end: 99,
  },
  {
    id: "capture",
    runtime: "claude_code" as Runtime,
    title: "Make capturing a note feel instant",
    project: "Field Notes",
    agent: "Vektor",
    detail: "Keyboard and focus checks passed",
    time: "12m ago",
    state: "done",
    start: 8,
    end: 43,
  },
];
export const HOME_NAMES = { claude_code: "Claude Code", codex: "Codex" };
export function homeBrief(design: HomeDesign) {
  return `Polyphonic · Cross-harness Home study. Not approved for production.\n\nPurpose: see what is happening, what needs you, and ask Luca to handle the next step without leaving the overview. The primary reading ground is neutral black by night and white by day; secondary surfaces are a single neutral step, not navy. Instrument Sans UI, Inter reading text, the existing shell and production composer remain. Light-mode outgoing messages are content-width blue bubbles.\n\nNeeds-you requests lead, followed by harness workspaces and the cross-harness work list. ${design.timeline ? "A project-aligned activity timeline is visible." : "The timeline is hidden."} ${design.results ? "Recent results are visible." : "Recent results are hidden."} ${design.journal ? "A sample agent journal is visible as a future optional module." : "The optional journal is hidden."} Density: ${design.density}. Scene: ${design.scene}.\n\nLuca is the same persistent companion conversation, with a docked composer and optional side pane. Selected work is explicitly attached before a message is sent. Provider sessions and Usage are drill-downs, not more permanent rails. Opening a surface must not start or stop execution. Native-owned approvals must open the owning app if Polyphonic cannot decide them.\n\nEvery session, message, approval, usage value and result is synthetic. No provider calls, credential access, observation or permission changes. GrokBot is a proposed integration, not verified control of the Grok app or X. Journal is an optional design example, not Mnemos integration. Browser glass is an approximation of the existing shell; no new material engine is introduced.`;
}
