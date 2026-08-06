import assert from "node:assert/strict";
import test from "node:test";

import { agentIdentityMatrix } from "./AgentIdentitySpecimen.tsx";

test("agent identity specimens are stable, mirrored 7 by 7 matrices", () => {
  const first = agentIdentityMatrix("ab".repeat(32));
  const second = agentIdentityMatrix("AB".repeat(32));

  assert.deepEqual(first, second);
  assert.equal(first.length, 7);
  assert.equal(
    first.every((row) => row.length === 7),
    true,
  );
  assert.equal(
    first.every((row) => row.every((cell, index) => cell === row[6 - index])),
    true,
  );
});

test("different public keys produce different identity specimens", () => {
  assert.notDeepEqual(
    agentIdentityMatrix("01".repeat(32)),
    agentIdentityMatrix("10".repeat(32)),
  );
});
