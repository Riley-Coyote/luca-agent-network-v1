import assert from "node:assert/strict";
import test from "node:test";

import {
  activityPhrase,
  activityPhraseKind,
  activityPhraseObject,
  stripBrackets,
} from "./activityPhrase.ts";

const step = (roomText, text = roomText, active = true) => ({
  text,
  roomText,
  active,
});

const owner = (value) =>
  activityPhrase({ step: value, streaming: false, privateConversation: true });
const room = (value) =>
  activityPhrase({ step: value, streaming: false, privateConversation: false });

test("no step reads as thinking, and as writing once the reply arrives", () => {
  assert.equal(
    activityPhrase({ step: null, streaming: false, privateConversation: true }),
    "Thinking",
  );
  assert.equal(
    activityPhrase({ step: null, streaming: true, privateConversation: true }),
    "Writing",
  );
  assert.equal(
    activityPhrase({ step: null, streaming: true, privateConversation: false }),
    "Writing",
  );
});

test("a settled step yields to streaming text, an open one does not", () => {
  const open = step("Reading files", "Reading notes.md", true);
  const done = step("Reading files", "Reading notes.md", false);
  assert.equal(
    activityPhrase({
      step: done,
      streaming: true,
      privateConversation: true,
    }),
    "Writing",
  );
  assert.equal(
    activityPhrase({
      step: open,
      streaming: true,
      privateConversation: true,
    }),
    "Reading notes.md",
  );
});

test("every native room label maps to one plain phrase", () => {
  // The closed set `room_label` in activity_trace_store.rs actually emits.
  assert.equal(room(step("Reading files")), "Reading a file");
  assert.equal(room(step("Editing files")), "Editing a file");
  assert.equal(room(step("Running a command")), "Running a command");
  assert.equal(room(step("Browsing the web")), "Reading a page");
  assert.equal(room(step("Searching")), "Searching the code");
  assert.equal(room(step("Thinking")), "Thinking");
  assert.equal(room(step("Delegating work")), "Working");
  assert.equal(room(step("Working")), "Working");
});

test("reading names the file for the owner and drops it in a room", () => {
  const reading = step("Reading files", "Reading notes.md");
  assert.equal(owner(reading), "Reading notes.md");
  assert.equal(room(reading), "Reading a file");
});

test("editing and writing keep their own verb and their own object", () => {
  assert.equal(
    owner(step("Editing files", "Editing App.tsx")),
    "Editing App.tsx",
  );
  assert.equal(
    owner(step("Editing files", "Writing App.tsx")),
    "Writing App.tsx",
  );
  assert.equal(
    room(step("Editing files", "Writing App.tsx")),
    "Editing a file",
  );
  assert.equal(
    owner(step("Editing files", "Editing a file")),
    "Editing a file",
  );
});

test("a path is reduced to the file's own name", () => {
  assert.equal(
    owner(
      step("Reading files", "Reading src/features/messages/MessageRow.tsx"),
    ),
    "Reading MessageRow.tsx",
  );
  assert.equal(
    owner(step("Reading files", "Reading C:\\Users\\riley\\notes.md")),
    "Reading notes.md",
  );
  assert.equal(activityPhraseObject("Reading /etc/hosts"), "hosts");
  assert.equal(activityPhraseObject("Editing ./Makefile"), "Makefile");
  assert.equal(activityPhraseObject("Reading a file"), null);
  assert.equal(activityPhraseObject("Reading the page"), null);
  assert.equal(activityPhraseObject("Guardian Review"), null);
  assert.equal(activityPhraseObject("Thinking"), null);
  assert.equal(activityPhraseObject(`Editing "src/App.tsx",`), "App.tsx");
  assert.equal(activityPhraseObject(`Reading ${"x".repeat(60)}`), null);
});

test("searching, exploring and shell steps never carry their argument", () => {
  assert.equal(
    owner(step("Searching", "Searching for resident_pubkey")),
    "Searching the code",
  );
  assert.equal(
    owner(step("Searching files", "Searching task-notes.md")),
    "Searching the code",
  );
  assert.equal(
    owner(step("Searching", "Listing src/features")),
    "Searching the code",
  );
  assert.equal(
    owner(step("Working", "Exploring the repository")),
    "Exploring the repository",
  );
  assert.equal(
    owner(step("Working", "Listing directory src")),
    "Exploring the repository",
  );
  assert.equal(
    owner(step("Running a command", "Running pnpm test --filter desktop")),
    "Running a command",
  );
  assert.equal(
    owner(step("Running a command", "Running rm -rf /tmp/secret")),
    "Running a command",
  );
});

test("web steps read as the web, never as a domain", () => {
  assert.equal(
    owner(step("Browsing the web", "Opening example.com")),
    "Reading a page",
  );
  assert.equal(
    owner(step("Browsing the web", "Reading example.com")),
    "Reading a page",
  );
  assert.equal(
    owner(step("Browsing the web", "Reading the page")),
    "Reading a page",
  );
  assert.equal(
    owner(step("Browsing the web", "Searching the web")),
    "Searching the web",
  );
  // A room keeps only the room projection, which cannot tell the two apart.
  assert.equal(
    room(step("Browsing the web", "Searching the web")),
    "Reading a page",
  );
  assert.equal(
    room(step("Browsing the web", "Opening example.com")),
    "Reading a page",
  );
});

test("an unrecognised runtime title becomes Working, never its own words", () => {
  assert.equal(owner(step("Working", "Guardian Review")), "Working");
  assert.equal(owner(step("Working", "Analysing the corpus")), "Working");
  assert.equal(
    owner(step("Working", "I'm checking the live Polyphonic capabilities")),
    "Working",
  );
  // A recognised room label still wins over an unnameable owner title.
  assert.equal(
    owner(step("Reading files", "Guardian Review")),
    "Reading a file",
  );
});

test("bracketed commentary is stripped before anything is read from it", () => {
  assert.equal(
    stripBrackets("[I'm checking the notes…]"),
    "I'm checking the notes…",
  );
  assert.equal(stripBrackets("[[nested]]"), "nested");
  assert.equal(stripBrackets("plain"), "plain");
  assert.equal(
    owner(step("Reading files", "[Reading notes.md]")),
    "Reading notes.md",
  );
  assert.equal(owner(step("Working", "[Guardian Review]")), "Working");
});

test("kind recovery covers each vocabulary and refuses to guess", () => {
  assert.equal(activityPhraseKind("Reading files"), "read");
  assert.equal(activityPhraseKind("Editing files"), "edit");
  assert.equal(activityPhraseKind("Writing App.tsx"), "write");
  assert.equal(activityPhraseKind("Searching"), "search");
  assert.equal(activityPhraseKind("Exploring the repository"), "explore");
  assert.equal(activityPhraseKind("Running a command"), "command");
  assert.equal(activityPhraseKind("Browsing the web"), "web-read");
  assert.equal(activityPhraseKind("Searching the web"), "web-search");
  assert.equal(activityPhraseKind("Thinking"), "think");
  assert.equal(activityPhraseKind("Delegating work"), null);
  assert.equal(activityPhraseKind("Working"), null);
  assert.equal(activityPhraseKind(""), null);
  assert.equal(activityPhraseKind("   "), null);
});

test("the phrase changes as the step changes, and only from the closed set", () => {
  const phrases = [
    null,
    step("Thinking"),
    step("Reading files", "Reading notes.md"),
    step("Searching", "Searching for auth"),
    step("Running a command", "Running pnpm test"),
    step("Editing files", "Editing App.tsx"),
  ].map((value) =>
    activityPhrase({
      step: value,
      streaming: false,
      privateConversation: true,
    }),
  );
  assert.deepEqual(phrases, [
    "Thinking",
    "Thinking",
    "Reading notes.md",
    "Searching the code",
    "Running a command",
    "Editing App.tsx",
  ]);
  for (const phrase of phrases) {
    assert.ok(!phrase.includes("["), `${phrase} must carry no bracket`);
    assert.ok(!phrase.includes("/"), `${phrase} must carry no path`);
    assert.ok(phrase.length <= 64, `${phrase} must stay one short phrase`);
  }
});
