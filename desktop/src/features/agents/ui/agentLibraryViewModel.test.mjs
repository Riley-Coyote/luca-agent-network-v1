import assert from "node:assert/strict";
import test from "node:test";

import {
  agentConfigurationViewModel,
  buildResidentLibrary,
  managedAgentSummary,
} from "./agentLibraryViewModel.ts";

function managedAgent(overrides = {}) {
  return {
    pubkey: "11".repeat(32),
    name: "Luca",
    personaId: "luca",
    agentCommand: "codex",
    nativeRuntimeBinding: null,
    model: "gpt-5",
    status: "running",
    lastError: null,
    needsRestart: false,
    personaOutOfDate: false,
    personaOrphaned: false,
    lastStartedAt: "2026-08-07T10:00:00Z",
    lastStoppedAt: null,
    updatedAt: "2026-08-07T10:00:00Z",
    ...overrides,
  };
}

test("native binding remains the source of resident classification", () => {
  const summary = managedAgentSummary(
    managedAgent({
      nativeRuntimeBinding: {
        kind: "hermes",
        schemaVersion: 1,
        profileName: "default",
        hermesHome: "/tmp/hermes",
        executablePath: "/tmp/hermes/bin/hermes",
        runtimeVersion: "1.0.0",
      },
    }),
  );
  assert.equal(summary.kind, "managed_native");
  assert.equal(summary.nativeSource, "hermes");
  assert.equal(summary.runtimeLabel, "Hermes");
});

test("upstream managed runtime ids never leak into Luca product copy", () => {
  const summary = managedAgentSummary(
    managedAgent({ agentCommand: "buzz-agent" }),
  );
  assert.equal(summary.kind, "managed_luca");
  assert.equal(summary.runtimeLabel, "Polyphonic runtime");
});

test("legacy builtin persona ids use Luca public agent names", () => {
  const residents = buildResidentLibrary(
    [],
    [
      {
        id: "builtin:fizz",
        displayName: "Fizz",
        runtime: null,
        model: null,
        updatedAt: "2026-08-07T11:00:00Z",
      },
      {
        id: "builtin:honey",
        displayName: "Honey",
        runtime: null,
        model: null,
        updatedAt: "2026-08-07T11:00:00Z",
      },
      {
        id: "builtin:bumble",
        displayName: "Bumble",
        runtime: null,
        model: null,
        updatedAt: "2026-08-07T11:00:00Z",
      },
    ],
  );
  assert.deepEqual(
    residents.map((resident) => resident.displayName),
    ["Anima", "Luca", "Vektor"],
  );
});

test("failed residents sort ahead of uninstantiated personas but retain identity", () => {
  const residents = buildResidentLibrary(
    [managedAgent({ lastError: "runtime exited" })],
    [
      {
        id: "draft",
        displayName: "Draft",
        runtime: "claude",
        model: null,
        updatedAt: "2026-08-07T11:00:00Z",
      },
    ],
  );
  assert.equal(residents[0].displayName, "Luca");
  assert.equal(residents[0].availability, "failed");
  assert.equal(residents[1].kind, "persona_only");
});

test("native agents keep native authority while Luca owns overlays", () => {
  const resident = managedAgentSummary(
    managedAgent({
      nativeRuntimeBinding: {
        kind: "openclaw",
        schemaVersion: 1,
        agentId: "main",
        gatewayIdentity: "local",
        executablePath: "/tmp/openclaw",
        runtimeVersion: "1.0.0",
      },
    }),
  );
  const configuration = agentConfigurationViewModel(resident);
  assert.equal(configuration.origin, "openclaw");
  assert.equal(configuration.authorities.runtime, "native_managed");
  assert.equal(configuration.authorities.workspace, "native_managed");
  assert.equal(configuration.authorities.continuity, "luca_managed");
  assert.equal(configuration.authorities.mcpGrants, "luca_managed");
});
