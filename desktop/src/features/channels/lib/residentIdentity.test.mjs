import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_CLAUDE_PERSONA_ID,
  DIRECT_CODEX_PERSONA_ID,
  RESIDENT_PROVIDER_MARKS,
  residentIdentityCells,
  residentIdentityMatrix,
  residentMarkKind,
} from "./residentIdentity.ts";

test("only trusted direct runtime persona ids receive provider marks", () => {
  assert.equal(residentMarkKind(DIRECT_CODEX_PERSONA_ID), "codex");
  assert.equal(residentMarkKind(DIRECT_CLAUDE_PERSONA_ID), "claude");

  for (const personaId of [
    null,
    undefined,
    "codex",
    "claude",
    "builtin:fizz",
    "builtin:hermes",
    "builtin:openclaw",
    "custom:codex-powered",
  ]) {
    assert.equal(residentMarkKind(personaId), "custom");
  }

  assert.equal(RESIDENT_PROVIDER_MARKS.codex, "/runtime-icons/codex.png");
  assert.equal(RESIDENT_PROVIDER_MARKS.claude, "/runtime-icons/claude.png");
});

test("custom resident matrices are deterministic, mirrored, and 7 by 7", () => {
  const matrix = residentIdentityMatrix("ABCDEF0123456789");
  assert.deepEqual(matrix, residentIdentityMatrix("abcdef0123456789"));
  assert.equal(matrix.length, 7);

  for (const row of matrix) {
    assert.equal(row.length, 7);
    assert.deepEqual(row, [...row].reverse());
    assert.ok(row.some(Boolean));
  }

  assert.notDeepEqual(matrix, residentIdentityMatrix("different-resident"));

  const cells = residentIdentityCells("ABCDEF0123456789");
  assert.ok(cells.length > 0);
  assert.equal(new Set(cells.map(({ id }) => id)).size, cells.length);
  assert.ok(cells.every(({ x, y }) => x >= 0 && x < 7 && y >= 0 && y < 7));
});
