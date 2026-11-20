import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  projectProposalDuplicate,
  projectLeftLine,
  projectPartlyMade,
  projectProposalJoins,
  projectProposalTitle,
  projectSettledLine,
} from "../lib/projectProposalWords.ts";
import { ProjectCreationProvider } from "../useRoomProjectCreation.ts";
import {
  ProjectProposalAsk,
  ProjectProposalCard,
} from "./ProjectProposalAsk.tsx";

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
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

test("the card asks in the owner's words and offers Create and Not now", () => {
  const html = draw();
  const words = text(html);
  assert.match(words, /Start a project called “Ghost app”\?/);
  assert.match(words, /Luca asks/);
  // The purpose and who joins are two lines of their own.
  assert.match(
    html,
    /data-testid="project-proposal-purpose"[^>]*>Build the Ghost app\.</,
  );
  assert.match(
    html,
    /data-testid="project-proposal-joins"[^>]*>Luca joins its first chat, general\.</,
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

test("a Create that stopped part-way says what exists in one sentence", () => {
  const none = { project: false, chat: false, inProject: false, missing: [] };
  const project = { ...none, project: true };
  const chat = { ...project, chat: true };
  const placed = { ...chat, inProject: true };
  assert.equal(
    projectPartlyMade("Ghost app", none),
    "Ghost app couldn't be made. Nothing was saved.",
  );
  assert.equal(
    projectPartlyMade("Ghost app", project),
    "The project was made, but its first chat wasn't.",
  );
  assert.equal(
    projectPartlyMade("Ghost app", chat),
    "Ghost app and its chat were made, but the chat isn't in the project yet.",
  );
  assert.equal(
    projectPartlyMade("Ghost app", { ...placed, missing: ["Luca"] }),
    "Ghost app and its chat were made, but Luca couldn't be added.",
  );
  assert.equal(
    projectPartlyMade("Ghost app", { ...placed, missing: ["Luca", "Atlas"] }),
    "Ghost app and its chat were made, but Luca and Atlas couldn't be added.",
  );
});

test("leaving it part-made tells the owner what is there", () => {
  const project = { project: true, chat: false, inProject: false, missing: [] };
  assert.equal(
    projectLeftLine("Ghost app", project),
    "Ghost app is in your projects, without its first chat.",
  );
  assert.equal(
    projectLeftLine("Ghost app", { ...project, chat: true }),
    "Ghost app is in your projects, but its chat isn't in it yet.",
  );
  assert.equal(
    projectLeftLine("Ghost app", {
      ...project,
      chat: true,
      inProject: true,
      missing: ["Luca"],
    }),
    "Ghost app is in your projects, without Luca in it yet.",
  );
  assert.equal(
    projectLeftLine("Ghost app", {
      ...project,
      chat: true,
      inProject: true,
    }),
    "Ghost app is in your projects.",
  );
});

/** The card as drawn, with the state a stopped Create leaves. */
function drawCard(fields = {}) {
  return renderToStaticMarkup(
    createElement(ProjectProposalCard, {
      busy: null,
      duplicate: null,
      joins: "Luca joins its first chat, general.",
      leaving: false,
      onCreate: () => {},
      onDecline: () => {},
      partly: null,
      purpose: "Build the Ghost app.",
      requestId: "project-proposal-1",
      stopped: false,
      summary: "Luca asks",
      title: "Start a project called “Ghost app”?",
      ...fields,
    }),
  );
}

/** Where each phrase first appears in the card's words, in reading order. */
function order(words, phrases) {
  return phrases.map((phrase) => {
    const at = words.indexOf(phrase);
    assert.notEqual(at, -1, `missing: ${phrase}`);
    return at;
  });
}

test("the card reads: question, who asks, purpose, who joins, then the answers", () => {
  const words = text(drawCard());
  const at = order(words, [
    "Start a project called",
    "Luca asks",
    "Build the Ghost app.",
    "Luca joins its first chat, general.",
    "Create",
    "Not now",
  ]);
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
  );
});

test("once a Create stops part-way, what exists takes the purpose's place, above the answers", () => {
  const sentence =
    "Ghost app and its chat were made, but Luca couldn't be added.";
  const html = drawCard({ leaving: true, partly: sentence, stopped: true });
  const words = text(html);
  const at = order(words, [
    "Start a project called",
    "Luca asks",
    sentence,
    "Try again",
    "Leave it",
  ]);
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
  );
  assert.doesNotMatch(html, /project-proposal-purpose|project-proposal-joins/);
  assert.doesNotMatch(words, /Build the Ghost app|joins its first chat/);
  // The sentence lives in the row's own lines, not in the notes under it.
  assert.match(
    html,
    /data-testid="project-proposal-line"[^>]*><span[^>]*data-testid="project-proposal-problem"[^>]*role="alert"/,
  );
});

test("a project already so named stays the one note under the answers", () => {
  const words = text(
    drawCard({ duplicate: "You already have a project called Ghost app." }),
  );
  const at = order(words, [
    "Luca joins its first chat, general.",
    "Not now",
    "You already have a project called Ghost app.",
  ]);
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
  );
});
