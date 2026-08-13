import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dedupeManagedOperationalStatuses,
  managedOperationalCopy,
  managedPermissionOutcomeCopy,
  sanitizedAttachmentFailure,
} from "./managedOperationalStatus.ts";

describe("managed operational presentation", () => {
  it("maps typed failures without protocol terminology", () => {
    assert.deepEqual(managedOperationalCopy("failed", "runtime"), {
      label: "Resident stopped unexpectedly · Retry",
      tone: "attention",
    });
    assert.equal(
      managedOperationalCopy("failed", "publication").label,
      "Response couldn’t be published · Retry",
    );
    assert.equal(
      managedOperationalCopy("finalizing", null).label,
      "Finalizing response",
    );
  });

  it("dedupes only body-free restart interruptions", () => {
    assert.deepEqual(
      dedupeManagedOperationalStatuses([
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "two", status: "interrupted_after_restart" },
      ]),
      [
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "two", status: "interrupted_after_restart" },
      ],
    );
  });

  it("keeps permission and attachment feedback safe and concise", () => {
    assert.equal(
      managedPermissionOutcomeCopy("session_replaced"),
      "Permission request closed when the resident restarted",
    );
    const attachment = sanitizedAttachmentFailure();
    assert.match(attachment, /keep typing/);
    assert.doesNotMatch(attachment, /path|stack|token|credential|relay/i);
  });
});
