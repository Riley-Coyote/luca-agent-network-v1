import assert from "node:assert/strict";
import test from "node:test";

import {
  notebookAvailabilityCopy,
  notebookCategoryLabel,
  notebookExcerpt,
  notebookItemMatchesView,
} from "./notebookPresentation.ts";

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
