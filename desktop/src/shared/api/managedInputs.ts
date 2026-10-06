import { listen } from "@tauri-apps/api/event";
import { invokeTauri } from "@/shared/api/tauri";

/** Body-free renderer reconciliation after a successful native decision. */
export const MANAGED_INPUT_REFRESH_EVENT = "luca:managed-input-refresh";

export type ManagedInputValue = string | string[];
export type ManagedInputField = {
  key: string;
  label: string;
  description: string | null;
  kind: "text" | "single" | "multiple";
  options: Array<{ value: string; label: string; description: string | null }>;
  required: boolean;
};
export type PendingManagedInput = {
  pendingId: string;
  request: {
    conversationId: string;
    residentPubkey: string;
    message: string;
    fields: ManagedInputField[];
  };
};

type RawInput = {
  pendingId: string;
  request: {
    conversation_id: string;
    resident_pubkey: string;
    message: string;
    fields: ManagedInputField[];
  };
};

/** Questions are transient native requests, not approvals or retained answers. */
export async function listPendingManagedInputs(): Promise<
  PendingManagedInput[]
> {
  const raw = await invokeTauri<RawInput[]>("list_pending_managed_inputs");
  return raw.map(({ pendingId, request }) => ({
    pendingId,
    request: {
      conversationId: request.conversation_id,
      residentPubkey: request.resident_pubkey,
      message: request.message,
      fields: request.fields,
    },
  }));
}

/** Return one bounded answer to its native question; never a permission grant. */
export async function resolveManagedInput(
  pendingId: string,
  action: "answered" | "declined" | "cancelled",
  answers: Record<string, ManagedInputValue> = {},
): Promise<void> {
  await invokeTauri("resolve_managed_input", {
    pendingId,
    action,
    answers: action === "answered" ? answers : {},
  });
  // The command succeeded even if the native resolution event was missed.
  // The signal intentionally carries no question or answer body.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MANAGED_INPUT_REFRESH_EVENT, { detail: { pendingId } }),
    );
  }
}

/** Subscribe to body-free question changes; detach both listeners together. */
export async function listenForManagedInputChanges(
  callback: (resolvedId?: string) => void,
) {
  const results = await Promise.allSettled([
    listen("managed-input-pending", () => callback()),
    listen<{ pendingId: string }>("managed-input-resolved", ({ payload }) =>
      callback(
        typeof payload?.pendingId === "string" ? payload.pendingId : undefined,
      ),
    ),
  ]);
  const stops = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    for (const stop of stops) stop();
    throw failed.reason;
  }
  return () => {
    for (const stop of stops) stop();
  };
}
