# V1.1 build specification — Resident Notebook and Living Journal

## Outcome

Ship a backend-complete resident notebook with two explicit data planes:

```text
memory note
  automatic after finalized resident work
  source-backed and eligible for bounded conversational recall

journal page
  manually requested by the owner
  resident-authored Markdown, never automatic chat context
```

The current encrypted handoff remains the resident's fast-changing working
state. Native Hermes/OpenClaw memory remains owned by the native runtime.

## Fixed bounds

- Memory-note body: 1,200 UTF-8 bytes.
- Automatic note mutations: at most three per metabolism result.
- Recalled notes: at most five per turn.
- Memory-note source events: at most eight.
- Journal title: 120 UTF-8 bytes.
- Journal Markdown body: 16 KiB.
- Journal owner prompt: 4 KiB.
- Journal source events: at most sixteen.
- Selected prior journal pages: at most five.
- Notebook list page size: default 25, maximum 50.
- The existing 48 KiB continuity packet maximum remains unchanged.

## Automatic metabolism

After the existing accepted/finalized response boundary, one idempotent job asks
the exact resident runtime/model for either `no_change` or one atomic proposal:

- optional new handoff;
- zero to three create/revise/supersede memory-note mutations.

The desktop validates the complete proposal and commits all encrypted revisions
or none. Owner-pinned corrections win. A new user turn, cancellation, stale
epoch, invalid output, runtime mismatch, or disabled continuity prevents commit.

## Manual journal cognition

An explicit owner command supplies a private prompt plus optional signed source
events and selected pages from the same resident. The exact resident runtime and
model returns `no_change` or one Markdown page. Tools, permissions, signing,
message publication, and model/runtime substitution are disabled.

Resident page bodies can be revised only by a later resident cognition job.
Owner annotations are separate encrypted records with owner authorship. The
owner may archive or forget a page, but cannot silently edit its body.

## Retrieval

Only active memory notes enter normal lexical/FTS retrieval. Journal pages and
annotations are excluded from the ordinary index used for conversation turns.
Selected pages may be decrypted only inside an explicit journal cognition or
future V1.3 review request.

## Backend gate

The backend gate requires protocol vectors, encrypted lifecycle, atomic
metabolism, bounded retrieval, journal cognition, owner commands, renderer view
models, deterministic fixtures, focused regression tests, and real Hermes plus
OpenClaw proof. The installed visual gate waits for frontend integration.

## Deferred

Images, audio, canvases, code/file artifacts, journal tools, scheduled creation,
proactive messages, cross-agent notebook access, automatic journal recall, and
autonomous inner-life activity are not reachable in V1.1.
