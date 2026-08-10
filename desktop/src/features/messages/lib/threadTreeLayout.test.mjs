import assert from "node:assert/strict";
import test from "node:test";

import {
  getThreadReplyAnchorCenterRem,
  getThreadReplyAnchorCenterYRem,
  getThreadReplyConnectorLayout,
  getThreadReplyDescendantRailStartYRem,
  getThreadReplyIndentRem,
  threadReplyLength,
} from "./threadTreeLayout.ts";

test("getThreadReplyIndentRem uses a visible Tailwind spacing step", () => {
  assert.equal(getThreadReplyIndentRem(0), 0);
  assert.equal(getThreadReplyIndentRem(1), 0);
  assert.equal(getThreadReplyIndentRem(2), 2.25);
  assert.equal(getThreadReplyIndentRem(3), 4.5);
});

test("anchor center helpers expose the compact rail points", () => {
  assert.equal(getThreadReplyAnchorCenterRem(0), 1.25);
  assert.equal(getThreadReplyAnchorCenterRem(1), 1.25);
  assert.equal(getThreadReplyAnchorCenterRem(2), 3.5);
  assert.equal(getThreadReplyAnchorCenterYRem(), 0.75);
  assert.equal(getThreadReplyDescendantRailStartYRem(), 1.5);
});

test("getThreadReplyConnectorLayout stops before the child content anchor", () => {
  assert.equal(getThreadReplyConnectorLayout(0), null);
  assert.equal(getThreadReplyConnectorLayout(1), null);
  assert.deepEqual(getThreadReplyConnectorLayout(2), {
    childOffsetRem: 3.5,
    heightRem: 0.75,
    parentOffsetRem: 1.25,
    widthRem: 1.5,
  });
  assert.deepEqual(getThreadReplyConnectorLayout(3), {
    childOffsetRem: 5.75,
    heightRem: 0.75,
    parentOffsetRem: 3.5,
    widthRem: 1.5,
  });
});

test("getThreadReplyConnectorLayout clamps very deep replies to the visible rail", () => {
  assert.deepEqual(getThreadReplyConnectorLayout(99), {
    childOffsetRem: 14.75,
    heightRem: 0.75,
    parentOffsetRem: 12.5,
    widthRem: 1.5,
  });
});

test("threadReplyLength formats rem values for inline styles", () => {
  assert.equal(threadReplyLength(0), "0");
  assert.equal(threadReplyLength(1.75), "1.75rem");
  assert.equal(threadReplyLength(-0.125), "-0.125rem");
});
