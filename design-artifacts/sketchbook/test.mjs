/* test.mjs — node test.mjs
 * Checks the parts that must hold before another mind draws in the book:
 * the validator, the sandbox against hostile pages, and every page module in
 * pages/ building through the sandbox into marks that pass validation.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sanitizeOps, sanitizePageMeta, LIMITS } from './validate.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('validate');
{
  const good = [{ k: 'phase', name: 'a' }, { k: 's', pts: [[0, 0], [10, 10]], layer: 'line', brush: 'liner', w: 0.5 }, { k: 'd', x: 5, y: 5, r: 2, layer: 'accent', brush: 'chalk' }, { k: 'occ', poly: [[0, 0], [9, 0], [9, 9]], a: 0.9 }, { k: 'clamp', layer: 'tone', max: 0.4 }, { k: 'p', ms: 100 }];
  const r = sanitizeOps(good);
  ok(r.ops && r.ops.length === 6 && r.errors.length === 0, 'accepts every op kind');
  ok(sanitizeOps('nope').ops === null, 'rejects a non-array');
  ok(sanitizeOps([{ k: 's', pts: [[0, 0], [1e9, 0]], layer: 'line', brush: 'liner' }]).ops === null, 'rejects a point far off the page');
  ok(sanitizeOps([{ k: 's', pts: [[0, 0], [NaN, 0]], layer: 'line', brush: 'liner' }]).ops === null, 'rejects NaN');
  ok(sanitizeOps([{ k: 's', pts: [[0, 0], [1, 1]], layer: 'line', brush: 'fillRect' }]).ops === null, 'rejects an unknown brush');
  ok(sanitizeOps([{ k: 'raster', src: 'data:' }]).ops === null, 'rejects an unknown kind');
  ok(sanitizeOps(new Array(LIMITS.maxOps + 1).fill({ k: 'p', ms: 1 })).ops === null, 'rejects too many ops');
  const dirty = sanitizeOps([{ k: 's', pts: [[0, 0], [1, 1]], layer: 'line', brush: 'liner', w: 1, __proto__: null, extra: 'x', onload: 'x' }]);
  ok(dirty.ops && Object.keys(dirty.ops[0]).sort().join() === 'brush,k,layer,pts,w', 'strips unknown fields');
  const m = sanitizePageMeta({ title: 'x'.repeat(500), date: 'yesterday', note: 'n', refs: [1, -2, 'a', 3.5] });
  ok(m.meta.title.length === 120 && m.meta.date === '' && m.meta.refs.join() === '1', 'clamps meta');
}

console.log('sandbox');
const sandbox = async (file) => {
  const { stdout } = await run(process.execPath, ['--experimental-vm-modules', '--no-warnings', resolve(ROOT, 'sandbox.mjs'), resolve(ROOT, file)], { maxBuffer: 256 * 1024 * 1024 }).catch((e) => ({ stdout: e.stdout || '' }));
  return JSON.parse(stdout.trim().split('\n').pop() || '{"error":"no output"}');
};
{
  const t0 = Date.now();
  const cases = [
    ['tests/hostile-fetch.js', /fetch is not defined/, 'no network'],
    ['tests/hostile-import.js', /not allowed: node:fs/, 'no node modules'],
    ['tests/hostile-escape.js', /not allowed: book.mjs/, 'cannot import the book tool'],
    ['tests/hostile-loop.js', /timed out/, 'endless loop is stopped'],
  ];
  for (const [file, re, name] of cases) {
    const r = await sandbox(file);
    ok(r.error && re.test(r.error), `${name} (${file})`);
  }
  const p = await sandbox('tests/hostile-process.js');
  ok(p.ops && p.ops.every((v) => v === 'undefined'), 'no process, require, fetch or document');
  const e = await sandbox('tests/hostile-eval.js');
  ok(e.ops && /disallowed/.test(e.ops[0].err), 'no eval');
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s incl. the 15s loop timeout)`);
}

console.log('pages');
{
  const files = (await readdir(resolve(ROOT, 'pages'))).filter((f) => f.endsWith('.js') && f !== 'lib.js');
  for (const f of files) {
    const r = await sandbox('pages/' + f);
    if (r.error) { ok(false, `${f}: ${r.error}`); continue; }
    const s = sanitizeOps(r.ops);
    ok(s.ops && s.ops.length > 0, `${f} builds in the sandbox and validates (${r.ops.length} marks, ${s.stats.points} points)`);
  }
}

console.log('book tool');
{
  const dir = await mkdtemp(join(tmpdir(), 'sketchbook-'));
  const tool = (...a) => run(process.execPath, [resolve(ROOT, 'book.mjs'), ...a, '--book', dir], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  await tool('init', '--owner', 'test');
  const w = await tool('write', 'pages/moth.js');
  ok(/page 1: "moth on a branch"/.test(w.stdout), 'writes a page through the sandbox');
  const bad = await tool('write', 'tests/hostile-fetch.js').catch((e) => e);
  ok(bad.code === 1 && /sandbox: fetch is not defined/.test(bad.stderr), 'refuses a hostile page');
  const badRef = await tool('write', 'pages/moth.js', '--refs', '9').catch((e) => e);
  ok(badRef.code === 1 && /refs page 9/.test(badRef.stderr), 'refuses a ref to a page that is not there');
  const l = await tool('list');
  ok(/1 of 48 pages drawn/.test(l.stdout), 'lists the book');
  const idx = JSON.parse(await readFile(join(dir, 'book.json'), 'utf8'));
  ok(idx.owner === 'test' && idx.pages.length === 1, 'the index is right');
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
