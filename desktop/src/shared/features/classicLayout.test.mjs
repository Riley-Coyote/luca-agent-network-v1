import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CLASSIC_LAYOUT_KEY, readClassicLayout } from "./classicLayout.ts";

const storage = (value) => ({
  getItem: (key) => (key === CLASSIC_LAYOUT_KEY ? value : null),
});

describe("readClassicLayout", () => {
  it("is off until chosen", () => {
    assert.equal(readClassicLayout(storage(null)), false);
    assert.equal(readClassicLayout(undefined), false);
  });

  it("is on only for the stored choice", () => {
    assert.equal(readClassicLayout(storage("1")), true);
    assert.equal(readClassicLayout(storage("true")), false);
  });

  it("is off when storage refuses", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readClassicLayout(refusing), false);
  });
});

describe("index.html's pre-paint script", () => {
  it("reads the same key, so the first paint agrees with the app", () => {
    const html = readFileSync(
      new URL("../../../index.html", import.meta.url),
      "utf8",
    );
    assert.ok(html.includes(`getItem("${CLASSIC_LAYOUT_KEY}") !== "1"`));
  });
});
