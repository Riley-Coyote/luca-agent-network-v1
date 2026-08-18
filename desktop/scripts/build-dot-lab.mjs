/**
 * Build the sandpile lab into ONE self-contained HTML file.
 *
 * Deliberately not served by the dev server. This repo can have more than one
 * vite instance bound to the same port across worktrees — one on IPv4, one on
 * IPv6 — and which one `localhost` resolves to is not something a design tool
 * should depend on. A single file with no network requests cannot be served the
 * wrong worktree's copy.
 */

import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const DESKTOP = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(DESKTOP, "dist", "_lab");
const ENTRY = path.join(DESKTOP, "src/shared/ui/dot-display/lab/entry.ts");
const TEMPLATE = path.join(DESKTOP, "scripts/dot-lab.template.html");
const OUT_HTML = path.join(OUT_DIR, "dot-lab.html");

await build({
  configFile: false,
  logLevel: "warn",
  resolve: { alias: { "@": path.join(DESKTOP, "src") } },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // Readable on purpose: when a scene misbehaves the first move is to open
    // devtools on this file, and minified physics is unreadable.
    minify: false,
    lib: {
      entry: ENTRY,
      name: "LUCA_DOT_LAB",
      formats: ["iife"],
      fileName: () => "lab.js",
    },
  },
});

const bundle = fs.readFileSync(path.join(OUT_DIR, "lab.js"), "utf8");
const template = fs.readFileSync(TEMPLATE, "utf8");

if (!template.includes("__BUNDLE__")) {
  throw new Error("dot-lab: template has no __BUNDLE__ placeholder");
}
// A literal closing script tag anywhere in the bundle would end the inline
// script early and silently truncate the page.
if (/<\/script/i.test(bundle)) {
  throw new Error("dot-lab: bundle contains a closing script tag");
}

// Function replacer: a plain string replacement would interpret `$&` and
// friends inside the bundle as capture-group references.
fs.writeFileSync(
  OUT_HTML,
  template.replace("__BUNDLE__", () => bundle),
  "utf8",
);

const kb = (fs.statSync(OUT_HTML).size / 1024).toFixed(1);
console.log(`${OUT_HTML}  (${kb} kB, self-contained)`);
