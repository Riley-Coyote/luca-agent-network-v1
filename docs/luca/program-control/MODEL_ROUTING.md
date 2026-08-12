# Luca runtime and model-routing rules

## Phase 1

- The resident's exact configured Hermes/OpenClaw/Luca-managed runtime remains
  authoritative for replies.
- Resident output is published verbatim through the host-owned signer in Direct
  mode; a different model may not silently rewrite it.
- Provider, model, executable, tools, MCP, budget, and permissions come from
  explicit resident configuration, never project/room membership or retrieved
  context.
- Restart may create a fresh runtime session but must preserve stable resident
  cryptographic identity, signed history, cancellation, and exactly-once final
  publication.
- No provider/native credentials or resident signing keys enter the model
  context, tool descendant, or communication payload.

## P4 Mnemos

- Native identity documents are loaded through the exact bound runtime/model.
- Handoffs and reflection are authored by that same resident/runtime and stored
  verbatim with provenance.
- Retrieval/hypomnema may supply supplemental context but cannot replace the
  resident author or alter provider/model/tool/budget authority.
- Missing or failed continuity is disclosed and skipped; conversation remains
  functional.

## P5 delegation

Multi-model delegation or an optional conductor requires separate activation.
Any worker is bounded by explicit budget/capability, cannot inherit durable
credentials/signing authority, and returns attributed proposals/results to the
resident/host boundary. A conductor, if ever built, is an ordinary replaceable
resident role, not a hidden router.
