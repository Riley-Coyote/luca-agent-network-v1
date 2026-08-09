# V1.2.1 frozen interfaces

Status: frozen for C28

Base: `fbdd50bb5e3c392a61fc875a13d0a27b0b623eb9`

Branch: `codex/brain-connections-v1-2-1`

## Protocol ownership

`crates/luca-protocol/src/connected_brain.rs` owns the strict serialized
contracts. `luca.brain.connected.v1` covers source descriptors, encrypted
device bindings, body-free index entries, and the default connection policy.
`luca.repository.work.v1` covers grants, requests, exact decisions, and body-
free receipts. Unknown fields and semantic-invalid values fail deserialization.

The encrypted owner-brain namespace owns bindings, indexes, cursors, and grants.
Original repositories and JSONL histories remain authoritative and are never
stored as connected-source bodies. Existing V1.2 snapshot contracts and
commands are unchanged.

## Frozen renderer commands

- `discover_connected_brain_sources`
- `add_connected_brain_root`
- `list_connected_brain_sources`
- `connect_connected_brain_source`
- `refresh_connected_brain_source`
- `disconnect_connected_brain_source`
- `reconfirm_connected_brain_source`

The renderer passes opaque IDs and owner actions only. Canonical paths,
credentials, broker capabilities, permission payloads, and source bodies never
cross this command surface.

## Frozen Brain inventory

The default Brain view has exactly four categories: Repositories, Codex,
Claude Code, and Files. Each category exposes one simple primary action and the
states `Found`, `Connecting`, `Connected`, `Current`, and `Needs attention`.
Details may expose discovery roots, exclusions, refresh state, V1.2 snapshot
imports, resident exclusions, grant state, and body-free provenance receipts.

The first successful connection records this exact consent:

> Luca keeps a private local index while your originals stay where they are.
> Your agents may send only relevant excerpts to their configured models.
> Repository edits and commands always ask first.

## Frozen repository tool surface

The managed `luca-repositories` MCP server exposes exactly:

- `repositories`
- `repo_tree`
- `repo_search`
- `repo_read`
- `repo_apply_patch`
- `repo_run`
- `repo_status`
- `repo_diff`
- `repo_commit`

Every call uses an opaque source ID and relative paths. Reads are automatic.
Patches, executable-plus-argument commands, and commits require desktop-owned
approval; commits require their own approval and honor hooks. Conversation
allowance is bound to resident, runtime binding, conversation, repository, and
operation fingerprint. No push, remote mutation, PR, credentialed Git, shell
string, absolute path, or direct `.git` mutation is present.

## Frozen bounds and exclusions

- At most 32 discovery parents and 512 discovered repositories per pass.
- Discovery never uses an unbounded home-root walk or escaping symlink.
- Index pages contain at most 512 body-free entries and each entry at most 256
  unique hashed lexical terms.
- A repository request carries at most 32 unique safe relative paths.
- Repository indexing respects Git ignore behavior and excludes binaries,
  dependencies, build outputs, oversized files, credential-like names/content,
  unsafe paths, and Git metadata.
- Session adapters retain user-visible user/assistant text only. They exclude
  system/developer instructions, reasoning/thinking, tools/results, environment
  payloads, subagents, credentials, and native restoration metadata.
- Connected and imported candidates share the V1.2 global ceiling of eight
  excerpts and 24 KiB per turn.

## Deferred authority

V1.2.1 adds no database migration, embeddings, graph, Mnemos integration,
model-assisted ingestion, automatic memory writing, proactive work, remote
repository operation, or Resident Reflection. V1.3 remains blocked by C32.
