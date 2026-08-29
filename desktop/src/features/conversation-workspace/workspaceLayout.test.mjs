import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultWorkspaceLayout,
  dockConversationInWorkspace,
  loadWorkspaceLayout,
  openConversationInNewPane,
  parseWorkspaceLayout,
  projectWorkspaceLayout,
  reconcileWorkspaceConversations,
  reduceWorkspaceLayout,
  saveWorkspaceLayout,
  setWorkspacePreset,
  WORKSPACE_SLOT_IDS,
  workspaceConversationEquals,
  workspaceLayoutStorageKey,
  workspaceSlot,
} from "./workspaceLayout.ts";

const OWNER = "a".repeat(64);
const SCOPE = { ownerPubkey: OWNER, workspaceId: "personal" };

function ref(channelId, projectId) {
  return projectId ? { channelId, projectId } : { channelId };
}

function replace(layout, conversation, slotId) {
  return reduceWorkspaceLayout(layout, {
    type: "replace-active-tab",
    conversation,
    slotId,
  });
}

function openPane(layout, conversation) {
  return openConversationInNewPane(layout, conversation).layout;
}

test("default layout is a visible single pane with four fixed empty slots", () => {
  const layout = createDefaultWorkspaceLayout();
  assert.equal(layout.version, 1);
  assert.equal(layout.preset, "single");
  assert.equal(layout.focusedSlotId, "slot-1");
  assert.equal(layout.visibility, "visible");
  assert.deepEqual(
    layout.slots.map(({ id }) => id),
    WORKSPACE_SLOT_IDS,
  );
  assert.equal(layout.slots.length, 4);
  assert.ok(layout.slots.every((slot) => slot.conversations.length === 0));
});

test("storage keys are versioned and owner/workspace scoped", () => {
  assert.equal(
    workspaceLayoutStorageKey(SCOPE),
    `luca.conversation-workspace.v1:${OWNER}:personal`,
  );
  assert.notEqual(
    workspaceLayoutStorageKey(SCOPE),
    workspaceLayoutStorageKey({ ...SCOPE, workspaceId: "studio" }),
  );
  assert.equal(
    workspaceLayoutStorageKey({ ownerPubkey: "invalid", workspaceId: "x" }),
    null,
  );
});

test("corrupt and unknown layouts fail closed to one empty focused pane", () => {
  for (const raw of [
    "not-json",
    JSON.stringify({ version: 2, preset: "grid-4" }),
    JSON.stringify({ version: 1, preset: "future-layout" }),
  ]) {
    assert.deepEqual(parseWorkspaceLayout(raw), createDefaultWorkspaceLayout());
  }
});

test("parsing keeps only opaque references, dedupes tabs, and repairs focus", () => {
  const parsed = parseWorkspaceLayout(
    JSON.stringify({
      version: 1,
      preset: "columns-2",
      focusedSlotId: "slot-4",
      visibility: "hidden",
      extraState: { prompt: "must not survive" },
      slots: [
        {
          id: "slot-1",
          conversations: [
            { channelId: "alpha", label: "discard me", path: "/private" },
            { channelId: "alpha" },
            { channelId: "project-room", projectId: "project-a" },
            { channelId: "" },
          ],
          activeTab: { channelId: "missing" },
        },
        {
          id: "slot-2",
          conversations: [{ channelId: "beta" }],
          activeTab: { channelId: "beta" },
        },
        {
          id: "slot-3",
          conversations: [{ channelId: "stale-hidden" }],
          activeTab: { channelId: "stale-hidden" },
        },
      ],
    }),
  );

  assert.equal(parsed.focusedSlotId, "slot-1");
  assert.equal(parsed.visibility, "hidden");
  assert.deepEqual(workspaceSlot(parsed, "slot-1"), {
    id: "slot-1",
    conversations: [ref("alpha"), ref("project-room", "project-a")],
    activeTab: ref("alpha"),
  });
  assert.deepEqual(workspaceSlot(parsed, "slot-3").conversations, []);
  assert.equal(JSON.stringify(parsed).includes("discard me"), false);
  assert.equal(JSON.stringify(parsed).includes("/private"), false);
});

test("best-effort persistence canonicalizes data and tolerates storage failure", () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const layout = replace(createDefaultWorkspaceLayout(), {
    channelId: "alpha",
    label: "not part of the schema",
  });
  assert.equal(saveWorkspaceLayout(storage, SCOPE, layout), true);
  assert.deepEqual(loadWorkspaceLayout(storage, SCOPE), layout);
  assert.equal([...entries.values()][0].includes("label"), false);

  const brokenStorage = {
    getItem: () => {
      throw new Error("locked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.deepEqual(
    loadWorkspaceLayout(brokenStorage, SCOPE),
    createDefaultWorkspaceLayout(),
  );
  assert.equal(
    saveWorkspaceLayout(brokenStorage, SCOPE, createDefaultWorkspaceLayout()),
    false,
  );
});

test("focus, replacement, and tab selection stay pane-scoped", () => {
  let layout = setWorkspacePreset(createDefaultWorkspaceLayout(), "columns-2");
  layout = replace(layout, ref("one"), "slot-1");
  layout = openPane(layout, ref("two"));
  layout = replace(layout, ref("three"), "slot-1");

  assert.deepEqual(workspaceSlot(layout, "slot-1").conversations, [
    ref("three"),
  ]);
  assert.deepEqual(workspaceSlot(layout, "slot-2").conversations, [ref("two")]);
  assert.equal(layout.focusedSlotId, "slot-1");

  layout = replace(layout, ref("one"), "slot-1");
  layout = reduceWorkspaceLayout(layout, {
    type: "select-tab",
    slotId: "slot-1",
    conversation: ref("one"),
  });
  assert.ok(
    workspaceConversationEquals(
      workspaceSlot(layout, "slot-1").activeTab,
      ref("one"),
    ),
  );
  assert.equal(layout.focusedSlotId, "slot-1");

  const ignored = reduceWorkspaceLayout(layout, {
    type: "focus-slot",
    slotId: "slot-4",
  });
  assert.equal(ignored, layout);
});

test("Dock focuses an existing copy or appends a tab without replacing one", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  layout = reduceWorkspaceLayout(layout, {
    type: "focus-slot",
    slotId: "slot-1",
  });

  layout = dockConversationInWorkspace(layout, ref("three"));
  assert.deepEqual(workspaceSlot(layout, "slot-1").conversations, [
    ref("one"),
    ref("three"),
  ]);
  assert.deepEqual(workspaceSlot(layout, "slot-1").activeTab, ref("three"));

  layout = reduceWorkspaceLayout(layout, { type: "hide" });
  layout = dockConversationInWorkspace(layout, ref("two"));
  assert.equal(layout.visibility, "visible");
  assert.equal(layout.focusedSlotId, "slot-2");
  assert.deepEqual(workspaceSlot(layout, "slot-2").conversations, [ref("two")]);
});

test("closing an active tab selects its neighbor and the last close stays empty", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("other"));
  layout = replace(layout, ref("two"), "slot-1");
  layout = replace(layout, ref("one"), "slot-1");
  // Replacing the active tab is intentionally not an append; seed two tabs by
  // moving one in from a removed pane during a preset reduction.
  layout = setWorkspacePreset(layout, "single");
  const slot = workspaceSlot(layout, "slot-1");
  assert.deepEqual(slot.conversations, [ref("one"), ref("other")]);

  layout = reduceWorkspaceLayout(layout, {
    type: "close-tab",
    slotId: "slot-1",
    conversation: ref("one"),
  });
  assert.ok(
    workspaceConversationEquals(
      workspaceSlot(layout, "slot-1").activeTab,
      ref("other"),
    ),
  );
  layout = reduceWorkspaceLayout(layout, {
    type: "close-tab",
    slotId: "slot-1",
    conversation: ref("other"),
  });
  assert.deepEqual(workspaceSlot(layout, "slot-1").conversations, []);
  assert.equal(workspaceSlot(layout, "slot-1").activeTab, null);
  assert.equal(layout.preset, "single");
});

test("preset reduction merges removed tabs into the focused surviving slot", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  layout = openPane(layout, ref("three"));
  layout = openPane(layout, ref("four"));
  layout = reduceWorkspaceLayout(layout, {
    type: "focus-slot",
    slotId: "slot-2",
  });
  layout = setWorkspacePreset(layout, "columns-2");

  assert.equal(layout.focusedSlotId, "slot-2");
  assert.deepEqual(workspaceSlot(layout, "slot-2").conversations, [
    ref("two"),
    ref("three"),
    ref("four"),
  ]);
  assert.deepEqual(workspaceSlot(layout, "slot-3").conversations, []);
  assert.deepEqual(workspaceSlot(layout, "slot-4").conversations, []);
});

test("preset reduction preserves focus when the focused slot is removed", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  layout = openPane(layout, ref("three"));
  assert.equal(layout.focusedSlotId, "slot-3");

  layout = setWorkspacePreset(layout, "single");
  assert.equal(layout.focusedSlotId, "slot-1");
  assert.deepEqual(workspaceSlot(layout, "slot-1").conversations, [
    ref("one"),
    ref("two"),
    ref("three"),
  ]);
  assert.ok(
    workspaceConversationEquals(
      workspaceSlot(layout, "slot-1").activeTab,
      ref("three"),
    ),
  );
});

test("open in new pane expands through the smallest presets and refuses pane five", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  const second = openConversationInNewPane(layout, ref("two"));
  assert.equal(second.layout.preset, "columns-2");
  assert.equal(second.slotId, "slot-2");
  layout = second.layout;

  const third = openConversationInNewPane(layout, ref("three"));
  assert.equal(third.layout.preset, "three");
  assert.equal(third.slotId, "slot-3");
  layout = third.layout;

  const fourth = openConversationInNewPane(layout, ref("four"));
  assert.equal(fourth.layout.preset, "grid-4");
  assert.equal(fourth.slotId, "slot-4");
  layout = fourth.layout;

  const refused = openConversationInNewPane(layout, ref("five"));
  assert.equal(refused.opened, false);
  assert.equal(refused.reason, "maximum-panes");
  assert.equal(refused.layout, layout);
});

test("opening an existing conversation focuses its existing pane without duplication", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  const result = openConversationInNewPane(layout, ref("one"));

  assert.equal(result.opened, true);
  assert.equal(result.slotId, "slot-1");
  assert.equal(result.layout.focusedSlotId, "slot-1");
  assert.equal(
    result.layout.slots
      .flatMap((slot) => slot.conversations)
      .filter((conversation) =>
        workspaceConversationEquals(conversation, ref("one")),
      ).length,
    1,
  );
});

test("hide and restore preserve the complete workspace", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  const before = structuredClone(layout);
  const hidden = reduceWorkspaceLayout(layout, { type: "hide" });
  assert.equal(hidden.visibility, "hidden");
  assert.deepEqual({ ...hidden, visibility: "visible" }, before);
  const restored = reduceWorkspaceLayout(hidden, { type: "restore" });
  assert.deepEqual(restored, before);
});

test("compact projection renders only the focused pane without mutating layout", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  layout = openPane(layout, ref("three"));
  const before = structuredClone(layout);

  assert.deepEqual(projectWorkspaceLayout(layout, true), {
    focusedSlotId: "slot-3",
    hidden: false,
    preset: "single",
    visibleSlotIds: ["slot-3"],
  });
  assert.deepEqual(projectWorkspaceLayout(layout, false).visibleSlotIds, [
    "slot-1",
    "slot-2",
    "slot-3",
  ]);
  assert.deepEqual(layout, before);

  const hidden = reduceWorkspaceLayout(layout, { type: "hide" });
  assert.deepEqual(projectWorkspaceLayout(hidden, true).visibleSlotIds, []);
});

test("missing-conversation reconciliation removes only missing tabs", () => {
  let layout = replace(createDefaultWorkspaceLayout(), ref("one"));
  layout = openPane(layout, ref("two"));
  layout = openPane(layout, ref("three", "project-a"));
  const preset = layout.preset;
  const focusedSlotId = layout.focusedSlotId;

  const reconciled = reconcileWorkspaceConversations(layout, [
    ref("one"),
    ref("three", "project-a"),
  ]);
  assert.equal(reconciled.preset, preset);
  assert.equal(reconciled.focusedSlotId, focusedSlotId);
  assert.deepEqual(workspaceSlot(reconciled, "slot-1").conversations, [
    ref("one"),
  ]);
  assert.deepEqual(workspaceSlot(reconciled, "slot-2").conversations, []);
  assert.equal(workspaceSlot(reconciled, "slot-2").activeTab, null);
  assert.deepEqual(workspaceSlot(reconciled, "slot-3").conversations, [
    ref("three", "project-a"),
  ]);
});
