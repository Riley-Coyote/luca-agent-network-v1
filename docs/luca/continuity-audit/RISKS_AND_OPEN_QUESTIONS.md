# Continuity risks and open questions

## Blocking architecture decisions

1. **Capsule commit claim:** single-installation first or full managed
   multi-device conditional coordinator?
2. **Local encryption:** which reviewed storage/envelope design protects SQLite,
   WAL, temporary files, backups, and key rotation through the existing desktop
   custody boundary?
3. **Reflection authorship:** does resident-authored continuity always run through
   the resident's own managed runtime? If a cheaper sidecar writes it, how is it
   labelled and prevented from impersonating the resident?
4. **Owner visibility into private continuity:** is hypomnema readable by default,
   hidden but exportable, or exposed through an owner notebook with disclosure?
5. **Post-turn write authority:** which fast changes may commit automatically,
   which require confidence gates, and which always require owner review?
6. **Universal-brain policy:** exact definitions for resident-private,
   owner-shared, project, and room scopes; recipient authorization; local-only
   egress; and revocation.
7. **Scheduling:** who owns jobs while the app is closed, sleeping, offline, or
   upgraded, and what are the catch-up and budget limits?
8. **Migration:** how are legacy Luca, Polyphonic, and standalone Mnemos identities
   and records mapped, deduplicated, previewed, rolled back, and linked to source?

## Critical technical risks

### Memory text becoming authority

Capsule and recalled memory are encrypted and persistent, which makes a poisoned
write a portable prompt-injection vehicle. They must remain declarative untrusted
data and structurally incapable of changing tools, approvals, provider policy,
budgets, routing, signing, or application configuration.

### Key-custody regression

Managed residents correctly have no private key in ACP. Enabling legacy Buzz
engram memory by passing a raw nsec would undo a central G1 security guarantee.
All continuity crypto must be typed desktop authority.

### Cross-agent disclosure

Neither room membership, explicit event IDs, shared owner identity, nor a list of
memory-agent IDs is sufficient authorization. Every responding resident and
effective provider request must be reauthorized independently.

### Turn-time mutation

Both standalone and legacy Mnemos can reconsolidate during recall. This may
strengthen records or create graph edges before a later scope/egress decision.
Pre-turn reads must use an authorized immutable snapshot; reconsolidation belongs
to a separately committed job.

### False encryption claims

Mnemos databases and backups are permission-hardened but plaintext. Buzz ordinary
rooms are relay-readable. Only proven Capsule/DM/export paths may be called
encrypted.

### Incomplete multi-agent rehydration

Current fresh-session replay works for DMs and thread replies but not plain group
rooms. A continuity system built without closing this seam would appear to fail
in the product's most distinctive surface.

### Checkpoint race/duplication

ACP `EndTurn` precedes policy, cancellation, relay acceptance, and outbox
finalization. Checkpointing there can preserve denied/failed drafts or duplicate
writes after restart. Jobs must derive from the exact durable final event.

### Imported-data poisoning and partial application

Legacy imports expose personal history to a remote extractor when configured,
have coarse memory provenance, and do not roll back written threads on cancel.
New imports need staging, prompt-injection handling, consent, exact lineage, and
deterministic rollback.

### Unsafe autonomous engine

The current Mnemos substrate tick has ineffective output limits, global/unscoped
state, duplicated decay, broken connection queries, and unguarded model paths.
Polyphonic's broader autonomous suite is hosted, budget-opaque, and not restart
durable. Neither can be enabled wholesale.

### Provider credential leakage

Audited Mnemos code can search OpenClaw configuration for provider keys and can
place an embedding key in a query string. Luca must never inherit native-agent
credentials or use query-string secrets.

### Portability and conflict illusion

Generic replaceable events provide last-writer-wins, not a conditional atomic
multi-record commit. Do not claim authoritative history, rollback, or concurrent
multi-device safety without the coordinator/receipt proof or a narrower
single-writer product statement.

### Divergent source lines

- `polyphonic-chat-2` local authority is 22 memory-specific commits behind its
  captured `origin/main` ref.
- Standalone Mnemos source reports 0.3.1 while the local installed distribution
  reports 0.3.0; verify an isolated wheel before packaging.
- Historical planning source coordinates have drifted and must not be reused
  without this audit manifest.

## Important non-blocking product questions

- How much hypomnema appears in the ordinary conversation UI versus an inspector?
- What event makes an observer eligible to retain continuity?
- Should rejecting a candidate suppress equivalent future proposals, and for how
  long?
- What part of the rich local notebook is projected into the portable Capsule?
- Which embeddings, if any, are default for beta?
- What scale target applies per resident and to the owner brain?
- What happens when a resident key is lost, rotated, revoked, or intentionally
  forked?
- Is a quiet empty first-run notebook preferable to generated template identity?

## Audit-required safety proofs before release claims

- continuity absent/locked/slow/corrupt while conversation succeeds;
- no resident/provider secret in ACP/model descendants, logs, screenshots, or
  evidence;
- complete owner/resident/visibility/provider-egress truth table;
- remote outbound payload capture proves denied/local-only bodies absent;
- pre-turn database and logical state remain byte-for-byte unchanged;
- duplicate/restart/cancel races create one terminal continuity outcome;
- group history and primary/observer scopes remain isolated;
- malicious memory/Capsule/import text cannot change authority;
- correction, forget, archive, backup, and restore preserve provenance and exact
  identity binding;
- installed sidecar/store works without developer-machine dependencies;
- public copy states the actual at-rest, relay, provider, and portability limits.
