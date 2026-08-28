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

  it("bounds retained failed-message payloads", () => {
    resetFailedSendRetryState();
    for (let index = 0; index < 105; index += 1) {
      retainFailedSendRetry(`optimistic-${index}`, { content: `${index}` });
    }

    assert.equal(failedSendRetry("optimistic-0"), undefined);
    assert.deepEqual(failedSendRetry("optimistic-104"), { content: "104" });
  });
});
