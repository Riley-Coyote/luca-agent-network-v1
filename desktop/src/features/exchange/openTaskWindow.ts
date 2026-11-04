import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";

export const OPEN_TASK_CHAT = "polyphonic:open-task-chat";

/** Reveal the task beside the current conversation. Opening never dispatches. */
export async function openTaskWindow(exchangeId: string): Promise<void> {
  if (isTauri() && getCurrentWindow().label !== "main") {
    try {
      await emitTo("main", OPEN_TASK_CHAT, exchangeId);
    } catch (error) {
      toast.error("Couldn’t open the task in the main window", {
        description: String(error),
      });
    }
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_TASK_CHAT, { detail: exchangeId }));
}
