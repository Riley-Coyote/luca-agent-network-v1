import type {
  SideConversation,
  TaskSide,
} from "@/features/exchange/sideConversations";
import {
  namesAsList,
  sideLiveWord,
} from "@/features/exchange/sideConversations";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import { normalizePubkey } from "@/shared/lib/pubkey";

import type { RailSideRow } from "./railHomes";

/**
 * The work in the Chats rail (BETA14_RELEASE.md WP-34, Decided 3): what is
 * handed to an agent or an app hangs on the thread under whoever does it.
 * Luca, a project and a room are one ongoing chat each and nest nothing, so
 * the side conversations that sat under Luca (WP-14) move: an exchange under
 * each agent it asks, a runtime task under the app that runs it. Pure, so it
 * is unit-tested under node.
 */

/** A side conversation as a rail row: its id, when it moved, its word. */
function rowOf(item: SideConversation, label: string): RailSideRow {
  return {
    at: item.at,
    shownAt:
      item.kind === "exchange" && item.atFrom === "deadline"
        ? null
        : item.at > 0
          ? item.at
          : null,
    conversationId: item.conversationId,
    id: `${item.kind}:${item.id}`,
    label,
    live: item.live,
    messageId: item.kind === "exchange" ? item.rootEventId : null,
    word: sideLiveWord(item),
  };
}

/**
 * Each agent's exchanges, by the agent's key (lowercase): every exchange
 * that asks it (it is among the members, and did not open it), for the keys
 * named, or for anyone asked when `agentKeys` is null. The row says
 * who else is in it and where: "Luca · Tidepool"; under the agent's row its
 * own name goes without saying.
 */
export function agentWorkRows(
  items: readonly SideConversation[],
  agentKeys: ReadonlySet<string> | null,
  nameOf: (pubkey: string) => string,
  roomOf: (conversationId: string) => string,
): Map<string, RailSideRow[]> {
  const byAgent = new Map<string, RailSideRow[]>();
  for (const item of items) {
    if (item.kind !== "exchange") continue;
    for (const asked of item.others) {
      const key = normalizePubkey(asked);
      if (agentKeys && !agentKeys.has(key)) continue;
      const others = item.members.filter((member) => member !== key);
      const who = namesAsList(others.map(nameOf));
      const room = roomOf(item.conversationId);
      const label = who && room ? `${who} · ${room}` : who || room;
      const rows = byAgent.get(key);
      const row = rowOf(item, label);
      if (rows) rows.push(row);
      else byAgent.set(key, [row]);
    }
  }
  return byAgent;
}

/** The app a task runs in, as the rail's families name them. */
export function taskFamily(task: Pick<TaskSide, "runtimeFamily">) {
  return runtimeRailFamilyFromRuntimeId(task.runtimeFamily);
}

/**
 * Each app's tasks, by its rail family ("claude", "codex"): every runtime
 * task it runs, for anyone, live and finished, newest first. The row is the
 * task's own summary: under the app's row the app goes without saying.
 */
export function appTaskRows(
  items: readonly SideConversation[],
): Map<string, RailSideRow[]> {
  const byApp = new Map<string, RailSideRow[]>();
  for (const item of items) {
    if (item.kind !== "task") continue;
    const family = taskFamily(item);
    if (!family) continue;
    const row = rowOf(item, item.summary);
    const rows = byApp.get(family);
    if (rows) rows.push(row);
    else byApp.set(family, [row]);
  }
  return byApp;
}
