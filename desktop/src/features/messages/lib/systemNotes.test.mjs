import assert from "node:assert/strict";
import test from "node:test";

import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import { buildMainTimelineEntries } from "./threadPanel.ts";
import {
  isWordlessSystemNote,
  parseSystemNotePayload,
  systemNoteHasWords,
} from "./systemNotes.ts";
import { buildTimelineDayGroups, buildTimelineItems } from "./timelineItems.ts";

const OWNER = "a".repeat(64);
const ATLAS = "b".repeat(64);

/** What the relay writes into every direct conversation it makes. */
const DM_CREATED = JSON.stringify({
  type: "dm_created",
  actor: OWNER,
  participants: [OWNER, ATLAS],
});

function note(body, overrides = {}) {
  return {
    id: "note",
    createdAt: Math.floor(new Date(2026, 9, 26, 9).getTime() / 1000),
    pubkey: OWNER,
    parentId: null,
    rootId: null,
    depth: 0,
    kind: KIND_SYSTEM_MESSAGE,
    tags: [],
    author: "relay",
    time: "9:00",
    body,
    ...overrides,
  };
}

test("the relay's dm_created note has no words, so it is not a message", () => {
  assert.equal(isWordlessSystemNote(note(DM_CREATED)), true);
});

test("an unknown note, a broken body and an empty exchange note have no words", () => {
  assert.equal(isWordlessSystemNote(note('{"type":"something_new"}')), true);
  assert.equal(isWordlessSystemNote(note("not json")), true);
  assert.equal(isWordlessSystemNote(note("")), true);
  assert.equal(
    isWordlessSystemNote(note('{"type":"exchange-note","text":"  "}')),
    true,
  );
  assert.equal(
    isWordlessSystemNote(note(`{"type":"member_joined","actor":"${OWNER}"}`)),
    true,
  );
});

test("every note the timeline writes a line for keeps its words", () => {
  const spoken = [
    { type: "member_joined", actor: OWNER, target: ATLAS },
    { type: "members_added", actor: OWNER, targets: [ATLAS] },
    { type: "members_joined", targets: [ATLAS] },
    { type: "member_left", actor: OWNER },
    { type: "member_removed", actor: OWNER, target: ATLAS },
    { type: "topic_changed", actor: OWNER, topic: "Launch" },
    { type: "purpose_changed", actor: OWNER, purpose: "Ship" },
    { type: "channel_created", actor: OWNER },
    { type: "channel_archived", actor: OWNER },
    { type: "channel_unarchived", actor: OWNER },
    { type: "message_deleted", actor: OWNER },
    { type: "exchange-note", text: "Atlas asked Wren about the release." },
  ];
  for (const payload of spoken) {
    assert.equal(systemNoteHasWords(payload), true, payload.type);
    assert.equal(
      isWordlessSystemNote(note(JSON.stringify(payload))),
      false,
      payload.type,
    );
  }
});

test("a visit note and anything that isn't a system note are never wordless", () => {
  const visit = JSON.stringify({
    type: "visit_arrived",
    resident: ATLAS,
    exchange_id: "c".repeat(64),
  });
  assert.equal(isWordlessSystemNote(note(visit)), false);
  assert.equal(isWordlessSystemNote(note("hello", { kind: 9 })), false);
  assert.equal(isWordlessSystemNote(note(DM_CREATED, { kind: 9 })), false);
});

test("the payload parser keeps objects only", () => {
  assert.deepEqual(parseSystemNotePayload('{"type":"x"}'), { type: "x" });
  assert.equal(parseSystemNotePayload("3"), null);
  assert.equal(parseSystemNotePayload(null), null);
});

test("a wordless note makes no day and no row; the first message still does", () => {
  const only = buildTimelineItems(
    buildMainTimelineEntries([note(DM_CREATED)], new Set(), new Map()),
    null,
  );
  assert.deepEqual(only.items, []);
  assert.deepEqual(buildTimelineDayGroups(only.items), []);

  const first = {
    ...note("Hello Atlas", { id: "first", kind: 9 }),
    createdAt: note(DM_CREATED).createdAt + 60,
  };
  const withFirst = buildTimelineItems(
    buildMainTimelineEntries([note(DM_CREATED), first], new Set(), new Map()),
    null,
  );
  assert.deepEqual(
    withFirst.items.map((item) => item.kind),
    ["day-divider", "message"],
  );
  assert.equal(withFirst.items[1].entry.message.id, "first");
});
