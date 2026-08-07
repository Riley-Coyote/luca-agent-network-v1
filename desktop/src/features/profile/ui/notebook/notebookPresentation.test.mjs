import assert from "node:assert/strict";
import test from "node:test";

import {
  notebookAvailabilityCopy,
  notebookCategoryLabel,
  notebookCountWhenComplete,
  notebookExcerpt,
  notebookItemMatchesView,
  mergeNotebookItemsById,
} from "./notebookPresentation.ts";
import { sigilPattern } from "@/shared/ui/dot-display/engine";

test("notebook labels contract categories without decorative aliases", () => {
  assert.equal(notebookCategoryLabel("durable_context"), "Durable context");
  assert.equal(notebookCategoryLabel("open_question"), "Open question");
});

test("notebook excerpts collapse whitespace and preserve a bounded disclosure", () => {
  assert.equal(notebookExcerpt("  one\n\n two  "), "one two");
  assert.equal(notebookExcerpt("abcdefgh", 6), "abcde…");
});

test("journal annotations never enter the primary page index", () => {
  const base = {
    itemId: "item",
    lineageRootId: "root",
    status: "active",
    authorship: "resident",
    revision: 1,
    pinnedOwnerCorrection: false,
    title: null,
    body: "body",
    category: null,
    sourceEventIds: [],
    sourcePageIds: [],
    createdAt: "2026-08-06T00:00:00Z",
    updatedAt: "2026-08-06T00:00:00Z",
  };
  assert.equal(
    notebookItemMatchesView({ ...base, kind: "journal_annotation" }, "pages"),
    false,
  );
  assert.equal(
    notebookItemMatchesView({ ...base, kind: "journal_page" }, "pages"),
    true,
  );
});

test("locked notebook copy states that chat remains available", () => {
  assert.match(notebookAvailabilityCopy("locked", "notes").body, /Messaging/);
});

test("notebook field foundation is stable per resident and distinct between residents", () => {
  const a = "35653885e1eeb9c1a0759c24b502f6105714f0198ee83d04468b9905752ec899";
  const b = "9f2b7c1d4e6a8035bd21ce4470f9a6182d3b5c7e90a4162f8837de5b0c1a4e73";
  assert.deepEqual(sigilPattern(a).grid, sigilPattern(a).grid);
  assert.notDeepEqual(sigilPattern(a).grid, sigilPattern(b).grid);
});

test("cursor-page merges preserve row order, replace stale entries, and remove duplicates", () => {
  const current = [
    { itemId: "a", revision: 1 },
    { itemId: "b", revision: 1 },
    { itemId: "a", revision: 0 },
  ];
  const incoming = [
    { itemId: "b", revision: 2 },
    { itemId: "c", revision: 1 },
    { itemId: "c", revision: 2 },
  ];

  assert.deepEqual(mergeNotebookItemsById(current, incoming), [
    { itemId: "a", revision: 1 },
    { itemId: "b", revision: 2 },
    { itemId: "c", revision: 2 },
  ]);
});

test("tab counts are omitted while cursor pagination is incomplete", () => {
  const items = [
    { itemId: "note", kind: "memory_note" },
    { itemId: "page", kind: "journal_page" },
  ];
  const notes = (item) => item.kind === "memory_note";
  assert.equal(notebookCountWhenComplete(items, 25, notes), null);
  assert.equal(notebookCountWhenComplete(items, undefined, notes), null);
  assert.equal(notebookCountWhenComplete(items, null, notes), 1);
});
