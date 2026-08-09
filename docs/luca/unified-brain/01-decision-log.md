# Decision Log

## Settled

| Decision | Why it matters |
|---|---|
| Local-first discovery and explicit selection | onboarding must feel effortless without silently ingesting a person’s life |
| One Owner Brain, many private resident continuities | prevents a single unsafe shared agent database |
| Provenance survives all transformations | answers, memories, and graphs remain accountable to original sources |
| Read-only context packet | ordinary recall must not silently reshape memory |
| Post-publication memory jobs | prevents failed/draft responses from becoming durable knowledge |
| Fail-soft conversation | Unified Brain improves Luca; it does not become a messaging dependency |
| Graphs are projections | graph capabilities must not control permissions or replace source evidence |
| Tab Ledger is optional | it is valuable for Riley but cannot be an assumed dependency for other users |

## Proposed defaults

| Topic | Default |
|---|---|
| Brain Setup entry choice | Set up agents / bring in active work / start empty |
| Discovery | local metadata only; no provider calls |
| Import | staged, cancellable, deduplicated, rollback-capable |
| Recall | local full-text first; graph and semantic projections are additive |
| Egress | deny by default for local-only data; explicit source and provider grant required |
| Resident identity updates | candidate + review unless a narrowly approved fast policy applies |
| First release portability | single-installation truth claim unless a stronger model is proven |

## Settled by current Luca

1. The first supported product is the macOS Tauri desktop app.
2. V1.2 begins with one explicitly selected Markdown/text file or folder; broad
   discovery and imported histories are deferred.
3. Existing owner-brain and resident-private records reuse the encrypted
   continuity kernel. Absolute paths are encrypted, device-local metadata.
4. Owner Brain egress is explicit per source, resident, provider and runtime;
   unknown egress fails closed as remote.
5. The owner may inspect, correct, pin, archive and forget resident notebook
   records without merging them into Owner Brain.
6. V1.2 has no automatic refresh or folder watching.
7. V1.2 makes a single-installation, single-writer claim.

## Open decisions — require Riley before later expansion

1. Default provider-egress policy for future model-assisted extraction and
   embeddings.
2. Whether repository code graphs ship as an in-app capability, a
   Graphify-compatible adapter, or both after evaluation.
3. Multi-device writer coordination after the single-writer release.

## Decisions an implementer may not make unilaterally

- grant a resident broad owner-brain access;
- merge resident databases;
- transmit private source bodies to an external model;
- install or modify external assistant hooks/configurations;
- claim encrypted storage without proving all relevant files are protected;
- enable a graph extractor that changes durable memory on ordinary recall.
