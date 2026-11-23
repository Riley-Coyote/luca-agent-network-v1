/**
 * The mind's picture, as Mnemos draws it: the notebook's own page for The
 * mind (`mnemos/companion/page/mind/`), its engine, the shared files they
 * use and the herbarium that draws one memory, copied unchanged into
 * `public/mnemos-mind/` (WP-50, Decided 1). Beside them: MANIFEST.json (the
 * source commit, each file's path, size and sha256), and Mnemos's own
 * LICENSE (Apache-2.0) and NOTICE.
 *
 *   node scripts/mnemos-mind-copy.mjs check
 *   node scripts/mnemos-mind-copy.mjs copy <mnemos checkout> [commit]
 *
 * `check` is what the unit tests run (`checkCopy`): every copied file is
 * there and matches its sha256, nothing else is in the folder, and every
 * file the copied page and its modules ask for was copied.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const COPY_DIR = path.resolve(here, "../public/mnemos-mind");

/** The commit the copy was taken from. */
export const SOURCE_COMMIT = "33140b327c6a5bddb6ca27cce8002bebb36c6714";
const SOURCE_PAGE = "mnemos/companion/page";

/** Only what the mind and the drawings need. Of the fonts, only the one
 *  the mind itself is drawn with (its cells are its glyphs), and its
 *  license: the picture shows no text of the page's own. */
export const FILES = [
  "mind/index.html",
  "mind/mind.js",
  "mind/build.js",
  "mind/keep.js",
  "engine/anatomy.js",
  "engine/gl.js",
  "engine/glyphs.js",
  "engine/lens.js",
  "engine/lens.worker.js",
  "engine/motion.js",
  "engine/post.js",
  "engine/tissue.js",
  "shared/fonts.css",
  "shared/regions.js",
  "shared/room.css",
  "shared/room.js",
  "shared/specimens.js",
  "shared/tell.js",
  "shared/words.js",
  "shared/herbarium/figure.js",
  "shared/herbarium/specimen.js",
  "fonts/jetbrains-mono-nl.woff",
  "fonts/OFL-JetBrainsMono.txt",
];

/** The page's other faces, named by `shared/fonts.css` and left out: they
 *  set the page's words, and in the place the frame shows none of them
 *  (`mind/mindFrame.ts` sets what's left in the app's own type), so none is
 *  ever asked for. */
export const LEFT_OUT = [
  "fonts/inter-latin-wght-normal.woff2",
  "fonts/inter-latin-ext-wght-normal.woff2",
  "fonts/inter-tight-latin-wght-normal.woff2",
  "fonts/inter-tight-latin-ext-wght-normal.woff2",
  "fonts/newsreader-latin-opsz-normal.woff2",
  "fonts/newsreader-latin-ext-opsz-normal.woff2",
  "fonts/newsreader-latin-opsz-italic.woff2",
  "fonts/newsreader-latin-ext-opsz-italic.woff2",
  "fonts/silkscreen-400-normal.woff2",
];

/** Mnemos's own license and notice, from its repository's root. */
const NOTICES = ["LICENSE", "NOTICE"];
const MANIFEST = "MANIFEST.json";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** What one copied file asks for, relative to the copy's root: a module's
 *  imports and workers, a page's stylesheets and scripts, a stylesheet's
 *  fonts. Addresses with a scheme, and the page's data (`../data/`,
 *  `../act`, `../log/`), are not files. */
export function asksFor(file, text) {
  const dir = path.posix.dirname(file);
  const found = new Set();
  const patterns = [
    /\bfrom\s+'([^']+)'/g,
    /\bimport\s+'([^']+)'/g,
    /new URL\('([^']+)',\s*import\.meta\.url\)/g,
    /\b(?:href|src)="([^"]+)"/g,
    /url\(([^)'"]+)\)/g,
  ];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) {
      const ask = match[1];
      if (!ask || /^[a-z]+:/i.test(ask) || ask.startsWith("#")) continue;
      if (/^\.\.\/(data|act|log)\b/.test(ask)) continue;
      if (!ask.startsWith(".")) continue;
      found.add(path.posix.normalize(path.posix.join(dir, ask)));
    }
  return [...found];
}

/** Every problem with the copy, or none. */
export function checkCopy(dir = COPY_DIR) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
  } catch (error) {
    return [`no manifest: ${error.message}`];
  }
  if (manifest.source?.commit !== SOURCE_COMMIT)
    problems.push(
      `the manifest names another commit: ${manifest.source?.commit}`,
    );
  if (manifest.license !== "Apache-2.0")
    problems.push("the manifest doesn't name Apache-2.0");
  const listed = new Map((manifest.files ?? []).map((f) => [f.path, f]));
  for (const file of FILES)
    if (!listed.has(file)) problems.push(`not in the manifest: ${file}`);
  for (const [file, entry] of listed) {
    let bytes;
    try {
      bytes = readFileSync(path.join(dir, file));
    } catch {
      problems.push(`missing: ${file}`);
      continue;
    }
    if (sha256(bytes) !== entry.sha256) problems.push(`changed: ${file}`);
    if (bytes.length !== entry.bytes) problems.push(`another size: ${file}`);
  }
  const patches = manifest.patches ?? [];
  if (patches.length) problems.push(`patched: ${patches.map((p) => p.path)}`);
  const allowed = new Set([...listed.keys(), MANIFEST, ...NOTICES]);
  for (const file of listFiles(dir))
    if (!allowed.has(file)) problems.push(`not part of the copy: ${file}`);
  for (const notice of NOTICES) {
    try {
      readFileSync(path.join(dir, notice));
    } catch {
      problems.push(`no ${notice}`);
    }
  }
  if (!/Apache License/.test(readSafe(path.join(dir, "LICENSE"))))
    problems.push("LICENSE isn't the Apache License");
  for (const file of listed.keys()) {
    if (!/\.(html|js|css)$/.test(file)) continue;
    for (const asked of asksFor(file, readSafe(path.join(dir, file))))
      if (!listed.has(asked) && !LEFT_OUT.includes(asked))
        problems.push(`${file} asks for ${asked}, not copied`);
  }
  return problems;
}

function readSafe(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Copies the files from a Mnemos checkout at the commit, and writes the
 *  manifest. */
export function copyFrom(repo, commit = SOURCE_COMMIT) {
  const show = (spec) =>
    execFileSync("git", ["-C", repo, "show", `${commit}:${spec}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
  const files = [];
  for (const file of FILES) {
    const bytes = show(`${SOURCE_PAGE}/${file}`);
    const to = path.join(COPY_DIR, file);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    files.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  for (const notice of NOTICES)
    writeFileSync(path.join(COPY_DIR, notice), show(notice));
  const manifest = {
    what: "Mnemos's own picture of a mind (The mind) and its memory drawings, copied unchanged.",
    source: {
      project: "Mnemos",
      commit,
      path: SOURCE_PAGE,
    },
    license: "Apache-2.0",
    notice:
      "Copyright 2026 Riley Ralmuto. Licensed under the Apache License, Version 2.0 (LICENSE, beside this file); see NOTICE. The JetBrains Mono font is under the SIL Open Font License 1.1 (fonts/OFL-JetBrainsMono.txt).",
    patches: [],
    leftOut: {
      files: LEFT_OUT,
      why: "Faces for the page's own words; the place shows none of the page's words, so none is asked for.",
    },
    files,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
  writeFileSync(
    path.join(COPY_DIR, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [command = "check", repo, commit] = process.argv.slice(2);
  if (command === "copy") {
    if (!repo) {
      process.stderr.write("copy needs the path of a Mnemos checkout\n");
      process.exit(1);
    }
    const manifest = copyFrom(repo, commit);
    process.stdout.write(
      `copied ${manifest.files.length} files, ${manifest.totalBytes} bytes\n`,
    );
  }
  const problems = checkCopy();
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(problems.length ? 1 : 0);
}
