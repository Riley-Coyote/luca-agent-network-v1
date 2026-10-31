import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionAsk } from "./ManagedAsks.tsx";

function draw({ surface = true, remember = false, request } = {}) {
  return renderToStaticMarkup(
    createElement(PermissionAsk, {
      common: { "data-testid": "ask" },
      pending: {
        pendingId: "permission-1",
        offer: {
          deny: true,
          once: true,
          alwaysHere: remember,
          projectLabel: "Studio",
        },
        request: request ?? {
          protocol: "luca.managed.permission.v1",
          title: "Read records",
          actionPreview: "find ./ -name '*.jsonl'",
        },
      },
      surface,
      summary: "Luca asks",
    }),
  );
}
function choices(html) {
  return [...html.matchAll(/data-permission-choice="([^"]+)"/g)].map(
    (m) => m[1],
  );
}
test("conversation sheets put one-time approval last without inventing durable access", () => {
  const html = draw();
  assert.deepEqual(choices(html), ["deny", "once"]);
  assert.match(html, /Allow once/);
  assert.match(html, /Luca asks · In Studio/);
  assert.doesNotMatch(html, /Always here/);
});
test("remembered access remains explicit, before the one-time action", () => {
  const html = draw({ remember: true });
  assert.deepEqual(choices(html), ["deny", "always", "once"]);
  assert.match(html, /Always here/);
});
test("Activity and agent-page rows keep their existing labels and order", () => {
  const html = draw({ surface: false, remember: true });
  assert.deepEqual(choices(html), ["deny", "once", "always"]);
  assert.doesNotMatch(html, /Allow once|data-permission-surface/);
});
test("structured high-impact requests never acquire a remembered option", () => {
  const html = draw({
    remember: true,
    request: {
      protocol: "luca.managed.permission.v2",
      capability: "destructive_action",
      risk: "high_impact",
      operation: "Delete selected records",
      resource: { displayName: "Selected records" },
    },
  });
  assert.deepEqual(choices(html), ["deny", "once"]);
  assert.match(html, /Delete selected records/);
});
