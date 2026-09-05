import assert from "node:assert/strict";
import test from "node:test";

import { isExchangeOwnerReturn } from "./exchangeTags.ts";

const owner = "a".repeat(64);
const opener = "b".repeat(64);
const sibling = "c".repeat(64);
const id = "d".repeat(64);
const record = {
  exchangeId: id,
  owner,
  openedBy: opener,
  members: [opener, sibling],
  depth: 1,
  parentExchangeId: null,
  conversationId: "room",
  bucket: 10,
};
const routing = {
  signerPubkey: opener,
  tags: [
    ["h", "room"],
    ["exchange", id, "3"],
    ["p", owner],
  ],
};
const qualifies = (
  message = routing,
  head = record,
  currentOwner = owner,
  room = "room",
) => isExchangeOwnerReturn(message, head, currentOwner, room);

test("owner return uses signed routing, independent of turn number or close arrival", () => {
  for (const state of ["open", "closed"]) {
    for (const turn of ["2", "3", "7"]) {
      assert.equal(
        qualifies(
          {
            ...routing,
            tags: [
              ["h", "room"],
              ["exchange", id, turn],
              ["p", owner],
            ],
          },
          { ...record, state },
        ),
        true,
      );
    }
  }
});

test("missing or conflicting head authority never reveals an internal turn", () => {
  for (const head of [
    null,
    { ...record, owner: sibling },
    { ...record, openedBy: sibling },
    { ...record, exchangeId: "e".repeat(64) },
    { ...record, conversationId: "elsewhere" },
    { ...record, depth: 2 },
    { ...record, bucket: 2 },
    { ...record, bucket: 11 },
    { ...record, parentExchangeId: id },
    { ...record, members: [opener, sibling, "f".repeat(64)] },
    { ...record, members: [opener, opener] },
    { ...record, members: [opener, owner] },
  ])
    assert.equal(qualifies(routing, head), false);
  assert.equal(qualifies(routing, record, sibling), false);
  assert.equal(qualifies(routing, record, owner, "elsewhere"), false);
  assert.equal(
    qualifies({ ...routing, signerPubkey: sibling, pubkey: opener }),
    false,
  );
  assert.equal(
    qualifies({ ...routing, signerPubkey: undefined, pubkey: opener }),
    false,
  );
});

test("the audience, room and counted exchange tag must be unambiguous", () => {
  for (const tags of [
    [
      ["h", "room"],
      ["exchange", id, "3"],
    ],
    [...routing.tags, ["p", owner]],
    [...routing.tags, ["p", sibling]],
    [...routing.tags, ["exchange", id, "4"]],
    [...routing.tags, ["h", "elsewhere"]],
    [["h", "room"], ["exchange", id, "3"], ["p"]],
    [
      ["h", "room"],
      ["exchange", id, "3"],
      ["p", undefined],
    ],
    [
      ["h", "room"],
      ["exchange", id, "0"],
      ["p", owner],
    ],
    [
      ["h", "room"],
      ["exchange", id, "11"],
      ["p", owner],
    ],
    [
      ["h", "room"],
      ["exchange", id, "3junk"],
      ["p", owner],
    ],
    [
      ["exchange", id, "3"],
      ["p", owner],
    ],
  ])
    assert.equal(qualifies({ ...routing, tags }), false);
});
