# Resident expression colors

Residents may color words and passages with `[text](color:warmth)`. Bold and
italic work within the brackets. Use one wrapper per paragraph. Code examples
remain literal. Finalized and streaming output share the same Markdown parser.

| Expression | Color |
| --- | --- |
| warmth | amber |
| joy | gold |
| care | rose |
| curiosity | violet |
| wonder | magenta |
| calm | cyan |
| clarity | blue |
| resolve | orange |
| reflection | slate |
| urgency | red |
| hope | emerald |

Either column works as the color name. These associations are a starting
vocabulary; residents may use colors for their own associations, emphasis,
structure, poetry, or play. They are optional, not inferred emotional telemetry.
Words should still carry meaning without color. The host's shared managed
resident prompt teaches the notation to Luca and newly created residents without
rewriting their individual personas. Existing runtime processes need a restart
to load the updated host prompt.

## Precise paint and gestures

Use a named color, `#rgb`, `#rrggbb`, or `hsl(275,95%,65%)` with no spaces.
Hue supports fractional degrees across 0–360, saturation/lightness 0–100%.
Custom paint preserves the authored sRGB color on both Void and Paper without
contrast adjustment. Join two to six stops with `~` for a perceptually
interpolated gradient.

- `[a changing thought](color:#ff52ad~#955cff~#36cfff)` — continuous fill.
- `[each character](color:rose~violet~cyan?axis=letters)` — discrete color steps.
- `[first\nsecond\nthird](color:blue~violet~rose?axis=lines)` — replace `\n`
  with real line breaks for a row-by-row gradient.
- `[soft signal](color:hsl(210,90%,65%)?motion=breathe)` — halo gathering/release.
- `[a small current](color:cyan~violet?motion=wave)` — a character ripple.
- `[lifting](color:#c277ff?motion=drift&pace=medium)` — gentle lift and settle.
- `[open](color:rose?tracking=0.06&weight=450)` — spacing and weight.
- `[m](color:#ff52ad)[e](color:#a56aff)` — exact individual-letter paint.

Controls combine with `&`. `pace` is slow (3.6s) or medium (2.4s), with at most
0.6s of stagger. Weight is 300–750 and tracking is -0.02–0.12em. Animation runs
once and settles; reduced motion and forced colors suppress gestures. Text is
never hidden. All text remains selectable; glyph segmentation preserves emoji
and combining marks. Joining scripts keep natural shaping with continuous fill.

The parser accepts a bounded style vocabulary, never arbitrary CSS/HTML or URLs.
Unknown or malformed expressions become readable plain text. Per message, no
more than 64 enhanced passages and 512 character/row spans are generated. Larger
passages retain continuous paint. Named-color syntax remains compatible, with a vivid, theme-independent palette.
The ordinary owner composer is not a color editor and may strip custom URL
notation; this feature targets resident-authored Markdown.

## Living ink marks

`ink:` and `color:` are one grammar. A value is `PAINT`, `PAINT?MARKS`,
`?MARKS`, or `MARKS` alone when the whole value is not paint. A single bare
paint or feeling keeps the named path: `[x](ink:warmth)` is `color:warmth`.
Marks read like the legacy controls and combine with them using `&`.

| Mark | Kind | Attribute on the passage |
| --- | --- | --- |
| `hush`, `land` | pressure | `data-expression-pressure="hush"` or `"land"` |
| `linger`, `rush` | tempo | `data-expression-tempo="linger"` or `"rush"` |
| `wet` | wet | `data-expression-wet=""` |
| `breathe`, `drift`, `wave` | gesture, same as `motion=` | `data-expression-motion` |
| `hold`, `hold=1.2` | pause in seconds | `data-expression-hold="0.7"` |
| `echo`, `echo=a+phrase` | phrase to find again | `data-expression-echo="…"` |

- One-word marks take no value. `hold` alone is 0.7 seconds; otherwise
  `Number(value)` from 0.2 to 2, written back as JavaScript writes it (`1.50`
  becomes `1.5`). `echo` alone is the passage's own words: its text and inline
  code as written, with each line break read as one space (none at the start
  or end, and one for a run of breaks). Otherwise it is the given phrase, with
  `+` as a space.
- Paint-less ink (`[and then](ink:hold)`, `ink:?hush`, `color:wet`) keeps the
  page's own colour: no fill, tone or gradient, and letters and lines stay
  whole (a wave still splits its letters). It needs at least one name, so
  `ink:`, `ink:?` and `ink:?&` stay plain. Legacy names count:
  `ink:motion=drift` is a paint-less drift. It is still one of the 64 enhanced
  passages.
- Written plainly: `hush` with `land`, `linger` with `rush`, more than one
  gesture (each flag counts once, and `motion=` counts once however often it
  appears, keeping today's first value), a new mark named twice, a value on a
  one-word mark, `hold` outside 0.2–2, or any unknown name. Names are
  case-sensitive.
- Per message, in reading order: at most three holds, one echo, and one land
  per paragraph, meaning its nearest block (a paragraph, including one in a
  list item or quote, a heading, or a table cell). A mark over its limit is
  dropped; the passage keeps everything else.
- Hush draws at weight 300 and 60% opacity, land at 640; an explicit `weight=`
  wins over either.

## How the desktop draws the marks

- While a reply streams, an unfinished ink link waits off the page until its
  closing parenthesis arrives (`openInkLinkStart` in `progressiveMarkdown.ts`),
  so the notation never shows and the passage arrives as itself. A closed ink
  link parses at once, even across soft line breaks.
- Hold, linger and rush shape the word clock (`markdownStreamingText.ts`,
  `useStreamingWordEffect.ts`). A hold waits before its passage's first word,
  measured from the word before it, and everything after waits too; a stream
  that already paused that long adds nothing. A lingering word is written on
  left to right behind a soft mask edge at 48 ms a letter, and the next word
  waits for it. A rushed passage starts its words 8 ms apart. Neither is
  tightened by a backlog. With Reduce Motion, or the streaming effect off,
  words appear as they arrive and nothing moves, but holds keep their pause.
- Wet ink is split into word spans (`data-expression-wet-word`, each with its
  text in `data-ink-text`). Painted wet passages sit 14% deeper (gradients keep
  their own colour). A gloss on each word lies where the room's one light
  falls (`inkLight.ts`): the pointer, followed with a soft lag, and a slow
  wander after 2.6 s at rest. Rows before the owner's latest message carry
  `data-ink-answered` (from `buildTimelineItems`), and there the gloss fades
  and the colour returns. No gloss under Reduce Motion or forced colours, or
  while the row is still streaming.
- Echo is read from each reply's body by the same remark pipeline
  (`inkHeardOf`) and given to the nearest owner message before it, whose
  parse lights the phrase's first whole-word, case-insensitive match
  (`rehypeInkHeard`): the reply's paint mixed 80% into the text colour, with a
  1px underline at 70%. Paint-less echo keeps only the underline. It warms in
  once, for an echo first seen within 1.5 s and a reply under five minutes
  old. Code is never lit.
- Thread panels do not yet dry wet ink or show echoes; the main timeline does.

## Source and validation

Branch `codex/expressive-text` starts at `b050d914b`, the delivery-notes-only
continuation of installed Dev source `5916ac567`. The baseline includes the
Stage 3 Place, browser, and session-context work. No historical branch was merged.

Focused tests cover real React Markdown rendering, provisional parsing, emphasis,
unknown values, code, ordinary links, palette/CSS agreement, and exact
color fidelity. Browser cases cover incoming messages at wide and 800px widths in Void
and Paper. Native packaging updates the same Dev identity; beta is separate.
