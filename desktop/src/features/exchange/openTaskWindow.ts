import { invokeTauri } from "@/shared/api/tauri";
import { toast } from "sonner";

/** Reveal one native pair window without navigating or dispatching anything. */
export async function openTaskWindow(exchangeId: string): Promise<void> {
  try {
    await invokeTauri("open_chat_view", {
      target: { kind: "correspondence", exchangeId },
    });
  } catch (error) {
    toast.error("Couldn’t open this task", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
