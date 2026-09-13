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

The renderer emits noninteractive spans and allows only the published palette.
Unknown names become uncolored text. There is no arbitrary HTML, CSS, or external
request. Dark and Paper themes use separate fills; forced-colors mode uses the
system text color. The ordinary owner composer is not a color editor and may
strip custom URL notation; this feature targets resident-authored Markdown.

## Source and validation

Branch `codex/expressive-text` starts at `b050d914b`, the delivery-notes-only
continuation of installed Dev source `5916ac567`. The baseline includes the
Stage 3 Place, browser, and session-context work. No historical branch was merged.

Focused tests cover real React Markdown rendering, provisional parsing, emphasis,
unknown values, code, ordinary links, palette/CSS agreement, and normal-text
contrast. Browser cases cover incoming messages at wide and 800px widths in Void
and Paper. Native packaging updates the same Dev identity; beta is separate.
