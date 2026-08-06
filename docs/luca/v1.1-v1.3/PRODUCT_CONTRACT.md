# Product contract

## Product thesis

Luca is the personal workspace where a person can use all of their agents
together without stripping those agents of their native profiles, tools,
workspaces, memory, or identity.

The functional beta already provides the usable workspace and one compact
encrypted handoff. V1.1-V1.3 deepen continuity only where the added behavior is
immediately legible, controllable, and useful:

```text
native agent capabilities
        +
stable cryptographic identity
        +
signed Luca conversation history
        +
small encrypted handoff
        -> V1.1 selective resident notebook
        -> V1.2 explicitly granted owner sources
        -> V1.3 resident-authored review and consolidation
```

## User-facing promise by release

### V1.1 — Resident Notebook

After meaningful work, a resident may keep a few durable notes in its own words.
Those notes are not a transcript dump. They are source-backed decisions,
commitments, lessons, explicit preferences, durable context, or open questions
that will matter later.

The owner can inspect the notebook, see where every note came from, correct it,
pin it, supersede it, archive it, or forget it. On a fresh runtime session the
resident receives only a bounded selection of its own relevant active notes,
plus the existing handoff and signed conversation context.

### V1.2 — Scoped Brain Sources

The owner can select a small local Markdown/text source or folder, preview
exactly what Luca will ingest, and grant individual residents read-only access.
The source is stored in the separate encrypted owner-brain namespace. Every
recall identifies its source, and revoking a grant removes it from future model
requests.

V1.2 is deliberately not a universal importer. It proves the complete
authorization and provenance loop on one narrow local corpus before adding more
formats or discovery adapters.

### V1.3 — Resident Reflection

The owner can ask a resident to review its own notebook. The exact resident,
using its configured runtime and model, may return `no_change`, write one private
reflection, or propose a small set of revisions or supersessions to its own
notes. It cannot write the owner brain, contact the user, call tools, request
permissions, or silently rewrite owner-pinned corrections.

Reflection is an intentional consolidation action, not an autonomous inner-life
scheduler.

## Vocabulary

- **Identity:** the resident's stable public key and Luca-held signing custody.
- **Native memory:** memory owned and managed by Hermes, OpenClaw, or another
  imported runtime. Luca does not copy or replace it.
- **Handoff:** the latest compact working state: summary, unresolved threads,
  commitments, and explicit preferences.
- **Hypomnema / resident notebook:** selective durable notes the resident carries
  forward, with provenance, revisions, and lifecycle.
- **Owner brain:** owner-governed source material that may be granted read-only
  to selected residents.
- **Reflection:** a resident-authored review of its own continuity, performed by
  that resident's exact configured runtime/model.
- **Portable Capsule:** the existing compact encrypted current-state projection;
  it is not the full notebook or owner brain.

## What these releases do not promise

- sentience, consciousness, emotion, or simulated mood;
- autonomous background life or proactive messages;
- complete Mnemos/Polyphonic parity;
- a universal knowledge graph or semantic search across every personal source;
- native runtime session restoration;
- model-independent personality transfer;
- cross-resident access to private notebooks;
- multi-device concurrent continuity writes;
- automatic changes to identity, convictions, relationships, or personality;
- a conductor or hidden orchestrator.

## Success standard

The product is successful when continuity is felt in ordinary use, not merely
visible in a database:

1. a meaningful exchange creates a small, understandable resident note;
2. a later fresh runtime recalls it appropriately without first-contact
   language;
3. the owner can inspect the evidence and change or remove it;
4. a granted owner source can answer a question with visible provenance while a
   non-granted resident cannot;
5. a resident can review its own notebook without gaining autonomous authority;
6. disabling or breaking all continuity leaves normal chat fully functional.
