/* Release checks for the v3 page (WP-18): the things that decide whether a built bundle is safe to
   publish, rather than the behaviour verify.mjs covers. Origin comes from VERIFY_ORIGIN:
     VERIFY_ORIGIN=http://127.0.0.1:8749 node scripts/verify-release.mjs                          */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const ORIGIN = (process.env.VERIFY_ORIGIN || 'http://127.0.0.1:8744').replace(/\/$/, '');
const report = {origin: ORIGIN, checks: [], errors: [], broken: [], warnings: []};
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') report.errors.push(`${m.type()}: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 400) report.broken.push(`${r.status()} ${r.url()}`); });
await page.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
await page.evaluate(() => document.fonts.ready);

/* every asset the page asks for is served, and only by this origin */
{
  const hosts = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map(e => new URL(e.name).host))]);
  assert.deepEqual(hosts.filter(h => h !== new URL(ORIGIN).host), [], 'a third-party host was contacted: ' + hosts);
  report.checks.push('No third-party requests (' + hosts.join(', ') + ')');
}

/* every internal anchor resolves */
{
  const broken = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
    .filter(a => a.hash && !document.getElementById(a.hash.slice(1))).map(a => a.hash));
  assert.deepEqual(broken, [], 'internal links with no target');
  const dead = await page.evaluate(() => [...document.querySelectorAll('a')].filter(a => !a.getAttribute('href') || a.getAttribute('href') === '#').length);
  assert.equal(dead, 0, 'a placeholder link remains');
  report.checks.push('All internal links resolve and no placeholder links remain');
}

/* metadata the share card and search results depend on */
{
  const meta = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name=description]')?.content || '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
    ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
    ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
    robots: document.querySelector('meta[name=robots]')?.content || '',
    heroSub: document.querySelector('#top p')?.textContent.replace(/\s+/g, ' ').trim() || ''
  }));
  assert.equal(meta.title, 'Polyphonic — One home for your agents.', 'title');
  assert.equal(meta.ogTitle, meta.title, 'og:title must match the title');
  assert.equal(meta.description, meta.heroSub, 'description must be the hero sub');
  assert.equal(meta.ogDescription, meta.heroSub, 'og:description must be the hero sub');
  assert.ok(meta.ogImage, 'og:image missing');
  const share = await page.request.get(new URL(meta.ogImage, ORIGIN + '/').href);
  assert.equal(share.status(), 200, 'og:image does not resolve');
  report.meta = meta;
  report.checks.push('Title, description, og:* and a resolvable share card');
  if (meta.robots) report.warnings.push('robots meta still present: this is a preview build, not a publishable one (PUBLISH=1 removes it)');
}

/* the built config is the one that was asked for, and no secret leaked into it */
{
  const cfg = await page.evaluate(() => ({...(window.POLYPHONIC_CONFIG || {})}));
  report.config = cfg;
  assert.ok(!/key|secret|token|password/i.test(JSON.stringify(cfg)), 'the built config looks like it carries a secret');
  report.checks.push('Built config: ' + JSON.stringify(cfg));
}

/* nothing that belongs to the old page is still being served */
{
  const gone = ['assets/demo.js', 'assets/demo.css', 'assets/effects.js', 'assets/luca-sigil-engine.js',
                'assets/dot-display.js', 'assets/mnemos-scenes.js', 'assets/brand/polyphonic-solid.svg'];
  const still = [];
  for (const f of gone) { const r = await page.request.get(ORIGIN + '/' + f); if (r.status() === 200) still.push(f); }
  assert.deepEqual(still, [], 'files from the replaced page are still in the bundle');
  report.checks.push('None of the replaced page\'s files are served');
}

/* signup: a completed request can be edited and sent again */
{
  const cfgEndpoint = await page.evaluate(() => (window.POLYPHONIC_CONFIG || {}).signupEndpoint || '');
  if (!cfgEndpoint) {
    report.warnings.push('no SIGNUP_ENDPOINT in this build: the signup statuses were not exercised here (verify.mjs covers the unconfigured path)');
  } else {
    for (const [status, copy] of [['already_subscribed', 'already on the list'], ['confirmation_required', 'Check your inbox'], ['subscribed', 'on the list']]) {
      const p = await browser.newPage();
      await p.route(new URL(cfgEndpoint, ORIGIN + '/').href, r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({status})}));
      await p.goto(ORIGIN + '/', {waitUntil: 'networkidle'});
      await p.locator('#email').fill('test@example.test');
      await p.locator('#signup-submit').click();
      await p.waitForFunction(t => document.querySelector('#signup-note').textContent.includes(t), copy, {timeout: 8000});
      await p.locator('#email').fill('second@example.test');
      assert.equal(await p.locator('#signup-submit').isEnabled(), true, 'the form stayed locked after ' + status);
      await p.close();
      report.checks.push('Signup ' + status + ', and the form can be edited and sent again');
    }
  }
}

assert.deepEqual(report.errors, [], 'console or page errors');
assert.deepEqual(report.broken, [], 'requests that did not resolve');
await fs.mkdir('audit', {recursive: true});
await fs.writeFile('audit/release-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
