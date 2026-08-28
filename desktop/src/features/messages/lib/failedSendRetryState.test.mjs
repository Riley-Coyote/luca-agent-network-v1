import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  failedSendRetry,
  resetFailedSendRetryState,
  retainFailedSendRetry,
} from "./failedSendRetryState.ts";
import {
  retainOptimisticSendError,
  retainedOptimisticSendChannel,
} from "./retainedOptimisticSendError.ts";

describe("failed send retry state", () => {
  it("clears retained message bodies and failure ownership at a community boundary", () => {
    const error = new Error("relay rejected");
    retainFailedSendRetry("optimistic-1", { content: "private message" });
    retainOptimisticSendError(error, "community-a-channel");

    resetFailedSendRetryState();

    assert.equal(failedSendRetry("optimistic-1"), undefined);
    assert.equal(retainedOptimisticSendChannel(error), null);
  });
});
