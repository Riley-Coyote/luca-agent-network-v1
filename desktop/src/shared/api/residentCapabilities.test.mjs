import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResidentCapabilitySettings } from "./residentCapabilities.ts";

test("normalizes native snake-case capability grants for display and revocation", () => {
  const settings = normalizeResidentCapabilitySettings({
    householdDefault: "standard",
    residentAccess: { resident: "full" },
    grants: [
      {
        grant_id: "grant-1",
        resident_pubkey: "resident",
        capability: "filesystem_read",
        resource: {
          kind: "repository",
          resource_ref: "/redacted/project",
          display_name: "Project",
        },
        created_at: "2026-08-22T00:00:00Z",
      },
    ],
  });

  assert.deepEqual(settings.grants, [
    {
      grantId: "grant-1",
      residentPubkey: "resident",
      capability: "filesystem_read",
      resource: {
        kind: "repository",
        resourceRef: "/redacted/project",
        displayName: "Project",
      },
      createdAt: "2026-08-22T00:00:00Z",
      revokedAt: undefined,
    },
  ]);
  assert.deepEqual(settings.rules, []);
});

test("normalizes remembered permission rules into the camel-case model", () => {
  const settings = normalizeResidentCapabilitySettings({
    householdDefault: "standard",
    residentAccess: {},
    grants: [],
    rules: [
      {
        protocol: "luca.permission.rule.v1",
        rule_id: "rule-1",
        resident_pubkey: "resident",
        scope: { scope: "project", source_id: "source-1" },
        matcher: {
          kind: "command",
          token: "git",
          argv_prefix: ["status"],
        },
        effect: "allow",
        display_name: "Run git status in Luca",
        created_at: "2026-09-16T00:00:00Z",
      },
      {
        protocol: "luca.permission.rule.v1",
        rule_id: "rule-2",
        resident_pubkey: "resident",
        scope: { scope: "everywhere" },
        matcher: {
          kind: "mcp_tool",
          server_family: "luca-artifacts",
          tool: "artifact_read",
        },
        effect: "deny",
        display_name: "Never read artifacts",
        created_at: "2026-09-16T00:00:00Z",
        revoked_at: "2026-09-16T01:00:00Z",
        last_used_at: "2026-09-16T00:30:00Z",
        use_count: 4,
      },
    ],
  });

  assert.deepEqual(settings.rules, [
    {
      protocol: "luca.permission.rule.v1",
      ruleId: "rule-1",
      residentPubkey: "resident",
      scope: { scope: "project", sourceId: "source-1" },
      matcher: { kind: "command", token: "git", argvPrefix: ["status"] },
      effect: "allow",
      displayName: "Run git status in Luca",
      createdAt: "2026-09-16T00:00:00Z",
      revokedAt: null,
      lastUsedAt: null,
      useCount: 0,
    },
    {
      protocol: "luca.permission.rule.v1",
      ruleId: "rule-2",
      residentPubkey: "resident",
      scope: { scope: "everywhere" },
      matcher: {
        kind: "mcp_tool",
        serverFamily: "luca-artifacts",
        tool: "artifact_read",
      },
      effect: "deny",
      displayName: "Never read artifacts",
      createdAt: "2026-09-16T00:00:00Z",
      revokedAt: "2026-09-16T01:00:00Z",
      lastUsedAt: "2026-09-16T00:30:00Z",
      useCount: 4,
    },
  ]);
});
