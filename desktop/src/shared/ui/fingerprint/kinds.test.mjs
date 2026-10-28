import assert from "node:assert/strict";
import test from "node:test";

import { LUCA_IDENTITY_SEED } from "@/features/luca/canonicalLucaResident";

import { FINGERPRINT_KINDS } from "./growth.ts";
import {
  assignFingerprintKinds,
  fingerprintSeed,
  fnv1a,
  kindFromSeed,
} from "./kinds.ts";

const LUCA = "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";
const key = (n) => n.toString(16).padStart(2, "0").repeat(32);

test("FNV-1a is the 0x811c9dc5 / 0x01000193 form", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  assert.equal(fnv1a("foobar"), 0xbf9cf968);
});

test("the seed is FNV-1a of residentGlyphSeed", () => {
  // Luca's print comes from Luca's fixed seed, whatever Luca's key is.
  assert.equal(fingerprintSeed(LUCA, LUCA), fnv1a(LUCA_IDENTITY_SEED));
  assert.equal(
    fingerprintSeed(key(7), key(7)),
    fingerprintSeed(LUCA, LUCA),
    "the same Luca print for every owner",
  );
  // Everyone else's from its own key, however the key is written.
  assert.equal(fingerprintSeed(key(9), LUCA), fnv1a(key(9)));
  assert.equal(
    fingerprintSeed(` ${key(9).toUpperCase()} `, LUCA),
    fnv1a(key(9)),
  );
  // No Luca known: every key is its own.
  assert.equal(fingerprintSeed(LUCA, null), fnv1a(LUCA));
});

test("a kind with no list is the seed's own", () => {
  for (const seed of [0, 1, 2, 3, 4, 5, 0xffffffff, 0x811c9dc5]) {
    assert.equal(kindFromSeed(seed), FINGERPRINT_KINDS[seed % 5]);
  }
});

test("the first five agents step past kinds an earlier one holds", () => {
  // Find five keys whose seeds all want the same kind.
  const wanted = [];
  for (let n = 1; wanted.length < 6 && n < 255; n++) {
    const k = key(n);
    if (fingerprintSeed(k, LUCA) % 5 === fingerprintSeed(LUCA, LUCA) % 5) {
      wanted.push(k);
    }
  }
  assert.equal(wanted.length, 6);
  const residents = [
    // Out of arrival order on purpose: the helper sorts.
    ...wanted.slice(0, 5).map((publicKey, i) => ({
      publicKey,
      arrivedAt: `2026-10-0${5 - i}T00:00:00Z`,
    })),
    { publicKey: LUCA, arrivedAt: "2026-10-09T00:00:00Z" },
  ];
  const kinds = assignFingerprintKinds(residents, LUCA);
  const lucaKind = kindFromSeed(fingerprintSeed(LUCA, LUCA));
  assert.equal(kinds.get(LUCA), lucaKind, "Luca first keeps its own kind");
  const firstFive = [LUCA, ...wanted.slice(0, 5).reverse().slice(0, 4)];
  assert.equal(new Set(firstFive.map((k) => kinds.get(k))).size, 5);
  // Past five, kinds repeat: the sixth wears its seed's own.
  const sixth = wanted[0];
  assert.equal(kinds.get(sixth), kindFromSeed(fingerprintSeed(sixth, LUCA)));
});

test("order is Luca first, then arrival; duplicates count once", () => {
  const a = key(10);
  const b = key(11);
  const residents = [
    { publicKey: b, arrivedAt: 2 },
    { publicKey: a, arrivedAt: 1 },
    { publicKey: a.toUpperCase(), arrivedAt: 0 },
  ];
  const kinds = assignFingerprintKinds(residents, null);
  assert.equal(kinds.size, 2);
  assert.equal(kinds.get(a), kindFromSeed(fnv1a(a)), "a arrived first");
  assert.notEqual(kinds.get(b), kinds.get(a));
});
