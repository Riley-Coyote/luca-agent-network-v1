/**
 * URL search-param keys managed by the channel-panel history state.
 *
 * Kept in a separate pure module (no React / router imports) so tests can
 * import and assert the patch contracts without a browser environment.
 */

export const CHANNEL_SEARCH_KEYS = [
  "agentSession",
  "agentSessionChannel",
  "autoSend",
  "channelManagement",
  "messageId",
  "profile",
  "profileTab",
  "profileView",
  "thread",
  "threadRootId",
] as const;

export type ChannelSearchKey = (typeof CHANNEL_SEARCH_KEYS)[number];

/**
 * Returns the search-param patch that clears only the `autoSend` trigger.
 *
 * Exported so tests can verify the patch is surgical — it must not include
 * `thread` or any other panel key that would collapse open panels. This is
 * the regression guard for the "auto-submit clear drops the thread route"
 * defect: a `goChannel()` re-navigation drops every search key including
 * `thread`; this patch removes only `autoSend` via `applyPatch`, preserving
 * the thread panel across the deferred `setTimeout(0)` submit.
 */
export function buildAutoSendClearPatch(): Partial<
  Record<ChannelSearchKey, string | null>
> {
  return { autoSend: null };
}

/** The sentinel the channel-management panel carries — open/closed only. */
export const CHANNEL_MANAGEMENT_OPEN_VALUE = "1";

/**
 * A whole auxiliary-panel arrangement, as one patch.
 *
 * Omitted keys are left alone; `null` clears. Opening one panel usually means
 * closing three others, and doing that with four separate setters produced
 * four URL patches — four navigations the router each wrapped in its own
 * document view transition, aborting one another mid-flight. One arrangement
 * is one patch, so it is one navigation.
 */
export type ChannelPanelState = {
  agentSession?: string | null;
  agentSessionChannel?: string | null;
  channelManagement?: boolean;
  profile?: string | null;
  thread?: string | null;
};

export function buildPanelStatePatch(
  next: ChannelPanelState,
): Partial<Record<ChannelSearchKey, string | null>> {
  const patch: Partial<Record<ChannelSearchKey, string | null>> = {};
  if (next.thread !== undefined) {
    patch.thread = next.thread;
  }
  if (next.profile !== undefined) {
    // Opening, switching, or closing a profile always resets its sub-view —
    // the carried `profileView` would otherwise leak onto the next profile.
    patch.profile = next.profile;
    patch.profileTab = null;
    patch.profileView = null;
  }
  if (next.agentSession !== undefined) {
    patch.agentSession = next.agentSession;
    // Closing the session drops its channel scope with it; opening one leaves
    // the scope to an explicit `agentSessionChannel` below.
    if (next.agentSession === null) patch.agentSessionChannel = null;
  }
  if (next.agentSessionChannel !== undefined) {
    patch.agentSessionChannel = next.agentSessionChannel;
  }
  if (next.channelManagement !== undefined) {
    patch.channelManagement = next.channelManagement
      ? CHANNEL_MANAGEMENT_OPEN_VALUE
      : null;
  }
  return patch;
}
