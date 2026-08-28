import assert from "node:assert/strict";
import test from "node:test";

import { resolveChannelShellLayout } from "./channelShellLayout.ts";

function resolve(overrides = {}) {
  return resolveChannelShellLayout({
    hasAuxiliaryPanel: true,
    hasProjectNavigator: false,
    isCompactProjectNavigator: false,
    isForum: false,
    isMobileViewport: false,
    mainInsetWidthPx: 900,
    ...overrides,
  });
}

test("drawer presentation depends on the stable inset, not drawer geometry", () => {
  assert.deepEqual(resolve(), {
    shouldCompactHeaderActions: false,
    stableConversationWidthPx: 900,
    useSinglePanel: false,
  });
});

test("project navigation is removed before applying drawer breakpoints", () => {
  assert.deepEqual(
    resolve({ hasProjectNavigator: true, mainInsetWidthPx: 850 }),
    {
      shouldCompactHeaderActions: true,
      stableConversationWidthPx: 546,
      useSinglePanel: true,
    },
  );
  assert.equal(
    resolve({
      hasProjectNavigator: true,
      isCompactProjectNavigator: true,
      mainInsetWidthPx: 850,
    }).stableConversationWidthPx,
    576,
  );
});

test("mobile project conversations do not reserve a hidden navigator", () => {
  assert.deepEqual(
    resolve({
      hasProjectNavigator: true,
      isMobileViewport: true,
      mainInsetWidthPx: 560,
    }),
    {
      shouldCompactHeaderActions: true,
      stableConversationWidthPx: 560,
      useSinglePanel: true,
    },
  );
});

test("forums and unmeasured insets never enter the channel cover layout", () => {
  assert.equal(
    resolve({ isForum: true, mainInsetWidthPx: 560 }).useSinglePanel,
    false,
  );
  assert.deepEqual(resolve({ mainInsetWidthPx: 0 }), {
    shouldCompactHeaderActions: false,
    stableConversationWidthPx: 0,
    useSinglePanel: false,
  });
});
