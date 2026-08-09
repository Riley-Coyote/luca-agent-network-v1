# Unified Brain reconciliation with current Luca

Date: 2026-08-08

Baseline: `luca/v1.1` at `34989f9`

Status: M0 complete; V1.2-B21 authorized by the active task graph.

## Authority order

1. `HANDOFF.md` and project instructions.
2. `docs/luca/v1.1-v1.3/` for the active V1.2 build.
3. `docs/luca/PROJECTS.md` for Project to Room and device-local path behavior.
4. This packet for the long-range Unified Brain destination.
5. `.codex/luca-v1/` as the historical G2 architecture and evidence archive.

The historical vendored kit contains unrelated tasks named `B21` through
`B25`. New evidence, commits and reports must use `V1.2-B21` through
`V1.2-B27` so the two graphs cannot be confused.

## Existing substrate to preserve

- signed Buzz/Luca events as canonical chronology and authorship;
- stable resident public keys and desktop key custody;
- read-only Hermes/OpenClaw discovery and native-owned configuration;
- encrypted resident handoff, Resident Notebook and Living Journal;
- read-only, fail-soft context packet and body-free activity state;
- separate owner-brain encryption namespace and dormant context layer;
- Project to Room navigation and its reviewed device-local project-store seam;
- installed macOS release verification.

These are dependencies, not Unified Brain milestones to rebuild.

## Active V1.2 boundary

V1.2 proves one complete, narrow source loop:

1. explicitly select one Markdown/text file or folder;
2. produce a zero-write preview with safe exclusions;
3. commit an encrypted, atomic, deduplicated source snapshot;
4. grant individual residents access independently;
5. validate provider/runtime egress before retrieval;
6. retrieve bounded local lexical context with visible provenance;
7. revoke or stale access before the next request;
8. leave messaging usable through every failure state.

Automatic discovery, imported chat histories, folder watching, model-assisted
organization, semantic indexes and graphs remain later adapters.

## Product flow separation

- Project creation does not import a repository.
- Source import does not grant a resident.
- Room assignment does not grant source access.
- A source grant does not mutate runtime, provider, tools or permissions.
- Absolute local paths remain encrypted, device-local metadata and never enter
  relay events, provider requests, receipts, logs or evidence.

The three conceptual entry routes belong inside reopenable Brain Setup after
owner onboarding. `Start empty` is always complete and carries no penalty.

## Naming

- **Unified Brain:** internal program and long-range product charter.
- **Owner Brain:** governed source-backed authority namespace.
- **Brain Setup:** user-facing source, project and access control surface.

## Branch discipline

Implementation branches from the clean release baseline above. The untracked
packet originally created in the older dirty `agent/runtime-reliability`
checkout is source material only and must not be committed or merged wholesale.
