import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginRelayOriginFetch,
  getCachedRelayOrigin,
  mediaProxyUrl,
  resetMediaCaches,
  subscribeRelayOrigin,
  withDeadline,
} from "./mediaUrl.ts";

const HASH = "a".repeat(64);

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("mediaProxyUrl: uses the IPv4 loopback literal for the localhost proxy", () => {
  assert.equal(
    mediaProxyUrl(54321, `${HASH}.png`),
    `http://127.0.0.1:54321/media/${HASH}.png`,
  );
});

test("relay-origin store: publishes are canonicalized at the store boundary", () => {
  // The store must hold the invariant that `cachedRelayOrigin` is always a
  // canonical URL origin — consumers compare `new URL(src).origin` against it
  // (isRelayDownloadable), which is safe only by this construction, not by
  // call-site convention.
  resetMediaCaches();
  let notifications = 0;
  const unsubscribe = subscribeRelayOrigin(() => notifications++);

  // Uppercase host + trailing slash + explicit default port → canonical form.
  beginRelayOriginFetch()("https://RELAY.Example:443/");
  assert.equal(getCachedRelayOrigin(), "https://relay.example");
  assert.equal(notifications, 1);

  // A differently-shaped publish of the same canonical origin is a no-op for
  // both the snapshot and the listeners.
  beginRelayOriginFetch()("https://relay.example");
  assert.equal(getCachedRelayOrigin(), "https://relay.example");
  assert.equal(notifications, 1);

  // Invalid non-null input fails closed to null (does not retain the previous
  // origin, does not publish an arbitrary string) and notifies the change.
  beginRelayOriginFetch()("not a url");
  assert.equal(getCachedRelayOrigin(), null);
  assert.equal(notifications, 2);

  // Stale-generation publishes are still rejected before canonicalization.
  const stale = beginRelayOriginFetch();
  resetMediaCaches();
  stale("https://STALE.example/");
  assert.equal(getCachedRelayOrigin(), null);

  unsubscribe();
  resetMediaCaches();
});

test("relay-origin store: a resolved origin publishes and notifies subscribers", () => {
  resetMediaCaches();
  let notifications = 0;
  const unsubscribe = subscribeRelayOrigin(() => notifications++);

  const publish = beginRelayOriginFetch();
  publish("https://relay.example");

  assert.equal(getCachedRelayOrigin(), "https://relay.example");
  assert.equal(notifications, 1);

  unsubscribe();
  resetMediaCaches();
});

test("relay-origin store: unsubscribe removes exactly its own listener", () => {
  resetMediaCaches();
  let kept = 0;
  let dropped = 0;
  const unsubscribeKept = subscribeRelayOrigin(() => kept++);
  const unsubscribeDropped = subscribeRelayOrigin(() => dropped++);

  // Dropping one listener must not affect the other.
  unsubscribeDropped();
  beginRelayOriginFetch()("https://relay.example");
  assert.equal(kept, 1);
  assert.equal(dropped, 0);

  unsubscribeKept();
  resetMediaCaches();
});

test("relay-origin store: reset notifies only on an actual snapshot change", () => {
  resetMediaCaches();
  let notifications = 0;
  const unsubscribe = subscribeRelayOrigin(() => notifications++);

  // Origin already null → reset is a no-op for listeners.
  resetMediaCaches();
  assert.equal(notifications, 0);

  // Now resolve, then reset: the reset clears a non-null origin, so it fires.
  beginRelayOriginFetch()("https://relay.example");
  assert.equal(notifications, 1);
  resetMediaCaches();
  assert.equal(getCachedRelayOrigin(), null);
  assert.equal(notifications, 2);

  unsubscribe();
});

test("relay-origin store: a late fetch from the previous community never regresses the snapshot", () => {
  resetMediaCaches();
  const unsubscribe = subscribeRelayOrigin(() => {});

  // Community A starts a fetch, then the user switches workspaces (reset),
  // then community B starts its own fetch.
  const publishA = beginRelayOriginFetch();
  resetMediaCaches();
  const publishB = beginRelayOriginFetch();

  // A resolves late — its generation is stale, so it must be discarded.
  publishA("https://relay-a.example");
  assert.equal(getCachedRelayOrigin(), null);

  // B resolves — it is current, so it wins.
  publishB("https://relay-b.example");
  assert.equal(getCachedRelayOrigin(), "https://relay-b.example");

  // A late duplicate from A after B must still not clobber B.
  publishA("https://relay-a.example");
  assert.equal(getCachedRelayOrigin(), "https://relay-b.example");

  unsubscribe();
  resetMediaCaches();
});

test("relay-origin store: a failed attempt then a later success publishes exactly once", () => {
  // Mirrors the `fetchProxyPort` retry loop: each poll attempt calls
  // `beginRelayOriginFetch()` and only publishes if the invoke resolves. An
  // early attempt whose invoke rejects (Tauri bridge not ready) never calls its
  // publisher, so nothing is published; a later attempt succeeds and publishes.
  resetMediaCaches();
  let notifications = 0;
  const unsubscribe = subscribeRelayOrigin(() => notifications++);

  // Attempt 1: invoke rejects — publisher is never invoked.
  beginRelayOriginFetch();
  assert.equal(getCachedRelayOrigin(), null);
  assert.equal(notifications, 0);

  // Attempt 2: invoke resolves — publishes once, notifies once.
  beginRelayOriginFetch()("https://relay.example");
  assert.equal(getCachedRelayOrigin(), "https://relay.example");
  assert.equal(notifications, 1);

  unsubscribe();
  resetMediaCaches();
});

test("relay-origin store: a reset between a failed attempt and its late success discards the stale result", () => {
  // A workspace switch (reset) during the retry sequence must invalidate a
  // still-in-flight attempt from the previous community, even if that attempt
  // eventually resolves after the switch.
  resetMediaCaches();
  const unsubscribe = subscribeRelayOrigin(() => {});

  // Attempt from community A begins, then the user switches (reset), then a
  // fresh attempt from community B begins and succeeds.
  const publishA = beginRelayOriginFetch();
  resetMediaCaches();
  beginRelayOriginFetch()("https://relay-b.example");
  assert.equal(getCachedRelayOrigin(), "https://relay-b.example");

  // A's invoke finally resolves late — stale generation, so it is dropped.
  publishA("https://relay-a.example");
  assert.equal(getCachedRelayOrigin(), "https://relay-b.example");

  unsubscribe();
  resetMediaCaches();
});

test("withDeadline: a never-settling invoke resolves to null at the deadline", async () => {
  // The poll loop bounds each invoke by the remaining budget so a wedged IPC
  // bridge (a promise that never settles) can't hang startup past the timeout.
  const neverSettles = new Promise(() => {});
  const result = await withDeadline(neverSettles, Date.now() + 20);
  assert.equal(result, null);
});

test("withDeadline: a value that settles before the deadline is returned", async () => {
  const result = await withDeadline(
    Promise.resolve("http://relay.example"),
    Date.now() + 1000,
  );
  assert.equal(result, "http://relay.example");
});

test("withDeadline: an already-passed deadline resolves to null without awaiting", async () => {
  const result = await withDeadline(new Promise(() => {}), Date.now() - 1);
  assert.equal(result, null);
});

test("withDeadline: a rejection before the deadline propagates to the caller", async () => {
  await assert.rejects(
    withDeadline(Promise.reject(new Error("ipc failed")), Date.now() + 1000),
    /ipc failed/,
  );
});

test("withDeadline: a rejection after the deadline is observed, not unhandled", async () => {
  // The timeout wins first (deadline ~10ms), then the invoke rejects ~30ms
  // later. That late rejection must be swallowed by the internal no-op catch,
  // not surface as an unhandled rejection. Register a listener to prove it.
  let unhandled;
  const onUnhandled = (reason) => {
    unhandled = reason;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const slowReject = new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("late ipc failure")), 30),
    );
    const result = await withDeadline(slowReject, Date.now() + 10);
    assert.equal(result, null);
    // Give the late rejection time to fire and be (not) reported.
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(unhandled, undefined);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("resetMediaCaches: ignores relay origin lookups from the previous generation", async () => {
  const previousWindow = globalThis.window;
  const staleOrigin = deferred();
  let relayOriginCalls = 0;

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        if (command === "get_relay_http_url") {
          relayOriginCalls += 1;
          return relayOriginCalls === 1
            ? staleOrigin.promise
            : Promise.resolve("https://active.example");
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };

  try {
    // A unique URL triggers module-load fetching with the stale relay lookup
    // still unresolved, matching a cold launch before applyCommunity finishes.
    const mediaUrl = await import(`./mediaUrl.ts?race=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    mediaUrl.resetMediaCaches();
    const activeUrl = `https://active.example/media/${HASH}.png`;
    mediaUrl.rewriteRelayUrl(activeUrl);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Complete the old lookup after reset. It must not overwrite the active
    // community origin fetched by the new generation.
    staleOrigin.resolve("https://stale.example");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      mediaUrl.rewriteRelayUrl(activeUrl),
      `http://127.0.0.1:54321/media/${HASH}.png`,
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("rewriteRelayUrl: matches relay origin case-insensitively (uppercase saved community URL)", async () => {
  const previousWindow = globalThis.window;

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        if (command === "get_relay_http_url") {
          // Saved community URLs keep the user's casing; the relay always
          // emits lowercased media URLs (normalize_host in buzz-core).
          return Promise.resolve("https://PENDING-SEED.communities.buzz.xyz");
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };

  try {
    const mediaUrl = await import(`./mediaUrl.ts?case=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const relayMediaUrl = `https://pending-seed.communities.buzz.xyz/media/${HASH}.png`;
    assert.equal(
      mediaUrl.rewriteRelayUrl(relayMediaUrl),
      `http://127.0.0.1:54321/media/${HASH}.png`,
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("rewriteRelayUrl: still passes external Blossom URLs through unchanged", async () => {
  const previousWindow = globalThis.window;

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        if (command === "get_relay_http_url") {
          return Promise.resolve("https://relay.example");
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };

  try {
    const mediaUrl = await import(`./mediaUrl.ts?external=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const externalUrl = `https://nostr.build/media/${HASH}.png`;
    assert.equal(mediaUrl.rewriteRelayUrl(externalUrl), externalUrl);
  } finally {
    globalThis.window = previousWindow;
  }
});

async function withRoutingContext(context, run) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        if (command === "get_media_routing_context")
          return Promise.resolve(context);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };
  try {
    const media = await import(`./mediaUrl.ts?routing=${Math.random()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await run(media);
  } finally {
    globalThis.window = previousWindow;
  }
}

test("local recovery: stale port uses guarded native route without changing saved URL", async () => {
  await withRoutingContext(
    { relayOrigin: "http://127.0.0.1:61234", supervisedLocal: true },
    (media) => {
      const saved = `http://127.0.0.1:51477/media/${HASH}.png`;
      assert.equal(
        media.rewriteRelayUrl(saved),
        `http://127.0.0.1:54321/media/${HASH}.png?buzz_local_recovery=1`,
      );
      assert.equal(saved, `http://127.0.0.1:51477/media/${HASH}.png`);
      assert.equal(
        media.rewriteRelayUrl(`http://127.0.0.1:61234/media/${HASH}.png`),
        `http://127.0.0.1:54321/media/${HASH}.png`,
      );
      assert.equal(
        media.rewriteRelayUrl(`http://localhost:51477/media/${HASH}.thumb.jpg`),
        `http://127.0.0.1:54321/media/${HASH}.thumb.jpg?buzz_local_recovery=1`,
      );
    },
  );
});

test("local recovery: unavailable authority and remote communities never dial the stale port", async () => {
  const stale = `http://127.0.0.1:51477/media/${HASH}.png`;
  for (const context of [
    { relayOrigin: "http://127.0.0.1:61234", supervisedLocal: false },
    { relayOrigin: "https://community.example", supervisedLocal: false },
  ]) {
    await withRoutingContext(context, (media) => {
      assert.equal(media.rewriteRelayUrl(stale), "about:blank");
      const exact = `${context.relayOrigin}/media/${HASH}.png`;
      assert.equal(
        media.rewriteRelayUrl(exact),
        `http://127.0.0.1:54321/media/${HASH}.png`,
      );
      const external = `https://external.example/media/${HASH}.png`;
      assert.equal(media.rewriteRelayUrl(external), external);
    });
  }
});

test("local recovery: rejects credentials, query, traversal and non-content-addressed paths", async () => {
  await withRoutingContext(
    { relayOrigin: "http://127.0.0.1:61234", supervisedLocal: true },
    (media) => {
      for (const raw of [
        `http://user:secret@127.0.0.1:51477/media/${HASH}.png`,
        `http://@127.0.0.1:51477/media/${HASH}.png`,
        `http://127.0.0.1:51477/media/${HASH}.png?token=secret`,
        `http://127.0.0.1:51477/media/${HASH}.png#fragment`,
        `http://127.0.0.1:51477/other/../media/${HASH}.png`,
        `http://127.0.0.1:51477/media/%2e%2e/${HASH}.png`,
        `http://127.0.0.1:51477/media/${HASH}.png/extra`,
        `http://127.0.0.1:51477/media/short.png`,
        `http://127.0.0.1:51477/media/${HASH}.html`,
        `http://192.168.1.1/media/${HASH}.png`,
      ]) {
        assert.ok(
          !media.rewriteRelayUrl(raw).includes("buzz_local_recovery"),
          raw,
        );
      }
    },
  );
});

test("local recovery: reset discards the supervised hint immediately", async () => {
  await withRoutingContext(
    { relayOrigin: "http://127.0.0.1:61234", supervisedLocal: true },
    (media) => {
      media.resetMediaCaches();
      assert.equal(
        media.rewriteRelayUrl(`http://127.0.0.1:51477/media/${HASH}.png`),
        "about:blank",
      );
    },
  );
});

test("local recovery: subscribed cold/reset renders become guarded routes when context is ready", async () => {
  const previousWindow = globalThis.window;
  let pending = deferred();
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_routing_context") return pending.promise;
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };
  try {
    const media = await import(`./mediaUrl.ts?delayed=${Math.random()}`);
    const saved = `http://127.0.0.1:51477/media/${HASH}.png`;
    const rendered = [media.rewriteRelayUrl(saved)];
    const unsubscribe = media.subscribeRelayOrigin(() =>
      rendered.push(media.rewriteRelayUrl(saved)),
    );
    assert.equal(rendered.at(-1), "about:blank");
    pending.resolve({
      relayOrigin: "http://127.0.0.1:61234",
      supervisedLocal: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(rendered.at(-1), /buzz_local_recovery=1$/);
    assert.ok(!rendered.at(-1).includes(":51477"));

    pending = deferred();
    media.resetMediaCaches();
    assert.equal(rendered.at(-1), "about:blank");
    pending.resolve({
      relayOrigin: "http://127.0.0.1:61235",
      supervisedLocal: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(rendered.at(-1), /buzz_local_recovery=1$/);
    unsubscribe();
  } finally {
    globalThis.window = previousWindow;
  }
});

test("routing snapshot: a deferred proxy port refreshes the same-origin protocol fallback", async () => {
  const previousWindow = globalThis.window;
  const port = deferred();
  const origin = "http://127.0.0.1:61234";
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_routing_context")
          return Promise.resolve({
            relayOrigin: origin,
            supervisedLocal: true,
          });
        if (command === "get_media_proxy_port") return port.promise;
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };
  try {
    const media = await import(`./mediaUrl.ts?port=${Math.random()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = `http://127.0.0.1:51477/media/${HASH}.png`;
    const before = media.getMediaRoutingSnapshot();
    assert.equal(before.relayOrigin, origin);
    assert.equal(before.proxyPort, null);
    assert.equal(
      media.rewriteRelayUrl(saved),
      `buzz-media://localhost/media/${HASH}.png?buzz_local_recovery=1`,
    );
    const renders = [];
    const unsubscribe = media.subscribeRelayOrigin(() =>
      renders.push(media.rewriteRelayUrl(saved)),
    );
    port.resolve(54321);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(renders, [
      `http://127.0.0.1:54321/media/${HASH}.png?buzz_local_recovery=1`,
    ]);
    const after = media.getMediaRoutingSnapshot();
    assert.notEqual(after, before);
    assert.equal(after.relayOrigin, before.relayOrigin);
    assert.equal(after.proxyPort, 54321);
    assert.equal(media.getMediaRoutingSnapshot(), after);
    unsubscribe();
  } finally {
    globalThis.window = previousWindow;
  }
});

test("routing snapshot: same-origin hint and reset changes publish without changing origin API", async () => {
  const previousWindow = globalThis.window;
  let context = deferred();
  const origin = "http://127.0.0.1:61234";
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        if (command === "get_media_routing_context") return context.promise;
        if (command === "get_media_proxy_port") return Promise.resolve(54321);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    },
  };
  try {
    const media = await import(`./mediaUrl.ts?hint=${Math.random()}`);
    media.beginRelayOriginFetch()(origin);
    const saved = `http://127.0.0.1:51477/media/${HASH}.png`;
    const before = media.getMediaRoutingSnapshot();
    assert.equal(before.supervisedLocal, false);
    const snapshots = [];
    const unsubscribe = media.subscribeRelayOrigin(() =>
      snapshots.push(media.getMediaRoutingSnapshot()),
    );
    context.resolve({ relayOrigin: origin, supervisedLocal: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(
      snapshots.some(
        (snapshot) =>
          snapshot.relayOrigin === origin &&
          snapshot.supervisedLocal &&
          snapshot.proxyPort === null,
      ),
    );
    assert.equal(media.getCachedRelayOrigin(), origin);
    assert.match(media.rewriteRelayUrl(saved), /buzz_local_recovery=1$/);

    context = deferred();
    media.resetMediaCaches();
    assert.deepEqual(snapshots.at(-1), {
      relayOrigin: null,
      proxyPort: null,
      supervisedLocal: false,
    });
    assert.equal(media.rewriteRelayUrl(saved), "about:blank");
    context.resolve({ relayOrigin: origin, supervisedLocal: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(media.getMediaRoutingSnapshot(), {
      relayOrigin: origin,
      proxyPort: 54321,
      supervisedLocal: true,
    });
    assert.equal(media.getCachedRelayOrigin(), origin);
    unsubscribe();
  } finally {
    globalThis.window = previousWindow;
  }
});
