import assert from "node:assert/strict";
import test from "node:test";

import { parsePolyphonicSurfaceRequest } from "./polyphonicSurfaceRequest.ts";

const channelId = "7c07e659-3610-42f4-9a5e-1e9973c09da9";

test("surface requests accept only body-free allowlisted navigation", () => {
  assert.deepEqual(
    parsePolyphonicSurfaceRequest({
      type: "polyphonic_surface_request",
      requestId: "request-1",
      channelId,
      surface: "access",
    }),
    {
      type: "polyphonic_surface_request",
      requestId: "request-1",
      channelId,
      surface: "access",
    },
  );
  assert.equal(
    parsePolyphonicSurfaceRequest({
      type: "polyphonic_surface_request",
      requestId: "request-1",
      channelId,
      surface: "access",
      prefill: "secret or unreviewed body",
    }),
    null,
  );
  assert.equal(
    parsePolyphonicSurfaceRequest({
      type: "polyphonic_surface_request",
      requestId: "request-1",
      channelId,
      surface: "terminal",
    }),
    null,
  );
});
