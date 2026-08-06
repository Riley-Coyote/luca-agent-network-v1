# V1B acceptance matrix

Status values: `NOT RUN`, `PASS`, `FAIL`, `BLOCKED`, `DEFERRED`.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A001 | Clean beta branch descends from `dc1c2e63`; dirty G2 worktree is unchanged. | PASS | `receipts/C00.md` |
| A002 | Active build controls validate and preserve G2 as long-range roadmap. | PASS | `receipts/C00.md` |
| A003 | Historical G1 evidence receives independent review without unsupported claims. | PASS | `G1_EVIDENCE_REVIEW.md`, `receipts/C01.md` |
| A004 | Native memory plus compact handoff is the frozen beta memory promise. | PASS | `V1B_BUILD_SPEC.md`, `receipts/C01.md` |
| A101 | Hermes/OpenClaw semantic identity remains stable across binding changes. | PASS | `NATIVE_PARITY_CONTRACT.md`, `receipts/N01.md` |
| A102 | Native configuration, credentials, memory, and schedules remain unchanged. | PASS | `NATIVE_PARITY_CONTRACT.md`, `receipts/N01.md`, `../../../../evidence/G1/RUN_LOG.md` |
| A103 | Real profile memory, workspace, and permission-gated tool checks pass or report honest unsupported states. | NOT RUN | |
| A104 | Hermes/OpenClaw DMs, restart, and mixed-room attribution remain correct. | NOT RUN | |
| A105 | Exact imported profile/agent and workspace bindings are validated at launch and unavailable bindings fail honestly. | PASS | `NATIVE_PARITY_CONTRACT.md`, `receipts/N02.md` |
| A201 | `ResidentHandoffV1` is bounded, validated, encrypted, revisioned, and source-backed. | PASS | `receipts/H01.md` |
| A202 | Owner corrections pin authority; item removal, forget, and disable are deterministic. | PASS | `receipts/H01.md`, `receipts/U01.md` |
| A203 | Handoff cognition uses only the same resident runtime/model with no substitution. | PASS | `receipts/H02.md` |
| A204 | Cognition cannot use tools, permissions, signing, routing, or publication. | PASS | `receipts/H02.md` |
| A205 | Only accepted/finalized resident finals can schedule handoff work. | PASS | `receipts/H03.md` |
| A206 | Duplicate/restart processing produces exactly one terminal job and mutation. | PASS | `receipts/H03.md` |
| A207 | Cancelled, failed, ambiguous, owner, and trivial turns create no durable handoff. | PASS | `receipts/H03.md` |
| A208 | Fresh Hermes/OpenClaw sessions use the latest effective handoff without native-resume claims. | NOT RUN | Installed native proof remains in R01. |
| A209 | Resident handoffs never cross residents, including mixed rooms. | PASS | `receipts/H04.md` |
| A210 | Disabled, locked, corrupt, missing, or timed-out continuity never blocks chat. | PASS | `receipts/H04.md` |
| A301 | Inspector supports inspect, correct, item removal, forget, disable, and retry. | PASS | `receipts/U01.md` |
| A302 | UI and Activity expose provenance/status without leaking private bodies. | PASS | `receipts/U01.md`, `receipts/U02.md` |
| A303 | Import clearly discloses default-on private handoff and provides a toggle. | PASS | `receipts/U02.md` |
| A304 | Chat indicators remain compact and do not become a memory dashboard. | PASS | `receipts/U02.md` |
| A401 | Installed app passes real native capability and fresh-session continuity demo. | NOT RUN | |
| A402 | Installed failure drills preserve messaging and exactly-once publication. | NOT RUN | |
| A403 | Artifact, database, WAL/SHM, log, relay, and child-environment scans contain no handoff plaintext or keys. | NOT RUN | |
| A404 | Focused tests, full repository gate, production build, and native smoke pass. | NOT RUN | |
| A405 | Independent final review, V1B verdict, and continuation handoff are committed and pushed. | NOT RUN | |
