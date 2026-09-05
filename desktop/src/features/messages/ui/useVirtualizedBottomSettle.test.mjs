import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetireVirtualizedBottomSettleForKey } from "./useVirtualizedBottomSettle.ts";

test("composer input and send keys do not cancel a pending bottom settle", () => {
  for (const key of ["Enter", "a", "Backspace", "Escape"]) {
    assert.equal(
      shouldRetireVirtualizedBottomSettleForKey({
        editableTarget: true,
        key,
      }),
      false,
    );
  }
});

test("non-editable scroll navigation cancels a pending bottom settle", () => {
  for (const key of [
    "ArrowDown",
    "ArrowUp",
    "PageDown",
    "PageUp",
    "Home",
    "End",
    " ",
  ]) {
    assert.equal(
      shouldRetireVirtualizedBottomSettleForKey({
        editableTarget: false,
        key,
      }),
      true,
    );
  }
});

test("editable scroll keys belong to the editor rather than the transcript", () => {
  assert.equal(
    shouldRetireVirtualizedBottomSettleForKey({
      editableTarget: true,
      key: "ArrowUp",
    }),
    false,
  );
});
