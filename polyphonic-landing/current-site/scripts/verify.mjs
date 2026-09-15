/* Verification for the v3 page (WP-18). Every assertion is measured in a real browser against a
   running build; nothing is inferred from the source. Origin comes from VERIFY_ORIGIN so the port
   never has to be edited into this file:
     VERIFY_ORIGIN=http://127.0.0.1:8749 node scripts/verify.mjs                                   */
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const ORIGIN = (process.env.VERIFY_ORIGIN || 'http://127.0.0.1:8744').replace(/\/$/, '');
const out = {};
const browser = await chromium.launch();
/* Walk the whole page so every IntersectionObserver fires, then come back to the top. Each
   [data-rv] is brought into view explicitly: a fast programmatic scroll can skip past one. */
const settle = async (page, ms = 11000) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => { let y = 0; const s = () => { window.scrollTo(0, y); y += 400; if (y < document.body.scrollHeight) setTimeout(s, 60); else setTimeout(r, 300); }; s(); }));
  const n = await page.evaluate(() => document.querySelectorAll('[data-rv]').length);
  for (let i = 0; i < n; i++) {
    await page.evaluate(k => document.querySelectorAll('[data-rv]')[k].scrollIntoView({block: 'center'}), i);
    await page.waitForTimeout(60);
  }
  /* IntersectionObserver delivers asynchronously: jumping straight back to the top would cancel
     the pending entries for the last few elements, so give them a frame or two to land. */
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(ms);
};
const open = async (w = 1440, h = 900, opts = {}) => {
  const page = await browser.newPage({viewport: {width: w, height: h}, ...opts});
  const errs = [], hosts = new Set();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('request', r => { try { hosts.add(new URL(r.url()).host); } catch {} });
  await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
  return {page, errs, hosts};
};

/* ---- 1. no third-party requests, clean console, no overflow, phone nav fits ---- */
{
  const ext = {}, ovf = {}, consoleMsgs = [];
  for (const w of [320, 390, 768, 1024, 1440]) {
    const {page, errs, hosts} = await open(w, w < 500 ? 844 : 900);
    await settle(page);
    ext[w] = [...hosts];
    ovf[w] = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    consoleMsgs.push(...errs);
    if (w === 320 || w === 390) {
      out.phone_nav_fits = out.phone_nav_fits || {};
      out.phone_nav_fits[w] = await page.evaluate(() => {
        const h = document.querySelector('header');
        const pill = [...h.querySelectorAll('a')].find(a => /get the beta/i.test(a.textContent));
        /* the three text links only; the wordmark and the pill are expected to stay */
        const NAV = ['how it works', 'works with', 'beta'];
        const links = [...h.querySelectorAll('a')].filter(a => NAV.includes(a.textContent.trim().toLowerCase()));
        const vis = links.filter(a => a.getBoundingClientRect().width > 0);
        const r = pill.getBoundingClientRect();
        return {pill_href: pill.getAttribute('href'), pill_right: Math.round(r.right), viewport: window.innerWidth,
                pill_inside: r.right <= window.innerWidth && r.left >= 0, text_links_visible: vis.length,
                header_overflow: h.scrollWidth > window.innerWidth + 1};
      });
    }
    await page.close();
  }
  out.external_requests = ext;
  out.overflow = ovf;
  out.console = {errors_warnings: consoleMsgs.length, messages: consoleMsgs};
  for (const w of Object.keys(ovf)) assert.equal(ovf[w], false, `overflow at ${w}`);
  for (const w of Object.keys(ext)) assert.equal(ext[w].length, 1, `third-party request at ${w}: ${ext[w]}`);
  assert.equal(consoleMsgs.length, 0, 'console not clean: ' + consoleMsgs.join(' | '));
  for (const w of [320, 390]) {
    assert.equal(out.phone_nav_fits[w].pill_inside, true, `nav pill off-screen at ${w}`);
    assert.equal(out.phone_nav_fits[w].text_links_visible, 0, `text links still shown at ${w}`);
    assert.equal(out.phone_nav_fits[w].pill_href, '#beta', `nav pill target at ${w}`);
  }
  {
    const p = await browser.newPage({viewport: {width: 700, height: 900}});
    await p.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
    await p.evaluate(() => document.fonts.ready);
    out.phone_nav_fits.above_breakpoint_700 = await p.evaluate(() => {
      const NAV = ['how it works', 'works with', 'beta'];
      return [...document.querySelectorAll('header a')].filter(a => NAV.includes(a.textContent.trim().toLowerCase()) && a.getBoundingClientRect().width > 0).length;
    });
    await p.close();
    assert.equal(out.phone_nav_fits.above_breakpoint_700, 3, 'the nav links do not come back above 640px');
  }
}

/* ---- 2. fonts really load (measureText proof) and nothing shifts when they swap ---- */
{
  const {page} = await open();
  await page.evaluate(() => document.fonts.ready);
  out.fonts = await page.evaluate(() => {
    const m = (family, fallback) => {
      const c = document.createElement('canvas').getContext('2d');
      const probe = 'Polyphonic 0123 agents';
      c.font = `24px "${family}", ${fallback}`; const a = c.measureText(probe).width;
      c.font = `24px ${fallback}`; const b = c.measureText(probe).width;
      return {with_family: Math.round(a * 100) / 100, fallback_only: Math.round(b * 100) / 100, differs: Math.abs(a - b) > 0.5};
    };
    return {
      loaded_faces: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`),
      instrument_sans: m('Instrument Sans', 'sans-serif'),
      fragment_mono: m('Fragment Mono', 'monospace'),
      check_instrument: document.fonts.check('16px "Instrument Sans"'),
      check_fragment: document.fonts.check('11px "Fragment Mono"'),
      banned_on_page: [...new Set([...document.querySelectorAll('*')].map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))]
        .filter(f => /^(Inter|Doto|JetBrains Mono)$/i.test(f))
    };
  });
  assert.equal(out.fonts.check_instrument, true, 'Instrument Sans did not load');
  assert.equal(out.fonts.check_fragment, true, 'Fragment Mono did not load');
  assert.equal(out.fonts.instrument_sans.differs, true, 'Instrument Sans measured same as fallback');
  assert.equal(out.fonts.fragment_mono.differs, true, 'Fragment Mono measured same as fallback');
  assert.deepEqual(out.fonts.banned_on_page, [], 'a banned font family is used on the page');
  await page.close();
}
/* cold-load CLS, which is where a font swap would show up */
{
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({type: 'layout-shift', buffered: true});
  });
  await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  out.fonts.layout_shift_on_font_swap = Math.round(await page.evaluate(() => window.__cls) * 10000) / 10000;
  assert.ok(out.fonts.layout_shift_on_font_swap < 0.01, 'CLS on cold load too high');
  await page.close();
}

/* ---- 3. the shell: replay, selection, chats column, breakpoints ---- */
{
  const {page} = await open();
  /* tops are taken relative to the frame's own top, so page scrolling cannot register as a shift */
  /* The dots and the typed span are absolute overlays over the paragraph's reserved box: they are
     deliberately outside the flow, so they are excluded. Everything that does hold layout is
     measured, plus the frame's own height, which is the real proof that nothing moved. */
  const TOPS = `(() => { const el = document.querySelector('[data-pp-conv-body]');
    const base = el.getBoundingClientRect().top;
    const skip = e => e.closest('.pp-dots, .pp-type');
    return {tops: [...el.querySelectorAll('*')].filter(e => !skip(e)).slice(0, 60).map(e => Math.round(e.getBoundingClientRect().top - base)),
            frame: Math.round(el.getBoundingClientRect().height)}; })()`;
  await page.evaluate(() => document.querySelector('[data-pp-conv-body]').scrollIntoView());
  await page.waitForTimeout(250);
  const before = await page.evaluate(TOPS);
  await page.waitForTimeout(600);
  const mid = await page.evaluate(TOPS);
  await page.waitForTimeout(11000);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-pp-conv-body]');
    const base = el.getBoundingClientRect().top;
    const skip = e => e.closest('.pp-dots, .pp-type');
    return {
      frame: Math.round(el.getBoundingClientRect().height),
      tops: [...el.querySelectorAll('*')].filter(e => !skip(e)).slice(0, 60).map(e => Math.round(e.getBoundingClientRect().top - base)),
      armed: el.getAttribute('data-replay'),
      p1: el.querySelector('[data-pp-type="1"]').textContent.length,
      ghost1: el.querySelector('.pp-ghost').textContent.length,
      receipt_on: el.querySelector('[data-pp-receipt]')?.dataset.on === '1',
      cards_on: [...el.querySelectorAll('[data-pp-cards] > *')].filter(c => c.dataset.on === '1').length
    };
  });
  const shift = Math.max(
    ...before.tops.map((v, i) => Math.abs(v - (mid.tops[i] ?? v))),
    ...before.tops.map((v, i) => Math.abs(v - (after.tops[i] ?? v))),
    Math.abs(before.frame - mid.frame), Math.abs(before.frame - after.frame));
  out.shell = {
    replay_completes: after.armed === null && after.p1 === after.ghost1 && after.receipt_on && after.cards_on === 2,
    replay_shift_px: shift,
    replay_detail: {typed_chars: after.p1, ghost_chars: after.ghost1, cards_revealed: after.cards_on, receipt: after.receipt_on,
                    frame_height: [before.frame, mid.frame, after.frame]}
  };
  assert.equal(out.shell.replay_completes, true, 'replay did not finish cleanly');
  assert.equal(shift, 0, `replay moved the frame by ${shift}px`);

  const pick = async sel => page.evaluate(s => {
    document.querySelector(s).click();
    const shell = document.querySelector('[data-pp-shell]');
    return {pressed: document.querySelector(s).getAttribute('aria-pressed'),
            title: document.querySelector('[data-pp-conv-title]').textContent,
            rows: [...document.querySelectorAll('[data-chat]')].map(r => r.textContent.trim().split('\n')[0]),
            list: shell.getAttribute('data-list')};
  }, sel);
  out.shell.rail_select_fifty = await pick('[data-pick="agent:fifty"]');
  out.shell.select_project = await pick('[data-pick="project:launch"]');
  assert.equal(out.shell.rail_select_fifty.pressed, 'true', 'selecting Fifty did not press it');
  assert.ok(out.shell.rail_select_fifty.rows.length > 0, 'no chats after selecting Fifty');
  assert.equal(out.shell.select_project.pressed, 'true', 'selecting a project did not press it');

  await page.evaluate(() => document.querySelector('[data-pick="project:northstar"]').click());
  const rowsBefore = await page.evaluate(() => [...document.querySelectorAll('[data-chat]')].map(r => r.dataset.chat));
  out.shell.switch_chat = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat]')];
    const target = rows.find(r => r.dataset.chat !== document.querySelector('[data-pp-conv-body]').dataset.conv);
    target.click();
    return {clicked: target.dataset.chat, now: document.querySelector('[data-pp-conv-body]').dataset.conv,
            title: document.querySelector('[data-pp-conv-title]').textContent};
  });
  assert.equal(out.shell.switch_chat.clicked, out.shell.switch_chat.now, 'conversation did not switch');
  out.shell.conv_entries = rowsBefore.length;
  out.shell.chats_close = await page.evaluate(() => {
    document.querySelector('[data-pp-close-list]').click();
    const shell = document.querySelector('[data-pp-shell]');
    const col = document.querySelector('[data-pp-chats]');
    return {list: shell.getAttribute('data-list'), width: Math.round(col.getBoundingClientRect().width)};
  });
  assert.equal(out.shell.chats_close.list, 'closed', 'the chats column did not close');
  assert.equal(out.shell.chats_close.width, 0, 'the chats column still has width when closed');
  await page.close();

  out.shell.breakpoints = {};
  for (const w of [740, 780, 820, 860]) {
    const p = await browser.newPage({viewport: {width: w, height: 900}});
    await p.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
    await p.evaluate(() => document.fonts.ready);
    out.shell.breakpoints[w] = await p.evaluate(() => {
      const shellW = Math.round(document.querySelector('[data-pp-shell]').getBoundingClientRect().width);
      const rail = document.querySelector('[data-pp-rail-col]');
      const chats = document.querySelector('[data-pp-chats]');
      return {shell_width: shellW,
              rail_shown: !!rail && rail.getBoundingClientRect().width > 0,
              chats_shown: !!chats && chats.getBoundingClientRect().width > 0};
    });
    await p.close();
  }
}

/* ---- 4. brain sources and the permission strip ---- */
{
  const {page} = await open();
  await settle(page, 500);
  const setAll = on => page.evaluate(v => {
    document.querySelectorAll('[data-pp-toggle]').forEach(b => { if ((b.getAttribute('aria-pressed') === 'true') !== v) b.click(); });
    return document.querySelector('[data-pp-luca-line]').textContent.trim();
  }, on);
  out.brain_toggle_states = {all_on: await setAll(true), all_off: await setAll(false), each_alone: {}};
  const keys = await page.evaluate(() => [...document.querySelectorAll('[data-pp-toggle]')].map(b => b.dataset.ppToggle));
  for (const k of keys) {
    await setAll(false);
    out.brain_toggle_states.each_alone[k] = await page.evaluate(key => {
      document.querySelector(`[data-pp-toggle="${key}"]`).click();
      return document.querySelector('[data-pp-luca-line]').textContent.trim();
    }, k);
  }
  out.brain_toggle_states.order_keys = keys;
  assert.ok(out.brain_toggle_states.all_off.length > 0, 'no fallback line when nothing is connected');
  assert.notEqual(out.brain_toggle_states.all_on, out.brain_toggle_states.all_off, 'the line does not react to the toggles');

  const feedRows = () => page.evaluate(() => document.querySelectorAll('[data-pp-feed] > *').length);
  const rows0 = await feedRows();
  out.permission = {feed_rows_before: rows0};
  out.permission.allow = await page.evaluate(() => {
    document.querySelector('[data-pp-allow]').click();
    return {note: document.querySelector('[data-pp-perm-note]')?.textContent.trim(),
            done: document.querySelector('[data-pp-perm-done]')?.textContent.trim(),
            feed_rows: document.querySelectorAll('[data-pp-feed] > *').length,
            ask_again: !!document.querySelector('[data-pp-reset-perm]')};
  });
  out.permission.ask_again = await page.evaluate(() => {
    document.querySelector('[data-pp-reset-perm]').click();
    return {allow_back: !!document.querySelector('[data-pp-allow]'),
            feed_rows: document.querySelectorAll('[data-pp-feed] > *').length};
  });
  out.permission.deny = await page.evaluate(() => {
    document.querySelector('[data-pp-deny]').click();
    return {note: document.querySelector('[data-pp-perm-note]')?.textContent.trim(),
            done: document.querySelector('[data-pp-perm-done]')?.textContent.trim(),
            feed_rows: document.querySelectorAll('[data-pp-feed] > *').length};
  });
  assert.ok(out.permission.allow.feed_rows > rows0, 'allowing did not add the feed row');
  assert.equal(out.permission.allow.ask_again, true, 'no "Ask again" after allowing');
  assert.equal(out.permission.ask_again.allow_back, true, '"Ask again" did not restore the strip');
  await page.close();
}

/* ---- 5. the rooms rail: constant speed, one rAF chain, no hover pause ---- */
{
  const {page} = await open();
  await page.evaluate(() => document.getElementById('rooms').scrollIntoView());
  await page.waitForTimeout(400);
  const readX = () => page.evaluate(() => {
    const t = getComputedStyle(document.getElementById('pp-rail')).transform;
    return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m41;
  });
  const speed = async ms => { const a = await readX(); const t0 = Date.now(); await page.waitForTimeout(ms); const b = await readX(); return Math.round(Math.abs(b - a) / ((Date.now() - t0) / 1000) * 10) / 10; };
  out.rooms_rail_px_per_sec = {port: await speed(3000)};
  const box = await page.evaluate(() => { const r = document.getElementById('pp-rail').getBoundingClientRect(); return {x: r.x + 200, y: r.y + r.height / 2}; });
  await page.mouse.move(box.x, box.y);
  out.rail_hover_pause_speed = await speed(2500);
  out.rail_hover_pause = Math.abs(out.rail_hover_pause_speed - out.rooms_rail_px_per_sec.port) > 3;
  await page.mouse.move(5, 5);
  /* a tab hidden and shown again must not speed up: exactly one rAF chain, clock re-based */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: 1}).catch(() => {});
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', {value: true, configurable: true}); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', {value: false, configurable: true}); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  out.rooms_rail_px_per_sec.after_hide_show = await speed(3000);
  out.rooms_rail_duplicated = await page.evaluate(() => {
    const r = document.getElementById('pp-rail');
    const n = r.children.length, half = n >> 1;
    const a = [...r.children].slice(0, half).map(c => c.textContent.trim().slice(0, 30));
    const b = [...r.children].slice(half).map(c => c.textContent.trim().slice(0, 30));
    return {children: n, halves_equal: JSON.stringify(a) === JSON.stringify(b)};
  });
  assert.equal(out.rail_hover_pause, false, 'the rooms rail pauses on hover');
  assert.equal(out.rooms_rail_duplicated.halves_equal, true, 'the rooms list is not rendered twice');
  assert.ok(Math.abs(out.rooms_rail_px_per_sec.after_hide_show - out.rooms_rail_px_per_sec.port) < 3, 'the rail changed speed after a hide/show');
  await page.close();
}

/* ---- 6. reduced motion collapses everything ---- */
{
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
  await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => { let y = 0; const s = () => { window.scrollTo(0, y); y += 500; if (y < document.body.scrollHeight) setTimeout(s, 25); else setTimeout(r, 800); }; s(); }));
  const x1 = await page.evaluate(() => { const t = getComputedStyle(document.getElementById('pp-rail')).transform; return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m41; });
  await page.waitForTimeout(1500);
  const x2 = await page.evaluate(() => { const t = getComputedStyle(document.getElementById('pp-rail')).transform; return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m41; });
  out.reduced_motion = await page.evaluate(() => {
    const rv = [...document.querySelectorAll('[data-rv]')];
    const body = document.querySelector('[data-pp-conv-body]');
    return {
      reveals_shown: rv.every(e => Number(getComputedStyle(e).opacity) > 0.99),
      reveal_count: rv.length,
      replay_finished: body.getAttribute('data-replay') === null && body.querySelector('[data-pp-type="1"]').textContent.length === 0,
      ghost_visible: getComputedStyle(body.querySelector('.pp-ghost')).visibility === 'visible',
      field_off: !document.querySelector('canvas')
    };
  });
  out.reduced_motion.rail_static = Math.abs(x2 - x1) < 0.5;
  assert.equal(out.reduced_motion.reveals_shown, true, 'reveals hidden under reduced motion');
  assert.equal(out.reduced_motion.rail_static, true, 'the rooms rail still moves under reduced motion');
  assert.equal(out.reduced_motion.replay_finished, true, 'the replay still runs under reduced motion');
  assert.equal(out.reduced_motion.ghost_visible, true, 'the finished text is not shown under reduced motion');
  await page.close();
}

/* ---- 7. reveals animate once, in place ---- */
{
  const {page} = await open();
  out.reveals = await page.evaluate(() => {
    const e = [...document.querySelectorAll('[data-rv]')].find(x => x.getBoundingClientRect().top > window.innerHeight);
    if (!e) return {checked: false};
    const c = getComputedStyle(e);
    return {checked: true, count: document.querySelectorAll('[data-rv]').length, hidden_before: Number(c.opacity) < 0.05,
            transition: c.transitionDuration + ' ' + c.transitionTimingFunction};
  });
  await settle(page, 1200);
  const rvState = await page.evaluate(() => [...document.querySelectorAll('[data-rv]')].map((e, i) => ({
    i, rv: e.getAttribute('data-rv'), op: getComputedStyle(e).opacity, tag: e.tagName,
    sec: e.closest('section')?.id || (e.closest('footer') ? 'footer' : '?'),
    txt: e.textContent.trim().slice(0, 30)})).filter(x => Number(x.op) < 0.99));
  out.reveals.all_shown_after_scroll = rvState.length === 0;
  out.reveals.not_shown = rvState;
  assert.equal(out.reveals.all_shown_after_scroll, true, 'a reveal never arrived: ' + JSON.stringify(rvState));
  await page.close();
}

/* ---- 8. contrast of every piece of text ---- */
{
  const {page} = await open();
  await settle(page, 1200);
  out.contrast = await page.evaluate(() => {
    const lum = c => { const s = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
    const parse = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    /* Composite every translucent layer, the way a browser paints it. Taking the first layer with
       alpha > .5 and ignoring the rest reports a darker ground than is really there, which is a
       false pass on exactly the rows that sit on a raised, semi-transparent surface. */
    const bgOf = el => {
      const layers = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const b = getComputedStyle(n).backgroundColor;
        const p = parse(b); if (p.length < 3) continue;
        const a = (b.match(/[\d.]+/g) || [])[3];
        const alpha = a === undefined ? 1 : Number(a);
        if (alpha <= 0) continue;
        layers.push([p, alpha]);
        if (alpha >= 1) break;
      }
      let out = [0, 0, 0];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [c, a] = layers[i];
        out = [0, 1, 2].map(k => c[k] * a + out[k] * (1 - a));
      }
      return out;
    };
    const bad = []; let min = 99; let n = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = el.textContent.trim(); if (!t) continue;
      const c = getComputedStyle(el);
      if (c.visibility === 'hidden' || c.display === 'none' || Number(c.opacity) < 0.05) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const fg = parse(c.color), bg = bgOf(el);
      if (fg.length < 3) continue;
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(c.fontSize), bold = Number(c.fontWeight) >= 700;
      const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
      n++; if (ratio < min) min = ratio;
      if (ratio < need) bad.push({text: t.slice(0, 44), color: c.color, size, ratio: Math.round(ratio * 100) / 100, need});
    }
    return {nodes_checked: n, min_ratio: Math.round(min * 100) / 100, failures: bad.slice(0, 20), failure_count: bad.length};
  });
  out.contrast_min = out.contrast.min_ratio;
  assert.equal(out.contrast.failure_count, 0, 'text below contrast minimum: ' + JSON.stringify(out.contrast.failures));
  await page.close();
}

/* ---- 9. axe ---- */
{
  /* The preview server sends script-src 'self', so addScriptTag is (correctly) refused. axe goes in
     as an init script instead, which is injected over CDP before the document's own scripts run. */
  const axeSource = await (await import('node:fs/promises')).readFile(require.resolve('axe-core'), 'utf8');
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  await page.addInitScript({content: axeSource});
  await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
  await settle(page, 1200);
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, {resultTypes: ['violations']});
    return res.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help}));
  });
  out.axe_violations = r.length;
  out.axe_detail = r;
  assert.equal(r.length, 0, 'axe violations: ' + JSON.stringify(r));
  await page.close();
}

/* ---- 10. the signup contract, against intercepted fixtures ---- */
{
  const noteAfter = async (fixture, {value = 'someone@example.com', wait = 900} = {}) => {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
    const endpoint = await page.evaluate(() => (window.POLYPHONIC_CONFIG || {}).signupEndpoint || '');
    /* The preview server sends connect-src 'self', so a fixture only works on a same-origin
       endpoint. Build with SIGNUP_ENDPOINT=/api/beta to exercise the statuses locally. */
    if (fixture && endpoint) await page.route(new URL(endpoint, ORIGIN + '/').href, fixture);
    await page.fill('#email', value);
    await page.click('#signup-submit');
    await page.waitForTimeout(wait);
    const r = await page.evaluate(() => ({
      note: document.getElementById('signup-note').textContent.trim(),
      button: document.getElementById('signup-submit').textContent.trim(),
      disabled: document.getElementById('signup-submit').disabled,
      invalid: document.getElementById('email').getAttribute('aria-invalid'),
      endpoint: (window.POLYPHONIC_CONFIG || {}).signupEndpoint || ''
    }));
    await page.close();
    return r;
  };
  const json = (status, body) => route => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
  out.signup = {};
  out.signup.invalid = await noteAfter(null, {value: 'not-an-email'});
  const configured = !!out.signup.invalid.endpoint;
  out.signup.configured_build = configured;
  if (!configured) {
    out.signup.unconfigured = await noteAfter(null, {});
    out.signup.note = 'build has no SIGNUP_ENDPOINT; only the invalid and unconfigured paths could be exercised';
  } else {
    out.signup.success = await noteAfter(json(200, {status: 'subscribed'}));
    out.signup.already_subscribed = await noteAfter(json(200, {status: 'already_subscribed'}));
    out.signup.confirmation_required = await noteAfter(json(200, {status: 'confirmation_required'}));
    out.signup.failure = await noteAfter(json(500, {error: 'nope'}));
    out.signup.loading = await noteAfter(route => new Promise(r => setTimeout(() => r(route.abort()), 4000)), {wait: 500});
    out.signup.timeout = await noteAfter(route => new Promise(() => {}), {wait: 13000});
    assert.match(out.signup.success.note, /on the list/i, 'success note wrong');
    assert.match(out.signup.already_subscribed.note, /already/i, 'already_subscribed note wrong');
    assert.match(out.signup.confirmation_required.note, /confirm/i, 'confirmation_required note wrong');
    assert.match(out.signup.failure.note, /again/i, 'failure note wrong');
    assert.match(out.signup.loading.note, /sending/i, 'loading note wrong');
    assert.match(out.signup.timeout.note, /again/i, 'timeout note wrong');
  }
  assert.equal(out.signup.invalid.invalid, 'true', 'an invalid address was not marked invalid');
  /* the honeypot must be present, hidden and out of the tab order */
  const {page} = await open();
  out.signup.honeypot = await page.evaluate(() => {
    const f = document.getElementById('website'); if (!f) return null;
    const r = f.getBoundingClientRect(); const c = getComputedStyle(f);
    return {present: true, tabindex: f.getAttribute('tabindex'), autocomplete: f.getAttribute('autocomplete'),
            visually_hidden: r.width <= 1 || r.height <= 1 || c.clipPath !== 'none' || c.position === 'absolute'};
  });
  assert.ok(out.signup.honeypot && out.signup.honeypot.present, 'honeypot missing');
  assert.equal(out.signup.honeypot.tabindex, '-1', 'honeypot is in the tab order');
  await page.close();
}

/* ---- 11. links, metadata and the glyph marks ---- */
{
  const {page} = await open();
  out.links = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href]')].map(x => ({t: x.textContent.trim().slice(0, 28), h: x.getAttribute('href')}));
    return {nav: a.filter(x => x.h.startsWith('#')), external: a.filter(x => /^https?:/.test(x.h)),
            write_to_us: a.some(x => /write to us/i.test(x.t)), empty: a.filter(x => !x.h || x.h === '#')};
  });
  out.meta = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name=description]')?.content,
    og_title: document.querySelector('meta[property="og:title"]')?.content,
    og_description: document.querySelector('meta[property="og:description"]')?.content,
    og_image: document.querySelector('meta[property="og:image"]')?.content,
    favicon: document.querySelector('link[rel~=icon]')?.getAttribute('href')
  }));
  out.marks = await page.evaluate(() => ({
    inline_glyphs: document.querySelectorAll('svg[viewBox="0 0 7 7"]').length,
    nav_mark: !!document.querySelector('header svg[viewBox="0 0 7 7"]'),
    footer_mark: !!document.querySelector('footer svg[viewBox="0 0 7 7"]')
  }));
  assert.equal(out.links.write_to_us, false, '"Write to us" is still a link');
  assert.equal(out.links.empty.length, 0, 'a dead link remains');
  assert.ok(out.marks.inline_glyphs > 0, 'no inlined glyph marks');
  assert.equal(out.meta.title, 'Polyphonic — One home for your agents.', 'title wrong');
  assert.equal(out.meta.og_title, out.meta.title, 'og:title does not match the title');
  await page.close();
}

/* ---- 12. no glyph engine and no public keys shipped ---- */
{
  const js = await (await fetch(ORIGIN + '/assets/site.js')).text();
  const html = await (await fetch(ORIGIN + '/')).text();
  const bundle = js + html;
  out.public_keys_in_bundle = (bundle.match(/\b[0-9a-f]{64}\b/g) || []).length;
  out.glyph_engine_shipped = /identityGlyph|glyphToSvgPath/.test(js);
  assert.equal(out.public_keys_in_bundle, 0, 'a 64-hex key is in the shipped bundle');
  assert.equal(out.glyph_engine_shipped, false, 'glyph code shipped to the browser');
}

await browser.close();
out.ok = true;
console.log(JSON.stringify(out, null, 1));
console.error('verify.mjs: all checks passed against ' + ORIGIN);
