import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  projectProposalDuplicate,
  projectProposalJoins,
  projectProposalLine,
  projectProposalTitle,
  projectSettledLine,
} from "../lib/projectProposalWords.ts";
import { ProjectCreationProvider } from "../useRoomProjectCreation.ts";
import { ProjectProposalAsk } from "./ProjectProposalAsk.tsx";

const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const OWNER = "c".repeat(64);

const proposal = {
  requestId: "project-proposal-1",
  kind: "new_project",
  ownerPubkey: OWNER,
  residentPubkey: LUCA,
  conversationId: "luca-chat",
  projectName: "Ghost app",
  purpose: "Build the Ghost app.",
  chatName: "general",
  residentPubkeys: [LUCA],
  createdAt: "2026-11-20T10:00:00Z",
};

const names = new Map([
  [LUCA, "Luca"],
  [ATLAS, "Atlas"],
]);

function draw(fields = {}, projects = []) {
  const store = new Map([
    [
      `luca-room-projects.v1:${OWNER}:ws%3A%2F%2Frelay`,
      JSON.stringify({ version: 1, projects, assignments: {} }),
    ],
  ]);
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          ProjectCreationProvider,
          {
            value: {
              createChat: async () => {},
              ownerPubkey: OWNER,
              relayUrl: "ws://relay",
            },
          },
          createElement(ProjectProposalAsk, {
            nameOf: (pubkey) => names.get(pubkey) ?? "Your resident",
            proposal: { ...proposal, ...fields },
            summary: "Luca asks",
          }),
        ),
      ),
    );
  } finally {
    delete globalThis.localStorage;
  }
}

function text(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("the card asks in the owner's words and offers Create and Not now", () => {
  const html = draw();
  const words = text(html);
  assert.match(words, /Start a project called “Ghost app”\?/);
  assert.match(words, /Luca asks/);
  assert.match(
    words,
    /Build the Ghost app\. · Luca joins its first chat, general\./,
  );
  const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(buttons, ["Create", "Not now"]);
  assert.doesNotMatch(words, /already have/);
});

test("a name the owner already uses is said on the card; Create stays", () => {
  const html = draw({}, [{ id: "ghost-app", label: "ghost app" }]);
  assert.match(text(html), /You already have a project called Ghost app\./);
  assert.match(html, /data-testid="project-proposal-create"[^>]*>Create</);
  assert.doesNotMatch(
    html,
    /data-testid="project-proposal-create"[^>]*disabled/,
  );
});

test("every resident who joins is named", () => {
  const words = text(draw({ residentPubkeys: [LUCA, ATLAS] }));
  assert.match(words, /Luca and Atlas join its first chat, general\./);
});

test("the words, as written", () => {
  assert.equal(
    projectProposalTitle("Ghost app"),
    "Start a project called “Ghost app”?",
  );
  assert.equal(
    projectProposalJoins(["Luca"], "general"),
    "Luca joins its first chat, general.",
  );
  assert.equal(
    projectProposalJoins(["Luca", "Atlas", "Vektor"], "general"),
    "Luca, Atlas and Vektor join its first chat, general.",
  );
  assert.equal(
    projectProposalLine("Ship it.", ["Luca"], "general"),
    "Ship it. · Luca joins its first chat, general.",
  );
  assert.equal(projectProposalDuplicate("Ghost app", ["Studio"]), null);
  assert.equal(
    projectProposalDuplicate("Ghost app", [" GHOST APP "]),
    "You already have a project called Ghost app.",
  );
  assert.equal(
    projectSettledLine("Ghost app"),
    "Ghost app is in your projects.",
  );
});
