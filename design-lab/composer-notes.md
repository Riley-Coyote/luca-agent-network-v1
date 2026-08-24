# Composer — session notes and reference anatomy

*Staged 2026-08-23 for the composer design session. Palette is settled (Ash
default, see the scale in `conversation-shell.css`); the composer is next.*

## Riley's direction

- **Thin.** He keeps returning to the thin silhouette; Claude Code is the
  reference, not ChatGPT's tall pill. The composer should be so well designed
  you forget it exists.
- The audience question (who will answer / who gets woken) still matters —
  it just has to fit a thin anatomy.

## The Claude Code anatomy (from Riley's screenshots, 2026-08-23)

The trick that makes CC feel thin — the card and the chrome are SEPARATED:

1. **The card is only text.** One row: placeholder ("Type / for commands"),
   a quiet return-glyph at the right. Nothing else lives inside it.
2. **The toolbar is naked on the floor, below the card.** Left: mode
   ("Auto"), attach (+), mic, chevron. Right: model ("Fable 5"), effort
   ("High"), status spinner. No surface behind it, no border — just quiet
   text and glyphs on the ground. This is why the whole thing reads thin:
   there is only ONE box.
3. **Attachments stack inside the card, above the text row**, appearing only
   when present. The card grows for content, never for chrome.

## Implications for ours (to explore in the lab, not decided)

- Keep the single text-only card (~46-52px). Retire the in-card icon row —
  `+`, emoji, mic move to a naked baseline row below the card.
- Right side of that baseline row is the natural home of the audience hint:
  "✳ Luca will answer" / "⁘ ziggy will be brought in" — quiet text + harness
  mark, exactly where CC puts model/effort.
- Attachment chips stack inside the card above the text when present
  (paste-image, drag-drop) — card grows for content only.
- Focus: the card's own border brightens in place (canon); the baseline row
  never changes on focus.
- Draft persistence per room; Shift+Enter newline; send affordance arms only
  with content. Zero keystroke latency is a hard requirement.

## Stages in the lab scene

- `drafts` — empty room: the composer is the only object. The hardest state.
- `Luca` DM — quiet 1:1, short transcript.
- `polyphonic` — busy room, open visit, live exchange (audience-hint state:
  mention ziggy while absent → visit).
- `field-notes` — vektor's room; mentioning ziggy here stages the
  "will be brought in" hint.

## DECIDED 2026-08-24: the reply context is the RECESS

Chosen from the four-way comparison (seam deck · in-card row · shade tier ·
recess; final two were card vs recess). The reply opens a dark well below the
conversation surface (#101010, shade from its top lip only, clipped-reveal
entrance); the composer card floats above it untouched. Riley: "i might tweak
it later but it looks good." The losing variants and the ?replyStyle switcher
are deleted; the council reports in `council/` record the reasoning.

Still open on the composer: the audience hint (baseline row, right side), the
send-moment cleanup the choreographer specced (delete spinner + SENDING label,
arm/disarm timing, border-color transition), and the room-name fix for the
scene ("Message ziggy, Luca" should say the room's name).
