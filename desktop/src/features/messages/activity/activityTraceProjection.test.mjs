import assert from "node:assert/strict";
import test from "node:test";
import {
  activityTraceLookupForMessage,
  projectActivityTraceMessages,
  provisionalReplyAfterNarration,
} from "./activityTraceProjection.ts";
import { projectFocusedThreadTimeline } from "../lib/focusedThreadProjection.ts";
const resident = "a".repeat(64);
const trace = (fields = {}) => ({
  conversationId: "room",
  residentPubkey: resident,
  dispatchReceiptId: "receipt",
  turnId: "turn",
  finalMessageId: null,
  anchorMessageId: "head",
  startedAt: 2000,
  endedAt: 3000,
  status: "cancelled",
  entries: [],
  truncated: false,
  ...fields,
});
const message = (id, fields = {}) => ({
  id,
  createdAt: 1,
  author: "Riley",
  body: "Hello",
  time: "",
  depth: 0,
  pubkey: "owner",
  ...fields,
});
test("restores stopped work in time order without repeating represented or other-scope turns", () => {
  const head = message("head");
  const result = projectActivityTraceMessages(
    "room",
    [head, message("later", { createdAt: 4 })],
    [
      trace(),
      trace(),
      trace({ conversationId: "elsewhere" }),
      trace({ dispatchReceiptId: "published", finalMessageId: "signed" }),
      trace({ dispatchReceiptId: "thread", responseSurface: "thread" }),
    ],
  );
  assert.deepEqual(
    result.map((x) => x.id),
    ["head", `activity:${resident}:receipt`, "later"],
  );
  assert.equal(result[1].body, "");
  assert.equal(result[1].signerPubkey, undefined);
  assert.equal(
    projectActivityTraceMessages("room", result, [trace()]).length,
    3,
  );
});
test("exact managed receipt follows live pending row without replacing signed-final identity", () => {
  const live = message(`pending-reply:${resident}`, {
    pubkey: resident,
    isAgent: true,
    activityTraceReceiptId: "receipt",
  });
  assert.equal(
    projectActivityTraceMessages("room", [live], [trace({ status: "working" })])
      .length,
    1,
  );
  assert.equal(
    activityTraceLookupForMessage("room", live).finalMessageId,
    null,
  );
  const signed = message("signed", { pubkey: resident, isAgent: true });
  assert.equal(
    activityTraceLookupForMessage("room", signed).finalMessageId,
    "signed",
  );
  assert.equal(activityTraceLookupForMessage("room", message("human")), null);
});
test("restores a stopped focused-thread turn only beneath its own thread", () => {
  const head = message("head");
  const another = message("other");
  const make = (root) =>
    projectFocusedThreadTimeline({
      conversationId: "room",
      focusedHeadId: root.id,
      threadHeadMessage: root,
      roomMessages: [head, another],
      threadMessages: [],
      managedResponseSlots: [],
      activityTraces: [
        trace({ responseSurface: "thread", threadRootId: "head" }),
      ],
    });
  assert.equal(make(head).entries.length, 2);
  assert.equal(make(another).entries.length, 1);
});
test("deduplicates only exact public narration prefixes of provisional text", () => {
  const t = trace({
    entries: [
      { kind: "narration", text: "Checking. " },
      { kind: "activity", text: "Reading file" },
      { kind: "narration", text: "Found it. " },
    ],
  });
  assert.equal(
    provisionalReplyAfterNarration("Checking. Found it. Answer", t, true),
    "Answer",
  );
  assert.equal(
    provisionalReplyAfterNarration("Checking. Found it. Answer", t, false),
    "Checking. Found it. Answer",
  );
  assert.equal(
    provisionalReplyAfterNarration(
      "Checking. Found it. Answer",
      { ...t, truncated: true },
      true,
    ),
    "Checking. Found it. Answer",
  );
  assert.equal(
    provisionalReplyAfterNarration(
      "Checking. Found it. Answer",
      trace({ entries: [{ kind: "narration", text: "Work update withheld" }] }),
      true,
    ),
    "Checking. Found it. Answer",
  );
  assert.equal(
    provisionalReplyAfterNarration("Answer containing Checking. ", t, true),
    "Answer containing Checking. ",
  );
});
test("a permission decision between two narrations changes nothing about the reply", () => {
  const withDecision = trace({
    entries: [
      { kind: "narration", text: "Checking. " },
      { kind: "permission", text: "You allowed once: git status" },
      { kind: "narration", text: "Found it. " },
    ],
  });
  assert.equal(
    provisionalReplyAfterNarration(
      "Checking. Found it. Answer",
      withDecision,
      true,
    ),
    "Answer",
  );
  // A decision is never narration, so its own text is never stripped either.
  assert.equal(
    provisionalReplyAfterNarration(
      "You allowed once: git status",
      trace({
        entries: [{ kind: "permission", text: "You allowed once: git status" }],
      }),
      true,
    ),
    "You allowed once: git status",
  );
});
