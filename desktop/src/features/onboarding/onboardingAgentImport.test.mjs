import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAgentImportSelection,
  createEmptyAgentImportSelection,
  filterAgentImportCandidates,
  groupAgentImportCandidates,
  isReadyAgentImportCandidate,
  isSelectableAgentImportCandidate,
  reconcileAgentImportSelection,
  selectAllReadyAgentImports,
} from "./onboardingAgentImport.ts";

function candidate(
  semanticId,
  {
    displayName = semanticId,
    nativeType = "hermes",
    nativeId = semanticId,
    modelSummary,
    readiness = { status: "ready" },
  } = {},
) {
  return {
    nativeType,
    nativeId,
    semanticId,
    bindingFingerprint: `${semanticId}:fingerprint`,
    displayName,
    modelSummary,
    readiness,
    warnings: [],
    bindingPreview: {
      kind: "hermes",
      schemaVersion: 1,
      profileName: nativeId,
      hermesHome: `/tmp/${nativeId}`,
      executablePath: "/tmp/hermes",
      runtimeVersion: "1.0.0",
    },
  };
}

test("new onboarding visits begin with no imported agents selected", () => {
  assert.deepEqual([...createEmptyAgentImportSelection()], []);
});

test("select all includes ready and safely discovered identities that are not already imported", () => {
  const candidates = [
    candidate("ready"),
    candidate("imported"),
    candidate("discovered", {
      readiness: { status: "discovered", message: "Found" },
    }),
    candidate("degraded", {
      readiness: { status: "degraded", code: "OFFLINE", message: "Offline" },
    }),
    candidate("unavailable", {
      readiness: {
        status: "unavailable",
        code: "MISSING",
        message: "Missing",
      },
    }),
  ];

  assert.deepEqual(
    [...selectAllReadyAgentImports(candidates, new Set(["imported"]))],
    ["ready", "discovered"],
  );
});

test("clear always returns a fresh empty selection", () => {
  const first = clearAgentImportSelection();
  const second = clearAgentImportSelection();
  assert.deepEqual([...first], []);
  assert.deepEqual([...second], []);
  assert.notEqual(first, second);
});

test("unavailable candidates are the only candidates disabled by discovery", () => {
  assert.equal(isSelectableAgentImportCandidate(candidate("ready")), true);
  assert.equal(
    isSelectableAgentImportCandidate(
      candidate("discovered", {
        readiness: { status: "discovered", message: "Found" },
      }),
    ),
    true,
  );
  assert.equal(
    isSelectableAgentImportCandidate(
      candidate("degraded", {
        readiness: { status: "degraded", code: "OFFLINE", message: "Offline" },
      }),
    ),
    true,
  );
  assert.equal(
    isSelectableAgentImportCandidate(
      candidate("missing", {
        readiness: {
          status: "unavailable",
          code: "MISSING",
          message: "Missing",
        },
      }),
    ),
    false,
  );
});

test("ready-to-import includes discovered identities but not degraded ones", () => {
  assert.equal(isReadyAgentImportCandidate(candidate("ready")), true);
  assert.equal(
    isReadyAgentImportCandidate(
      candidate("discovered", {
        readiness: { status: "discovered", message: "Found" },
      }),
    ),
    true,
  );
  assert.equal(
    isReadyAgentImportCandidate(
      candidate("degraded", {
        readiness: { status: "degraded", code: "OFFLINE", message: "Offline" },
      }),
    ),
    false,
  );
});

test("rescan preserves valid choices and drops missing, unavailable, and imported identities", () => {
  const next = reconcileAgentImportSelection(
    new Set(["kept", "missing", "unavailable", "imported"]),
    [
      candidate("kept", {
        readiness: { status: "discovered", message: "Found" },
      }),
      candidate("unavailable", {
        readiness: {
          status: "unavailable",
          code: "MISSING",
          message: "Missing",
        },
      }),
      candidate("imported"),
    ],
    new Set(["imported"]),
  );

  assert.deepEqual([...next], ["kept"]);
});

test("search matches names, ids, sources, and model summaries", () => {
  const candidates = [
    candidate("hermes:writer", {
      displayName: "Writer",
      nativeId: "opus",
      modelSummary: "Claude Opus",
    }),
    candidate("openclaw:main", {
      displayName: "Main",
      nativeType: "openclaw",
      nativeId: "primary",
      modelSummary: "GPT-5",
    }),
  ];

  assert.deepEqual(
    filterAgentImportCandidates(candidates, "writer").map(
      (item) => item.semanticId,
    ),
    ["hermes:writer"],
  );
  assert.deepEqual(
    filterAgentImportCandidates(candidates, "primary").map(
      (item) => item.semanticId,
    ),
    ["openclaw:main"],
  );
  assert.deepEqual(
    filterAgentImportCandidates(candidates, "openclaw").map(
      (item) => item.semanticId,
    ),
    ["openclaw:main"],
  );
  assert.deepEqual(
    filterAgentImportCandidates(candidates, "opus").map(
      (item) => item.semanticId,
    ),
    ["hermes:writer"],
  );
});

test("grouping is Hermes then OpenClaw regardless of completion order", () => {
  const groups = groupAgentImportCandidates([
    candidate("openclaw:first", { nativeType: "openclaw" }),
    candidate("hermes:first"),
    candidate("openclaw:second", { nativeType: "openclaw" }),
  ]);

  assert.deepEqual(
    groups.map((group) => group.nativeType),
    ["hermes", "openclaw"],
  );
  assert.deepEqual(
    groups[1].candidates.map((item) => item.semanticId),
    ["openclaw:first", "openclaw:second"],
  );
});

test("blank search preserves the original discovery order", () => {
  const candidates = [candidate("one"), candidate("two")];
  assert.deepEqual(filterAgentImportCandidates(candidates, "  "), candidates);
  assert.notEqual(filterAgentImportCandidates(candidates, ""), candidates);
});
