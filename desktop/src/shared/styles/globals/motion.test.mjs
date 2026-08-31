import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const motionCss = readFileSync(
  new URL("./motion.css", import.meta.url),
  "utf8",
);

test("conversation arrival is quick, crisp, and uses shared motion tokens", () => {
  assert.match(motionCss, /--motion-duration-arrival:\s*500ms/);
  assert.match(motionCss, /--motion-duration-message-arrival:\s*180ms/);
  assert.match(motionCss, /--motion-distance-message-arrival:\s*4px/);
  assert.match(
    motionCss,
    /\.motion-enter-conversation\s*\{[\s\S]*var\(--motion-duration-message-arrival\)[\s\S]*var\(--motion-ease-standard\)/,
  );
  const conversationKeyframes = motionCss.match(
    /@keyframes motion-enter-conversation\s*\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(conversationKeyframes);
  assert.doesNotMatch(conversationKeyframes, /filter|blur/);
});

test("conversation arrival has a reduced-motion treatment", () => {
  assert.match(
    motionCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.motion-enter-conversation/,
  );
});
