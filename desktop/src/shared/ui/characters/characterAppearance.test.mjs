import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARACTER_IDS,
  agentPhotoPreferred,
  characterIdForPubkey,
  defaultCharacterId,
  isCustomAgentPhotoUrl,
  setAgentPhotoPreferred,
  setCharacterId,
  setCharacterMotionEnabled,
} from "./characterAppearance.ts";

const CODEX_FALLBACK =
  "https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5313.41514/1773706730621/Microsoft.VisualStudio.Services.Icons.Default";
const SAVED_PHOTO = "https://example.com/my-agent-portrait.png";

test("runtime defaults are exact matches, while uploaded photos remain photos", () => {
  assert.equal(isCustomAgentPhotoUrl(CODEX_FALLBACK), false);
  assert.equal(isCustomAgentPhotoUrl(` ${CODEX_FALLBACK} `), false);
  assert.equal(isCustomAgentPhotoUrl(`${CODEX_FALLBACK}?custom=1`), true);
  assert.equal(isCustomAgentPhotoUrl(SAVED_PHOTO), true);
  assert.equal(isCustomAgentPhotoUrl(null), false);
});

test("choosing a character overrides a saved photo without deleting it", (t) => {
  const values = new Map();
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  globalThis.window = browser;
  t.after(() => {
    delete globalThis.window;
  });

  const pubkey = "ad".repeat(32);
  assert.equal(agentPhotoPreferred(pubkey, CODEX_FALLBACK), false);
  assert.equal(agentPhotoPreferred(pubkey, SAVED_PHOTO), true);
  setCharacterId(pubkey, "kite");
  assert.equal(agentPhotoPreferred(pubkey, SAVED_PHOTO), false);
  setAgentPhotoPreferred(pubkey);
  assert.equal(agentPhotoPreferred(pubkey, SAVED_PHOTO), true);
  assert.equal(characterIdForPubkey(pubkey), "kite");
  setCharacterId(pubkey, null);
  assert.equal(agentPhotoPreferred(pubkey, SAVED_PHOTO), false);
  assert.equal(characterIdForPubkey(pubkey), defaultCharacterId(pubkey));

  const stored = JSON.parse(values.get("polyphonic.character-appearance.v1"));
  assert.deepEqual(stored.assignments, {});
  assert.equal(stored.appearanceModes[pubkey], "character");
});

test("a previously selected v1 character still beats a saved photo", (t) => {
  const pubkey = "ab".repeat(32);
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: () =>
        JSON.stringify({
          version: 1,
          assignments: { [pubkey]: "crab" },
          motionEnabled: true,
        }),
    },
  });
  t.after(() => {
    delete globalThis.window;
  });
  assert.equal(characterIdForPubkey(pubkey), "crab");
  assert.equal(agentPhotoPreferred(pubkey, SAVED_PHOTO), false);
});

test("v1 default assignment stays stable for existing resident public keys", () => {
  assert.deepEqual(CHARACTER_IDS, [
    "scuttle",
    "walker",
    "kite",
    "beetle",
    "crab",
    "manta",
    "scout",
    "sentinel",
  ]);
  for (const [prefix, expected] of [
    ["00", "scuttle"],
    ["11", "walker"],
    ["22", "kite"],
    ["66", "beetle"],
    ["88", "crab"],
    ["01", "manta"],
    ["33", "scout"],
    ["55", "sentinel"],
  ]) {
    assert.equal(defaultCharacterId(prefix.repeat(32)), expected);
  }
});

test("character choice follows a resident public key and does not change its default", (t) => {
  const values = new Map();
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  globalThis.window = browser;
  t.after(() => {
    delete globalThis.window;
  });

  const pubkey = "AB".repeat(32);
  const initial = defaultCharacterId(pubkey);
  assert.equal(initial, defaultCharacterId(pubkey.toLowerCase()));
  const chosen = initial === "crab" ? "manta" : "crab";
  setCharacterId(pubkey, chosen);
  assert.equal(characterIdForPubkey(pubkey.toLowerCase()), chosen);

  setCharacterMotionEnabled(false);
  assert.equal(characterIdForPubkey(pubkey), chosen);
  setCharacterId(pubkey, null);
  assert.equal(characterIdForPubkey(pubkey), initial);
});
