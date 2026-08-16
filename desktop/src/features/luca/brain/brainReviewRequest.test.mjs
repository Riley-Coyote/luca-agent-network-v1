import assert from "node:assert/strict";
import test from "node:test";

import {
  BRAIN_REVIEW_REQUEST,
  parseBrainReviewRequest,
} from "./brainReviewRequest.ts";

const CHANNEL_ID = "7c07e659-3610-42f4-9a5e-1e9973c09da9";

test("parses only the narrow Brain review request", () => {
  const request = {
    type: BRAIN_REVIEW_REQUEST,
    requestId: "request-1",
    channelId: CHANNEL_ID,
  };
  assert.deepEqual(parseBrainReviewRequest(request), request);
});

test("rejects mutation data, unknown fields, and invalid conversations", () => {
  for (const value of [
    {
      type: BRAIN_REVIEW_REQUEST,
      requestId: "request-1",
      channelId: CHANNEL_ID,
      sourceId: "repo-secret",
    },
    {
      type: BRAIN_REVIEW_REQUEST,
      requestId: "request-1",
      channelId: CHANNEL_ID,
      connect: true,
    },
    {
      type: BRAIN_REVIEW_REQUEST,
      requestId: "request-1",
      channelId: "general",
    },
  ]) {
    assert.equal(parseBrainReviewRequest(value), null);
  }
});
