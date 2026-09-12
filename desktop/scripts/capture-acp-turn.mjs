#!/usr/bin/env node
/**
 * WP-LAB2 · Capture a REAL resident turn as ACP `session/update` frames.
 *
 * WHY THIS EXISTS. The previous lab was driven by invented narration
 * ("Two of the entries under Fixed describe the same change") and the made-up
 * sentence misled a design decision. Nothing in this lab is written by hand:
 * every phrase on screen comes out of a turn a resident actually ran.
 *
 * WHERE THE FRAMES COME FROM. The desktop ingests observer frames of kind
 * 24200 — encrypted and ephemeral, so they are not on disk anywhere after the
 * turn. What IS on disk is the Codex rollout the resident's runtime wrote
 * while that same turn ran (`~/.codex/sessions/**`, `session_meta.originator`
 * = `buzz-acp`). codex-acp is a pure translator between the two: this script
 * applies that translation, function for function, so the fixture holds the
 * frames the desktop saw.
 *
 * The mapping is transcribed from the installed adapter,
 * `@agentclientprotocol/codex-acp@1.11.0`, `dist/index.js`:
 *   Reasoning         → agent_thought_chunk
 *   AgentMessage      → agent_message_chunk
 *   CommandExecution  → tool_call (+ tool_call_update on completion) via
 *                       createCommandExecutionUpdate / createCommandActionEvent
 * `parsed_cmd` in the rollout is the same `commandActions` array the adapter
 * switches on, so `kind`, `title` and `locations` are the adapter's own, not
 * this script's invention.
 *
 * Usage:  node desktop/scripts/capture-acp-turn.mjs <rollout.jsonl> <out.json>
 * Read-only on the rollout. Runs no agent.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** codex-acp dist/index.js · stripShellPrefix */
function stripShellPrefix(command) {
  const withoutShell = String(command).replace(
    /^(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-[lc]+\s+)?/,
    "",
  );
  if (withoutShell.startsWith("'") && withoutShell.endsWith("'")) {
    return withoutShell.slice(1, -1);
  }
  return withoutShell;
}

/** codex-acp dist/index.js · createSearchTitle */
function createSearchTitle(query, path) {
  if (query && path) return `Search for '${query}' in ${path}`;
  if (query) return `Search for '${query}'`;
  if (path) return `Search in '${path}'`;
  return "Search";
}

/** codex-acp dist/index.js · createCommandActionEvent */
function createCommandActionEvent(id, action) {
  // The rollout spells the SDK's `listFiles` as `list_files`.
  const type = action.type === "list_files" ? "listFiles" : action.type;
  switch (type) {
    case "read":
      return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        status: "in_progress",
        kind: "read",
        title: `Read file '${action.path}'`,
        locations: [{ path: action.path }],
      };
    case "search":
      return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        status: "in_progress",
        kind: "search",
        title: createSearchTitle(action.query ?? null, action.path ?? null),
        ...(action.path ? { locations: [{ path: action.path }] } : {}),
      };
    case "listFiles":
      return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        status: "in_progress",
        kind: "read",
        title: action.path ? `List files in '${action.path}'` : "List files",
        ...(action.path ? { locations: [{ path: action.path }] } : {}),
      };
    default:
      return {
        sessionUpdate: "tool_call",
        toolCallId: id,
        status: "in_progress",
        kind: "execute",
        title: stripShellPrefix(action.cmd ?? ""),
        rawInput: { command: action.cmd ?? "" },
      };
  }
}

/** codex-acp dist/index.js · createCommandExecutionUpdate */
function commandExecutionUpdate(item) {
  const actions = item.parsed_cmd ?? [];
  if (actions.length === 1) return createCommandActionEvent(item.id, actions[0]);
  const command = stripShellPrefix(
    Array.isArray(item.command) ? item.command.join(" ") : (item.command ?? ""),
  );
  return {
    sessionUpdate: "tool_call",
    toolCallId: item.id,
    status: "in_progress",
    kind: "execute",
    title: command,
    rawInput: { command },
  };
}

function sessionUpdateEnvelope(update, timestamp, sessionId) {
  // The shape `deriveActivity` reads: an ObserverEvent of kind `acp_read`
  // whose payload is the JSON-RPC notification the runtime sent.
  return {
    kind: "acp_read",
    at: timestamp,
    payload: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    },
  };
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: capture-acp-turn.mjs <rollout.jsonl> <out.json>");
  process.exit(2);
}

const rows = readFileSync(inPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const meta = rows[0]?.payload ?? {};
if (!String(meta.cwd ?? "").includes(".buzz")) {
  console.error(`refusing: ${inPath} is not a resident turn (cwd ${meta.cwd})`);
  process.exit(1);
}

const sessionId = meta.session_id ?? "unknown";
const frames = [];
const openTools = new Map();

for (const row of rows) {
  const payload = row.payload ?? {};
  if (payload.type !== "item_completed") continue;
  const item = payload.item ?? {};
  const at = row.timestamp;
  switch (item.type) {
    case "Reasoning": {
      const text = (item.summary_text ?? []).join("\n").trim();
      if (!text) break;
      frames.push(
        sessionUpdateEnvelope(
          {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text },
          },
          at,
          sessionId,
        ),
      );
      break;
    }
    case "AgentMessage": {
      const text = (item.content ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) break;
      frames.push(
        sessionUpdateEnvelope(
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
          at,
          sessionId,
        ),
      );
      break;
    }
    case "CommandExecution": {
      const update = commandExecutionUpdate(item);
      frames.push(sessionUpdateEnvelope(update, at, sessionId));
      openTools.set(item.id, at);
      // The rollout records a command only once it has finished, so the
      // completion frame is emitted immediately after — the adapter's
      // createCommandExecutionCompleteUpdate.
      frames.push(
        sessionUpdateEnvelope(
          {
            sessionUpdate: "tool_call_update",
            toolCallId: item.id,
            status: item.status === "completed" ? "completed" : "failed",
          },
          at,
          sessionId,
        ),
      );
      break;
    }
    default:
      break;
  }
}

const first = frames[0]?.at;
const last = frames[frames.length - 1]?.at;
const fixture = {
  capturedFrom: inPath,
  sessionId,
  originator: meta.originator ?? null,
  cwd: meta.cwd ?? null,
  startedAt: first,
  endedAt: last,
  durationMs: first && last ? Date.parse(last) - Date.parse(first) : null,
  frameCount: frames.length,
  note:
    "Real frames. Translated from the resident's own Codex rollout by " +
    "desktop/scripts/capture-acp-turn.mjs, transcribing codex-acp@1.11.0's " +
    "own mapping. No text in this file was written by hand.",
  frames,
};
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `${frames.length} frames · ${fixture.durationMs}ms · ${first} → ${last}`,
);
