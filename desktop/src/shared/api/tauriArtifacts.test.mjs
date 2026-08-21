import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArtifactPreviewPayload } from "./tauriArtifacts.ts";

test("native artifact preview uses nested version and artifact fields", () => {
  const payload = normalizeArtifactPreviewPayload(
    {
      previewType: "text",
      artifact: {
        id: "artifact-native-shape",
        language: "typescript",
        availability: "ready",
      },
      version: {
        id: "artifact-native-shape:v7",
        number: 7,
        mediaType: "text/plain; charset=utf-8",
      },
      contentUtf8: "const nativeShape = true;",
      truncated: false,
    },
    "fallback-artifact-id",
    2,
  );

  assert.equal(payload.artifactId, "artifact-native-shape");
  assert.equal(payload.version, 7);
  assert.equal(payload.versionId, "artifact-native-shape:v7");
  assert.equal(payload.language, "typescript");
  assert.equal(payload.capability, "code");
  assert.equal(payload.mediaType, "text/plain; charset=utf-8");
  assert.equal(payload.text, "const nativeShape = true;");
});
