import { invokeTauri } from "@/shared/api/tauri";
import { useFeatureEnabled } from "@/shared/features";

/**
 * The preview-feature id that gates the "Open as window" affordance.
 *
 * Registered in `preview-features.json` with `defaultEnabled: true`, which
 * gives it a real Settings row (Experimental features) and makes the manifest
 * the single authority — the fail-open hazard for unknown ids does not apply
 * to a registered id, so no bypass is needed here.
 */
export const POPOUT_WINDOWS_FEATURE_ID = "popout-chat-windows";

/** Whether the owner can pop a conversation out into its own window. */
export function usePopoutWindowsEnabled(): boolean {
  return useFeatureEnabled(POPOUT_WINDOWS_FEATURE_ID);
}

/**
 * Open (or focus) the pop-out chat window for one conversation.
 *
 * `title` is the conversation's already-resolved display name; it becomes the
 * native window title, which is what the Window menu, Mission Control and
 * VoiceOver read, and what the pop-out's own strip reads back.
 *
 * Resolves with the window's label.
 */
export function openChannelPopout(
  channelId: string,
  title: string,
): Promise<string> {
  return invokeTauri<string>("open_channel_popout", { channelId, title });
}
