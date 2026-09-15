import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelPresence } from "./PanelPresence.tsx";

describe("PanelPresence", () => {
  it("renders the panel it is given", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        PanelPresence,
        null,
        React.createElement("div", null, "drawer"),
      ),
    );
    assert.match(markup, /drawer/);
  });

  it("renders nothing when there is no panel and none was retained", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PanelPresence, null, null),
    );
    assert.equal(markup, "");
  });

  it("captures the retained panel in a ref, never in render-phase state", async () => {
    // JSX children are a fresh object on every parent render, so setting
    // state from the render body re-rendered the whole drawer subtree on
    // every unrelated parent update. Regression guard for that.
    const source = await readFile(
      new URL("./PanelPresence.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /if \(present\) retainedRef\.current = children;/);
    assert.doesNotMatch(source, /setRetained\(/);
  });
});
