#!/usr/bin/env node
/* book.mjs — the agent-facing side of the sketchbook.
 *
 * The book is a folder: book/book.json is the index, book/pages/NNN.json is a
 * page — its marks (ops) and the source that made them. This tool is how an
 * agent writes into it. The viewer (index.html) only reads.
 *
 *   node book.mjs list
 *   node book.mjs read <n>                 print a page's meta and note
 *   node book.mjs write <module.js> [--refs 2,3] [--title ..] [--note ..] [--date ..]
 *   node book.mjs blank                    how many pages are left
 *
 * A page module exports default { title, date, note, build }. Its ops are
 * rounded to 1dp on save — a full drawing is ~100 kB, not 250.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BOOK_DIR = resolve(ROOT, 'book');
const INDEX = resolve(BOOK_DIR, 'book.json');
const PAGES = 48;

async function loadBook() {
  if (!existsSync(INDEX)) {
    return { id: 'sketchbook-1', title: 'Sketchbook', owner: 'claude', created: new Date().toISOString().slice(0, 10), pageCount: PAGES, pages: [] };
  }
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

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...args] = process.argv.slice(2);
const book = await loadBook();

if (cmd === 'list' || !cmd) {
  console.log(`${book.title} — ${book.pages.length} of ${book.pageCount} pages drawn`);
  for (const p of book.pages) {
    const refs = p.refs?.length ? `  ↺ ${p.refs.join(',')}` : '';
    console.log(`  ${String(p.index).padStart(2)}  ${p.date}  ${p.title}${refs}  (${p.opCount} marks)`);
  }
} else if (cmd === 'read') {
  const n = Number(args[0]);
  const meta = book.pages.find((p) => p.index === n);
  if (!meta) { console.error(`no page ${n}`); process.exit(1); }
  const page = JSON.parse(await readFile(resolve(BOOK_DIR, meta.file), 'utf8'));
  const { ops, source, ...rest } = page;
  console.log(JSON.stringify({ ...rest, opCount: ops.length, sourceBytes: source.length }, null, 2));
  if (args.includes('--source')) console.log('\n' + source);
} else if (cmd === 'blank') {
  console.log(book.pageCount - book.pages.length);
} else if (cmd === 'write') {
  const modPath = resolve(process.cwd(), args[0]);
  if (book.pages.length >= book.pageCount) { console.error('the book is full'); process.exit(1); }
  const mod = await import(pathToFileURL(modPath).href);
  const page = mod.default;
  if (!page || typeof page.build !== 'function') { console.error('a page module exports default { title, date, note, build }'); process.exit(1); }
  const ops = page.build().map(roundOp);
  const source = await readFile(modPath, 'utf8');
  const index = book.pages.length + 1;
  const refs = (arg(args, '--refs') || '').split(',').filter(Boolean).map(Number);
  const meta = {
    index,
    file: `pages/${String(index).padStart(3, '0')}.json`,
    title: arg(args, '--title') || page.title,
    date: arg(args, '--date') || page.date,
    note: arg(args, '--note') || page.note,
    refs,
    seed: page.seed ?? index,
    module: relative(ROOT, modPath),
    opCount: ops.length,
    state: 'drawn',
  };
  await mkdir(resolve(BOOK_DIR, 'pages'), { recursive: true });
  await writeFile(resolve(BOOK_DIR, meta.file), JSON.stringify({ ...meta, page: { w: 880, h: 660 }, source, ops }));
  book.pages.push(meta);
  await saveBook(book);
  console.log(`page ${index}: "${meta.title}" — ${ops.length} marks${refs.length ? `, reworks ${refs.join(', ')}` : ''}`);
} else {
  console.error('commands: list, read <n> [--source], write <module.js> [--refs a,b], blank');
  process.exit(1);
}
