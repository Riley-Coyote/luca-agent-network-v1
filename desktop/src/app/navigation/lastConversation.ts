const LAST_CONVERSATION_STORAGE_KEY = "luca:last-conversation.v1";

export function rememberLastConversation(channelId: string) {
  if (typeof window === "undefined" || channelId.length === 0) {
    return;
  }

  try {
    window.localStorage.setItem(LAST_CONVERSATION_STORAGE_KEY, channelId);
  } catch {
    // Navigation remains fully functional when local storage is unavailable.
  }
}

export function readLastConversation(
  availableChannelIds: ReadonlySet<string>,
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const channelId = window.localStorage.getItem(
      LAST_CONVERSATION_STORAGE_KEY,
    );
    return channelId && availableChannelIds.has(channelId) ? channelId : null;
  } catch {
    return null;
  }
}
