import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/** Rules of a stylesheet, as `selector { body }` pairs, comments dropped. */
function rules(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

describe("the huddle bar in the frame (WP-08e)", () => {
  it("keys every rule on the frame, or on the band only the frame draws", async () => {
    const css = await read("./shell-huddle.css");
    for (const { selector } of rules(css)) {
      if (selector.startsWith("@") || /^(syntax|inherits)/.test(selector)) {
        continue;
      }
      assert.ok(
        selector.includes(":root[data-luca-frame]") ||
          selector.includes(".luca-huddle-band"),
        `unkeyed rule: ${selector}`,
      );
    }
  });

  it("travels on the rail's curve and stands still under Reduce Motion", async () => {
    const css = await read("./shell-huddle.css");
    assert.match(css, /@property --luca-huddle-band \{/);
    assert.match(
      css,
      /transition: --luca-huddle-band var\(--luca-frame-slide\);/,
    );
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none;/,
    );
  });

  it("ends every card above the band, by one shared bottom", async () => {
    const css = await read("./shell-huddle.css");
    assert.match(
      css,
      /\[data-testid="app-sidebar"\], \[data-luca-settings-list\]/,
    );
    assert.match(
      css,
      /main\[data-buzz-glass-inset\], \[data-luca-settings-card-host\]/,
    );
    assert.match(css, /bottom: var\(--luca-frame-card-bottom\);/);
    assert.match(css, /padding-bottom: var\(--luca-frame-card-bottom\);/);
  });

  it("leaves the app surface whole in the frame and mounts the band there", async () => {
    const shell = await read("../AppShell.tsx");
    assert.match(
      shell,
      /isHuddleDrawerOpen &&\s*!shellFrame &&\s*"buzz-huddle-app-surface-open"/,
    );
    assert.match(shell, /\? "luca-huddle-band"/);
    assert.match(
      shell,
      /exitMs=\{shellFrame \? SHELL_FRAME_SLIDE_MS : undefined\}/,
    );
  });

  it("keeps today's drawer timing without the frame", async () => {
    const bar = await read("../../features/huddle/components/HuddleBar.tsx");
    assert.match(bar, /exitMs = HUDDLE_DRAWER_EXIT_MS/);
    assert.match(bar, /const HUDDLE_DRAWER_EXIT_MS = 260;/);
    assert.match(bar, /import "@\/app\/shell\/shell-huddle\.css";/);
  });
});
