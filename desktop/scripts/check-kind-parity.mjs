#!/usr/bin/env node
// Rust ↔ TypeScript event-kind parity guard.
//
// `crates/buzz-core/src/kind.rs` is the single source of truth for every event
// kind integer; `desktop/src/shared/constants/kinds.ts` mirrors the subset the
// desktop app needs. A drifted mirror is silent and total — the client sends or
// filters on a number the relay classifies as some other feature entirely — so
// this compares the two by NAME and fails on any value mismatch.
//
// The TS file is deliberately a subset: only names present in BOTH files are
// compared. Several TS names are deliberate local aliases for a differently
// named Rust const (`KIND_REPO_ANNOUNCEMENT` ↔ `KIND_GIT_REPO_ANNOUNCEMENT`,
// the `30078` app-data family), so a TS-only name is reported but does not
// fail — this guard exists to catch a shared name whose VALUE drifted.
//
// Run: `pnpm check:kind-parity` (wired into `pnpm check`).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rustPath = fileURLToPath(
  new URL("../../crates/buzz-core/src/kind.rs", import.meta.url),
);
const tsPath = fileURLToPath(
  new URL("../src/shared/constants/kinds.ts", import.meta.url),
);

/** `pub const KIND_FOO: u32 = 40002;` — integer literals only, `_` separators allowed. */
const RUST_CONST =
  /^\s*pub const (KIND_[A-Z0-9_]+)\s*:\s*u\d+\s*=\s*([0-9_]+)\s*;/gm;
/** `export const KIND_FOO = 40002;` — integer literals only. */
const TS_CONST =
  /^\s*export const (KIND_[A-Z0-9_]+)\s*(?::\s*number\s*)?=\s*([0-9_]+)\s*;/gm;

/** Collect `name -> value` pairs, refusing a duplicate definition of either side. */
function collect(source, pattern, label, errors) {
  const found = new Map();
  for (const match of source.matchAll(pattern)) {
    const [, name, literal] = match;
    const value = Number.parseInt(literal.replaceAll("_", ""), 10);
    if (!Number.isSafeInteger(value)) {
      errors.push(`${label}: ${name} is not a safe integer (${literal})`);
      continue;
    }
    if (found.has(name) && found.get(name) !== value) {
      errors.push(
        `${label}: ${name} defined twice with different values (${found.get(name)} and ${value})`,
      );
    }
    found.set(name, value);
  }
  return found;
}

const errors = [];
const rust = collect(
  await readFile(rustPath, "utf8"),
  RUST_CONST,
  "kind.rs",
  errors,
);
const ts = collect(
  await readFile(tsPath, "utf8"),
  TS_CONST,
  "kinds.ts",
  errors,
);

if (rust.size === 0) {
  errors.push(
    "kind.rs: parsed zero KIND_* constants — the guard is not reading the file",
  );
}
if (ts.size === 0) {
  errors.push(
    "kinds.ts: parsed zero KIND_* constants — the guard is not reading the file",
  );
}

let compared = 0;
const tsOnly = [];
for (const [name, tsValue] of [...ts].sort(([a], [b]) => a.localeCompare(b))) {
  if (!rust.has(name)) {
    tsOnly.push(`${name} = ${tsValue}`);
    continue;
  }
  compared += 1;
  const rustValue = rust.get(name);
  if (rustValue !== tsValue) {
    errors.push(`${name}: kind.rs = ${rustValue}, kinds.ts = ${tsValue}`);
  }
}

if (compared === 0 && errors.length === 0) {
  errors.push(
    "no KIND_* name is present in both files — the guard would pass vacuously",
  );
}

if (errors.length > 0) {
  console.error("Event-kind parity check FAILED:\n");
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    "\nkind.rs is the source of truth. Fix desktop/src/shared/constants/kinds.ts to match.",
  );
  process.exit(1);
}

console.log(
  `Event-kind parity OK — ${compared} shared constant${compared === 1 ? "" : "s"} agree ` +
    `(${rust.size} in kind.rs, ${ts.size} in kinds.ts).`,
);
if (tsOnly.length > 0) {
  console.log(
    `  ${tsOnly.length} TS-only name${tsOnly.length === 1 ? "" : "s"} (local alias or ` +
      `desktop-only kind), not compared: ${tsOnly.join(", ")}`,
  );
}
