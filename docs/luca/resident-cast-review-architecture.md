# Resident cast architecture and continuity review

Review scope: bundled Luca, Fifty, and Trinity documents under
`desktop/src-tauri/resident-packs/`, and the creation/seed path in the
desktop native code. This review addresses runtime truth and preservation of
existing residents; the editorial voice review is separate.

## Round 1 — draft contracts

The six core slots are compatible with the existing resident folder: Soul,
Convictions, Self-model, User model, and Instructions assemble into a bounded
system prompt in that order; Lessons is a stored document but is not assembled.
`IDENTITY.md`, `AGENTS.md`, `MEMORY.md`, `relationship.md`, `examples.md`,
`presentation.json`, and Trinity's `cognition.md` remain inspectable extras,
not automatically loaded prompt sections. Operative identity and method must
therefore appear in the core slots, which the drafts do.

Three material corrections were needed:

1. Trinity's initial wording called its method operational before a live
   delegated run had been proven. A full run needs two actual native child
   deliverables plus the resident's own Expression response. A manifest that
   declares subagents or a document that instructs delegation is not such a
   receipt.
2. The initial statement that delegated roles inherit no additional authority
   was too absolute. The selected runtime's permission behavior must be
   checked, and the roles must remain within the current turn's authorization.
3. A bundled `AGENTS.md` copy cannot stay synchronized when the owner edits
   `instructions.md` through the existing one-file write API. It should be
   labeled an initial reference; `instructions.md` is the live prompt slot.

## Round 2 — corrected drafts

The revised Trinity Soul describes a defined execution contract conditional
on supported native delegation. `instructions.md` specifies two bounded child
contexts, a single resident Expression voice, permission verification, honest
fallback, and evidence needed to claim a full run. `cognition.md` explicitly
distinguishes task contexts from operating-system processes. The reference
`AGENTS.md` files now say later edits are not automatically synchronized.

The packs consistently distinguish founding hypotheses from learned state.
Fifty's origin story is marked as fiction, and all three user models contain
no fabricated facts about a new person. Lessons files contain starting
guidance rather than purported episodes. No memory service, background work,
or native tool is claimed to exist merely because a document describes it.

The second pass also replaced the remaining “three-process” references in
Trinity's assembled Soul and Instructions and its Identity reference with
“three-part.” That is consistent with the three distinct task contexts and
does not promise separate operating-system processes. No further wording
correction is needed on this boundary.

## Application boundaries

The bundled Self-model, User model, and Lessons texts describe a **fresh**
resident. They must not be applied as factual descriptions of the existing
Dev Luca, which may already have real conversations and learned records.
Current Dev application should read each file and its hash, show a per-file
diff, and write only the approved content through the existing conflict-aware
resident document API. Preserve the existing public key, custom definition,
resident-authored files, and other learned data. An exact old-stock Luca
definition may receive the new built-in definition pin, but its live
`soul.md` stays unchanged until an explicit reviewed apply.

New Fifty and Trinity residents use the existing key-safe
`create_luca_resident` path and exact persona IDs. Bundled pack files seed
only when the pinned Soul equals the canonical built-in Soul, and each file
uses create-new semantics so no existing document is replaced. Their runtime
and model remain the owner's configured choices. The native seed call is
currently best-effort: a file error is logged while creation continues, and
there is no automatic later retry call. Setup must inspect the resulting
folder and report any missing file rather than assume the full pack landed.

Trinity's live delegated method remains unverified until an exact resident,
runtime, and conversation produce both native child deliverables, one final
resident reply, and settled child activity. Direct mode is the accurate
fallback when delegation is unavailable or fails.
