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

test("capability palette arrival uses the approved local-surface timing", () => {
  assert.match(
    motionCss,
    /\.motion-enter-capability-palette\s*\{[\s\S]*var\(--motion-duration-fast\)[\s\S]*var\(--motion-ease-standard\)/,
  );
  assert.match(
    motionCss,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.motion-enter-capability-palette[\s\S]*animation-duration:\s*1ms/,
  );
  assert.match(
    motionCss,
    /@keyframes motion-enter-capability-palette\s*\{[\s\S]*opacity:\s*0[\s\S]*translateY\(4px\)[\s\S]*opacity:\s*1[\s\S]*translateY\(0\)/,
  );
});
