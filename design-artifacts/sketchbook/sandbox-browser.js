/* sandbox-browser.js — run a page module another mind wrote, in a browser,
 * and get back only marks.
 *
 *   import { runPageSource } from './sandbox-browser.js';
 *   const { ops, meta } = await runPageSource(source, { modules, timeoutMs });
 *
 * `modules` maps file names to source text for everything the page may import
 * — at least mark-engine.js, usually lib.js, maybe an earlier page. Load them
 * with `loadModules()` below. Import specifiers are matched by file name.
 *
 * How it is sealed: the code runs in a Worker inside an <iframe sandbox>
 * with an opaque origin and a Content Security Policy of default-src 'none',
 * so it has no DOM, no storage, and every network request is refused. Modules
 * are handed to it as data: URLs (blob: workers do not start in an opaque
 * origin), so nothing is fetched. The
 * worker is terminated at the time limit. What comes back is JSON, and the
 * caller should still pass it through validate.js — this module does.
 */

import { sanitizeOps, sanitizePageMeta } from './validate.js';

const FRAME_SRC = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; worker-src data:; child-src data:">
<script>
(() => {
  const SPEC = /(from\\s*|import\\s*\\(\\s*|^\\s*import\\s+)(['"])([^'"]+)\\2/gm;
  const base = (s) => s.split('/').pop();
  /* data: URLs, not blob: — an opaque-origin frame cannot start a worker from a blob */
  const mk = (text) => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(text).replace(/'/g, '%27').replace(/\\(/g, '%28').replace(/\\)/g, '%29');
  function link(modules, entryName, entrySource) {
    const all = { ...modules, [entryName]: entrySource };
    const urls = {};
    const deps = {};
    for (const name of Object.keys(all)) {
      deps[name] = [];
      for (const m of all[name].matchAll(SPEC)) { const b = base(m[3]); if (b !== name) deps[name].push(b); }
    }
    let guard = 0;
    while (Object.keys(urls).length < Object.keys(all).length && guard++ < 64) {
      for (const name of Object.keys(all)) {
        if (urls[name]) continue;
        if (deps[name].some((d) => !urls[d])) {
          if (deps[name].some((d) => !(d in all))) throw new Error('import not allowed: ' + deps[name].find((d) => !(d in all)));
          continue;
        }
        const text = all[name].replace(SPEC, (s, pre, q, spec) => pre + q + (urls[base(spec)] || spec) + q);
        urls[name] = mk(text);
      }
    }
    if (!urls[entryName]) throw new Error('circular or unresolved imports');
    return urls[entryName];
  }
  window.addEventListener('message', (e) => {
    const { id, source, modules, timeoutMs } = e.data || {};
    if (!id) return;
    const reply = (msg) => e.source.postMessage({ id, ...msg }, '*');
    let worker;
    try {
      const entry = link(modules || {}, '__page__.js', source);
      /* belt and braces: the CSP already refuses every request; take the functions away too */
      const code = 'for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "caches", "indexedDB"]) { try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {} }' +
        'try { Object.defineProperty(self.navigator, "sendBeacon", { value: undefined }); } catch (e) {}' +
        'const m = await import(' + JSON.stringify(entry) + ');' +
        'const p = m.default; if (!p || typeof p.build !== "function") throw new Error("page module must export default { title, date, note, build }");' +
        'const ops = p.build();' +
        'postMessage(JSON.parse(JSON.stringify({ ops, meta: { title: p.title, date: p.date, note: p.note, refs: p.refs, seed: p.seed } })));';
      worker = new Worker(mk(code), { type: 'module' });
    } catch (err) { reply({ error: String(err && err.message || err) }); return; }
    const t = setTimeout(() => { worker.terminate(); reply({ error: 'the page did not finish within ' + (timeoutMs / 1000) + 's' }); }, timeoutMs || 15000);
    worker.onmessage = (m) => { clearTimeout(t); worker.terminate(); reply(m.data); };
    worker.onerror = (err) => { clearTimeout(t); worker.terminate(); reply({ error: (err.message || 'the page failed') + (err.filename ? ' [' + String(err.filename).slice(0, 40) + ':' + err.lineno + ']' : '') }); err.preventDefault && err.preventDefault(); };
  });
})();
</script>`;

let frame = null;
let ready = null;
const pending = new Map();

function ensureFrame() {
  if (frame) return ready;
  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
  frame.srcdoc = FRAME_SRC;
  ready = new Promise((res) => { frame.onload = () => res(); });
  document.body.appendChild(frame);
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const { id, ...rest } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p(rest);
  });
  return ready;
}

/** Fetch the module sources a page may import, keyed by file name. */
export async function loadModules(urls) {
  const out = {};
  await Promise.all(urls.map(async (u) => { out[u.split('/').pop()] = await (await fetch(u)).text(); }));
  return out;
}

/**
 * Run page source in the sealed box. Resolves to { ops, meta, stats } with
 * validated marks, or rejects with the reason.
 */
export async function runPageSource(source, { modules = {}, timeoutMs = 15000 } = {}) {
  await ensureFrame();
  const id = Math.random().toString(36).slice(2);
  const result = await new Promise((res) => {
    pending.set(id, res);
    frame.contentWindow.postMessage({ id, source, modules, timeoutMs }, '*');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ error: 'the sandbox did not answer' }); } }, timeoutMs + 2000);
  });
  if (result.error) throw new Error(result.error);
  const { ops, errors, stats } = sanitizeOps(result.ops);
  if (!ops) throw new Error('the marks were rejected: ' + errors.join('; '));
  const { meta } = sanitizePageMeta(result.meta || {});
  return { ops, meta, stats };
}
