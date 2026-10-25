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

  it("opens the first huddle's hint only once the bar has risen", async () => {
    const shell = await read("../AppShell.tsx");
    assert.match(
      shell,
      /enterMs=\{shellFrame \? SHELL_FRAME_SLIDE_MS : undefined\}/,
    );
    const bar = await read("../../features/huddle/components/HuddleBar.tsx");
    assert.match(bar, /enterMs = 0,/);
    assert.match(bar, /const isBarInPlace = enterMs <= 0 \|\| hasArrived;/);
    assert.match(bar, /!isDrawerClosing &&\s*isBarInPlace/);
  });

  it("draws the bar in the page's warning tone, as the lip's buttons", async () => {
    const css = await read("./shell-huddle.css");
    assert.match(css, /--destructive: inherit;/);
    assert.match(
      css,
      /border-radius: 7px;\s*box-shadow: none;[\s\S]*height: 24px;/,
    );
    assert.match(css, /stroke-width: 1\.7;/);
    assert.doesNotMatch(css, /border-(top|bottom)-(left|right)-radius: 0/);
  });

  it("gives what opens from the bar the page's own materials", async () => {
    const css = await read("./shell-huddle.css");
    assert.match(css, /:root\[data-luca-frame\] \.buzz-huddle-tooltip \{/);
    assert.match(css, /:root\[data-luca-frame\] \.buzz-huddle-popover \{/);
  });

  it("raises the quick chat's launcher with the band, never its panel", async () => {
    const css = await read("./shell-huddle.css");
    assert.match(css, /button\.qc-launcher \{\s*bottom: 58px;/);
    assert.doesNotMatch(css, /\.qc-panel/);
  });
});
