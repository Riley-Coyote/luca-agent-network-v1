/* sandbox.mjs — run a page module another mind wrote, and return only marks.
 *
 *   node --experimental-vm-modules sandbox.mjs <page-module.js>
 *
 * The module is evaluated in a fresh V8 context with no globals beyond the
 * language itself: no require, no process, no fs, no fetch, no DOM. Imports are
 * linked by hand and only files inside this folder are allowed — the engine,
 * the helpers, and other pages (a page may import an earlier page's builder).
 * `build()` runs under a CPU time limit. book.mjs spawns this as a child with a
 * wall-clock kill, so a runaway page costs a process, not the book.
 *
 * Output: one JSON line on stdout — { ops, meta } or { error }.
 */

import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BUILD_TIMEOUT_MS = 15000;
const FORBIDDEN = new Set(['book.mjs', 'sandbox.mjs', 'validate.js', 'test.mjs']);

function allowed(path) {
  const rel = relative(ROOT, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
  if (extname(path) !== '.js') return false;
  if (FORBIDDEN.has(rel)) return false;
  if (rel.startsWith('book/') || rel.startsWith('reference/') || rel.startsWith('node_modules/')) return false;
  return true;
}

async function run(entry) {
  if (typeof vm.SourceTextModule !== 'function') throw new Error('run with --experimental-vm-modules');
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    name: 'sketchbook-sandbox',
  });
  const cache = new Map();
  async function load(path) {
    if (cache.has(path)) return cache.get(path);
    if (!allowed(path)) throw new Error(`import not allowed: ${relative(ROOT, path) || path}`);
    const source = await readFile(path, 'utf8');
    const mod = new vm.SourceTextModule(source, {
      context,
      identifier: relative(ROOT, path),
      importModuleDynamically: () => { throw new Error('dynamic import is not allowed'); },
    });
    cache.set(path, mod);
    return mod;
  }
  const linker = async (specifier, referencing) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`import not allowed: ${specifier}`);
    const from = resolve(ROOT, referencing.identifier);
    return load(resolve(dirname(from), specifier));
  };
  const root = await load(resolve(entry));
  await root.link(linker);
  await root.evaluate({ timeout: BUILD_TIMEOUT_MS });
  const page = root.namespace.default;
  if (!page || typeof page.build !== 'function') throw new Error('page module must export default { title, date, note, build }');
  context.__page = page;
  const ops = vm.runInContext('__page.build()', context, { timeout: BUILD_TIMEOUT_MS });
  /* everything crosses back as plain JSON; nothing from the context survives */
  const json = JSON.stringify({
    ops,
    meta: { title: page.title, date: page.date, note: page.note, refs: page.refs, seed: page.seed },
  });
  return JSON.parse(json);
}

const entry = process.argv[2];
try {
  if (!entry) throw new Error('usage: sandbox.mjs <page-module.js>');
  const out = await run(entry);
  process.stdout.write(JSON.stringify(out) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String(e && e.message ? e.message : e) }) + '\n');
  process.exitCode = 2;
}
