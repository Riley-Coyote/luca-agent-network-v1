import assert from "node:assert/strict";
import test from "node:test";

import { svgImageDataUrl } from "./previewSecurity.ts";

test("SVG renderer produces an image URL and never executable DOM markup", () => {
  const url = svgImageDataUrl(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(url, /<script>/);
});
