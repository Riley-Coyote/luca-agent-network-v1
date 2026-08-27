import { invokeTauri } from "@/shared/api/tauri";
import { resolveEnabled, useFeatureSnapshot } from "@/shared/features";

/**
 * The preview-feature id that gates the "Open as window" affordance.
 *
 * NOTE ON THE READ PATH: `useFeatureEnabled` fails OPEN for ids that are not in
 * `preview-features.json` — an unknown id resolves to `true` so a stale
 * `<FeatureGate>` can never hide shipped UI. That default is exactly wrong for
 * a surface that is still being proven, so this reads the same override store
 * directly and resolves it against an explicit `false`. Same store, same
 * single-name lookup, same cross-window reactivity — but absent an override the
 * answer is "off". (The pane deck reads its own flag the same way; see
 * `features/panes/paneState.ts`.)
 */
export const POPOUT_WINDOWS_FEATURE_ID = "popout-chat-windows";

/** Whether the owner can pop a conversation out into its own window. */
export function usePopoutWindowsEnabled(): boolean {
  const overrides = useFeatureSnapshot();
  return resolveEnabled(POPOUT_WINDOWS_FEATURE_ID, overrides, false);
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
