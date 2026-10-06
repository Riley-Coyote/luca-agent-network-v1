import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import {
  listPendingManagedInputs,
  resolveManagedInput,
  listenForManagedInputChanges,
  MANAGED_INPUT_REFRESH_EVENT,
} from "@/shared/api/managedInputs";
import { ManagedInputCard } from "./ui/ManagedInputCard.tsx";

beforeEach(() => {
  globalThis.window = Object.assign(new EventTarget(), {
    crypto: globalThis.crypto,
  });
});
afterEach(() => {
  clearMocks();
  delete globalThis.window;
});

const fields = [
  {
    key: "note",
    label: "Note",
    kind: "text",
    description: null,
    options: [],
    required: true,
  },
  {
    key: "choice",
    label: "Choice",
    kind: "single",
    description: null,
    options: [
      { value: "exact_value", label: "Exact label", description: null },
    ],
    required: true,
  },
  {
    key: "many",
    label: "Several",
    kind: "multiple",
    description: null,
    options: [{ value: "item_1", label: "Item one", description: "Why" }],
    required: true,
  },
];
const raw = {
  pendingId: "opaque-question-id",
  request: {
    conversation_id: "exact-conversation",
    resident_pubkey: "exact-resident",
    message: "A question, not permission",
    fields,
    provider_session_id: "not-for-renderer",
  },
};

test("maps exact native scope and opaque choice values without session metadata", async () => {
  mockIPC((command) => {
    assert.equal(command, "list_pending_managed_inputs");
    return [raw];
  });
  assert.deepEqual(await listPendingManagedInputs(), [
    {
      pendingId: raw.pendingId,
      request: {
        conversationId: raw.request.conversation_id,
        residentPubkey: raw.request.resident_pubkey,
        message: raw.request.message,
        fields,
      },
    },
  ]);
});

test("answers exactly once through native command and signals body-free reconciliation", async () => {
  const calls = [];
  const events = [];
  window.addEventListener(MANAGED_INPUT_REFRESH_EVENT, (event) =>
    events.push(event),
  );
  mockIPC((command, payload) => calls.push({ command, payload }));
  const answers = {
    note: "Private answer",
    choice: "exact_value",
    many: ["item_1"],
  };
  await resolveManagedInput("exact-pending", "answered", answers);
  assert.deepEqual(calls, [
    {
      command: "resolve_managed_input",
      payload: { pendingId: "exact-pending", action: "answered", answers },
    },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, { pendingId: "exact-pending" });
});

for (const action of ["declined", "cancelled"]) {
  test(`${action} never forwards a populated answer draft`, async () => {
    mockIPC((command, payload) => {
      assert.equal(command, "resolve_managed_input");
      assert.deepEqual(payload, {
        pendingId: "exact-pending",
        action,
        answers: {},
      });
    });
    await resolveManagedInput("exact-pending", action, {
      note: "Private draft",
    });
  });
}

test("failed stale decision preserves rejection and never signals success", async () => {
  let refreshed = false;
  window.addEventListener(MANAGED_INPUT_REFRESH_EVENT, () => {
    refreshed = true;
  });
  mockIPC(() => {
    throw new Error("stale session epoch");
  });
  await assert.rejects(
    resolveManagedInput("stale-id", "answered", {}),
    /stale session epoch/,
  );
  assert.equal(refreshed, false);
});

test("subscribes to pending and resolved events and fully detaches", async () => {
  mockIPC(() => {}, { shouldMockEvents: true });
  let changed = 0;
  const stop = await listenForManagedInputChanges(() => changed++);
  await emit("managed-input-pending", {});
  await emit("managed-input-resolved", {});
  assert.equal(changed, 2);
  stop();
  assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0);
});

test("partial event registration failure detaches its successful sibling", async () => {
  const stopped = [];
  mockIPC((command, payload) => {
    if (command === "plugin:event|listen") {
      if (payload.event === "managed-input-resolved")
        throw new Error("registration unavailable");
      return 17;
    }
    if (command === "plugin:event|unlisten") stopped.push(payload.event);
  });
  await assert.rejects(
    listenForManagedInputChanges(() => {}),
    /registration unavailable/,
  );
  assert.deepEqual(stopped, ["managed-input-pending"]);
});

test("card reuses approval styling, semantic fields, wrapping, and no access buttons", () => {
  const pending = {
    pendingId: raw.pendingId,
    request: {
      ...raw.request,
      conversationId: "exact-conversation",
      residentPubkey: "exact-resident",
    },
  };
  const markup = renderToStaticMarkup(
    createElement(ManagedInputCard, { pending, compact: true }),
  );
  assert.match(markup, /Agent question required/);
  assert.match(markup, /class="p-3"/);
  assert.match(markup, /border-border bg-card text-card-foreground/);
  assert.match(markup, /<fieldset/);
  assert.match(markup, /type="radio"/);
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /flex flex-wrap items-center justify-end/);
  assert.match(markup, /does not approve tools or change access/);
  assert.match(markup, />Skip</);
  assert.match(markup, />Send answer</);
  assert.doesNotMatch(
    markup,
    />Allow|>Always|>Cancel question|not-for-renderer/,
  );
});
