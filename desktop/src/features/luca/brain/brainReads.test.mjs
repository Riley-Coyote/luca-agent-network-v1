import assert from "node:assert/strict";
import test from "node:test";

import {
  accessDetail,
  accessWord,
  brainReadsLine,
  mindBrainAccess,
  readsEverything,
} from "./brainReads.ts";

const LUCA = "A".repeat(64);
const ATLAS = "b".repeat(64);

const source = (sourceId, sourceKind, status = "current") => ({
  sourceId,
  sourceKind,
  displayName: sourceId,
  status,
  itemCount: 1,
  entryCount: 2,
  lastRefreshedAt: null,
});

const inventory = {
  sources: [
    source("repo-a", "repository"),
    source("repo-b", "repository", "needs_attention"),
    source("codex", "codex_history"),
    source("gone", "repository", "disconnected"),
  ],
  recallGrants: [
    {
      grantId: "1",
      sourceId: "repo-a",
      residentPubkey: LUCA.toLowerCase(),
      state: "active",
      canReconfirm: false,
    },
    {
      grantId: "2",
      sourceId: "repo-b",
      residentPubkey: LUCA.toLowerCase(),
      state: "active",
      canReconfirm: false,
    },
    {
      grantId: "3",
      sourceId: "codex",
      residentPubkey: LUCA.toLowerCase(),
      state: "active",
      canReconfirm: false,
    },
    {
      grantId: "4",
      sourceId: "repo-a",
      residentPubkey: ATLAS,
      state: "stale",
      canReconfirm: true,
    },
  ],
  repositoryGrants: [
    {
      grantId: "w1",
      sourceId: "repo-a",
      residentPubkey: LUCA.toLowerCase(),
      state: "active",
    },
  ],
};

const files = {
  sources: [
    {
      sourceId: "notes",
      sourceKind: "text_folder",
      displayName: "Launch Notes",
      status: "ready",
      fileCount: 4,
      chunkCount: 8,
      changedFileCount: 0,
      indexedAt: "2026-08-08T20:02:00Z",
    },
  ],
  grants: [
    {
      grantId: "f1",
      sourceId: "notes",
      residentPubkey: LUCA.toLowerCase(),
      residentName: "Luca",
      state: "active",
      providerEgress: "local",
      canReconfirm: false,
    },
  ],
};

test("the line counts what Brain's cards count, in a breath", () => {
  assert.equal(brainReadsLine(undefined, 0), "");
  assert.equal(brainReadsLine({ sources: [] }, 0), "Nothing connected");
  assert.equal(
    brainReadsLine(inventory, 1),
    "2 repositories · Codex history · 1 file",
  );
  assert.equal(
    brainReadsLine(
      {
        sources: [
          source("r", "repository"),
          source("c", "claude_history"),
          source("x", "codex_history"),
        ],
      },
      3,
    ),
    "1 repository · Claude Code and Codex history · 3 files",
  );
});

test("a mind's access, source by source, its own grants only", () => {
  const rows = mindBrainAccess(inventory, files, LUCA);
  assert.deepEqual(
    rows.map((row) => [row.sourceId, row.record, row.state]),
    [
      ["repo-a", "connected", "active"],
      ["repo-b", "connected", "active"],
      ["codex", "connected", "active"],
      ["notes", "file", "active"],
    ],
  );
  assert.equal(readsEverything(rows), true);
  assert.equal(
    accessDetail(rows[0]),
    "Repository · Recall and repository work · ready",
  );
  assert.equal(
    accessDetail(rows[1]),
    "Repository · Resident access saved · source reconnect required",
  );
  assert.equal(accessDetail(rows[2]), "Codex · Recall access");
  assert.equal(accessDetail(rows[3]), "Folder · Local provider path");
  assert.equal(accessWord(rows[0]), "Included");
  assert.equal(accessWord(rows[3]), "Active");
});

test("another mind's grants: stale, excluded, and no file access", () => {
  const rows = mindBrainAccess(inventory, files, ATLAS);
  assert.deepEqual(
    rows.map((row) => [row.sourceId, row.state, accessWord(row)]),
    [
      ["repo-a", "stale", "Review needed"],
      ["repo-b", "revoked", "Excluded"],
      ["codex", "revoked", "Excluded"],
      ["notes", "absent", "No access"],
    ],
  );
  assert.equal(rows[0].canReconfirm, true);
  assert.equal(
    accessDetail(rows[0]),
    "Repository · Recall and repository work · review needed",
  );
  assert.equal(
    accessDetail(rows[3]),
    "Folder · No source content can be retrieved",
  );
  assert.equal(readsEverything(rows), false);
});

test("nothing connected reads nothing, not everything", () => {
  assert.deepEqual(mindBrainAccess(undefined, undefined, LUCA), []);
  assert.equal(readsEverything([]), false);
});
