import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  createHarnessCatalogueRenewalGate,
  harnessCatalogueRefreshInterval,
  harnessTranscriptPlaceholder,
  harnessTranscriptRefreshInterval,
} from "./hooks.ts";

describe("selected harness transcript refresh", () => {
  it("refreshes only a visible selected send-capable session", () => {
    assert.equal(harnessTranscriptRefreshInterval(true, true), 4_000);
    assert.equal(harnessTranscriptRefreshInterval(false, true), false);
    assert.equal(harnessTranscriptRefreshInterval(true, false), false);
    assert.equal(harnessTranscriptRefreshInterval(false, false), false);
    assert.equal(harnessCatalogueRefreshInterval(true, true), 240_000);
    assert.equal(harnessCatalogueRefreshInterval(false, true), false);
    assert.equal(harnessCatalogueRefreshInterval(true, false), false);
  });

  it("retains text across handle renewal but never across owner or native selection", () => {
    const text = {
      messages: [{ role: "assistant", text: "Existing native text" }],
    };
    assert.equal(
      harnessTranscriptPlaceholder(
        text,
        "owner:relay-a:session-a",
        "owner:relay-a:session-a",
      ),
      text,
    );
    assert.equal(
      harnessTranscriptPlaceholder(
        text,
        "owner:relay-a:session-a",
        "owner:relay-b:session-a",
      ),
      undefined,
    );
    assert.equal(
      harnessTranscriptPlaceholder(
        text,
        "owner:relay-a:session-a",
        "owner:relay-a:session-b",
      ),
      undefined,
    );
  });

  it("bounds error-driven exact catalogue renewal to once a minute", () => {
    const allow = createHarnessCatalogueRenewalGate();
    assert.equal(allow(0), true);
    assert.equal(allow(4_000), false);
    assert.equal(allow(59_999), false);
    assert.equal(allow(60_000), true);
    assert.equal(allow(64_000), false);
    assert.equal(allow(120_000), true);
  });

  it("coalesces a refresh with an in-flight read while retaining existing text", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = [
      "harness-transcript",
      "exact-owner-and-selection",
      "source-a",
      "session-a",
    ];
    const old = { messages: ["Existing native text"] };
    client.setQueryData(key, old);
    let reads = 0;
    let finish;
    const options = {
      queryKey: key,
      staleTime: 0,
      queryFn: () => {
        reads += 1;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    try {
      const first = client.fetchQuery(options);
      const second = client.fetchQuery(options);
      assert.equal(reads, 1);
      assert.equal(client.getQueryData(key), old);
      finish({ messages: ["Existing native text", "New native reply"] });
      await Promise.all([first, second]);
      assert.deepEqual(client.getQueryData(key).messages, [
        "Existing native text",
        "New native reply",
      ]);
    } finally {
      client.clear();
    }
  });

  it("a late old-source read cannot replace another exact selection", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const firstKey = [
      "harness-transcript",
      "owner:relay-a:session-a",
      "source-a",
      "session-a",
    ];
    const secondKey = [
      "harness-transcript",
      "owner:relay-a:session-b",
      "source-a",
      "session-b",
    ];
    let finishOld;
    try {
      const old = client.fetchQuery({
        queryKey: firstKey,
        queryFn: () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      });
      await client.fetchQuery({
        queryKey: secondKey,
        queryFn: async () => ({ messages: ["Selected session B"] }),
      });
      finishOld({ messages: ["Late session A"] });
      await old;
      assert.deepEqual(client.getQueryData(secondKey).messages, [
        "Selected session B",
      ]);
    } finally {
      client.clear();
    }
  });
});
