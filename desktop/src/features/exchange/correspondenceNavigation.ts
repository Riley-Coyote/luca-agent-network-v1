import { correspondenceDraftKey } from "./correspondenceView";
import type { AgentInboxScope } from "@/shared/api/agentInbox";

export type CorrespondenceIntent = "new-message" | "reply";
export type CorrespondenceSearch = {
  seed?: string;
  task?: string;
  recipient?: string;
  reply?: string;
  invalid?: true;
};

const eventRef = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** URL references select a view, never grant access or dispatch work. */
export function correspondenceSearch(
  search: Record<string, unknown>,
): CorrespondenceSearch {
  const result: CorrespondenceSearch = {};
  for (const key of ["seed", "task", "recipient", "reply"] as const) {
    if (search[key] == null) continue;
    if (eventRef(search[key])) result[key] = search[key];
    else result.invalid = true;
  }
  if (result.reply && !result.task) result.invalid = true;
  return result;
}

export function correspondencePathId(pathname: string): string | null {
  const match = /^\/correspondence\/(correspondence-v1-[a-f0-9]{64})$/.exec(
    pathname,
  );
  return match?.[1] ?? null;
}

/** A general pair message has one draft across tasks and presentation hosts.
 * Keep an existing legacy draft's exact key, including its uncertain-send ID;
 * never rename, merge or discard drafts during navigation. */
export function generalCorrespondenceDraftKey(
  scope: AgentInboxScope,
  pair: string,
  recipient: string,
  existingKeys: readonly string[],
): string {
  const canonical = correspondenceDraftKey(scope, pair, "new-topic", recipient);
  if (existingKeys.includes(canonical)) return canonical;
  for (const key of existingKeys) {
    if (!key.startsWith("agent-inbox:")) continue;
    try {
      const parts: unknown = JSON.parse(key.slice("agent-inbox:".length));
      if (
        Array.isArray(parts) &&
        parts.length === 5 &&
        parts[0] === scope.communityId &&
        parts[1] === scope.ownerPubkey &&
        parts[2] === pair &&
        parts[4] === recipient &&
        typeof parts[3] === "string" &&
        parts[3].startsWith("new-topic:")
      )
        return key;
    } catch {
      /* Other keys are not this conversation's drafts. */
    }
  }
  return canonical;
}
