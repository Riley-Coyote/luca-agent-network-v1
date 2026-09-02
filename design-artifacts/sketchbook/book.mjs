#!/usr/bin/env node
/* book.mjs — the agent-facing side of the sketchbook.
 *
 * A book is a folder: book.json is the index, pages/NNN.json is a page — its
 * marks (ops) and the source that made them. This tool is how an agent writes
 * into it. The viewer (index.html) only reads.
 *
 *   node book.mjs init  --owner <name> [--title ..] [--book <dir>]
 *   node book.mjs list                     [--book <dir>]
 *   node book.mjs read  <n> [--source]     [--book <dir>]
 *   node book.mjs write <module.js> [--refs 2,3] [--title ..] [--note ..] [--date ..]
 *   node book.mjs blank
 *
 * `--book <dir>` picks the book (default: ./book). One folder per mind.
 *
 * write runs the module in the sandbox (sandbox.mjs: no globals, no network,
 * imports only from this folder, a time limit) and keeps only marks that pass
 * validate.js. `--unsafe` imports the module directly; for your own pages
 * while developing, never for someone else's.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeOps, sanitizePageMeta } from './validate.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PAGES = 48;
const WALL_MS = 30000;

const [cmd, ...args] = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);
const BOOK_DIR = resolve(process.cwd(), arg('--book') || resolve(ROOT, 'book'));
const INDEX = resolve(BOOK_DIR, 'book.json');

async function loadBook() {
  if (!existsSync(INDEX)) throw new Error(`no book at ${relative(process.cwd(), BOOK_DIR) || '.'} — run: node book.mjs init --owner <name>`);
  return JSON.parse(await readFile(INDEX, 'utf8'));
}
async function saveBook(book) {
  await mkdir(resolve(BOOK_DIR, 'pages'), { recursive: true });
  await writeFile(INDEX, JSON.stringify(book, null, 2) + '\n');
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
function roundOp(op) {
  const o = { ...op };
  if (o.pts) o.pts = o.pts.map((p) => [r1(p[0]), r1(p[1])]);
  if (o.poly) o.poly = o.poly.map((p) => [r1(p[0]), r1(p[1])]);
  for (const k of ['x', 'y', 'r']) if (typeof o[k] === 'number') o[k] = r1(o[k]);
  if (typeof o.w === 'number') o.w = r2(o.w);
  return o;
}

/** Run a page module and get { ops, meta } — through the sandbox unless --unsafe. */
async function buildPage(modPath) {
  if (flag('--unsafe')) {
    const mod = await import(pathToFileURL(modPath).href);
    const page = mod.default;
    if (!page || typeof page.build !== 'function') throw new Error('a page module exports default { title, date, note, build }');
    return { ops: page.build(), meta: { title: page.title, date: page.date, note: page.note, refs: page.refs, seed: page.seed } };
  }
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--experimental-vm-modules', '--no-warnings', resolve(ROOT, 'sandbox.mjs'), modPath],
    { timeout: WALL_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 },
  ).catch((e) => {
    if (e.killed) throw new Error(`the page did not finish within ${WALL_MS / 1000}s`);
    if (e.stdout) return { stdout: e.stdout };
    throw e;
  });
  const out = JSON.parse(stdout.trim().split('\n').pop());
  if (out.error) throw new Error(`sandbox: ${out.error}`);
  return out;
}

try {
  if (cmd === 'init') {
    const owner = arg('--owner');
    if (!owner) throw new Error('init needs --owner <name>');
    if (existsSync(INDEX)) throw new Error(`a book already exists at ${relative(process.cwd(), BOOK_DIR)}`);
    const book = {
      id: `sketchbook-${owner.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
      title: arg('--title') || 'Sketchbook',
      owner,
      created: new Date().toISOString().slice(0, 10),
      pageCount: Number(arg('--pages')) || PAGES,
      pages: [],
    };
    await saveBook(book);
    console.log(`new book for ${owner} at ${relative(process.cwd(), BOOK_DIR) || '.'} — ${book.pageCount} blank pages`);
  } else if (cmd === 'list' || !cmd) {
    const book = await loadBook();
    console.log(`${book.title} (${book.owner}) — ${book.pages.length} of ${book.pageCount} pages drawn`);
    for (const p of book.pages) {
      const refs = p.refs?.length ? `  ↺ ${p.refs.join(',')}` : '';
      console.log(`  ${String(p.index).padStart(2)}  ${p.date}  ${p.title}${refs}  (${p.opCount} marks)`);
    }
  } else if (cmd === 'read') {
    const book = await loadBook();
    const n = Number(args[0]);
    const meta = book.pages.find((p) => p.index === n);
    if (!meta) throw new Error(`no page ${n}`);
    const page = JSON.parse(await readFile(resolve(BOOK_DIR, meta.file), 'utf8'));
    const { ops, source, ...rest } = page;
    console.log(JSON.stringify({ ...rest, opCount: ops.length, sourceBytes: source.length }, null, 2));
    if (flag('--source')) console.log('\n' + source);
  } else if (cmd === 'blank') {
    const book = await loadBook();
    console.log(book.pageCount - book.pages.length);
  } else if (cmd === 'write') {
    const book = await loadBook();
    if (!args[0] || args[0].startsWith('--')) throw new Error('write needs a page module');
    const modPath = resolve(process.cwd(), args[0]);
    if (book.pages.length >= book.pageCount) throw new Error('the book is full');
    const built = await buildPage(modPath);
    const { ops, errors, stats } = sanitizeOps((built.ops || []).map(roundOp));
    if (!ops) throw new Error(`the page's marks were rejected:\n  ${errors.join('\n  ')}`);
    if (ops.length === 0) throw new Error('the page has no marks');
    const { meta: m } = sanitizePageMeta({
      title: arg('--title') || built.meta.title,
      date: arg('--date') || built.meta.date,
      note: arg('--note') || built.meta.note,
      refs: (arg('--refs') || '').split(',').filter(Boolean).map(Number).concat(built.meta.refs || []),
    });
    if (!m.note) throw new Error('a page needs a note: what was attempted, and where it failed');
    for (const r of m.refs) if (!book.pages.some((p) => p.index === r)) throw new Error(`refs page ${r}, which is not in the book`);
    const source = await readFile(modPath, 'utf8');
    const index = book.pages.length + 1;
    const meta = {
      index,
      file: `pages/${String(index).padStart(3, '0')}.json`,
      ...m,
      date: m.date || new Date().toISOString().slice(0, 10),
      seed: built.meta.seed ?? index,
      module: relative(ROOT, modPath),
      opCount: ops.length,
      points: stats.points,
      state: 'drawn',
    };
    await mkdir(resolve(BOOK_DIR, 'pages'), { recursive: true });
    await writeFile(resolve(BOOK_DIR, meta.file), JSON.stringify({ ...meta, page: { w: 880, h: 660 }, source, ops }));
    book.pages.push(meta);
    await saveBook(book);
    console.log(`page ${index}: "${meta.title}" — ${ops.length} marks${meta.refs.length ? `, reworks ${meta.refs.join(', ')}` : ''}`);
  } else {
    throw new Error('commands: init --owner <name>, list, read <n> [--source], write <module.js> [--refs a,b], blank   (--book <dir> on any)');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
