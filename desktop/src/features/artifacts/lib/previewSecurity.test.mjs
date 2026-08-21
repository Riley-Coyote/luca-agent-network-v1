import assert from "node:assert/strict";
import test from "node:test";

import { buildOpaqueHtmlDocument, svgImageDataUrl } from "./previewSecurity.ts";

test("static HTML receives one host-owned network-denied policy", () => {
  const document = buildOpaqueHtmlDocument(`<!doctype html><html><head>
    <base href="https://example.com/">
    <meta http-equiv="Content-Security-Policy" content="default-src *">
  </head><body><script>fetch("https://example.com")</script></body></html>`);

  assert.doesNotMatch(document, /<base\b/i);
  assert.doesNotMatch(document, /default-src \*/i);
  assert.match(document, /default-src 'none'/i);
  assert.match(document, /connect-src 'none'/i);
  assert.match(document, /form-action 'none'/i);
  assert.match(document, /navigate-to 'none'/i);
  assert.equal(
    document.match(/http-equiv="Content-Security-Policy"/g)?.length,
    1,
  );
});

test("fragment HTML is wrapped rather than trusted as a host document", () => {
  const document = buildOpaqueHtmlDocument("<main>quiet work</main>");
  assert.match(document, /^<!doctype html><html><head>/i);
  assert.match(document, /<body><main>quiet work<\/main><\/body>/i);
});

test("SVG renderer produces an image URL and never executable DOM markup", () => {
  const url = svgImageDataUrl(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.doesNotMatch(url, /<script>/);
});
