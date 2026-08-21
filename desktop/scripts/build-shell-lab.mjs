/**
 * Build the desktop shell into ONE self-contained HTML file.
 *
 * Same reasoning as `build-glyph-lab.mjs`: this repo can have more than one
 * vite instance bound to the same port across worktrees, and which one
 * `localhost` resolves to is not something a design tool should depend on. A
 * single file with no network requests cannot be served the wrong worktree's
 * copy — and it opens with a double-click, with no dev server and no Tauri.
 *
 * The shell is the whole React app rather than one component, so this uses a
 * normal vite app build (same plugins, same aliases, same production settings
 * as the shipped app — `configFile` points at the app's own vite.config.ts)
 * tuned three ways for self-containment:
 *   - one chunk, no code splitting, no CSS split
 *   - every asset inlined as a data URI, fonts included
 *   - then the emitted JS and CSS are folded into the HTML here
 *
 * What actually renders is `src/testing/labEntry.tsx` — the real `<App/>` with
 * the real providers, in front of the E2E mock bridge. Scene data lives in
 * `src/testing/labScene.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const DESKTOP = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const OUT_DIR = path.join(DESKTOP, "dist", "_shell-lab");
const TEMPLATE = path.join(DESKTOP, "scripts/shell-lab.template.html");
const OUT_HTML = path.join(REPO, "design-lab", "shell-lab.html");

await build({
  base: "./",
  configFile: path.join(DESKTOP, "vite.config.ts"),
  logLevel: "warn",
  mode: "production",
  root: DESKTOP,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // Fonts are the big ones (~350 kB of woff2). Inlining them is the whole
    // point: a design lab that asks the network for its typeface is not a
    // single file.
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    rollupOptions: {
      input: TEMPLATE,
      // Lazy routes, vendor chunks, and the dynamic imports behind them all
      // fold into the one chunk. A second chunk is a second network request,
      // and on file:// a network request is a CORS error and a blank page.
      output: { codeSplitting: false },
    },
  },
});

// Vite mirrors the input path under outDir, so the emitted page keeps the
// template's own relative location.
const emittedHtmlPath = path.join(
  OUT_DIR,
  path.relative(DESKTOP, TEMPLATE).replaceAll(path.sep, "/"),
);
const emittedHtml = fs.readFileSync(emittedHtmlPath, "utf8");

const scriptMatch = emittedHtml.match(
  /<script[^>]*\ssrc="([^"]+\.js)"[^>]*><\/script>/,
);
if (!scriptMatch) {
  throw new Error("shell-lab: no module script in the emitted HTML");
}
const styleMatch = emittedHtml.match(
  /<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+\.css)"[^>]*>/,
);
if (!styleMatch) {
  throw new Error("shell-lab: no stylesheet in the emitted HTML");
}

const assetPath = (href) =>
  path.join(OUT_DIR, "assets", path.basename(href.split("?")[0]));
const bundle = fs.readFileSync(assetPath(scriptMatch[1]), "utf8");
const styles = fs.readFileSync(assetPath(styleMatch[1]), "utf8");

// A literal closing script tag anywhere in the bundle would end the inline
// script early and silently truncate the page.
if (/<\/script/i.test(bundle)) {
  throw new Error("shell-lab: bundle contains a closing script tag");
}

// Anything left in `assets/` beside the one chunk and the one stylesheet is a
// file the page would have to fetch, and a file:// page cannot fetch anything
// (cross-origin from `null`). A second .js here means code splitting is back
// on and the lab is broken even though the build "succeeded" — the exact
// failure this check exists to catch.
const emitted = fs.readdirSync(path.join(OUT_DIR, "assets"));
const extraScripts = emitted.filter(
  (name) => name.endsWith(".js") && name !== path.basename(scriptMatch[1]),
);
if (extraScripts.length > 0) {
  throw new Error(
    `shell-lab: the build split into ${extraScripts.length + 1} chunks; only one can be inlined:\n  ${extraScripts.join("\n  ")}`,
  );
}
const strays = emitted.filter(
  (name) => !name.endsWith(".js") && !name.endsWith(".css"),
);
if (strays.length > 0) {
  throw new Error(
    `shell-lab: ${strays.length} asset(s) were not inlined and would be fetched:\n  ${strays.join("\n  ")}`,
  );
}

// Function replacers: a plain string replacement would interpret `$&` and
// friends inside the bundle as capture-group references.
const page = emittedHtml
  .replace(styleMatch[0], () => `<style>\n${styles}\n</style>`)
  .replace(
    scriptMatch[0],
    () => `<script type="module">\n${bundle}\n</script>`,
  );

fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
fs.writeFileSync(OUT_HTML, page, "utf8");

const mb = (fs.statSync(OUT_HTML).size / 1024 / 1024).toFixed(2);
console.log(`${OUT_HTML}  (${mb} MB, self-contained)`);
