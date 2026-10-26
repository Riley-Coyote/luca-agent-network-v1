import assert from "node:assert/strict";
import test from "node:test";

import { navOrder, resolveNavMotion } from "./navigationChoreography.ts";

const places = navOrder(true);
const rail = navOrder(false);

test("frame_movingDownThePlacesDriftsDown", () => {
  // The places column, top to bottom (NAVIGATION.md): Chats (home), Agents,
  // Activity, Library, Settings.
  const column = ["/", "/agents", "/pulse", "/artifacts", "/settings"];
  for (let index = 1; index < column.length; index += 1) {
    const above = column[index - 1];
    const below = column[index];
    assert.equal(resolveNavMotion(above, below, places), "down", below);
    assert.equal(resolveNavMotion(below, above, places), "up", above);
  }
});

test("frame_aPlacesOwnPagesShareItsSeat", () => {
  // New conversation is in Chats, Brain in Agents, the Inbox with Activity:
  // between them the page crossfades, never drifts.
  assert.equal(resolveNavMotion("/", "/messages/new", places), "swap");
  assert.equal(resolveNavMotion("/agents", "/brain", places), "swap");
  assert.equal(resolveNavMotion("/pulse", "/inbox", places), "swap");
  assert.equal(resolveNavMotion("/brain", "/pulse", places), "down");
});

test("frame_conversationsToLibraryIsDown_whereTheRailSaidUp", () => {
  // The rail put Library above home; the places put it below Conversations.
  assert.equal(resolveNavMotion("/", "/artifacts", rail), "up");
  assert.equal(resolveNavMotion("/", "/artifacts", places), "down");
  assert.equal(resolveNavMotion("/messages/new", "/artifacts", rail), "up");
  assert.equal(resolveNavMotion("/messages/new", "/artifacts", places), "down");
});

test("frame_subPagesTakeTheirPlacesSeat", () => {
  assert.equal(resolveNavMotion("/agents/abc", "/settings", places), "down");
  assert.equal(resolveNavMotion("/settings", "/pulse", places), "up");
});

test("noFrame_depthIsUnchanged", () => {
  assert.equal(resolveNavMotion("/agents", "/channels/x", rail), "deeper");
  assert.equal(resolveNavMotion("/channels/x", "/agents", rail), "shallower");
  assert.equal(
    resolveNavMotion("/projects/p", "/artifacts", rail),
    "shallower",
  );
});

test("frame_aConversationDriftsByThePlaces_likeEveryPlace", () => {
  // WP-19: a conversation is Chats' own page, so arriving from another
  // place moves by the column, and leaving does the reverse.
  assert.equal(resolveNavMotion("/agents", "/channels/x", places), "up");
  assert.equal(resolveNavMotion("/channels/x", "/agents", places), "down");
  assert.equal(resolveNavMotion("/artifacts", "/channels/x", places), "up");
  assert.equal(resolveNavMotion("/channels/x", "/pulse", places), "down");
  assert.equal(resolveNavMotion("/settings", "/channels/x", places), "up");
  assert.equal(resolveNavMotion("/projects/p", "/artifacts", places), "down");
  // Within Chats a conversation is still deeper than its place's own pages.
  assert.equal(resolveNavMotion("/", "/channels/x", places), "deeper");
  assert.equal(
    resolveNavMotion("/messages/new", "/channels/x", places),
    "deeper",
  );
  assert.equal(
    resolveNavMotion("/channels/x", "/messages/new", places),
    "shallower",
  );
  // A workflow has no place of its own: depth, as before.
  assert.equal(resolveNavMotion("/agents", "/workflows/w", places), "deeper");
});

test("sameIsUnchangedByTheOrder", () => {
  for (const order of [rail, places]) {
    assert.equal(resolveNavMotion("/channels/x", "/channels/y", order), "same");
    assert.equal(resolveNavMotion("/channels/x", "/projects/p", order), "same");
    assert.equal(resolveNavMotion("/agents", "/agents", order), "same");
    assert.equal(resolveNavMotion("/agents", "/workflows", order), "swap");
  }
});

test("noFrame_theRailOrderIsTheDefault", () => {
  assert.equal(resolveNavMotion("/artifacts", "/agents"), "down");
  assert.equal(resolveNavMotion("/", "/artifacts"), "up");
  assert.equal(resolveNavMotion("/settings", "/brain"), "up");
});
