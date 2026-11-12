import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RememberedPrivateAskAccessControls } from "./LucaSettingsSupportPanels.tsx";

const render = (fields = {}) =>
  renderToStaticMarkup(
    createElement(RememberedPrivateAskAccessControls, {
      count: 1,
      frame: true,
      pending: false,
      error: false,
      onForget() {},
      ...fields,
    }),
  );

test("Forget is absent unless the native count confirms remembered scopes", () => {
  for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(render({ count }), "");
  const html = render({ count: 2 });
  assert.match(html, /Forget remembered private-chat ask access/);
  assert.match(html, />Forget<\/button>/);
  assert.match(html, /Project files and tools are not included/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("Forget stays accessible while pending and announces failure without claiming revocation", () => {
  assert.match(render({ pending: true }), /disabled=""/);
  assert.match(render({ pending: true }), /Forgetting…/);
  const html = render({ error: true });
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not forget this access/);
});
