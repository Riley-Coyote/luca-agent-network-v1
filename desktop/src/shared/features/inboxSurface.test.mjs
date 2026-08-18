import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INBOX_SURFACE_DEFAULT_ENABLED,
  INBOX_SURFACE_FEATURE_ID,
  resolveInboxSurfaceEnabled,
} from "./inboxSurface.ts";

describe("inbox surface flag", () => {
  it("ships disabled", () => {
    // Product decision (owner, 2026-08-18): the Inbox is off until the core
    // conversation app is right. Flipping this default is a reviewed change.
    assert.equal(INBOX_SURFACE_DEFAULT_ENABLED, false);
    assert.equal(resolveInboxSurfaceEnabled({}), false);
  });

  it("turns on with an explicit override", () => {
    assert.equal(
      resolveInboxSurfaceEnabled({ [INBOX_SURFACE_FEATURE_ID]: true }),
      true,
    );
  });

  it("stays off with an explicit opt-out", () => {
    assert.equal(
      resolveInboxSurfaceEnabled({ [INBOX_SURFACE_FEATURE_ID]: false }),
      false,
    );
  });

  it("ignores overrides for unrelated ids", () => {
    assert.equal(resolveInboxSurfaceEnabled({ pulse: true }), false);
  });
});
