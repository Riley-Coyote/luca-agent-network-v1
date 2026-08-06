# V1.1 frozen interface contract

Status: frozen for backend implementation

## Protocol

- `ResidentMemoryNoteV1`
- `ResidentJournalPageV1`
- `ResidentNotebookItemV1`
- `ResidentNotebookStatusV1`
- `ResidentNotebookAuthorshipV1`
- `ResidentMemoryNoteMutationV1`
- `ResidentMetabolismRequestV1`
- `ResidentMetabolismResultV1`
- `CreateResidentJournalPageRequestV1`
- `CreateResidentJournalPageResultV1`
- `ResidentJournalPageRevisionRequestV1`
- `ResidentJournalAnnotationV1`

Unknown fields, unknown enum variants, wrong protocol versions, cross-resident
references, excessive bodies/counts, empty source-backed notes, invalid
revision links, and authorship substitution fail closed.

## Lifecycle

- Memory notes: resident create/revise/supersede; owner correction/pin/archive/
  forget.
- Journal pages: resident create/revise; owner annotate/archive/forget/request
  revision. Direct owner body replacement is not an interface.
- Annotations never enter automatic recall and remain attached to the exact page
  lineage/revision they cite.
- Forget removes the effective body and retrieval eligibility while preserving
  only minimum encrypted lifecycle authority.

## Renderer view models

- `ResidentNotebookListV1`: pagination cursor, availability, counts, body-free
  active job, and item summaries disclosed only through the explicit inspector.
- `ResidentNotebookItemDetailV1`: one decrypted item, provenance, authorship,
  lifecycle, and annotations.
- `ResidentNotebookRevisionHistoryV1`: ordered body-bearing history returned only
  through explicit owner disclosure.
- `ResidentNotebookActivityV1`: body-free job status only.

## Commands

- `list_resident_notebook_items`
- `get_resident_notebook_item`
- `get_resident_notebook_revision_history`
- `correct_resident_memory_note`
- `archive_resident_notebook_item`
- `forget_resident_notebook_item`
- `create_resident_journal_page`
- `annotate_resident_journal_page`
- `request_resident_journal_page_revision`
- `cancel_resident_notebook_job`
- `retry_resident_notebook_job`
- `get_resident_notebook_activity`

TypeScript projections use the renderer view-model names above and camel-case
fields. The protocol implementation freezes their concrete fields before
frontend binding.

## Authority

- All item bodies are encrypted in the exact owner/resident namespace.
- Same-resident runtime/model authorship is mandatory.
- Journal bodies never appear in ordinary pre-turn context.
- No notebook operation grants signing, publication, tools, permissions,
  routing, native-memory access, or cross-resident reads.
