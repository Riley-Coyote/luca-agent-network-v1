import assert from "node:assert/strict";
import test from "node:test";
import { resolveQuickChatSelection } from "./selection.ts";

test("saved selections wait for registry identity and never guess an ambiguous primary", () => {
  const primary = "a".repeat(64),
    other = "b".repeat(64);
  const available = [{ pubkey: primary }, { pubkey: other }];
  const entry = { residentPubkey: primary, personaId: "builtin:fizz" };
  assert.equal(
    resolveQuickChatSelection(undefined, available, primary).selectedPubkey,
    null,
  );
  assert.deepEqual(resolveQuickChatSelection([entry], available, primary), {
    primaryPubkey: primary,
    selectedPubkey: primary,
    ambiguous: false,
  });
  assert.equal(
    resolveQuickChatSelection([entry], available, other).selectedPubkey,
    other,
  );
  assert.equal(
    resolveQuickChatSelection([entry], available, null).selectedPubkey,
    primary,
  );
  assert.equal(
    resolveQuickChatSelection(
      [entry, { ...entry, residentPubkey: other }],
      available,
      primary,
    ).selectedPubkey,
    null,
  );
  assert.equal(
    resolveQuickChatSelection([], available, other).selectedPubkey,
    other,
  );
});
