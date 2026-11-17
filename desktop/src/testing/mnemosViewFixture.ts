// Shell lab only. No native calls, memory files, tokens, or participant turns.
// `?memory=` disconnected | missing | failure | linkable (made-up minds to
// link) | linked; anything else opens a seeded view-only connection.
import type { MindChoice, ViewScope } from "@/shared/api/mnemosView";
const seeded: ViewScope = {
  agent_id: "wren",
  person_id: "pat-example",
  project_scope: "lighthouse",
};
const minds: MindChoice[] = [
  { id: "wren", name: "Wren", memories: 2431, newest: "2026-11-16" },
  {
    id: "field-notes",
    name: "Field Notes",
    memories: 86,
    newest: "2026-10-02",
  },
];
const examples: Record<string, string[]> = {
  memories: [
    "The keeper’s log lives in the blue binder on the shelf.",
    "The light is checked before dusk.",
  ],
  standing: ["The keeper’s log lives in the blue binder on the shelf."],
  journal: ["I left the window open long enough to hear the rain change."],
  notes: ["Please keep the tide times beside the lantern."],
  handoffs: ["The south window is ready for the morning check."],
  beliefs: ["Small routines make it easier to notice what changes."],
};
export function installMnemosViewFixture(
  resident: string,
  start: string | null,
) {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
          options?: unknown,
        ) => Promise<unknown>;
      };
    }
  ).__TAURI_INTERNALS__;
  const original = internals.invoke.bind(internals);
  let scope: ViewScope | null =
    start === "disconnected" || start === "missing" || start === "linkable"
      ? null
      : start === "linked"
        ? { agent_id: "wren", person_id: "user", project_scope: "global" }
        : seeded;
  let linked = start === "linked";
  const calls: string[] = [];
  Object.assign(window, { __mnemosViewCalls: calls });
  internals.invoke = async (cmd, args, options) => {
    // A linked resident restarts into its memory; the lab's resident is idle.
    if (
      (cmd === "try_stop_managed_agent_for_auto_restart" ||
        cmd === "start_managed_agent") &&
      args?.pubkey === resident
    ) {
      calls.push(`${cmd}:`);
      const agents = (await original("list_managed_agents")) as {
        pubkey: string;
      }[];
      return agents.find((agent) => agent.pubkey === resident) ?? null;
    }
    if (
      ![
        "mnemos_view_status",
        "read_mnemos_view",
        "connect_mnemos_view",
        "disconnect_mnemos_view",
        "mnemos_minds",
        "link_mnemos_mind",
      ].includes(cmd)
    )
      return original(cmd, args, options);
    calls.push(`${cmd}:${args?.section ?? ""}`);
    if (args?.residentPubkey !== resident) throw "resident_unavailable";
    if (cmd === "mnemos_view_status")
      return {
        scope,
        grant: scope ? "test-grant" : null,
        readerReady: start !== "missing",
        linked,
        mnemosReady: start === "linkable" || start === "linked",
      };
    if (cmd === "mnemos_minds") return minds;
    if (cmd === "link_mnemos_mind") {
      scope = {
        agent_id: String(args?.mind),
        person_id: "user",
        project_scope: "global",
      };
      linked = true;
      return true;
    }
    if (cmd === "connect_mnemos_view") {
      scope = args?.scope as ViewScope;
      return true;
    }
    if (cmd === "disconnect_mnemos_view") {
      scope = null;
      linked = false;
      return;
    }
    if (!scope || args?.grant !== "test-grant") throw "binding_changed";
    if (start === "failure") throw "store_changed";
    if (args?.section === "summary")
      return {
        kind: "summary",
        counts: {
          memories: { active: 2, dormant: 0, archived: 0 },
          standing: 1,
          journal: 1,
          notes: { all: 1, unread: 1 },
          handoffs: 1,
          beliefs: 1,
        },
      };
    const key = String(args?.section);
    const rows = examples[key] ?? [];
    const page = args?.cursor ? rows.slice(1) : rows.slice(0, 1);
    return {
      kind: "items",
      items: page.map((text) => ({
        text,
        clipped: false,
        ...(key === "notes" ? { author: "person" } : {}),
      })),
      nextCursor: rows.length > 1 && !args?.cursor ? "test-next" : null,
    };
  };
}
