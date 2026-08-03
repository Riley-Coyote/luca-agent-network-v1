# Luca Agent Network V1 — Vendored Execution Kit

This is the target-local V5 execution subset used by the Luca Agent Network V1
delivery workflow. Its source coordinate is Buzz
`7e34bee62cacaa9d8a96c14d5892a471b59a1983`; the upstream remote remains
`https://github.com/block/buzz.git`.

Current execution is governed by `USABLE_BUILD_MODE.md`: milestone-grade
verification is paused in favor of the shortest path to a usable local
messaging build.

Included artifacts:

- task graph and task capsules;
- the architecture, target-code, source-map and evidence contracts;
- G0 authorization, milestone gates, proof map and swarm operating model.

Run `python3 scripts/evidence/validate_contracts.py --audit` for a local
ownership/mutex audit. The single intentionally corrected copied status line
and ownership omission are listed in `CORRECTIONS.md`.
