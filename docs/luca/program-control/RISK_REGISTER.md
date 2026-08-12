# Luca program risk register

This register protects the functional product without allowing speculative
hardening to displace it.

| ID | Risk | Phase treatment | Owner | Stop condition |
|---|---|---|---|---|
| R-01 | Product remains a polished shell with disconnected controls | P1–P2 reconnect existing operations before new architecture | All product teams | A named visible acceptance row cannot be exercised with real state |
| R-02 | New managed-agent protocols duplicate working Buzz operations | Reuse signed events, builders, commands, rooms, membership, media, search, and projections | Communications | Proposed code creates a second conversation or authority plane |
| R-03 | Routine communication becomes approval-heavy or rewritten | Direct mode, verbatim output, five narrow confirmation classes | Communications | Ordinary authorized local message requires approval or semantic transformation |
| R-04 | A2A loops or duplicate finals damage trust | Minimal explicit activation plus existing cancel/restart/exact-publication safeguards | Communications | More than one final publication or hidden autonomous chain appears |
| R-05 | Project/room membership implies data or tool authority | Preserve separate explicit grants and negative tests | Projects / Agent Platform | Membership alone unlocks filesystem, Brain, MCP, model, provider, budget, or external action |
| R-06 | Native Hermes/OpenClaw state or credentials are copied/mutated | Read-only discovery/config, host custody, protected-state hashes | Agent Platform | Any unrelated native file, credential, memory, schedule, or workspace changes |
| R-07 | Inbox/Activity are rebuilt as a parallel workflow system | Restore existing projections/events first; add only a minimal projection if a visible flow proves it necessary | Communications | New store or receipt system is proposed without a missing visible requirement |
| R-08 | Mnemos retrieval impersonates identity or overwrites resident authorship | Native profile authoritative; same runtime authors handoff/reflection; retrieval supplemental and attributed | Agent Platform / Projects | Substitute model authors identity/handoff or retrieved memory becomes sole identity |
| R-09 | Continuity failure blocks conversation | Fail soft, disclose degradation, preserve conversation plane | Communications | Missing/locked/corrupt continuity prevents an otherwise valid conversation |
| R-10 | Security work consumes the beta critical path | Only existing indispensable protections remain P1–P3; generalized hardening is P5 | Program | Optional hardening blocks an accepted visible requirement without concrete beta risk |
| R-11 | Demo overclaims privacy or readiness | Preview/beta language, no E2EE claim, sensitive-data warning | Program | Copy says production-hardened/E2EE or uses highly sensitive real data on unfinished surfaces |
| R-12 | Branch/worktree/reference drift makes evidence non-reproducible | Exact SHA, required candidate ancestry, historical-reference reachability/content, cleanliness, scope, unchanged candidate | Program | Any required ancestry, reference reachability/content, coordinate, validation, or cleanliness check fails |
| R-13 | Shared files create hidden cross-team integration | Program-issued exact-file leases and ordered integration | Program | Team writes an unleased shared file or broad conflict resolution changes semantics |
| R-14 | Installed proof diverges from tested source | Freeze source after candidate; rebuild after any source change | Program / QA | Bundle hash/source SHA cannot be tied to the unchanged candidate |

## Security that is unavoidable for function

The following stays in P1–P3 because removing it would create data loss,
identity confusion, authority leakage, or dishonest behavior:

- stable identity and host signing;
- credential/key isolation and native-config immutability;
- encrypted Brain/continuity storage already in use;
- cancellation, restart recovery, duplicate suppression, exactly-once final;
- membership/recipient checks and five narrow confirmation classes;
- explicit grants separate from organization;
- truthful runtime, privacy, and failure states.

Generalized leases, new outbox/receipt systems, advanced causal graphs, broad
approval binding, NIP-17, production rotation/recovery, hostile multi-tenant
hardening, and unrestricted auto-reply chains are P5 unless a concrete P1–P3
failure proves one indispensable.
