/* Telling the person when the mind asks them something: one quiet desktop notification for each new question it
 * leaves (a note of its whose last word is a question no one has answered under), only while the page isn't in front
 * of them, and only if they turned it on and the browser allows it. However many of its pages are open, each question
 * is told once: what's been told is kept in this browser, per mind. The questions already waiting when telling began
 * are never told; only what arrives after. */

import { waiting, firstLine } from './words.js';

const ON = (agent) => `mnemos.tell.${agent || 'agent'}`;
const TOLD = (agent) => `mnemos.told.${agent || 'agent'}`;
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private: nothing is told twice this visit anyway */ } };

export const canTell = () => typeof Notification !== 'undefined';
export const telling = (agent) => canTell() && Notification.permission === 'granted' && read(ON(agent)) === true;
export const refused = () => canTell() && Notification.permission === 'denied';

/* turn telling on (asking the browser, from the click that asked for it) or off; answers whether it's on */
export async function setTelling(agent, on, notes) {
  if (!on) { write(ON(agent), false); return false; }
  if (!canTell()) return false;
  const allowed = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted';
  if (!allowed) return false;
  write(ON(agent), true);
  write(TOLD(agent), waiting(notes).map((n) => n.id));          // what's waiting now isn't news
  return true;
}

/* look at the notes as they stand and tell what's new; `open` brings the page to the notes */
export function tell({ agent, who, notes, open }) {
  const asks = waiting(notes);
  const told = new Set(read(TOLD(agent)) || []);
  if (!read(TOLD(agent))) { write(TOLD(agent), asks.map((n) => n.id)); return; }   // first look: nothing is news yet
  const news = asks.filter((n) => !told.has(n.id));
  if (!news.length) return;
  for (const n of news) told.add(n.id);
  write(TOLD(agent), [...told].slice(-400));
  if (!telling(agent) || !document.hidden) return;                // in front of them already: the page says it
  const n = news[news.length - 1];
  const note = new Notification(news.length === 1 ? `${who.name} asked you something` : `${who.name} asked you ${news.length} things`, {
    body: firstLine(n.text.split('\n').filter((l) => l.trim()).pop() || n.text, 160), tag: `mnemos-${agent}`, silent: false,
  });
  note.onclick = () => { window.focus(); open(); note.close(); };
}
