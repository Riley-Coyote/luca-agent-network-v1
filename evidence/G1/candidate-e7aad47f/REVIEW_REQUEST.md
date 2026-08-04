# Independent G1 review request

Review candidate `e7aad47f5d0debc6681ceef55b7c74fff42b7f6c` without changing product UI.

## Review scope

1. Confirm the candidate is a descendant of the approved runtime-reliability
   baseline and inspect the two candidate commits after `e3214746`.
2. Review exact cancellation authority, pending-dispatch cancellation, the
   five-second cleanup contract, and `publication_ambiguous` truthfulness.
3. Review managed permission fail-closed behavior, stale-decision binding,
   descriptor isolation, and the separate unmanaged ACP compatibility path.
4. Confirm the two deterministic G1 runtimes contain no real credentials and
   cannot publish simulated behavior outside local verification.
5. Confirm this candidate evidence directory passes the artifact scanner.
6. Record a PASS or actionable finding with severity. A finding must cite the
   exact file and line and state which checklist item it blocks.

Do not re-evaluate visual direction or edit Claude's parallel design lane in
this review.

