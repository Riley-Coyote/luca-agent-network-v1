import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessLevelPicker } from "./ResidentCapabilitySettings.tsx";

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

test("unsupported Codex Manual is visibly unavailable without selecting a higher level", () => {
  const { html, radios } = inputs({
    restrictedUnavailable: true,
    value: "restricted",
  });
  assert.equal(radios.length, 3);
  assert.match(radios[0], /disabled/);
  assert.match(radios[0], /checked/);
  assert.doesNotMatch(radios[1], /disabled|checked/);
  assert.match(html, /Unavailable with this Codex connection/);
});

test("pending changes disable every access choice", () => {
  const { radios } = inputs({ disabled: true });
  assert.equal(radios.length, 3);
  for (const radio of radios) assert.match(radio, /disabled/);
});

test("supported runtimes retain an available Manual choice", () => {
  const { radios } = inputs();
  assert.doesNotMatch(radios[0], /disabled/);
});
