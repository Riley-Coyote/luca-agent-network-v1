import assert from "node:assert/strict";
import test from "node:test";

import { artifactMcpCapabilityPresentation } from "./artifactMcpCapability.ts";

function runtime(artifactMcpSupport) {
  return {
    id: "future-acp",
    command: "/opt/future-acp",
    artifactMcpSupport,
  };
}

for (const [support, value] of [
  ["supported", "Available"],
  ["probe_pending", "Compatibility check pending"],
  ["unavailable", "Unavailable"],
]) {
  test(`artifact MCP capability presents catalog ${support} truth`, () => {
    const result = artifactMcpCapabilityPresentation({
      runtimeReference: "/opt/future-acp",
      runtimes: [runtime(support)],
      loading: false,
      failed: false,
    });

    assert.equal(result.state, support);
    assert.equal(result.value, value);
  });
}

test("artifact MCP capability does not guess when a resident has no catalog entry", () => {
  const result = artifactMcpCapabilityPresentation({
    runtimeReference: "native-runtime-without-catalog-entry",
    runtimes: [runtime("supported")],
    loading: false,
    failed: false,
  });

  assert.equal(result.state, "not_reported");
  assert.equal(result.value, "Support not reported");
});
