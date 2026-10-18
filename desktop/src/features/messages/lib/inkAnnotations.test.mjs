import assert from "node:assert/strict";
import test from "node:test";

import { inkAnnotations } from "./inkAnnotations.ts";

const message = (id, pubkey, body, createdAt = 1_700_000_000) => ({
  id,
  pubkey,
  body,
  createdAt,
});

test("every message before the owner's latest one is answered", () => {
  const { answered } = inkAnnotations(
    [
      message("a", "owner", "hello"),
      message("b", "luca", "[maybe](ink:wet)"),
      message("c", "OWNER", "yes"),
      message("d", "luca", "[still open](ink:wet)"),
    ],
    "owner",
  );
  assert.deepEqual([...answered], ["a", "b"]);
});

test("nothing is answered, or heard, without an owner", () => {
  const { answered, heard } = inkAnnotations([
    message("a", "x", "[the small things](ink:echo)"),
  ]);
  assert.equal(answered.size, 0);
  assert.equal(heard.size, 0);
});

test("a thread reads the same way: its head first, then its replies", () => {
  // The owner started the thread; a resident answers, then the owner again.
  const thread = [
    message("head", "owner", "Where did the stairs go?"),
    message(
      "r1",
      "luca",
      "[The stairs](ink:care?echo) went up, [I think](ink:wet).",
    ),
    message("r2", "owner", "Thanks."),
  ];
  const { answered, heard } = inkAnnotations(thread, "owner");
  assert.deepEqual([...answered], ["head", "r1"]);
  assert.deepEqual(
    heard.get("head")?.map(({ phrase, colour }) => ({ phrase, colour })),
    [{ phrase: "The stairs", colour: "#ff4f91" }],
  );
  assert.equal(heard.has("r2"), false);
});

test("each reply lights the nearest owner message before it", () => {
  const { heard } = inkAnnotations(
    [
      message("o1", "owner", "the small things matter"),
      message("r1", "luca", "[worth keeping](ink:echo=the+small+things)"),
      message("r2", "vesper", "[small things](ink:calm?echo)"),
      message("o2", "owner", "so calming"),
      message("r3", "luca", "[So calming](ink:echo)"),
    ],
    "owner",
  );
  assert.deepEqual(
    heard.get("o1")?.map(({ phrase }) => phrase),
    ["the small things", "small things"],
  );
  assert.deepEqual(
    heard.get("o2")?.map(({ phrase, colour }) => ({ phrase, colour })),
    [{ phrase: "So calming", colour: null }],
  );
});
