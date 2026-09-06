import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRoomProject,
  createEmptyRoomProject,
  createRoomProject,
  deleteRoomProject,
  parseRoomProjectStore,
  readRoomProjectStore,
  renameRoomProject,
  resolveRoomProjects,
  roomProjectStorageKey,
  writeRoomProjectStore,
} from "./roomProjects.ts";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    clear: () => values.clear(),
    get length() {
      return values.size;
    },
  };
}

test("project stores are isolated by owner and relay", () => {
  assert.notEqual(
    roomProjectStorageKey("owner-a", "ws://127.0.0.1:3000"),
    roomProjectStorageKey("owner-b", "ws://127.0.0.1:3000"),
  );
  assert.notEqual(
    roomProjectStorageKey("owner-a", "ws://127.0.0.1:3000"),
    roomProjectStorageKey("owner-a", "wss://relay.example"),
  );
});

test("invalid projects and orphaned room assignments are removed", () => {
  assert.deepEqual(
    parseRoomProjectStore({
      version: 1,
      projects: [
        {
          id: "luca",
          label: "Luca",
          sourceIds: [],
          workingContextStatus: "attached",
        },
        { id: "", label: "Invalid" },
      ],
      assignments: { general: "luca", orphaned: "missing" },
    }),
    {
      version: 1,
      projects: [
        {
          id: "luca",
          label: "Luca",
          sourceIds: [],
          workingContextStatus: "attached",
        },
      ],
      assignments: { general: "luca" },
    },
  );
});

test("legacy prototype data migrates once into the scoped store", () => {
  const storage = memoryStorage({
    "luca.projects.v1": JSON.stringify([{ id: "luca", label: "Luca" }]),
    "luca.roomProjects.v1": JSON.stringify({ general: "luca" }),
  });
  const migrated = readRoomProjectStore(
    "owner",
    "ws://127.0.0.1:3000",
    storage,
  );

  assert.equal(migrated.assignments.general, "luca");
  assert.equal(storage.getItem("luca.projects.v1"), null);
  assert.ok(
    storage.getItem(roomProjectStorageKey("owner", "ws://127.0.0.1:3000")),
  );
});

test("writes persist a normalized project catalog", () => {
  const storage = memoryStorage();
  assert.equal(
    writeRoomProjectStore(
      "owner",
      "relay",
      {
        version: 1,
        projects: [{ id: "project", label: "Project" }],
        assignments: { room: "project", orphan: "missing" },
      },
      storage,
    ),
    true,
  );
  assert.deepEqual(readRoomProjectStore("owner", "relay", storage), {
    version: 1,
    projects: [
      {
        id: "project",
        label: "Project",
        sourceIds: [],
        workingContextStatus: "none",
      },
    ],
    assignments: { room: "project" },
  });
});

test("assignRoomProject keeps one project per room", () => {
  const priorWindow = globalThis.window;
  const priorStorage = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  globalThis.window = { dispatchEvent: () => true };
  try {
    writeRoomProjectStore("owner", "relay", {
      version: 1,
      projects: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      assignments: {},
    });
    assert.equal(assignRoomProject("owner", "relay", "room", "a"), true);
    assert.equal(assignRoomProject("owner", "relay", "room", "b"), true);
    assert.equal(readRoomProjectStore("owner", "relay").assignments.room, "b");
  } finally {
    globalThis.window = priorWindow;
    globalThis.localStorage = priorStorage;
  }
});

test("project resolution honors explicit assignments for any chat and name fallbacks for rooms only, without rewriting input", () => {
  const channels = [
    { id: "room", name: "general", channelType: "stream" },
    { id: "forum", name: "planning", channelType: "forum" },
    { id: "dm", name: "alice-tyler", channelType: "dm" },
    { id: "fallback-dm", name: "agent-dm", channelType: "dm" },
  ];
  const projects = [{ id: "luca", label: "Luca" }];
  const assignments = { room: "luca", dm: "luca" };
  const fallbackAssignments = {
    planning: "luca",
    "agent-dm": "luca",
  };
  const inputsBeforeResolution = structuredClone({
    assignments,
    channels,
    fallbackAssignments,
    projects,
  });

  const resolved = resolveRoomProjects(
    channels,
    projects,
    assignments,
    fallbackAssignments,
  );

  assert.deepEqual([...resolved.keys()], ["room", "forum", "dm"]);
  assert.equal(resolved.get("room"), projects[0]);
  assert.equal(resolved.get("forum"), projects[0]);
  // An explicit assignment is the owner putting a chat in a project — a
  // group conversation included. Only the name-keyed fallback stays rooms-only.
  assert.equal(resolved.get("dm")?.id, "luca");
  assert.equal(resolved.has("fallback-dm"), false);
  assert.deepEqual(
    { assignments, channels, fallbackAssignments, projects },
    inputsBeforeResolution,
  );
});

test("createRoomProject stores opaque context ids and assigns its first room", () => {
  const priorWindow = globalThis.window;
  const priorStorage = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  globalThis.window = { dispatchEvent: () => true };
  try {
    const project = createRoomProject("owner", "relay", {
      label: "Luca Network",
      roomId: "room-1",
      sourceIds: ["repo:one", "repo:one", "/private/source"],
    });
    assert.deepEqual(project, {
      id: "luca-network",
      label: "Luca Network",
      sourceIds: ["repo:one"],
      workingContextStatus: "attached",
    });
    const stored = readRoomProjectStore("owner", "relay");
    assert.equal(stored.assignments["room-1"], "luca-network");
    assert.deepEqual(stored.projects[0]?.sourceIds, ["repo:one"]);
  } finally {
    globalThis.window = priorWindow;
    globalThis.localStorage = priorStorage;
  }
});

test("createEmptyRoomProject stores a scoped project without a room assignment", () => {
  const storage = memoryStorage();
  const project = createEmptyRoomProject(
    "owner",
    "relay",
    {
      label: "Launch Work",
      sourceIds: ["folder:notes", "/private/source", "folder:notes"],
    },
    storage,
  );

  assert.deepEqual(project, {
    id: "launch-work",
    label: "Launch Work",
    sourceIds: ["folder:notes"],
    workingContextStatus: "attached",
  });
  assert.deepEqual(readRoomProjectStore("owner", "relay", storage), {
    version: 1,
    projects: [project],
    assignments: {},
  });
  assert.deepEqual(readRoomProjectStore("another-owner", "relay", storage), {
    version: 1,
    projects: [],
    assignments: {},
  });
});

test("createEmptyRoomProject generates stable unique ids without changing atomic room creation", () => {
  const storage = memoryStorage();
  const first = createEmptyRoomProject(
    "owner",
    "relay",
    { label: "Launch Work" },
    storage,
  );
  const second = createEmptyRoomProject(
    "owner",
    "relay",
    { label: "Launch Work" },
    storage,
  );

  assert.equal(first?.id, "launch-work");
  assert.equal(second?.id, "launch-work-2");
  assert.deepEqual(
    readRoomProjectStore("owner", "relay", storage).assignments,
    {},
  );
});

test("renameRoomProject preserves stable identity sources status and assignments", () => {
  const storage = memoryStorage();
  writeRoomProjectStore(
    "owner",
    "relay",
    {
      version: 1,
      projects: [
        {
          id: "luca",
          label: "Luca",
          sourceIds: ["repo:luca"],
          workingContextStatus: "missing",
        },
      ],
      assignments: { general: "luca" },
    },
    storage,
  );

  assert.equal(
    renameRoomProject("owner", "relay", "luca", "  Luca Network  ", storage),
    true,
  );
  assert.deepEqual(readRoomProjectStore("owner", "relay", storage), {
    version: 1,
    projects: [
      {
        id: "luca",
        label: "Luca Network",
        sourceIds: ["repo:luca"],
        workingContextStatus: "missing",
      },
    ],
    assignments: { general: "luca" },
  });
  assert.equal(
    renameRoomProject("owner", "relay", "luca", "Luca Network", storage),
    false,
  );
  assert.equal(
    renameRoomProject("owner", "relay", "luca", " ", storage),
    false,
  );
});

test("deleteRoomProject removes only its local grouping and assignments", () => {
  const storage = memoryStorage();
  writeRoomProjectStore(
    "owner",
    "relay",
    {
      version: 1,
      projects: [
        { id: "luca", label: "Luca", sourceIds: ["repo:luca"] },
        { id: "other", label: "Other", sourceIds: ["folder:notes"] },
      ],
      assignments: { general: "luca", engineering: "luca", random: "other" },
    },
    storage,
  );

  assert.equal(deleteRoomProject("owner", "relay", "luca", storage), true);
  assert.deepEqual(readRoomProjectStore("owner", "relay", storage), {
    version: 1,
    projects: [
      {
        id: "other",
        label: "Other",
        sourceIds: ["folder:notes"],
        workingContextStatus: "none",
      },
    ],
    assignments: { random: "other" },
  });
  assert.equal(deleteRoomProject("owner", "relay", "missing", storage), false);
});

test("project detail mutations report storage failure without changing state", () => {
  const stored = JSON.stringify({
    version: 1,
    projects: [{ id: "luca", label: "Luca" }],
    assignments: { general: "luca" },
  });
  const storage = {
    ...memoryStorage({ [roomProjectStorageKey("owner", "relay")]: stored }),
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(
    renameRoomProject("owner", "relay", "luca", "Renamed", storage),
    false,
  );
  assert.equal(deleteRoomProject("owner", "relay", "luca", storage), false);
  assert.equal(
    readRoomProjectStore("owner", "relay", storage).projects[0]?.label,
    "Luca",
  );
});
