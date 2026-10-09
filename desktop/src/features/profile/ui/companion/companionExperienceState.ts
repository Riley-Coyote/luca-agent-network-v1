/** Preview-only state. These values are not grants, native facts, or receipts. */
export type CompanionPreviewScene = "off" | "context" | "carried" | "paused" | "unavailable" | "busy" | "privacy";
export type CompanionSourceChoice = "observe" | "promote" | "egress";
export type CompanionSourceGrant = Record<CompanionSourceChoice, boolean>;
export type CompanionPreviewState = {
  scene: CompanionPreviewScene;
  companion: "luca" | "ziggy";
  awarenessPaused: boolean;
  workPaused: boolean;
  backgroundEnabled: boolean;
  grants: Record<string, CompanionSourceGrant>;
  shared: "open" | "deferred" | "declined" | "retired";
  own: "pursue" | "defer" | "decline";
  historyChoice: "undecided" | "declined" | "sample_allowed";
  creationWithdrawn: boolean;
};

/** Exact source classes stay separate even in the simulation. No account feed. */
export const COMPANION_PREVIEW_SOURCES = [
  { id: "codex-profile-metadata", label: "Codex work · metadata", scope: "One selected profile · metadata", detail: "New or changed sessions after permission. Past history is not scanned. File changes do not prove active work." },
  { id: "codex-profile-excerpts", label: "Codex work · visible messages", scope: "One selected profile · visible messages", detail: "A separate choice from metadata. Recent visible messages only; private, internal, and subagent work stays excluded." },
  { id: "claude-profile-metadata", label: "Claude Code work · metadata", scope: "One selected profile · metadata", detail: "New or changed sessions after permission. Past history is not scanned. Metadata access does not include message text." },
  { id: "claude-profile-excerpts", label: "Claude Code work · visible messages", scope: "One selected profile · visible messages", detail: "A recent visible tail only. Private, internal, and subagent work stays excluded." },
  { id: "selected-files", label: "Selected project files", scope: "Only the files you choose", detail: "Read-only context from selected files. This does not allow project edits." },
  { id: "browser-visits", label: "Browser visits", scope: "One paired normal browser profile", detail: "Private browsing is excluded. Visit access does not include bookmarks or page text." },
  { id: "browser-bookmarks", label: "Browser bookmarks", scope: "One paired normal browser profile", detail: "A separate bookmark choice through the paired extension. No visits or page text." },
  { id: "browser-excerpts", label: "Browser page text", scope: "Separately chosen page access", detail: "Bounded excerpts from allowed pages through the paired extension, not other browser windows." },
  { id: "app-metadata", label: "Frontmost app", scope: "Allowed app names only", detail: "App metadata is separate from window text. It does not establish attention or browser privacy." },
  { id: "accessibility-text", label: "Accessible window text", scope: "Allowed non-browser apps", detail: "TextEdit and Preview only for now. Requires OS access; secure fields and excluded documents are blocked." },
  { id: "screen-text", label: "Text from a window image", scope: "One allowed non-browser window", detail: "TextEdit and Preview only for now, with separate screen permission and document checks. No screenshots are saved." },
] as const;

export type CompanionPreviewAction =
  | { type: "source"; id: string; choice: CompanionSourceChoice; enabled: boolean }
  | { type: "pause-awareness" }
  | { type: "pause-work" }
  | { type: "background"; enabled: boolean }
  | { type: "companion"; companion: CompanionPreviewState["companion"] }
  | { type: "shared"; disposition: CompanionPreviewState["shared"] }
  | { type: "own"; disposition: CompanionPreviewState["own"] }
  | { type: "history"; choice: CompanionPreviewState["historyChoice"] };

export function companionPreviewState(scene: CompanionPreviewScene): CompanionPreviewState {
  const selected = scene !== "off";
  const sampleSelections: readonly string[] = ["codex-profile-metadata", "claude-profile-excerpts", "selected-files"];
  const grants = Object.fromEntries(COMPANION_PREVIEW_SOURCES.map((source) => [source.id, {
    observe: selected && sampleSelections.includes(source.id),
    promote: selected && scene === "carried" && sampleSelections.includes(source.id),
    egress: false,
  }])) as CompanionPreviewState["grants"];
  return {
    scene, companion: "luca", grants,
    awarenessPaused: scene === "paused",
    workPaused: scene === "paused",
    backgroundEnabled: scene === "carried" || scene === "busy" || scene === "paused",
    shared: "open", own: "defer", historyChoice: "undecided", creationWithdrawn: false,
  };
}

export function reduceCompanionPreview(state: CompanionPreviewState, action: CompanionPreviewAction): CompanionPreviewState {
  switch (action.type) {
    case "source": {
      if (!COMPANION_PREVIEW_SOURCES.some((source) => source.id === action.id)) return state;
      const current = state.grants[action.id];
      if (!current || (action.choice !== "observe" && !current.observe)) return state;
      const grant = action.choice === "observe" && !action.enabled
        ? { observe: false, promote: false, egress: false }
        : { ...current, [action.choice]: action.enabled };
      const withdrawsCreation = !action.enabled && (action.choice === "observe" || action.choice === "promote") && ["claude-profile-excerpts", "selected-files"].includes(action.id);
      return { ...state, grants: { ...state.grants, [action.id]: grant }, creationWithdrawn: state.creationWithdrawn || withdrawsCreation };
    }
    case "pause-awareness": return { ...state, awarenessPaused: !state.awarenessPaused };
    case "pause-work": return { ...state, workPaused: !state.workPaused };
    case "background": return state.companion === "ziggy" && action.enabled ? state : { ...state, backgroundEnabled: action.enabled };
    case "companion":
      // A different companion does not inherit the first one's source choices.
      return action.companion === state.companion ? state : { ...companionPreviewState("off"), companion: action.companion };
    case "shared": return { ...state, shared: action.disposition };
    case "own": return { ...state, own: action.disposition };
    case "history": return {
      ...state,
      historyChoice: action.choice,
      grants: action.choice === "declined"
        ? Object.fromEntries(Object.entries(state.grants).map(([id, grant]) => [id, { ...grant, egress: false }]))
        : state.grants,
    };
  }
}

/** Truthful labels: selected context is local; chat injection stays under review. */
export function companionPreviewPresentation(state: CompanionPreviewState) {
  const currentSources = COMPANION_PREVIEW_SOURCES.filter((source) => state.grants[source.id]?.observe);
  const sourceCount = currentSources.length;
  const contextAvailable = sourceCount > 0 && !state.awarenessPaused && state.scene !== "unavailable";
  return {
    sourceCount,
    currentSources,
    contextAvailable,
    contextLabel: state.awarenessPaused ? "Awareness paused" : state.scene === "unavailable" ? "Context unavailable" : sourceCount ? "Available locally · sample" : "No sources selected",
    chatContextLabel: "Live context in chat is off · privacy review open",
    workLabel: !state.backgroundEnabled ? "Background work is off" : state.workPaused ? "Background work paused" : state.scene === "busy" ? "Running · sample task" : "Idle · no task running",
    planningLabel: state.companion === "ziggy" ? "Private Codex planning is not verified. Background work stays off." : "Native work is not running in this preview.",
    showCreation: state.scene === "carried",
    creationAvailable: !state.creationWithdrawn && ["claude-profile-excerpts", "selected-files"].every((id) => state.grants[id]?.observe && state.grants[id]?.promote),
  };
}
