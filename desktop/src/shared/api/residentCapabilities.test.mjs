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
});
