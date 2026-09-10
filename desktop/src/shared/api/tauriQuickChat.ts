import type {
  QuickChatEffort,
  QuickChatImage,
} from "@/features/quickchat/types";
import { invokeTauri } from "./tauri";

export async function captureQuickChatWindow(): Promise<QuickChatImage> {
  return invokeTauri<QuickChatImage>("quickchat_capture_window");
}

export async function getQuickChatEffort(
  conversationId: string,
  residentPubkey: string,
): Promise<QuickChatEffort> {
  return invokeTauri<QuickChatEffort>("quickchat_get_effort", {
    conversationId,
    residentPubkey,
  });
}
