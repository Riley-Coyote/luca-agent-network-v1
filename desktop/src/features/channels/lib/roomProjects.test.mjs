import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRoomProject,
  parseRoomProjectStore,
  readRoomProjectStore,
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
        { id: "luca", label: "Luca", workingContextStatus: "attached" },
        { id: "", label: "Invalid" },
      ],
      assignments: { general: "luca", orphaned: "missing" },
    }),
    {
      version: 1,
      projects: [
        { id: "luca", label: "Luca", workingContextStatus: "attached" },
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
      { id: "project", label: "Project", workingContextStatus: "none" },
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
