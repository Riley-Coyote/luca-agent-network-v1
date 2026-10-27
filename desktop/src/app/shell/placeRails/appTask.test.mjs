import assert from "node:assert/strict";
import test from "node:test";

import {
  appPathOf,
  folderName,
  projectOfFolder,
  stepStateLabel,
  taskAppName,
  taskCanOpenNative,
  taskIsLive,
  taskStateLine,
} from "./appTask.ts";

test("appPathOf_readsAnAppAndItsTask", () => {
  assert.deepEqual(appPathOf("/apps/claude"), {
    family: "claude",
    taskId: null,
  });
  assert.deepEqual(appPathOf("/apps/codex/tasks/task%3A1"), {
    family: "codex",
    taskId: "task:1",
  });
  assert.equal(appPathOf("/apps/"), null);
  assert.equal(appPathOf("/channels/x"), null);
  assert.equal(appPathOf("/apps/claude/other"), null);
});

test("taskIsLive_workingStatesOnly", () => {
  for (const state of ["queued", "active", "stopping"])
    assert.equal(taskIsLive({ state }), true);
  for (const state of [
    "awaiting_native",
    "succeeded",
    "stopped",
    "failed",
    "interrupted",
  ])
    assert.equal(taskIsLive({ state }), false);
});

test("taskCanOpenNative_onlyACodexChatWithItsSession", () => {
  const codex = {
    controlOwner: "native_app",
    operation: "send_message",
    providerSessionId: "0f8b2a5c-6d1e-4c3b-9a7f-2e5d8c1b4a90",
    runtimeFamily: "codex",
  };
  assert.equal(taskCanOpenNative(codex), true);
  assert.equal(taskCanOpenNative({ ...codex, providerSessionId: null }), false);
  assert.equal(taskCanOpenNative({ ...codex, operation: "new_task" }), false);
  assert.equal(
    taskCanOpenNative({ ...codex, controlOwner: "polyphonic" }),
    false,
  );
  assert.equal(
    taskCanOpenNative({ ...codex, runtimeFamily: "claude_code" }),
    false,
  );
});

test("projectOfFolder_theDeepestProjectHoldingIt", () => {
  const projects = [
    { folder: "/work/studio", label: "Studio" },
    { folder: "/work/studio/site/", label: "Site" },
    { folder: null, label: "Unresolved" },
  ];
  assert.equal(projectOfFolder("/work/studio", projects), "Studio");
  assert.equal(projectOfFolder("/work/studio/desktop", projects), "Studio");
  assert.equal(projectOfFolder("/work/studio/site/src", projects), "Site");
  assert.equal(projectOfFolder("/work/studios", projects), null);
  assert.equal(projectOfFolder("/elsewhere", projects), null);
  assert.equal(folderName("/work/scratch/build-check/"), "build-check");
});

test("taskStateLine_whoWhereAndWhen", () => {
  const timeOf = (iso) => (iso ? `at ${iso}` : "");
  const base = { completedAt: "c", startedAt: "s" };
  assert.equal(
    taskStateLine(
      { ...base, state: "active" },
      { forName: "Luca", timeOf, where: "Studio" },
    ),
    "For Luca · Studio · working since at s",
  );
  assert.equal(
    taskStateLine(
      { ...base, state: "succeeded" },
      { forName: "Luca", timeOf, where: null },
    ),
    "For Luca · finished at c",
  );
  assert.equal(
    taskStateLine(
      { ...base, state: "failed" },
      { forName: "Atlas", timeOf, where: "build-check" },
    ),
    "For Atlas · build-check · failed",
  );
  assert.equal(
    taskStateLine(
      { ...base, state: "awaiting_native" },
      { forName: "Luca", timeOf, where: "Studio" },
    ),
    "For Luca · Studio · in the app",
  );
});

test("names_theAppAndEachStepState", () => {
  assert.equal(taskAppName({ runtimeFamily: "codex" }), "Codex");
  assert.equal(taskAppName({ runtimeFamily: "claude_code" }), "Claude Code");
  assert.deepEqual(["done", "active", "queued", "failed"].map(stepStateLabel), [
    "Done",
    "Working",
    "Queued",
    "Failed",
  ]);
});
