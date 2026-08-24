import assert from "node:assert/strict";
import test from "node:test";

import { describeConnectionError } from "./connectionStatusCopy.ts";

/**
 * The rule this file exists to keep: nothing the relay says reaches the owner.
 *
 * The regression it guards is not hypothetical. A nine-hour dead-backend
 * session put `relay returned 404 Not Found: relay: no community is configured
 * for this host` in the sidebar, in red, for the whole session — an HTTP status
 * and the relay's internal vocabulary, with no icon, no container, and nothing
 * to do about it. The failure mode is that the raw string is always the easiest
 * thing to render, so the guard is a test rather than a convention.
 */
const LEAKS = [
  /\b\d{3}\b/, // an HTTP status
  /relay/i, // the backend's name for itself
  /http|json|null|undefined|error:/i,
];

function assertNoLeak(copy, from) {
  for (const text of [copy.title, copy.detail]) {
    for (const leak of LEAKS) {
      assert.ok(
        !leak.test(text),
        `"${text}" (from ${JSON.stringify(from)}) leaks ${leak}`,
      );
    }
    assert.ok(text.length > 0, "copy must not be empty");
  }
}

const REAL_BACKEND_STRINGS = [
  // buzz-relay/src/router.rs, via relay.rs's `relay returned {status}: {msg}`.
  "relay returned 404 Not Found: relay: no community is configured for this host",
  "relay returned 401 Unauthorized: auth required",
  "relay returned 403 Forbidden",
  "relay rate-limited: retry in 30s",
  "relay rate-limited: quota exceeded",
  "relay returned 500 Internal Server Error",
  "relay returned 503",
  "relay returned malformed response: not valid JSON",
  // And the shapes nobody planned for.
  "",
  undefined,
  "something nobody has seen before",
];

test("no backend string reaches the owner", () => {
  for (const raw of REAL_BACKEND_STRINGS) {
    assertNoLeak(describeConnectionError(raw), raw);
  }
});

test("the cause is named when the backend gives us one to name", () => {
  assert.match(
    describeConnectionError(
      "relay returned 404 Not Found: relay: no community is configured for this host",
    ).title,
    /community/i,
  );
  assert.match(
    describeConnectionError("relay returned 401 Unauthorized: auth required")
      .title,
    /refused/i,
  );
  assert.match(
    describeConnectionError("relay rate-limited: retry in 30s").detail,
    /on its own/i,
  );
  assert.match(describeConnectionError("relay returned 503").title, /trouble/i);
});

test("an unrecognised failure admits the effect instead of guessing the cause", () => {
  const generic = describeConnectionError("something nobody has seen before");
  assert.equal(generic.title, describeConnectionError(undefined).title);
  assert.match(generic.title, /can't load/i);
});
