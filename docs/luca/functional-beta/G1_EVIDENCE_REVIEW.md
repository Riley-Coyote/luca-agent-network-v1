# Independent G1 evidence review

## Reviewed coordinates

- Candidate: `e7aad47f5d0debc6681ceef55b7c74fff42b7f6c`
- Runtime-control commit: `99410d36d0971bbedcc6cf0b532582f484b5b847`
- Candidate ancestry includes `fa1c5194`.
- Recorded installed binary SHA-256:
  `33a9ee168534b222d97da6957ca0b3bd92e268140014374d2a0529cc1d84855a`

## Initial review verdict

The implementation evidence supports the existing G1 functionality baseline.
Cancellation, permission handling, process isolation, and security fixtures are
substantive, and no unresolved product P0/P1 was found. Formal historical G1
closure is nevertheless withheld until four narrow observations are captured:

1. import the same OpenClaw agent twice and observe one resident identity;
2. observe OpenClaw recall after application relaunch;
3. change a runtime binding path or version while preserving the resident key;
4. recapture the focused logs and scan the complete evidence set without stale
   parent-log counts.

These are targeted V1B native-parity and installed-gate checks. Repeating the
complete historical G1 matrix would add cost without resolving a distinct risk.

## Closure addendum

The V1B installed gate closed the four narrow gaps without repeating the full
historical matrix:

- a fresh discovery resolved OpenClaw `main` to one existing resident and a
  disabled `Imported` action; the registry contained one matching resident;
- a fresh OpenClaw runtime used bounded signed history and its Luca handoff
  after restart without any native-session restoration claim;
- source fixtures proved that a binding fingerprint can change while the
  semantic identity remains stable, and the historical missing-executable live
  check preserved the same resident key;
- the final functional-beta evidence, application support, crash logs, job
  metadata, and managed child environments received body-free scans.

The full repository gate and installed Hermes/OpenClaw beta matrix then passed.
The functional G1 record is closed for this beta baseline. The legacy planning
kit's older machine-validation corpus remains historical material rather than a
second operative product gate.

## Scope freeze

The V1 beta memory promise is intentionally small: native runtime memory remains
owned by Hermes/OpenClaw, bounded signed conversation history remains canonical,
and Luca adds one compact encrypted resident handoff. Universal-brain imports,
associative memory, journals, scheduled inner life, and proactive outreach remain
on the preserved long-range G2 roadmap.
