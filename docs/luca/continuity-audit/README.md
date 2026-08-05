# Luca continuity source audit

Status: complete, read-only source audit
Started: 2026-08-04
Integration repository: `luca-agent-network-v1`
Integration branch at audit start: `agent/runtime-reliability`
Integration commit at audit start: `6da9d059`

This directory is the durable source-of-truth record for the Mnemos,
Polyphonic, hypomnema, continuity-capsule, and Luca integration audit. It exists
so later implementation work can reuse verified findings instead of repeating
repository archaeology.

## Product boundary

The audit is preparing the next Luca milestone after G1. G1 is treated as
functionally complete by Riley's explicit 2026-08-04 decision.

The target is not generic retrieval-augmented chat. The target is a layered
continuity system in which:

- Buzz/Luca signed events remain canonical conversation chronology.
- Each resident keeps a stable cryptographic identity.
- Each resident has a private first-person hypomnema and working continuity.
- Mnemos provides scoped associative memory and user-governed shared knowledge.
- A compact encrypted continuity capsule carries the part of a resident that
  must survive relocation.
- Reflection, consolidation, and later inner-life activity remain bounded,
  inspectable, and outside the messaging critical path.

The primary product remains an effortless personal home for imported agents,
with direct messages and intuitive multi-agent rooms. Continuity must deepen
that product rather than delay or destabilize it.

## Audit outputs

- `AUDIT_LOG.md` - dated work log and verification record.
- `AUDIT_CHECKSUMS.sha256` - frozen content hashes for the completed audit set.
- `SOURCE_MANIFEST.md` - repositories, revisions, files, and authority status.
- `LANE_LUCA_BUZZ.md` - current Luca/Buzz seams and constraints.
- `LANE_MNEMOS_ENGINE.md` - Mnemos engine maturity and reusable components.
- `LANE_POLYPHONIC.md` - Polyphonic hypomnema/application integration.
- `LANE_LEGACY_LUCA.md` - legacy Luca brain/import assets.
- `ADOPT_ADAPT_REJECT.md` - component-level disposition matrix.
- `CONTINUITY_V1_BOUNDARY.md` - narrow buildable milestone and acceptance demo.
- `RISKS_AND_OPEN_QUESTIONS.md` - unresolved authority, privacy, safety, and
  product decisions.
- `IMPLEMENTATION_HANDOFF.md` - final implementation-ready source map.

## Completion verdict

The audit confirms that Luca does not need a continuity system invented from
scratch:

- current Luca/Buzz already owns the working secure identity, runtime, signed
  chronology, cancellation, permission, and publication plane;
- standalone Mnemos supplies a tested resident-continuity kernel;
- Polyphonic supplies real hypomnema, pre/post-turn, notebook, reflection,
  consolidation, and candidate-review behavior;
- legacy Luca supplies useful import, ingestion, and memory-scope product seams.

The missing work is a governed local integration: typed desktop continuity
authority, encrypted resident storage, pre-turn authorization, durable post-turn
jobs, a compact portable Capsule projection, and a new owner-controlled shared
brain scope. The current autonomous substrate and hosted Polyphonic orchestration
must not be copied wholesale.

## Evidence rules

1. Every material claim cites a concrete source file and revision.
2. Implemented, experimental, planned, and visual-only work are labeled
   separately.
3. Historical documents are evidence of intent, not proof of current behavior.
4. No source repository is modified during the audit except this documentation
   directory in the integration repository.
5. Raw private data, credentials, databases, and agent journals are never copied
   into the audit record.
6. Conflicting implementations are preserved in the manifest and resolved in
   the disposition matrix rather than silently collapsed.
