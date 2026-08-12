import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectCreationFailure,
  runProjectCreationTransaction,
} from "./projectCreationTransaction.ts";

function draft(overrides = {}) {
  return {
    label: "Launch Work",
    roomName: "planning",
    sourceIds: ["repo:launch"],
    residents: { mode: "none" },
    ...overrides,
  };
}

function operations(overrides = {}) {
  let roomSequence = 0;
  return {
    createProject: () => ({ id: "launch-work" }),
    createRoom: async (_input, onCreated) => {
      roomSequence += 1;
      await onCreated(`room-${roomSequence}`);
    },
    assignRoom: () => true,
    addResidents: async (_channelId, pubkeys) => ({
      added: pubkeys,
      errors: [],
    }),
    requestNewResident: () => {},
    ...overrides,
  };
}

async function capturedFailure(run) {
  try {
    await run();
  } catch (cause) {
    assert.ok(cause instanceof ProjectCreationFailure);
    return cause;
  }
  assert.fail("expected ProjectCreationFailure");
}

test("a local project failure stops before remote room creation", async () => {
  let roomCalls = 0;
  const failure = await capturedFailure(() =>
    runProjectCreationTransaction(
      draft(),
      null,
      operations({
        createProject: () => null,
        createRoom: async () => {
          roomCalls += 1;
        },
      }),
    ),
  );

  assert.equal(failure.stage, "project");
  assert.equal(roomCalls, 0);
  assert.deepEqual(failure.checkpoint, {});
});

test("a room failure retains the empty project and retries only the room", async () => {
  let projectCalls = 0;
  let roomCalls = 0;
  const ops = operations({
    createProject: () => {
      projectCalls += 1;
      return { id: "launch-work" };
    },
    createRoom: async (_input, onCreated) => {
      roomCalls += 1;
      if (roomCalls === 1) throw new Error("Relay unavailable.");
      await onCreated("room-recovered");
    },
  });

  const first = await capturedFailure(() =>
    runProjectCreationTransaction(draft(), null, ops),
  );
  assert.equal(first.stage, "room");
  assert.equal(first.checkpoint.projectId, "launch-work");

  const completed = await runProjectCreationTransaction(
    draft(),
    first.checkpoint,
    ops,
  );
  assert.equal(completed.channelId, "room-recovered");
  assert.equal(projectCalls, 1);
  assert.equal(roomCalls, 2);
});

test("an assignment failure retries assignment without recreating the room", async () => {
  let roomCalls = 0;
  let assignmentCalls = 0;
  const ops = operations({
    createRoom: async (_input, onCreated) => {
      roomCalls += 1;
      await onCreated("room-existing");
    },
    assignRoom: () => {
      assignmentCalls += 1;
      return assignmentCalls > 1;
    },
  });

  const first = await capturedFailure(() =>
    runProjectCreationTransaction(draft(), null, ops),
  );
  assert.equal(first.stage, "assignment");
  assert.equal(first.checkpoint.channelId, "room-existing");

  const completed = await runProjectCreationTransaction(
    draft(),
    first.checkpoint,
    ops,
  );
  assert.equal(completed.roomAssigned, true);
  assert.equal(roomCalls, 1);
  assert.equal(assignmentCalls, 2);
});

test("partial resident failure retries only unresolved membership", async () => {
  const membershipCalls = [];
  const residentDraft = draft({
    residents: { mode: "existing", pubkeys: ["agent-a", "agent-b"] },
  });
  const ops = operations({
    addResidents: async (_channelId, pubkeys) => {
      membershipCalls.push(pubkeys);
      return membershipCalls.length === 1
        ? {
            added: ["agent-a"],
            errors: [{ pubkey: "agent-b", error: "Membership unavailable." }],
          }
        : { added: ["agent-b"], errors: [] };
    },
  });

  const first = await capturedFailure(() =>
    runProjectCreationTransaction(residentDraft, null, ops),
  );
  assert.equal(first.stage, "membership");
  assert.deepEqual(first.checkpoint.pendingResidentPubkeys, ["agent-b"]);

  const completed = await runProjectCreationTransaction(
    residentDraft,
    first.checkpoint,
    ops,
  );
  assert.deepEqual(completed.pendingResidentPubkeys, []);
  assert.deepEqual(membershipCalls, [["agent-a", "agent-b"], ["agent-b"]]);
});

test("project-only creation makes no room resident or authority calls", async () => {
  let roomCalls = 0;
  let residentCalls = 0;
  const completed = await runProjectCreationTransaction(
    draft({ roomName: null, sourceIds: [], residents: { mode: "none" } }),
    null,
    operations({
      createRoom: async () => {
        roomCalls += 1;
      },
      addResidents: async () => {
        residentCalls += 1;
        return { added: [], errors: [] };
      },
      requestNewResident: () => {
        residentCalls += 1;
      },
    }),
  );

  assert.equal(completed.projectId, "launch-work");
  assert.equal(roomCalls, 0);
  assert.equal(residentCalls, 0);
});

test("new resident handoff emits the exact room identity once", async () => {
  const requests = [];
  const ops = operations({
    requestNewResident: (request) => requests.push(request),
  });
  const newResidentDraft = draft({ residents: { mode: "new" } });

  const completed = await runProjectCreationTransaction(
    newResidentDraft,
    null,
    ops,
  );
  await runProjectCreationTransaction(newResidentDraft, completed, ops);

  assert.deepEqual(requests, [
    { channelId: "room-1", channelName: "planning" },
  ]);
  assert.deepEqual(Object.keys(requests[0]).sort(), [
    "channelId",
    "channelName",
  ]);
});
