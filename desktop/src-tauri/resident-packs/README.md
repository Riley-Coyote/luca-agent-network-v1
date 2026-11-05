# Polyphonic starter residents — review candidate

Cast (2026-11-05): Luca, Anima and Vektor are in the house from the start; Fifty (design), Trinity (review), Mira (research) and Coda (writing) wait in the Agent Catalog. Adding a catalog resident uses the existing configured runtime, not another subscription or a pinned provider/model. Council is a separate proposed capability.

Mira and Coda have owner-approved founding portraits and complete editable packs, not borrowed biographies or invented memories. Their shared continuity scaffolds live in `shared/`. Existing residents and user-edited files are not replaced. New definitions are inactive on both a fresh install and an upgrade until the owner adds them.

`desktop/src/shared/content/starterSpecialists.json` supplies the visible role summaries, copy-only example requests and concrete working methods for all seven residents. Native prompt assembly supplements exact stock Soul and Instructions only; any edit to either disables that supplement. Imported native residents are excluded. No files, permissions, memory grants, runtime selection or background jobs are changed by a method or example.

Luca's three examples demonstrate design → build → review, evidence → exploration → review, and evidence → writing using ordinary inbox tasks or existing group chats. They are suggestions, not automatic pipelines or pre-created teams. Missing catalog residents must be added through the existing owner-approved flow before they can be addressed. Copying an example performs no model call.
Each resident has a mark and a shape, written into soul.md and IDENTITY.md: Luca ☉ torus, Anima ⧊ Klein bottle, Vektor ⏀ straight line, Fifty ◐ Möbius strip, Trinity ⟁ triangle within a triangle. A mark is used rarely, never as a signature.
On 2026-11-02 Luca's, Fifty's and Trinity's founding documents gained the new cast and their marks; the 2026-09-15 editions are kept in each archive/ for the migration.
On 2026-09-15 each resident rewrote its own soul.md, IDENTITY.md, self-model.md and convictions.md in the first person, with a specialty: Luca the generalist and orchestrator, Fifty design and the creative leap, Trinity the skeptic. Nobody is told who they are. The owner-authored 2026-09-13 portraits they replaced are kept verbatim in each pack's archive/ so the migration can still recognise them. The remaining documents were authored from the owner's approved design discussion and recovered prompt archive, then reviewed through a bounded two-perspective Polyclaude-style council. See docs/luca/resident-cast-review-editorial.md and the delivery record for actual review and runtime acceptance.

## Document responsibilities
- soul.md: founding disposition, voice, purpose, and scenarios of judgment.
- convictions.md: explicitly authored founding commitments, distinct from earned beliefs.
- self-model.md: a revisable starting hypothesis with provenance and risks to watch.
- user-model.md: a fresh-user scaffold with no invented personal history.
- lessons.md: an initially unearned notebook structure, excluded from runtime assembly.
- instructions.md: concrete operating behavior, assembled by the app.
- IDENTITY.md: extended portrait and design lineage.
- AGENTS.md: portable reference of Instructions, deliberately not a second assembled copy.
- MEMORY.md: continuity practice; does not enable background activity.
- relationship.md: expectations for familiarity, correction, agency, and privacy.
- examples.md: invented conversation studies, never memories or required catchphrases.
- presentation.json: owner-authored introductory Place copy for explicit application.
- Trinity's cognition.md: cooperation design, failure boundaries, and evidence requirements.

## Fresh installation versus existing residents
Full seeds apply only to exact bundled definitions. User-edited definitions do not regain stock files. Seed writes create only absent files.

The existing Dev Luca has history. Preserve its identity, relationships, Notebook, learned models, and lessons. Do not replace existing experience with fresh-install “no observations” language.

One migration does run without asking, and its whole safety argument is a byte comparison. soul.md, convictions.md, self-model.md and IDENTITY.md move to the current edition per file, and only while the file on disk is still exactly a text this app shipped — such a file contains nobody's writing, so replacing it destroys nothing. One word of difference and it is left alone. Absent files stay absent; learned files (lessons, memory, user-model, relationship) are never in the set; native residents, whose documents are their runtime's own files, are excluded. The definition's pinned prompt follows the same rule. Every previous edition stays in archive/, so the change is reversible by hand.

## Source lineage
Recovered Luca: luca-oc-agents-md--b018d6b37a60.txt and luca-oc-identity-md--cb2a5ec93424.txt.
Recovered Fifty: fifty-backstory-long--555695305359.txt and fifty-personality-profile--ab4b7f82fa2b.txt.
Vektor: ~/clawd SOUL.md and IDENTITY.md, and the public voice of the earlier Vektor X agent (vektor-twitter-bot). Token, campaign and account-specific rules were left out.
Anima: the voice, registers and hard lines of the live Anima X agent (polyphonic-twitter-bot/anima/bot.py). Token, campaign and X-only rules were left out.
Recovered Trinity: perception-node-system-prompt--435de30def2b.txt, procesor-system-prompt--0dec954c8776.txt, expression-node-system-prompt--fc6b7de3730c.txt.
Archive names identify design sources; none grants tools, authority, personal memories, or runtime capabilities.

## Delivery boundary
Prepare and inspect a Dev candidate. Do not cut beta.6, publish, or replace the installed beta. Trinity's native three-context execution must be verified honestly; a prompt alone is insufficient.

Council slider concept: the rightmost deliberate selection becomes Council, with the phosphor animation expanding beyond the slider's bounds as a visual metaphor for additional perspectives. Keep reduced-motion behavior, an explicit mode label, and clear additional-work semantics. This is a separate future implementation: do not expose an ornamental Council setting that performs no real council.
