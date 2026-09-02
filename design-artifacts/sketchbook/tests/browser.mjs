/* tests/browser.mjs — node tests/browser.mjs [http://localhost:4192]
 * Drives embed.html in headless Chromium: the <sketch-page> element draws a
 * page from the book, and the browser sandbox runs a real page and refuses
 * hostile ones. Needs the folder served over HTTP and playwright on the
 * machine (PLAYWRIGHT env var points at its index.mjs if not the default).
 */

const base = process.argv[2] || 'http://localhost:4192';
const pw = process.env.PLAYWRIGHT || '/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1/prototypes/luca-mobile-companion/node_modules/playwright/index.mjs';
const { chromium } = await import(pw);
let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/embed.html?t=${Date.now()}`);
await page.waitForFunction(() => window.sandbox && document.getElementById('chat-2').ops.length > 0, null, { timeout: 30000 });

console.log('sketch-page');
{
  const r = await page.evaluate(async () => {
    const a = document.getElementById('chat-1'), b = document.getElementById('chat-2');
    a.finish();
    /* read the flattened page, not the on-screen canvas: headless may not paint a frame */
    const px = (el) => Math.round(el.toDataURL().length / 1000);
    await new Promise((r) => setTimeout(r, 120));
    return { aOps: a.ops.length, bOps: b.ops.length, aLit: px(a), bLit: px(b), aTitle: a.meta.title, bDone: b.engine.done, controls: !a.shadowRoot.querySelector('.controls').hidden, hudOff: b.shadowRoot.querySelector('.hud').hidden };
  });
  ok(r.aOps > 1000 && r.bOps > 300, `loads pages from the book (${r.aOps}, ${r.bOps} marks)`);
  ok(r.aLit > 60 && r.bLit > 20, `draws ink (${r.aLit} kB, ${r.bLit} kB flattened; blank is ~5)`);
  ok(r.aTitle === 'sphere and cube, one light', 'carries the page meta');
  ok(r.bDone && r.controls && r.hudOff, 'attributes: finished without autoplay, controls, hud off');
  const rej = await page.evaluate(() => new Promise((res) => {
    const el = document.createElement('sketch-page');
    el.addEventListener('sketch-error', (e) => res(e.detail.message));
    document.body.appendChild(el);
    el.ops = [{ k: 's', pts: [[0, 0], [1e9, 0]], layer: 'line', brush: 'liner' }];
  }));
  ok(/rejected/.test(rej), 'refuses bad marks handed to it directly');
}

console.log('browser sandbox');
{
  const moth = await (await fetch(`${base}/pages/moth.js`)).text();
  const r = await page.evaluate(async (src) => {
    try { const { ops, meta } = await window.sandbox.runPageSource(src, { modules: window.sandbox.modules }); return { n: ops.length, title: meta.title }; } catch (e) { return { error: e.message }; }
  }, moth);
  ok(r.n > 300 && r.title === 'moth on a branch', `runs a real page (${r.n} marks)`);
  const hand2 = await (await fetch(`${base}/pages/hand2.js`)).text();
  const r2 = await page.evaluate(async (src) => {
    try { const { ops } = await window.sandbox.runPageSource(src, { modules: window.sandbox.modules }); return { n: ops.length }; } catch (e) { return { error: e.message }; }
  }, hand2);
  ok(r2.n > 5000, `a page can import an earlier page's builder (${r2.n} marks)`);
  const cases = [
    [`export default { title: 'x', date: '2026-09-02', note: 'x', build: () => { fetch('https://example.com/'); return [{ k: 'p', ms: 1 }]; } };`, /fetch is not a function|not defined/i, 'no network: fetch is gone'],
    [`export default { title: 'x', date: '2026-09-02', note: 'x', build: () => { for (;;) {} } };`, /did not finish/, 'endless loop is stopped'],
    [`import '../book.mjs';\nexport default { title: 'x', date: '2026-09-02', note: 'x', build: () => [] };`, /not allowed/, 'cannot import outside the given modules'],
    [`export default { title: 'x', date: '2026-09-02', note: 'x', build: () => [typeof document, typeof window, typeof localStorage] };`, /rejected/, 'no document or window (and non-ops are rejected)'],
    [`export default { title: 'x', date: '2026-09-02', note: 'x', build: () => { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/', false); x.send(); return [{ k: 'p', ms: 1 }]; } };`, /XMLHttpRequest is not a constructor|not defined|Uncaught/, 'no network: XHR is gone'],
  ];
  for (const [src, re, name] of cases) {
    const out = await page.evaluate(async (s) => {
      try { const { ops } = await window.sandbox.runPageSource(s, { modules: window.sandbox.modules, timeoutMs: 3000 }); return { n: ops.length }; } catch (e) { return { error: e.message }; }
    }, src);
    ok(out.error && re.test(out.error), `${name}${out.error ? ` — "${out.error.slice(0, 70)}"` : ' — RAN: ' + JSON.stringify(out)}`);
  }
  const net = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /example\.com/.test(r.name)).length);
  ok(net === 0, 'no request to example.com ever left the page');
}

ok(errors.filter((e) => !/Content Security Policy|Refused to connect|Failed to fetch|net::ERR/.test(e)).length === 0, `no unexpected console errors${errors.length ? ` (${errors.length} CSP refusals logged, as intended)` : ''}`);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
