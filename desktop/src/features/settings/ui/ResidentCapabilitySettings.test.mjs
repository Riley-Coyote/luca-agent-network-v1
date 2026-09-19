import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessLevelPicker } from "./ResidentCapabilitySettings.tsx";

// beta.13 P1 retires the three-rung picker (Manual/Accept edits/Full
// access) for two plain modes — "Work in my project" (standard) and "Don't
// ask me" (full). The confirmation AlertDialog beta.13 P4 adds is closed by
// default (`confirmOpen` starts `false`), and Radix does not mount a closed
// dialog's portal content, so `renderToStaticMarkup` still sees only the
// plain radio markup below — exactly as it did before this AlertDialog was
// added.
function inputs(options = {}) {
  const html = renderToStaticMarkup(
    createElement(AccessLevelPicker, {
      disabled: false,
      onChange() {},
      value: "standard",
      ...options,
    }),
  );
  return {
    html,
    radios: [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]),
  };
}

test("exactly two choices render: Work in my project and Don't ask me", () => {
  const { html, radios } = inputs();
  assert.equal(radios.length, 2);
  assert.match(html, /Work in my project/);
  assert.match(html, /Don&#x27;t ask me/);
  // The retired three-rung wording must not reappear.
  assert.doesNotMatch(html, /\bManual\b/);
  assert.doesNotMatch(html, /Accept edits/);
  assert.doesNotMatch(html, /Full access/);
});

test("standard selects the first (Work in my project) radio", () => {
  const { radios } = inputs({ value: "standard" });
  assert.match(radios[0], /checked/);
  assert.doesNotMatch(radios[1], /checked/);
});

test("full selects the second (Don't ask me) radio", () => {
  const { radios } = inputs({ value: "full" });
  assert.doesNotMatch(radios[0], /checked/);
  assert.match(radios[1], /checked/);
});

test("a resident still on the retired restricted level displays as Work in my project, not a third dead option", () => {
  // permission_tier::migrate_unsupported_level moves any resident still
  // stored at "restricted" to "standard" on its next start; until that
  // start happens, the picker must not invent a third radio for it and
  // must not leave nothing selected.
  const { radios } = inputs({ value: "restricted" });
  assert.equal(radios.length, 2);
  assert.match(radios[0], /checked/);
  assert.doesNotMatch(radios[1], /checked/);
});

test("pending changes disable every access choice", () => {
  const { radios } = inputs({ disabled: true });
  assert.equal(radios.length, 2);
  for (const radio of radios) assert.match(radio, /disabled/);
});

test("neither choice is ever individually disabled — restrictedUnavailable is retired along with restricted", () => {
  const { radios } = inputs({ disabled: false });
  for (const radio of radios) assert.doesNotMatch(radio, /disabled/);
});
