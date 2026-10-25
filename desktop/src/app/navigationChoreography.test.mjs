import assert from "node:assert/strict";
import test from "node:test";

import { navOrder, resolveNavMotion } from "./navigationChoreography.ts";

const places = navOrder(true);
const rail = navOrder(false);

test("frame_movingDownThePlacesDriftsDown", () => {
  // The places column, top to bottom: New conversation, Conversations
  // (home), Library, Inbox, Agents, Activity, Brain, Settings.
  const column = [
    "/messages/new",
    "/",
    "/artifacts",
    "/inbox",
    "/agents",
    "/pulse",
    "/brain",
    "/settings",
  ];
  for (let index = 1; index < column.length; index += 1) {
    const above = column[index - 1];
    const below = column[index];
    assert.equal(resolveNavMotion(above, below, places), "down", below);
    assert.equal(resolveNavMotion(below, above, places), "up", above);
  }
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

test("depthAndSameAreUnchangedByTheOrder", () => {
  for (const order of [rail, places]) {
    assert.equal(resolveNavMotion("/agents", "/channels/x", order), "deeper");
    assert.equal(
      resolveNavMotion("/channels/x", "/agents", order),
      "shallower",
    );
    assert.equal(resolveNavMotion("/channels/x", "/channels/y", order), "same");
    assert.equal(resolveNavMotion("/agents", "/agents", order), "same");
    assert.equal(resolveNavMotion("/agents", "/workflows", order), "swap");
  }
});

test("noFrame_theRailOrderIsTheDefault", () => {
  assert.equal(resolveNavMotion("/artifacts", "/agents"), "down");
  assert.equal(resolveNavMotion("/", "/artifacts"), "up");
  assert.equal(resolveNavMotion("/settings", "/brain"), "up");
});
