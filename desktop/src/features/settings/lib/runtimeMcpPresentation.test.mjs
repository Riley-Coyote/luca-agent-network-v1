import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runtimeMcpCatalogStatusLabel,
  runtimeMcpServerStatusLabel,
} from "./runtimeMcpPresentation.ts";

function catalog(status, servers = []) {
  return {
    runtimeId: "codex",
    label: "Codex",
    source: "Codex user configuration",
    status,
    servers,
    reason: null,
  };
}

describe("runtime MCP presentation", () => {
  it("describes configured definitions without implying they are running", () => {
    assert.equal(
      runtimeMcpCatalogStatusLabel(
        catalog("configured", [
          { name: "filesystem", status: "configured" },
          { name: "memory", status: "disabled" },
        ]),
      ),
      "2 configured",
    );
    assert.equal(runtimeMcpServerStatusLabel("configured"), "Configured");
    assert.equal(runtimeMcpServerStatusLabel("disabled"), "Disabled");
  });

  it("keeps empty, unreadable, and unsupported sources distinct", () => {
    assert.equal(
      runtimeMcpCatalogStatusLabel(catalog("none_configured")),
      "None configured",
    );
    assert.equal(
      runtimeMcpCatalogStatusLabel(catalog("unavailable")),
      "Unavailable",
    );
    assert.equal(
      runtimeMcpCatalogStatusLabel(catalog("unsupported")),
      "Unsupported",
    );
  });
});
