// Shell lab only. No native calls, memory files, tokens, or participant turns.
import type { ViewScope } from "@/shared/api/mnemosView";
const seeded: ViewScope = {
  agent_id: "wren",
  person_id: "pat-example",
  project_scope: "lighthouse",
};
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
    start === "disconnected" || start === "missing" ? null : seeded;
  const calls: string[] = [];
  Object.assign(window, { __mnemosViewCalls: calls });
  internals.invoke = async (cmd, args, options) => {
    if (
      ![
        "mnemos_view_status",
        "read_mnemos_view",
        "connect_mnemos_view",
        "disconnect_mnemos_view",
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
      };
    if (cmd === "connect_mnemos_view") {
      scope = args?.scope as ViewScope;
      return true;
    }
    if (cmd === "disconnect_mnemos_view") {
      scope = null;
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
