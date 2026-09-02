/* sketch-page.js — a drawing from the book as one tag.
 *
 *   <script type="module" src="sketch-page.js"></script>
 *   <sketch-page src="book/pages/002.json" autoplay controls speed="3"></sketch-page>
 *
 * or feed it marks directly:
 *
 *   el.ops = ops;            // an array of ops, or a page object { ops, title, ... }
 *   el.replay(); el.finish(); el.toDataURL();
 *
 * Attributes: src, autoplay (draw on load; otherwise show it finished),
 * controls (draw-again / finish chips), speed (1–8), hud (phase and progress,
 * on by default; hud="off" hides it).
 * Events: sketch-load { ops, meta }, sketch-done, sketch-error { message }.
 * Every list of marks passes validate.js before the engine draws it.
 * Size it with CSS width; the height follows the page's 4:3.
 */

import { MarkEngine } from './mark-engine.js';
import { sanitizeOps, sanitizePageMeta } from './validate.js';

const W = 880, H = 660;
const STYLE = `
  :host { display: block; width: 100%; --sketch-radius: 16px; --sketch-ink: rgba(255,255,255,.46); --sketch-live: rgb(150,205,255); font: 11px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; }
  .stage { position: relative; aspect-ratio: ${W} / ${H}; border-radius: var(--sketch-radius); overflow: hidden;
    border: .5px solid rgba(255,255,255,.09);
    background: radial-gradient(120% 100% at 30% 12%, #14151a 0%, #0b0b0f 52%, #07070a 100%); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .hud { position: absolute; left: 12px; bottom: 10px; display: flex; gap: 7px; align-items: center; font-size: 10px; letter-spacing: .04em; color: var(--sketch-ink); pointer-events: none; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,.3); }
  .dot.live { background: var(--sketch-live); }
  .pct { position: absolute; right: 12px; bottom: 10px; font-size: 10px; color: rgba(255,255,255,.32); font-variant-numeric: tabular-nums; pointer-events: none; }
  .controls { display: flex; gap: 6px; margin-top: 8px; }
  button { font: inherit; font-size: 10.5px; color: rgba(255,255,255,.6); cursor: pointer; background: transparent; border: .5px solid rgba(255,255,255,.13); border-radius: 999px; padding: 5px 11px; }
  button:hover { color: rgba(255,255,255,.95); border-color: rgba(255,255,255,.32); }
  button:focus-visible { outline: none; border-color: rgba(255,255,255,.5); }
  .err { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255,255,255,.4); font-size: 11px; padding: 20px; text-align: center; }
  [hidden] { display: none !important; }
`;

export class SketchPage extends HTMLElement {
  static get observedAttributes() { return ['src', 'speed']; }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="stage" part="stage">
        <canvas width="${W * 2}" height="${H * 2}"></canvas>
        <div class="hud" part="hud"><span class="dot"></span><span class="phase">Ready</span></div>
        <div class="pct"></div>
        <div class="err" hidden></div>
      </div>
      <div class="controls" part="controls" hidden>
        <button data-act="replay">Draw it again</button>
        <button data-act="finish">Jump to finished</button>
      </div>`;
    this._cv = root.querySelector('canvas');
    this._ctx = this._cv.getContext('2d');
    this._engine = new MarkEngine({ width: W, height: H, dpr: 2 });
    this._ops = [];
    this._meta = null;
    this._raf = 0;
    this._last = 0;
    this._doneFired = false;
    root.querySelector('[data-act="replay"]').onclick = () => this.replay();
    root.querySelector('[data-act="finish"]').onclick = () => this.finish();
  }

  connectedCallback() {
    this.shadowRoot.querySelector('.controls').hidden = !this.hasAttribute('controls');
    this.shadowRoot.querySelector('.hud').hidden = this.getAttribute('hud') === 'off';
    if (this.hasAttribute('src') && !this._ops.length) this._load(this.getAttribute('src'));
    this._loop();
  }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; }
  attributeChangedCallback(name, _old, val) {
    if (name === 'src' && val && this.isConnected) this._load(val);
  }

  get speed() { const s = Number(this.getAttribute('speed')); return s > 0 ? Math.min(8, s) : 3; }
  set speed(v) { this.setAttribute('speed', String(v)); }
  get ops() { return this._ops; }
  set ops(v) { this._setOps(v); }
  get meta() { return this._meta; }
  get engine() { return this._engine; }

  replay() { if (this._ops.length) { this._doneFired = false; this._engine.replay(); } }
  finish() { if (this._ops.length) { this._engine.finish(); this._fireDone(); } }
  toDataURL(type) { return this._engine.toDataURL(type); }

  async _load(src) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} loading ${src}`);
      this._setOps(await res.json());
    } catch (e) { this._error(e.message); }
  }

  _setOps(input) {
    const page = Array.isArray(input) ? { ops: input } : (input || {});
    const { ops, errors } = sanitizeOps(page.ops);
    if (!ops) { this._error('marks rejected: ' + errors.slice(0, 3).join('; ')); return; }
    this._ops = ops;
    this._meta = sanitizePageMeta(page).meta;
    this.shadowRoot.querySelector('.err').hidden = true;
    this._engine.load(ops);
    this._doneFired = false;
    if (this.hasAttribute('autoplay')) this._engine.replay(); else { this._engine.finish(); this._doneFired = true; }
    this.dispatchEvent(new CustomEvent('sketch-load', { detail: { ops, meta: this._meta } }));
    if (!this._raf && this.isConnected) this._loop();
  }

  _error(message) {
    const el = this.shadowRoot.querySelector('.err');
    el.textContent = message;
    el.hidden = false;
    this.dispatchEvent(new CustomEvent('sketch-error', { detail: { message } }));
  }

  _fireDone() {
    if (this._doneFired) return;
    this._doneFired = true;
    this.dispatchEvent(new CustomEvent('sketch-done'));
  }

  _loop() {
    const root = this.shadowRoot;
    const phase = root.querySelector('.phase'), pct = root.querySelector('.pct'), dot = root.querySelector('.dot');
    const e = this._engine, ctx = this._ctx;
    this._last = performance.now();
    const frame = () => {
      this._raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      const was = !!e.cursor;
      e.tick(dt, this.speed);
      e.composite(ctx);
      if (e.pen) {
        ctx.save(); ctx.scale(2, 2);
        ctx.beginPath();
        ctx.moveTo(e.pen.x, e.pen.y - 4); ctx.lineTo(e.pen.x - 4, e.pen.y - 24); ctx.lineTo(e.pen.x + 4, e.pen.y - 24);
        ctx.closePath(); ctx.fillStyle = 'rgba(226,238,255,.8)'; ctx.fill();
        ctx.restore();
      }
      const drawing = !!e.cursor;
      phase.textContent = e.phase || (e.done ? 'Finished' : 'Ready');
      pct.textContent = drawing ? Math.round(e.progress * 100) + '%' : e.done ? this._ops.length + ' marks' : '';
      dot.classList.toggle('live', drawing);
      if (was && !drawing && e.done) this._fireDone();
    };
    frame();
  }
}

if (!customElements.get('sketch-page')) customElements.define('sketch-page', SketchPage);
