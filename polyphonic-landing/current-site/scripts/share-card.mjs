/* Renders scripts/share-card.html to assets/share/polyphonic-beta.png at 1200x630. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve('scripts/share-card.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.locator('.card').screenshot({ path: 'assets/share/polyphonic-beta.png' });
await browser.close();
console.log('assets/share/polyphonic-beta.png rendered (1200x630).');
