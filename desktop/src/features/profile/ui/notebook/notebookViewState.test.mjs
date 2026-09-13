import assert from "node:assert/strict";
import test from "node:test";

import {
  isNotebookRequestCurrent,
  notebookViewStorageKey,
  readNotebookViewState,
  writeNotebookViewState,
} from "./notebookViewState.ts";

function installStorage() {
  const values = new Map();
  const localStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { localStorage };
  return { localStorage, values };
}

const scope = {
  ownerPubkey: "Owner-A",
  workspaceId: "workspace-a",
  residentPubkey: "Resident-A",
};

test("notebook view state is namespaced by owner, workspace, and stable resident", () => {
  assert.notEqual(
    notebookViewStorageKey(scope),
    notebookViewStorageKey({ ...scope, workspaceId: "workspace-b" }),
  );
  assert.notEqual(
    notebookViewStorageKey(scope),
    notebookViewStorageKey({ ...scope, ownerPubkey: "owner-b" }),
  );
  assert.equal(
    notebookViewStorageKey(scope),
    notebookViewStorageKey({ ...scope, residentPubkey: "resident-a" }),
  );
});

test("restores only compact notebook references", () => {
  installStorage();
  assert.equal(
    writeNotebookViewState(scope, {
      version: 1,
      view: "pages",
      selected: { itemId: "item-1", revision: 4 },
      listAnchor: "item-1",
      detailAnchor: "history",
      body: "private document body must never persist",
    }),
    true,
  );
  const restored = readNotebookViewState(scope);
  assert.deepEqual(
    {
      ...restored,
      updatedAt: typeof restored?.updatedAt,
    },
    {
      version: 1,
      view: "pages",
      selected: { itemId: "item-1", revision: 4 },
      listAnchor: "item-1",
      detailAnchor: "history",
      updatedAt: "number",
    },
  );
  assert.doesNotMatch(
    globalThis.window.localStorage.getItem(notebookViewStorageKey(scope)),
    /body|private document/i,
  );
});

test("corrupt or oversized stored state is discarded", () => {
  const { localStorage } = installStorage();
  const key = notebookViewStorageKey(scope);
  localStorage.setItem(key, "not-json");
  assert.equal(readNotebookViewState(scope), null);
  assert.equal(localStorage.getItem(key), null);
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, body: "private body" }),
  );
  assert.equal(readNotebookViewState(scope), null);
});

test("bounds scoped storage by evicting the oldest notebook positions", () => {
  const { localStorage } = installStorage();
  for (let index = 0; index < 40; index += 1) {
    localStorage.setItem(
      `luca.notebook-view.v1:old-${index}`,
      JSON.stringify({
        version: 1,
        view: "notes",
        selected: null,
        listAnchor: null,
        detailAnchor: null,
        updatedAt: index,
      }),
    );
  }
  writeNotebookViewState(scope, {
    version: 1,
    view: "pages",
    selected: null,
    listAnchor: null,
    detailAnchor: null,
  });
  assert.equal(localStorage.getItem("luca.notebook-view.v1:old-0"), null);
  assert.notEqual(localStorage.getItem("luca.notebook-view.v1:old-39"), null);
});

test("disabled localStorage degrades to an in-memory-only view", () => {
  globalThis.window = {};
  Object.defineProperty(globalThis.window, "localStorage", {
    get() {
      throw new Error("storage disabled");
    },
  });
  assert.equal(readNotebookViewState(scope), null);
  assert.equal(
    writeNotebookViewState(scope, {
      version: 1,
      view: "notes",
      selected: null,
      listAnchor: null,
      detailAnchor: null,
    }),
    false,
  );
});

test("late notebook responses cannot apply after resident or workspace changes", () => {
  const request = {
    residentPubkey: "resident-a",
    scopeKey: "a",
    generation: 4,
  };
  assert.equal(isNotebookRequestCurrent(request, request), true);
  assert.equal(
    isNotebookRequestCurrent(request, {
      ...request,
      residentPubkey: "resident-b",
    }),
    false,
  );
  assert.equal(
    isNotebookRequestCurrent(request, { ...request, scopeKey: "b" }),
    false,
  );
  assert.equal(
    isNotebookRequestCurrent(request, { ...request, generation: 5 }),
    false,
  );
});
