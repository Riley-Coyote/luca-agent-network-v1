import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ConversationalAction = {
  requestId: string;
  residentPubkey: string;
  sourceChatId: string;
  action:
    | "propose_agent"
    | "propose_native_link"
    | "propose_team"
    | "propose_project";
  payload: Record<string, unknown>;
};

const listeners = new Set<(action: ConversationalAction) => void>();
let nativeUnlisten: UnlistenFn | null = null;
let connectPromise: Promise<void> | null = null;

function isAction(value: unknown): value is ConversationalAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.requestId === "string" &&
    typeof item.residentPubkey === "string" &&
    typeof item.sourceChatId === "string" &&
    typeof item.payload === "object" &&
    item.payload !== null &&
    [
      "propose_agent",
      "propose_native_link",
      "propose_team",
      "propose_project",
    ].includes(String(item.action))
  );
}

function ensureConnected() {
  if (nativeUnlisten || connectPromise) return;
  connectPromise = listen<unknown>("luca-conversational-action", (event) => {
    if (!isAction(event.payload)) return;
    for (const listener of listeners) listener(event.payload);
  })
    .then((unlisten) => {
      nativeUnlisten = unlisten;
    })
    .finally(() => {
      connectPromise = null;
    });
}

export function subscribeConversationalActions(
  listener: (action: ConversationalAction) => void,
) {
  listeners.add(listener);
  ensureConnected();
  return () => {
    listeners.delete(listener);
  };
}
