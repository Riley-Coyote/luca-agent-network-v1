import assert from "node:assert/strict";
import test from "node:test";

import {
  boundaryCursor,
  cursorBefore,
  nextCursorAfterPage,
  PROVENANCE_PAGE_SIZE,
  PROVENANCE_RELAY_LIMIT,
  ProvenanceTimestampBoundaryLimitError,
  unseenBoundaryEvents,
} from "./provenancePagination.ts";

function event(id, createdAt) {
  return {
    id,
    pubkey: "a".repeat(64),
    created_at: createdAt,
    kind: 9,
    tags: [],
    content: id,
    sig: "b".repeat(128),
  };
}

test("a dense timestamp boundary carries every same-second record once", () => {
  const boundary = 1_700_000_000;
  const firstPage = [event("newer", boundary + 1)].concat(
    Array.from({ length: PROVENANCE_PAGE_SIZE - 1 }, (_, index) =>
      event(`page-${index.toString().padStart(3, "0")}`, boundary),
    ),
  );
  const wholeBoundary = Array.from({ length: 91 }, (_, index) =>
    event(`page-${index.toString().padStart(3, "0")}`, boundary),
  );

  const cursor = boundaryCursor(firstPage);
  assert.deepEqual(cursor, {
    kind: "boundary",
    createdAt: boundary,
    seenEventIds: firstPage.slice(1).map((row) => row.id),
  });

  const records = unseenBoundaryEvents(wholeBoundary, cursor);
  assert.equal(records.length, 32);
  assert.equal(
    new Set([...firstPage, ...records].map((row) => row.id)).size,
    92,
  );
  assert.deepEqual(cursorBefore(boundary), {
    kind: "before",
    until: boundary - 1,
  });
});

test("a short relay page is exhaustive without a boundary expansion", () => {
  const page = [event("b", 20), event("a", 20)];
  const cursor = boundaryCursor(page);

  assert.equal(cursor, null);
  assert.equal(nextCursorAfterPage(page), null);
});

test("a relay-capped timestamp bucket fails closed instead of skipping history", () => {
  const boundary = 1_700_000_000;
  const bucket = Array.from({ length: PROVENANCE_RELAY_LIMIT }, (_, index) =>
    event(index.toString().padStart(64, "0"), boundary),
  );

  assert.throws(
    () =>
      unseenBoundaryEvents(bucket, {
        kind: "boundary",
        createdAt: boundary,
        seenEventIds: bucket
          .slice(0, PROVENANCE_PAGE_SIZE)
          .map((row) => row.id),
      }),
    ProvenanceTimestampBoundaryLimitError,
  );
});
