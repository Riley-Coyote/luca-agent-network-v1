# beta.14 conversation polish

Local candidate only. Preserve the shell, composer, glass, marks, fonts and
existing profiles. No publication, tagging, signing or daily-app replacement.

## Changes

- Conversation-only reading styles: 16px default Inter body, 1.6 leading,
  relative paragraph/list spacing, and restrained headings that never fall below
  body size. Owner text-size choices and root zoom remain authoritative.
- Preserve loose/nested lists and quoted paragraphs, including the progressive
  renderer used by streaming responses and mini chat. Blank lines inside these
  containers no longer split them into unrelated blocks.
- Inline code, fenced code, tables and quotes follow the same relative scale.
  Code copying, syntax highlighting, horizontal scrolling and links stay intact.
- Attribution remains visible; names and work summaries are secondary to prose.
- Valid trailing choice metadata from canonical Luca replies stays out of prose
  after the initial offer window. Owner text, other residents, malformed blocks
  and untriggered conversations retain ordinary code rendering. The five-reply
  active-choice window and permission semantics are unchanged.
- Bundled Luca instructions recommend natural prose and useful structure, not
  mandatory headings. Existing owner-authored instructions are not overwritten;
  this updates the bundled default, not every warm session's live prompt.

## Focused verification

Unit coverage includes the progressive parser/renderer/cache, Markdown helpers,
first-meeting boundaries and mini-chat projection. Browser coverage uses real
production components with synthetic content, not personal activity: main and
detached chat, both themes, 1440/1280/1024/390 widths at DPR 1 and 2, reduced motion,
loose/nested lists, headings, code, quotes, tables, keyboard copy-button focus,
and small/large text preferences. Mini chat uses the same renderer and has its
own dark/light narrow/wide checks. Browser screenshots simulate web surfaces;
they are not native Liquid Glass proof.

Native walkthrough and exact source/build evidence are recorded alongside the
isolated candidate, outside source. Desktop screenshots do not prove a live
model will choose good formatting; the guidance is not a rigid output template.

## Design critique

The old answer read like separate fragments rather than one coherent passage.
The revised rhythm gives prose the lead and keeps supporting detail attached.
Very wide tables still need horizontal scrolling on narrow windows; forcing
them into cards would change the meaning and is deliberately out of scope.

## Reliability follow-up

Queued-message interruption now binds to the earlier captured dispatches, not
every turn for that resident. A later queued follow-up is not an explicit
cancellation target. Late runtime confirmation updates the button's enabled
state; word arrivals alone do not trigger notice refreshes. The label is now
"Stop earlier reply", without promising immediate delivery after the native
cancellation watchdog. The existing native restart/safety policy is unchanged.

Desktop-generated cancellation events carry a client marker. When recovered as
verified ACP conversation history, they are described as application controls,
not words typed by the owner; event IDs/authors and cancellation authorization
are unchanged. Legacy unmarked controls cannot be retroactively attributed.

The queued notice reuses the approved temporary plate and capsule controls.
On narrow windows the button wraps below the explanation; it does not squeeze
the text into a thin column. Keyboard focus and live status semantics remain.

Normal-speed browser baselines: typing p95 24ms quiet / 32ms busy, with no
recorded >50ms keystrokes or typing long tasks; warm switching about 147ms for
plain history and 285ms for rich history. These are thresholded Chromium event
samples on this machine, not native INP guarantees. A layout-read experiment
did not improve end-to-end switching reliably and was removed.

Checks: exact interrupt targeting and late confirmation, both-theme/narrow
notice screenshots, signed ACP context history and control provenance. Most
history/virtualization checks pass. Two stale checks were corrected (the
approved "New response" label and fractional painted-pixel tolerance). Three
legacy navigation checks still target unavailable Pulse/member/custom-section
controls; they remain unresolved rather than being reported green. Actual
live-provider follow-up delivery across a cancellation watchdog restart has
not been claimed from mocked IPC tests.
