import assert from "node:assert/strict";
import test from "node:test";

import {
  readableConnectedBrainError,
  readableOwnerBrainError,
} from "./brainErrors.ts";

test("Brain errors distinguish invalid sources, stale previews, and unreadable state", () => {
  assert.equal(
    readableOwnerBrainError(new Error("owner-brain-invalid"), "preview"),
    "Luca could not preview that source. Choose it again.",
  );
  assert.equal(
    readableOwnerBrainError(new Error("owner-brain-stale"), "preview"),
    "The source changed or the preview expired. Preview it again.",
  );
  assert.equal(
    readableConnectedBrainError(new Error("owner-brain-unavailable")),
    "Brain data could not be opened. Try again.",
  );
});

test("connected Brain never exposes raw invalid-state codes", () => {
  assert.equal(
    readableConnectedBrainError(new Error("owner-brain-invalid")),
    "Luca could not open this Brain source. Scan again, then retry the connection.",
  );
});

test("Brain capacity errors explain preservation and index limits, not corruption", () => {
  const expected =
    "Brain's index has reached its size limit. Your existing data is preserved, but this update could not be saved. Reducing what is indexed may be needed before retrying.";
  assert.equal(readableConnectedBrainError("owner-brain-capacity"), expected);
  for (const context of ["preview", "access"]) {
    assert.equal(
      readableOwnerBrainError(new Error("owner-brain-capacity"), context),
      expected,
    );
  }
});
