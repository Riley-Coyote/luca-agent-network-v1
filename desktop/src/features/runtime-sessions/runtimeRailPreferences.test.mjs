import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeRailConnections,
  DEFAULT_RUNTIME_RAIL_PINS,
  filterPinnedRuntimeRailConnections,
  parseRuntimeRailPins,
  runtimeRailPinsStorageKey,
  updateRuntimeRailFamilyPin,
} from "./runtimeRailPreferences.ts";

const OWNER = "a".repeat(64);

function status(runtimeId, executable = `/usr/local/bin/${runtimeId}`) {
  return {
    statusId: `native:${runtimeId}`,
    runtimeId,
    label: runtimeId,
    executable,
    version: null,
    readiness: "ready",
    authentication: "ready",
    lastVerifiedAt: null,
    reason: null,
    readinessBasis: "native_probe",
  };
}

function catalog(id, availability = "available") {
  return {
    id,
    label: id === "kimi" ? "Kimi Code" : id,
    avatarUrl: "",
    availability,
    command: id,
    binaryPath: availability === "available" ? `/usr/local/bin/${id}` : null,
    defaultArgs: [],
    mcpCommand: null,
    artifactMcpSupport: "unavailable",
    modelEnvVar: null,
    providerEnvVar: null,
    thinkingEnvVar: null,
    installHint: "Install it",
    installInstructionsUrl: "https://example.test",
    canAutoInstall: false,
    underlyingCliPath: null,
    nodeRequired: false,
    authStatus: { status: "logged_in" },
    loginHint: null,
  };
}

test("runtime rail storage is versioned and owner/workspace scoped", () => {
  assert.equal(
    runtimeRailPinsStorageKey({ ownerPubkey: OWNER, workspaceId: "personal" }),
    `luca.runtime-rail-pins.v1:${OWNER}:personal`,
  );
  assert.notEqual(
    runtimeRailPinsStorageKey({ ownerPubkey: OWNER, workspaceId: "personal" }),
    runtimeRailPinsStorageKey({ ownerPubkey: OWNER, workspaceId: "work" }),
  );
  assert.equal(
    runtimeRailPinsStorageKey({
      ownerPubkey: "not-a-key",
      workspaceId: "work",
    }),
    null,
  );
});

test("corrupt and unknown preference versions fall back to curated defaults", () => {
  assert.deepEqual(parseRuntimeRailPins("not-json"), DEFAULT_RUNTIME_RAIL_PINS);
  assert.deepEqual(
    parseRuntimeRailPins(JSON.stringify({ version: 2, pinnedFamilies: [] })),
    DEFAULT_RUNTIME_RAIL_PINS,
  );
  assert.deepEqual(
    parseRuntimeRailPins(
      JSON.stringify({
        version: 1,
        pinnedFamilies: ["grok", "unknown", "codex", "grok"],
      }),
    ),
    { version: 1, pinnedFamilies: ["codex", "grok"] },
  );
});

test("rail projection keeps one discovered supported family and excludes residents", () => {
  const connections = buildRuntimeRailConnections(
    [
      status("codex"),
      status("hermes"),
      status("openclaw"),
      { ...status("claude_code"), label: "Native Claude Code" },
    ],
    [catalog("claude"), catalog("kimi"), catalog("grok")],
  );

  assert.deepEqual(
    connections.map(({ runtimeId }) => runtimeId),
    ["claude_code", "codex", "kimi", "grok"],
  );
  assert.equal(connections[0]?.label, "Native Claude Code");
  assert.equal(
    connections.some(
      ({ runtimeId }) => runtimeId === "hermes" || runtimeId === "openclaw",
    ),
    false,
  );
});

test("pin changes filter only the presentation projection", () => {
  const connections = [status("claude_code"), status("codex"), status("grok")];
  const withoutClaude = updateRuntimeRailFamilyPin(
    DEFAULT_RUNTIME_RAIL_PINS,
    "claude",
    false,
  );

  assert.deepEqual(withoutClaude.pinnedFamilies, ["codex", "kimi", "grok"]);
  assert.deepEqual(
    filterPinnedRuntimeRailConnections(connections, withoutClaude).map(
      ({ runtimeId }) => runtimeId,
    ),
    ["codex", "grok"],
  );
});
