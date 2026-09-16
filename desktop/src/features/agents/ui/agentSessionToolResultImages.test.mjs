import assert from "node:assert/strict";
import test from "node:test";

import { extractToolResultImages } from "./agentSessionTranscriptHelpers.ts";

test("an image content block becomes a data URI", () => {
  assert.deepEqual(
    extractToolResultImages({
      content: [
        { type: "text", text: "here it is" },
        { type: "image", mimeType: "image/png", data: "AAAA" },
      ],
    }),
    ["data:image/png;base64,AAAA"],
  );
});

test("image blocks nested under content are read too", () => {
  assert.deepEqual(
    extractToolResultImages({
      content: [
        {
          type: "content",
          content: { type: "image", mimeType: "image/webp", data: "BBBB" },
        },
      ],
    }),
    ["data:image/webp;base64,BBBB"],
  );
});

test("rawOutput content is read when there is no top-level content", () => {
  assert.deepEqual(
    extractToolResultImages({
      rawOutput: {
        content: [{ type: "image", mime_type: "image/jpeg", data: "CCCC" }],
      },
    }),
    ["data:image/jpeg;base64,CCCC"],
  );
});

test("at most four images are kept", () => {
  const content = Array.from({ length: 6 }, (_, index) => ({
    type: "image",
    mimeType: "image/png",
    data: `AAA${index}`,
  }));
  assert.equal(extractToolResultImages({ content }).length, 4);
});

test("anything that is not a bounded base64 image is ignored", () => {
  const cases = [
    { content: [{ type: "image", mimeType: "text/plain", data: "AAAA" }] },
    { content: [{ type: "image", mimeType: "image/png" }] },
    { content: [{ type: "image", data: "AAAA" }] },
    {
      content: [
        { type: "image", mimeType: "image/png", data: "not base64 <script>" },
      ],
    },
    {
      content: [
        {
          type: "image",
          mimeType: "image/png;charset=utf-8",
          data: "AAAA",
        },
      ],
    },
    {
      content: [
        {
          type: "image",
          mimeType: "image/png",
          data: "A".repeat(4 * 1024 * 1024 + 1),
        },
      ],
    },
    { content: "just text" },
    {},
  ];
  for (const update of cases) {
    assert.deepEqual(
      extractToolResultImages(update),
      [],
      JSON.stringify(update).slice(0, 80),
    );
  }
});
