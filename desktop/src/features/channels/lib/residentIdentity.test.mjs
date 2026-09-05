import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIRECT_CLAUDE_PERSONA_ID,
  DIRECT_CODEX_PERSONA_ID,
  residentIdentityMatrix,
  residentIdentityPath,
  residentMarkKind,
} from "./residentIdentity.ts";
import {
  identityGlyph,
  isWellFormed,
} from "../../../shared/ui/dot-display/identity/glyph.ts";

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

test("custom resident marks are deterministic, well-formed identity glyphs, 7 by 7", () => {
  const matrix = residentIdentityMatrix("ABCDEF0123456789");
  assert.deepEqual(matrix, residentIdentityMatrix("abcdef0123456789"));
  assert.equal(matrix.length, 7);
  for (const row of matrix) assert.equal(row.length, 7);
  assert.ok(matrix.some((row) => row.some(Boolean)));
  // The mark is the identity glyph itself, so it obeys the glyph's rules:
  // one connected piece, touching every rim, no solid 2x2, few loose ends.
  assert.ok(isWellFormed(identityGlyph("abcdef0123456789")));

  assert.notDeepEqual(matrix, residentIdentityMatrix("different-resident"));

  const path = residentIdentityPath("ABCDEF0123456789");
  assert.ok(path.length > 0);
  assert.equal(path, residentIdentityPath("abcdef0123456789"));
  assert.notEqual(path, residentIdentityPath("different-resident"));
});

test("provider marks reuse transparent source assets without baked tiles", async () => {
  const [markSource, contactSource, thinkingLabSource] = await Promise.all([
    readFile(
      new URL("../ui/ResidentIdentityMark.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../messages/ui/DirectRuntimeContactRow.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../messages/lab/ThinkingIndicatorLab.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(markSource, /harness-logos\/chatgpt\.png\?inline/);
  assert.match(markSource, /harness-logos\/claude\.png\?inline/);
  assert.match(contactSource, /<HarnessLogo/);
  for (const source of [markSource, contactSource]) {
    assert.doesNotMatch(source, /runtime-icons\/(?:codex|claude)\.png/);
    assert.doesNotMatch(source, /object-cover|rounded-\[/);
  }

  // A direct conversation deliberately has no activity shelf, so its response
  // row owns the approved live state: the resident's key-derived mark murmurs
  // until the complete response settles. Runtime contacts remain provider
  // marks and never receive this custom-resident treatment.
  assert.match(markSource, /data-resident-mark-live/);
  assert.match(markSource, /kind === "custom" && live/);
  assert.match(markSource, /<FilamentMark/);
  assert.match(markSource, /motion="murmur"/);
  assert.match(markSource, /fit="box"/);
  assert.match(markSource, /bloom=\{false\}/);
  assert.match(thinkingLabSource, /archived-runtime-mark-thinking/);
  assert.match(thinkingLabSource, /motion="murmur"/);
  assert.match(thinkingLabSource, /bloom=\{false\}/);
});
