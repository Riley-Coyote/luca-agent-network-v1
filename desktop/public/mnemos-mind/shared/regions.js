/* The regions of a mind: the concerns its memories gather into, named in their own words.
 *
 * The layout finds them (memories that come back together, as communities of the link graph) and gives each a place
 * of its own. Here each is named by the words that set it apart: the words its memories use far more than the rest of
 * the mind does, weighted toward names (a word written with a capital where a sentence doesn't need one, the way
 * Ghost or TrueMark is). Nothing is invented: a region's name is a word from inside it, and the few that follow are
 * what it's about. A word that names the mind itself, or the person it works with, names nothing apart. */

const STOP = new Set(`a an the and or but nor so yet of to in on at by for with from into onto over under about after before
between through during without within along across against among around than then that this these those there here
is am are was were be been being have has had having do does did done doing will would shall should can could may might must
it its it's i i'm i've i'd me my mine we us our you your he him his she her they them their what which who whom whose
when where why how all any both each few more most other some such no not only own same too very just also still even
again ever never always now once one two three first last next new old like as if because while until though although
up down out off back away yes ok okay get got make made use used using way thing things something nothing anything
everything time times day days week today tonight yesterday tomorrow said says say asked ask want wants wanted need needs
needed see seen look looks looked keep kept go goes went come came take took give gave let lets put set run ran know knew
think thought feel felt work works worked working right left good better best much many less little well really
jan feb mar apr jun jul aug sep sept oct nov dec january february march april may june july august september october
november december monday tuesday wednesday thursday friday saturday sunday am pm cdt utc
session sessions memory memories note notes`.split(/\s+/));

const tokens = (text) => (text || '').match(/[A-Za-z][A-Za-z0-9'’-]{2,}/g) || [];
const proper = (word, at, text) => /[A-Z]/.test(word) && !/[.!?:\n]\s*$/.test(text.slice(Math.max(0, at - 3), at)) && at > 0;

/* name every region: `of[i]` is memory i's region; `mems` the memories; `skip` words that name nothing apart */
export function nameRegions(mems, of, skip = []) {
  const N = mems.length, K = Math.max(-1, ...of) + 1;
  const own = skip.flatMap((s) => tokens(String(s || '')).map((w) => w.toLowerCase()));
  const ban = new Set([...STOP, ...own]);
  const df = new Map(), forms = new Map(), docs = new Array(N);
  mems.forEach((m, i) => {
    const text = m.content || '', seen = new Set();
    const count = (low, w, isName) => {
      seen.add(low);
      const f = forms.get(low) || forms.set(low, { cased: new Map(), proper: 0, all: 0 }).get(low);
      f.all++;
      if (isName) { f.proper++; f.cased.set(w, (f.cased.get(w) || 0) + 1); }
    };
    let prev = null;
    for (const hit of text.matchAll(/[A-Za-z][A-Za-z0-9'’-]{2,}/g)) {
      const w = hit[0].replace(/['’]s$/, ''), low = w.toLowerCase(), isName = proper(w, hit.index, text) || (prev?.name && /[A-Z]/.test(w[0]));
      // two names side by side are one name (Prompt Ghost, Polyphonic Desktop)
      // (a capital at the start of a sentence counts here: most notes open with the name of what they're about)
      if (prev?.cap && /^[A-Z]/.test(w) && text.slice(prev.end, hit.index) === ' ' && !ban.has(low)) count(`${prev.low} ${low}`, `${prev.w} ${w}`, true);
      prev = { w, low, name: isName && !ban.has(low), cap: /^[A-Z]/.test(w) && !ban.has(low) && low.length >= 3, end: hit.index + hit[0].length };
      if (ban.has(low) || /^\d/.test(low) || low.length < 3 || own.some((o) => low.startsWith(`${o}-`))) continue;
      count(low, w, isName);
    }
    docs[i] = seen;
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  });
  const members = Array.from({ length: K }, () => []);
  of.forEach((k, i) => { if (k >= 0) members[k].push(i); });
  const shown = (low) => {
    const f = forms.get(low);
    if (f && f.proper / f.all > 0.4 && f.cased.size) return [...f.cased.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return low[0].toUpperCase() + low.slice(1);
  };
  const regions = members.map((cells, k) => {
    const tf = new Map();
    for (const i of cells) for (const w of docs[i]) tf.set(w, (tf.get(w) || 0) + 1);
    const floor = Math.max(2, Math.ceil(cells.length * 0.06));
    const scored = [...tf.entries()].filter(([, n]) => n >= floor).map(([w, n]) => {
      const f = forms.get(w), name = f.proper / f.all > 0.4 ? (w.includes(' ') ? 2.2 : 1.8) : 1;
      return [w, (n / cells.length) * Math.log(N / df.get(w)) * name, n];
    }).sort((a, b) => b[1] - a[1]);
    return { k, n: cells.length, cells, scored };
  });
  // the biggest regions choose first; a smaller one never takes a name already given
  const taken = new Set();
  for (const r of [...regions].sort((a, b) => b.n - a.n)) {
    let pick = r.scored.find(([w]) => !taken.has(w));
    // a word that is mostly half of a longer name is named whole ("Prompt" in "Prompt Ghost")
    const whole = pick && r.scored.find(([w, , n]) => w.includes(' ') && w.split(' ').includes(pick[0]) && n >= 0.35 * pick[2] && !taken.has(w));
    if (whole) pick = whole;
    r.name = pick ? shown(pick[0]) : '';
    if (pick) for (const w of [pick[0], ...pick[0].split(' ')]) taken.add(w);
    r.words = r.scored.filter(([w]) => w !== pick?.[0]).slice(0, 3).map(([w]) => (forms.get(w).proper / forms.get(w).all > 0.4 ? shown(w) : w));
    delete r.scored;
  }
  return regions;
}
