import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadMcpSettingsSections,
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

  it("preserves the managed registry when the native catalog fails", async () => {
    const registry = { connections: [], grants: [], health: [] };
    const result = await loadMcpSettingsSections({
      registry: async () => registry,
      runtimes: async () => [],
      runtimeMcps: async () => {
        throw new Error("native catalog failed");
      },
    });

    assert.equal(result.registry, registry);
    assert.deepEqual(result.runtimes, []);
    assert.equal(result.runtimeMcps, null);
    assert.deepEqual(result.errors, [
      "Runtime-owned MCP definitions could not be loaded.",
    ]);
  });

  it("keeps Goose catalogs in the same safe presentation model", () => {
    const goose = {
      ...catalog("configured", [
        { name: "developer", status: "configured" },
        { name: "local-tools", status: "disabled" },
      ]),
      runtimeId: "goose",
      label: "Goose",
      source: "Goose user configuration",
    };

    assert.equal(runtimeMcpCatalogStatusLabel(goose), "2 configured");
    assert.deepEqual(
      goose.servers.map(({ name, status }) => ({ name, status })),
      [
        { name: "developer", status: "configured" },
        { name: "local-tools", status: "disabled" },
      ],
    );
  });
});
