# Luca V1 Functional Beta verdict

Verdict: **PASS — functional beta candidate accepted**

The beta is a working personal workspace for imported Hermes and OpenClaw
residents plus Luca-created ACP residents. Stable cryptographic identity,
direct and mixed-agent messaging, native runtime bindings, permissions,
cancellation, restart recovery, search, attachments, and exactly-once final
publication remain intact from G1.

The new continuity promise is deliberately small and complete:

- one private encrypted handoff per resident;
- authored only by that resident's exact configured runtime and model;
- generated only after an accepted and finalized resident response;
- injected with bounded signed conversation history before later turns;
- isolated per resident and unavailable to the relay;
- inspectable, correctable, disableable, retryable, and forgettable by the owner;
- unable to block normal messaging when locked, corrupt, missing, slow, or
  unavailable.

## Installed proof

Real Hermes and OpenClaw residents each generated a source-backed handoff and
used it through a fresh runtime session. A mixed room preserved correct
attribution and resident isolation. Owner correction, item removal, disable,
manual retry, and the forget confirmation were exercised. The destructive
forget confirmation was intentionally cancelled against the live profile; its
physical purge and replay semantics passed on disposable encrypted fixtures.

The final installed application is Developer ID signed as
`com.luca.agent-network.dev`. Its executable SHA-256 is
`d633ba22eb929ecabb8fcd80053ec1c9699b3cbc7b4e2b687accc53b2966ab20`.

## Verification

- full repository `just ci`: pass;
- desktop frontend: 3,377 pass;
- desktop Rust library: 1,748 pass, 13 documented ignores;
- mobile: 525 pass, one documented ignore;
- production builds, typecheck, formatting, and clippy: pass;
- focused continuity security and lifecycle regressions: pass;
- persisted publication-to-handoff crash/reload regression: pass;
- independent final durability re-review: pass, no remaining P0/P1;
- installed native smoke and real-runtime continuity matrix: pass;
- plaintext, signing-key, and child-environment scans: pass.

## Honest beta boundary

This is a functional beta, not the complete Mnemos/Polyphonic vision. Native
memory remains owned by each native runtime. Luca adds a compact continuity
overlay and never claims native transcript restoration or unsupported ACP
capabilities. Universal-brain imports, associative retrieval, hypomnema,
journaling, scheduled inner life, proactive outreach, mobile, voice, conductor
behavior, and concurrent multi-device writes remain deferred.
