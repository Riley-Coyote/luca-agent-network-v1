import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectRuntimeResidentInput,
  directRuntimeContactMatches,
  getUnmaterializedDirectRuntimeContacts,
} from "./directRuntimeContacts.ts";

function runtime({
  authStatus = { status: "logged_in" },
  availability = "available",
  id,
  label,
}) {
  return {
    id,
    label,
    avatarUrl: "",
    availability,
    command: availability === "available" ? `${id}-acp` : null,
    binaryPath: availability === "available" ? `/fixture/${id}` : null,
    defaultArgs: ["--acp"],
    mcpCommand: `${id} mcp serve`,
    modelEnvVar: null,
    providerEnvVar: null,
    thinkingEnvVar: null,
    installHint: `Install ${label}`,
    installInstructionsUrl: "https://example.invalid/runtime",
    canAutoInstall: false,
    underlyingCliPath: null,
    nodeRequired: false,
    authStatus,
    loginHint: null,
  };
}

const CLAUDE = runtime({ id: "claude", label: "Claude Code" });
const CODEX = runtime({ id: "codex", label: "Codex" });
const KIMI = runtime({ id: "kimi", label: "Kimi Code" });
const GROK = runtime({ id: "grok", label: "Grok" });

test("offers familiar direct contacts in the intended order", () => {
  const contacts = getUnmaterializedDirectRuntimeContacts({
    managedAgents: [],
    runtimes: [GROK, CODEX, KIMI, CLAUDE],
  });

  assert.deepEqual(
    contacts.map(({ displayName, personaId, readiness, runtimeId }) => ({
      displayName,
      personaId,
      readiness,
      runtimeId,
    })),
    [
      {
        displayName: "Claude Code",
        personaId: "builtin:direct-runtime:claude",
        readiness: "ready",
        runtimeId: "claude",
      },
      {
        displayName: "Codex",
        personaId: "builtin:direct-runtime:codex",
        readiness: "ready",
        runtimeId: "codex",
      },
      {
        displayName: "Kimi Code",
        personaId: "builtin:direct-runtime:kimi",
        readiness: "ready",
        runtimeId: "kimi",
      },
      {
        displayName: "Grok",
        personaId: "builtin:direct-runtime:grok",
        readiness: "ready",
        runtimeId: "grok",
      },
    ],
  );
});

test("materialized runtime identities disappear from quick start", () => {
  const contacts = getUnmaterializedDirectRuntimeContacts({
    managedAgents: [
      {
        personaId: "builtin:direct-runtime:codex",
      },
    ],
    runtimes: [CLAUDE, CODEX, KIMI, GROK],
  });

  assert.deepEqual(
    contacts.map(({ runtimeId }) => runtimeId),
    ["claude", "kimi", "grok"],
  );
});

test("unavailable and signed-out runtimes fail closed", () => {
  const contacts = getUnmaterializedDirectRuntimeContacts({
    managedAgents: [],
    runtimes: [
      runtime({
        authStatus: { status: "logged_out" },
        id: "claude",
        label: "Claude Code",
      }),
      runtime({
        availability: "not_installed",
        id: "codex",
        label: "Codex",
      }),
    ],
  });

  assert.deepEqual(
    contacts.map(({ readiness }) => readiness),
    ["needs-setup", "needs-setup", "needs-setup", "needs-setup"],
  );
  assert.throws(
    () => buildDirectRuntimeResidentInput(contacts[0]),
    /needs setup/,
  );
});

test("resident input is stable, local, and contains no authority or secrets", () => {
  const [contact] = getUnmaterializedDirectRuntimeContacts({
    managedAgents: [],
    runtimes: [CLAUDE],
  });
  const input = buildDirectRuntimeResidentInput(contact);

  assert.deepEqual(input, {
    name: "Claude Code",
    personaId: "builtin:direct-runtime:claude",
    acpCommand: "buzz-acp",
    agentCommand: "claude-acp",
    agentArgs: ["--acp"],
    mcpCommand: "claude mcp serve",
    harnessOverride: true,
    avatarUrl: undefined,
    spawnAfterCreate: true,
    startOnAppLaunch: true,
    backend: { type: "local" },
  });
  assert.doesNotMatch(
    JSON.stringify(input).toLocaleLowerCase(),
    /credential|private.?key|secret|systemprompt/,
  );
});

test("search recognizes product labels and runtime ids", () => {
  const [claude, codex, kimi, grok] = getUnmaterializedDirectRuntimeContacts({
    managedAgents: [],
    runtimes: [CLAUDE, CODEX, KIMI, GROK],
  });

  assert.equal(directRuntimeContactMatches(claude, "code"), true);
  assert.equal(directRuntimeContactMatches(codex, "CODEX"), true);
  assert.equal(directRuntimeContactMatches(kimi, "KIMI"), true);
  assert.equal(directRuntimeContactMatches(grok, "GROK"), true);
  assert.equal(directRuntimeContactMatches(codex, "claude"), false);
});
