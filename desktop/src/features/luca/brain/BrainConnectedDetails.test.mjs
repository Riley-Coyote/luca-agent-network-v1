import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BrainConnectedDetails } from "./BrainConnectedDetails.tsx";

const baseInventory = {
  sources: [],
  discoveries: [],
  recallGrants: [],
  repositoryGrants: [],
};

function render(discoveries) {
  return renderToStaticMarkup(
    React.createElement(BrainConnectedDetails, {
      busySourceIds: new Set(),
      inventory: { ...baseInventory, discoveries },
      kind: "repository",
      onConnect: () => {},
      onDisconnect: () => {},
      onReconfirm: () => {},
      onRefresh: () => {},
      onRevoke: () => {},
      residents: [],
    }),
  );
}

test("connected source details offers a way to connect newly discovered repositories", () => {
  const html = render([
    {
      discoveryId: "repo-new",
      sourceKind: "repository",
      displayName: "primary-repo",
      itemCount: 1,
    },
  ]);

  assert.match(html, /Found on this device/);
  assert.match(html, />Connect source</);
});

test("connected source details hides the connect action without discoveries", () => {
  const html = render([]);

  assert.doesNotMatch(html, />Connect source/);
});
