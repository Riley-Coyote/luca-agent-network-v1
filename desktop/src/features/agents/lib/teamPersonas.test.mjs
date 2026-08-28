import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyResolvedTeamPersonas,
  getTeamPickerUnavailableReason,
  getUsableTeams,
  resolveTeamPersonas,
} from "./teamPersonas.ts";

function createPersona(id, displayName) {
  return {
    id,
    displayName,
    avatarUrl: null,
    systemPrompt: `${displayName} prompt`,
    runtime: null,
    model: null,
    isBuiltIn: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function createTeam(id, personaIds) {
  return {
    id,
    name: `Team ${id}`,
    description: null,
    personaIds,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

test("emptyResolvedTeamPersonas starts empty but complete", () => {
  assert.deepEqual(emptyResolvedTeamPersonas(), {
    hasMissingPersonas: false,
    isComplete: true,
    isUsable: false,
    missingPersonaCount: 0,
    missingPersonaIds: [],
    resolvedPersonaIds: [],
    resolvedPersonas: [],
  });
});

test("resolveTeamPersonas preserves team order and marks complete teams usable", () => {
  const personas = [
    createPersona("persona-1", "Solo"),
    createPersona("persona-2", "Kit"),
  ];
  const resolution = resolveTeamPersonas(
    createTeam("team-1", ["persona-2", "persona-1"]),
    personas,
  );

  assert.equal(resolution.isComplete, true);
  assert.equal(resolution.isUsable, true);
  assert.deepEqual(resolution.resolvedPersonaIds, ["persona-2", "persona-1"]);
  assert.deepEqual(
    resolution.resolvedPersonas.map((persona) => persona.displayName),
    ["Kit", "Solo"],
  );
});

test("resolveTeamPersonas surfaces missing persona ids without dropping the resolved ones", () => {
  const personas = [createPersona("persona-1", "Solo")];
  const resolution = resolveTeamPersonas(
    createTeam("team-2", ["persona-1", "missing"]),
    personas,
  );

  assert.equal(resolution.hasMissingPersonas, true);
  assert.equal(resolution.isComplete, false);
  assert.equal(resolution.isUsable, false);
  assert.equal(resolution.missingPersonaCount, 1);
  assert.deepEqual(resolution.missingPersonaIds, ["missing"]);
  assert.deepEqual(resolution.resolvedPersonaIds, ["persona-1"]);
});

test("getUsableTeams keeps only fully-resolved teams with at least one persona", () => {
  const personas = [createPersona("persona-1", "Solo")];
  const teams = [
    createTeam("team-empty", []),
    createTeam("team-missing", ["missing"]),
    createTeam("team-ready", ["persona-1"]),
  ];

  assert.deepEqual(
    getUsableTeams(teams, personas).map((team) => team.id),
    ["team-ready"],
  );
});

test("getTeamPickerUnavailableReason explains why a saved group cannot be selected", () => {
  assert.equal(
    getTeamPickerUnavailableReason({
      missingPersonaCount: 2,
      resolvedPersonaIds: ["persona-1"],
    }),
    "2 agents are no longer available. Edit this group to continue.",
  );
  assert.equal(
    getTeamPickerUnavailableReason({
      missingPersonaCount: 0,
      resolvedPersonaIds: [],
    }),
    "This group has no agents. Edit it to continue.",
  );
  assert.equal(
    getTeamPickerUnavailableReason({
      missingPersonaCount: 0,
      resolvedPersonaIds: ["persona-1"],
    }),
    null,
  );
});
