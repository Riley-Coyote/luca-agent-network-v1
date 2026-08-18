import assert from "node:assert/strict";
import test from "node:test";

import {
  RESIDENT_DOCUMENT_KINDS,
  documentKindMeta,
  documentWriterLabel,
  formatDocumentBytes,
  formatDocumentStatus,
  formatRelativeAge,
  validateExtraFilePath,
} from "./documentKinds.ts";

test("kinds are listed in assembly order with the framework file names", () => {
  assert.deepEqual(
    RESIDENT_DOCUMENT_KINDS.map((kind) => documentKindMeta(kind).fileName),
    [
      "soul.md",
      "convictions.md",
      "self-model.md",
      "user-model.md",
      "lessons.md",
      "instructions.md",
    ],
  );
});

test("who writes what: soul, convictions, instructions are the owner's; the rest the agent's", () => {
  const writers = Object.fromEntries(
    RESIDENT_DOCUMENT_KINDS.map((kind) => [
      kind,
      documentKindMeta(kind).writer,
    ]),
  );
  assert.deepEqual(writers, {
    soul: "owner",
    convictions: "owner",
    selfModel: "agent",
    userModel: "agent",
    lessons: "agent",
    instructions: "owner",
  });
  assert.equal(documentWriterLabel("owner", "Luca"), "You write this");
  assert.equal(documentWriterLabel("agent", "Luca"), "Luca writes this");
});

test("lessons is a document but not an assembly slot", () => {
  assert.equal(documentKindMeta("lessons").assembled, false);
  for (const kind of [
    "soul",
    "convictions",
    "selfModel",
    "userModel",
    "instructions",
  ]) {
    assert.equal(documentKindMeta(kind).assembled, true, kind);
  }
});

test("status line reads size and age, or says the file is not written yet", () => {
  const now = Date.UTC(2026, 7, 18, 12, 0, 0);
  assert.equal(
    formatDocumentStatus({ exists: false, bytes: 0, modifiedAt: null }, now),
    "Not written yet",
  );
  assert.equal(
    formatDocumentStatus(
      { exists: true, bytes: 1229, modifiedAt: now / 1000 - 180 },
      now,
    ),
    "1.2 KB · edited 3 min ago",
  );
  assert.equal(
    formatDocumentStatus({ exists: true, bytes: 512, modifiedAt: null }, now),
    "512 B",
  );
});

test("sizes and ages round the way a person reads them", () => {
  assert.equal(formatDocumentBytes(0), "0 B");
  assert.equal(formatDocumentBytes(1023), "1023 B");
  assert.equal(formatDocumentBytes(1024), "1.0 KB");
  assert.equal(formatDocumentBytes(20 * 1024), "20 KB");
  const now = 1_000_000_000_000;
  assert.equal(formatRelativeAge(now - 10_000, now), "just now");
  assert.equal(formatRelativeAge(now - 5 * 60_000, now), "5 min ago");
  assert.equal(formatRelativeAge(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(formatRelativeAge(now - 2 * 86_400_000, now), "2 d ago");
});

test("extra file paths stay inside the folder and stay text", () => {
  assert.equal(validateExtraFilePath("notes/todo.md"), null);
  assert.equal(validateExtraFilePath("config.toml"), null);
  assert.match(validateExtraFilePath(""), /name/);
  assert.match(validateExtraFilePath("/etc/passwd"), /absolute/);
  assert.match(validateExtraFilePath("../soul.md"), /climb/);
  assert.match(validateExtraFilePath(".hidden.md"), /Hidden/);
  assert.match(validateExtraFilePath("script.sh"), /Text files only/);
});
