import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  dismissShellUpdate,
  getShellStatusSnapshot,
  publishConnectionProblem,
  resetShellStatus,
} from "./shellStatus.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/** The body of `function name(...) { ... }` in `source`, braces balanced. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`${name} has no end`);
}

describe("the connection store resets with the community (WP-09a)", () => {
  it("is in resetCommunityState, beside the community's other state", async () => {
    const init = await read("../../features/communities/useCommunityInit.ts");
    const body = functionBody(init, "resetCommunityState");
    assert.match(body, /\bresetShellStatus\(\);/);
    assert.match(
      init,
      /import \{ resetShellStatus \} from "@\/app\/shell\/shellStatus";/,
    );
  });

  it("forgets one relay's trouble and the dismissed update", () => {
    resetShellStatus();
    publishConnectionProblem(true);
    dismissShellUpdate();
    assert.deepEqual(getShellStatusSnapshot(), {
      connectionProblem: true,
      updateDismissed: true,
    });
    resetShellStatus();
    assert.deepEqual(getShellStatusSnapshot(), {
      connectionProblem: false,
      updateDismissed: false,
    });
  });
});

describe("the finishing list's styles (WP-09a)", () => {
  it("load after every other shell stylesheet", async () => {
    const app = await read("../App.tsx");
    const edges = app.indexOf('import "@/app/shell/shell-edges.css";');
    const finish = app.indexOf('import "@/app/shell/shell-finish.css";');
    assert.ok(edges > 0 && finish > edges);
  });

  it("only draw while the frame is drawn", async () => {
    const css = await read("./shell-finish.css");
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0].trim())
      .filter((head) => head && !head.startsWith("@media"));
    for (const head of selectors) {
      for (const selector of head.split(/,(?![^()]*\))/)) {
        const trimmed = selector.replace(/^@media[^{]*/, "").trim();
        if (!trimmed) continue;
        // The group disc is drawn only by the frame's lip.
        if (trimmed === ".luca-lip-group") continue;
        assert.match(trimmed, /^:root\[data-luca-frame\]/, trimmed);
      }
    }
  });
});
