import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIRECT_CLAUDE_PERSONA_ID,
  DIRECT_CODEX_PERSONA_ID,
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

test("provider marks reuse transparent source assets without baked tiles", async () => {
  const [markSource, contactSource] = await Promise.all([
    readFile(
      new URL("../ui/ResidentIdentityMark.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../messages/ui/DirectRuntimeContactRow.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  for (const source of [markSource, contactSource]) {
    assert.match(source, /harness-logos\/chatgpt\.png\?inline/);
    assert.match(source, /harness-logos\/claude\.png\?inline/);
    assert.doesNotMatch(source, /runtime-icons\/(?:codex|claude)\.png/);
    assert.doesNotMatch(source, /object-cover|rounded-\[/);
  }
});
