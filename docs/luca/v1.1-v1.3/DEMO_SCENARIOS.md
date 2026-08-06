# Acceptance demo scenarios

These scenarios are both product demonstrations and installed-app acceptance
scripts. Names and content may be replaced with public-safe fixtures, but the
behavior and evidence boundaries remain fixed.

## V1.1 — The note that returns

### Setup

- One live Hermes resident and one live OpenClaw resident.
- Continuity enabled for both.
- Empty or known notebook state.

### Story

1. Riley tells the Hermes resident about a meaningful project decision and an
   unresolved next step.
2. The resident responds. Its final is signed, accepted, and finalized.
3. The compact activity state shows that continuity work completed.
4. The inspector shows the updated handoff and one selective resident-authored
   notebook entry with exact source provenance.
5. Riley corrects one detail and pins the correction.
6. Quit Luca and start a fresh resident runtime session.
7. Riley asks to continue the work. The resident uses the correct unresolved
   thread and pinned correction without first-contact language.
8. Repeat the meaningful-note and fresh-session proof for OpenClaw.

### Failure proof

- Send trivial traffic and accept `no_change`.
- Disable continuity: no generation and no injection.
- Lock or corrupt the continuity layer: chat still replies normally.
- In a mixed room, prove each resident can use only its own notebook.

### Evidence

- resident key and binding before/after;
- signed source/final event IDs;
- body-free job and context receipts;
- inspector source/revision capture;
- provider capture proving bounded same-resident context;
- native app video or timestamped screenshots;
- plaintext/secret scan result.

## V1.2 — One source, explicit access

### Setup

- A small local Markdown corpus containing a unique public-safe fact not present
  in the agents' native memory or conversation history.
- Hermes and OpenClaw residents plus one denied resident/fixture.

### Story

1. Riley selects the folder and reviews a zero-write preview.
2. Luca identifies accepted files and explicitly reports an unsupported or
   skipped fixture.
3. Riley commits the import and grants the source separately to Hermes and
   OpenClaw.
4. Both answer the unique fact in separate turns with visible source provenance
   and distinct body-free receipts.
5. The denied resident cannot surface the source content.
6. Riley revokes one grant; the next provider capture contains no source chunk.
7. Change the granted resident's runtime/provider binding. The grant becomes
   stale until Riley reconfirms it.

### Failure proof

- Cancel an import; no partial source is visible.
- Reimport identical files; no duplicates appear.
- Change one file; preview shows a diff before commit.
- Restart during a staged transaction; it resolves without partial visibility.
- Lock the owner brain; messaging still works.

### Evidence

- before/after hashes of the source corpus;
- import preview and atomic commit receipt;
- grant/revoke/stale/reconfirm transitions;
- provider captures for authorized and denied turns;
- body-free retrieval receipts;
- encrypted-store and plaintext scan results.

## V1.3 — Deliberate reflection, no autonomy theater

### Setup

- A resident with a handoff, several active notebook notes, one pinned owner
  correction, and bounded source conversations.

### Story

1. Riley opens the resident inspector and selects **Review notebook**.
2. The app explains the review scope and starts one private, tool-free request to
   that exact resident runtime/model.
3. The resident returns either `no_change` or one private reflection plus a
   bounded revision/supersession proposal.
4. The inspector reveals the reflection only after Riley opens it deliberately.
5. A before/after view shows the source evidence and notebook changes.
6. Riley rolls back one eligible change. The prior revision becomes effective
   without losing history.
7. Quit and relaunch; authorship, effective revisions, and isolation persist.

### Failure proof

- Start reflection, then begin a user conversation; reflection is preempted and
  cannot commit late.
- Attempt to reverse an owner-pinned correction; validation rejects the result.
- Simulate invalid output, runtime exit, stale epoch, locked store, and restart;
  prior continuity remains intact and chat remains usable.
- Confirm no scheduler or proactive message appears.

### Evidence

- exact runtime/model binding;
- tool/permission/signing/publication denial trace;
- request/result validation receipt without private body;
- revision and rollback evidence;
- post-relaunch installed-app capture;
- proof that ordinary chat and Activity did not expose reflection text.

## Integrated closing shot

In one installed Luca app:

1. Riley enters a mixed conversation with imported Hermes and OpenClaw
   residents.
2. Each remains the same cryptographic resident and uses its native system.
3. A fresh session carries forward a resident-private notebook note.
4. An explicitly granted owner source is available with provenance.
5. The notebook can be reviewed and revised by its resident without background
   autonomy or cross-resident leakage.
6. Turning continuity off leaves an ordinary fully functional agent workspace.
