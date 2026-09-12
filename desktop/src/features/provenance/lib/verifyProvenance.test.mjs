import assert from "node:assert/strict";
import test from "node:test";

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

import {
  resetProvenanceVerificationCache,
  tallyVerifications,
  verifyProvenanceEvent,
} from "./verifyProvenance.ts";

const SECRET =
  "1c9e5f30a84b27d6e05f3c91ab74d2086f1e5a3c9b28d740e6c51f83a29b0d74";
const OTHER_SECRET =
  "2d7a418c05e93b6741af28d095c3e61bf802a95d34e17c68b0d259a34f1e8c62";

function signed(content = "the runtime atlas finished rebuilding") {
  return finalizeEvent(
    {
      content,
      created_at: 1_757_000_000,
      kind: 9,
      tags: [["h", "f3a1c6d8-9e42-4b17-8c05-1d7e2a9b4f60"]],
    },
    hexToBytes(SECRET),
  );
}

test("a genuinely signed event verifies", () => {
  resetProvenanceVerificationCache();
  assert.equal(verifyProvenanceEvent(signed()), "verified");
});

test("editing the content after signing fails verification", () => {
  resetProvenanceVerificationCache();
  const event = signed();
  // Same id and signature, different body — the tamper the id is meant to catch.
  const tampered = { ...event, content: "nothing was rebuilt" };
  assert.equal(verifyProvenanceEvent(tampered), "failed");
});

test("a signature from another key fails verification", () => {
  resetProvenanceVerificationCache();
  const event = signed();
  const impostor = finalizeEvent(
    {
      content: event.content,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
    },
    hexToBytes(OTHER_SECRET),
  );
  // The impostor's own record, relabelled as the resident's.
  const forged = { ...impostor, pubkey: getPublicKey(hexToBytes(SECRET)) };
  assert.equal(verifyProvenanceEvent(forged), "failed");
});

test("placeholder signatures are unverifiable, not failures", () => {
  resetProvenanceVerificationCache();
  const event = signed();
  const unsigned = { ...event, sig: "mocksig".repeat(20).slice(0, 128) };
  assert.equal(verifyProvenanceEvent(unsigned), "unverifiable");
});

test("an id that is not a hash is unverifiable", () => {
  resetProvenanceVerificationCache();
  const event = signed();
  assert.equal(
    verifyProvenanceEvent({ ...event, id: "not-a-hash" }),
    "unverifiable",
  );
});

test("a tally counts each outcome separately", () => {
  resetProvenanceVerificationCache();
  const good = signed("one");
  const tampered = { ...signed("two"), content: "edited" };
  const placeholder = {
    ...signed("three"),
    sig: "mocksig".repeat(20).slice(0, 128),
  };
  assert.deepEqual(tallyVerifications([good, tampered, placeholder]), {
    verified: 1,
    failed: 1,
    unverifiable: 1,
  });
});
