/** Synthetic, export-safe fixtures. No host sessions or account data are read. */
export type SessionState = "working" | "waiting" | "ready" | "saved";
export type Turn = {
  id: string;
  role: "You" | "Claude Code" | "Codex";
  content: string;
};
export type StudySession = {
  id: string;
  title: string;
  project: string;
  branch: string;
  state: SessionState;
  origin: "Claude Code" | "Codex" | "Luca" | "You";
  updated: string;
  activity: string;
  context: number;
  turns: Turn[];
};

export const PROJECTS = ["Polyphonic", "Field Notes", "Personal website"];
export const SESSIONS: StudySession[] = [
  {
    id: "onboarding",
    title: "Finish the first-run setup",
    project: "Polyphonic",
    branch: "onboarding",
    state: "working",
    origin: "Luca",
    updated: "Now",
    activity: "Checking the first-run setup",
    context: 36,
    turns: [
      {
        id: "o1",
        role: "You",
        content:
          "Make the first-run setup simpler. Keep the existing permissions and let people do the rest by talking to Luca.",
      },
      {
        id: "o2",
        role: "Claude Code",
        content:
          "The setup now starts with a conversation. Connecting a harness stays explicit; the remaining choices can happen in chat.\n\nI’m checking three paths:\n- A fresh install with no saved settings.\n- Someone who connects Claude Code and skips observation.\n- Someone who approves following their recent work.\n\nYour existing conversations and permissions are unchanged.",
      },
    ],
  },
  {
    id: "release",
    title: "Verify the release candidate",
    project: "Polyphonic",
    branch: "release-checks",
    state: "waiting",
    origin: "You",
    updated: "2m",
    activity: "Waiting for your approval",
    context: 22,
    turns: [
      {
        id: "r1",
        role: "You",
        content:
          "Check the release candidate. Don’t publish or replace the installed app.",
      },
      {
        id: "r2",
        role: "Claude Code",
        content:
          "The source checks are clean. I’d like to run the focused conversation tests next. This only runs tests in the Polyphonic project; it won’t publish anything.",
      },
    ],
  },
  {
    id: "capture",
    title: "Make capturing a note feel instant",
    project: "Field Notes",
    branch: "quick-capture",
    state: "ready",
    origin: "Claude Code",
    updated: "12m",
    activity: "Ready for a follow-up",
    context: 18,
    turns: [
      {
        id: "c1",
        role: "You",
        content: "Let me capture an idea without choosing a collection first.",
      },
      {
        id: "c2",
        role: "Claude Code",
        content:
          "Done. A new note opens immediately and saves to Inbox. Choosing a collection is optional.\n\nThe keyboard shortcut and existing collections still work. You can try the capture flow now, or tell me what you’d like to change.",
      },
    ],
  },
  {
    id: "search",
    title: "Keep search fast as the library grows",
    project: "Field Notes",
    branch: "search-index",
    state: "saved",
    origin: "Claude Code",
    updated: "Yesterday",
    activity: "Saved session",
    context: 42,
    turns: [
      {
        id: "s1",
        role: "You",
        content: "Look for a way to avoid reindexing unchanged notes.",
      },
      {
        id: "s2",
        role: "Claude Code",
        content:
          "The index can reuse unchanged entries. The next step is to add a small fixture with a mix of new, changed and untouched notes, then compare the refresh work.",
      },
    ],
  },
  {
    id: "site",
    title: "A clearer home page",
    project: "Personal website",
    branch: "home",
    state: "saved",
    origin: "You",
    updated: "Wednesday",
    activity: "Saved session",
    context: 11,
    turns: [
      {
        id: "w1",
        role: "Claude Code",
        content:
          "The page now opens with the work itself. The longer introduction sits below it. We left the contact section unchanged.",
      },
    ],
  },
  {
    id: "attachments",
    title: "Check keyboard access for attachments",
    project: "Polyphonic",
    branch: "attachment-focus",
    state: "saved",
    origin: "Luca",
    updated: "Tuesday",
    activity: "Saved session",
    context: 15,
    turns: [
      {
        id: "a1",
        role: "Claude Code",
        content:
          "Keyboard focus returns to the composer after an attachment is removed. The remaining check is to try the same flow with a larger text size.",
      },
    ],
  },
];

export type StudyScene = "working" | "approval" | "empty" | "disconnected";
export type StudyDesign = {
  density: "comfortable" | "compact";
  scene: StudyScene;
};
export const HARNESS_STUDY_KEY =
  "ui-design-lab.polyphonic.harness-dashboard.v1";
export const DEFAULT_DESIGN: StudyDesign = {
  density: "comfortable",
  scene: "working",
};
export function normalizeDesign(value: unknown): StudyDesign {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    density: v.density === "compact" ? "compact" : "comfortable",
    scene: ["approval", "empty", "disconnected"].includes(String(v.scene))
      ? (v.scene as StudyScene)
      : "working",
  };
}
export function designBrief(design: StudyDesign) {
  return `Polyphonic · Claude Code workspace study (not approved for production)\n\nOne harness workspace inside the current production shell. The live session list and selected conversation share the page. Starting a task, continuing the exact saved session, and sending a follow-up are separate, explicit operations. No context-copy disguised as continuation.\n\n${design.density === "compact" ? "Compact" : "Comfortable"} session rows; ${design.scene} preview. Existing Instrument Sans UI, Inter reading type, production composer and markdown rendering. No new glass, shell geometry or decorative charts.\n\nUsage separates context occupancy, account allowance and API cost. Unknown provider quotas remain unavailable. All preview sessions, messages, approvals and numbers are synthetic. Browser glass is a stand-in. Implementation must capability-gate native approvals and continuation, use event-driven updates, and sleep hidden views. The study calls no harness and changes no permissions.`;
}
