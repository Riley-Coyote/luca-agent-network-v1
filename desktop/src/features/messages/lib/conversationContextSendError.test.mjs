import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isMissingPrimaryContextSendError } from "./conversationContextSendError.ts";

describe("conversation context send failures", () => {
  it("refreshes only after the native missing-primary failure", () => {
    assert.equal(
      isMissingPrimaryContextSendError(
        new Error("conversation_context:missing_primary"),
      ),
      true,
    );
    assert.equal(
      isMissingPrimaryContextSendError(new Error("relay unreachable")),
      false,
    );
    assert.equal(isMissingPrimaryContextSendError("missing"), false);
  });
});
