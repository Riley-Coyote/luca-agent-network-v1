# G2 acceptance matrix

Status values: `NOT RUN`, `PASS`, `FAIL`, `BLOCKED`, `DEFERRED`. Every PASS must
link a task receipt and repository evidence. G2 is not claimed until the
installed-app rows pass and `N03` records an explicit verdict.

## G2.0 — Control plane

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A001 | Exact `4781dca6` baseline is reachable on pushed `agent/continuity-g2`. | PASS | `receipts/C00.md` |
| A002 | Worktree is isolated from Claude's design and existing dirty work. | PASS | `receipts/C00.md` |
| A003 | Control validator proves required docs, valid DAG, known lanes, and gate membership. | PASS | `receipts/C01.md` |
| A004 | Immutable source-audit checksums verify. | PASS | `receipts/C01.md` |

## G2.1 — Protocol and conversation parity

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A101 | Versioned contracts and golden vectors round-trip with body-free diagnostics. | PASS | `receipts/P01.md` |
| A102 | DM and plain-room signed history is bounded, ordered, recent, and isolated. | PASS | `receipts/P02.md` |
| A103 | Every layer state is reproducible through the fake provider. | PASS | `receipts/P03.md` |
| A104 | Hermes DM, OpenClaw DM, mixed room, cancellation, permissions, and publication work with continuity absent. | PASS | `receipts/P04.md` |

## G2.2 — Encrypted continuity kernel

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A201 | Master key is keychain-only; unavailable/locked custody leaves chat operational. | PASS | `receipts/K02.md` |
| A202 | Owner and resident keys are domain-separated; resident records cannot decrypt across namespaces. | PASS | `receipts/K02.md`, `receipts/K03.md` |
| A203 | Tamper, nonce, AAD substitution, wrong-key, corruption, and replay tests fail safely. | PASS | `receipts/K03.md` |
| A204 | Disk, SQLite, WAL/SHM, logs, screenshots, evidence, and child environments contain no continuity plaintext or keys. | PASS | `receipts/K03D.md` |
| A205 | In-memory lexical/graph retrieval is bounded and source-backed. | PASS | `receipts/K04.md` |
| A206 | Revisions preserve history; correction, rollback, archive, and forget are deterministic. | PASS | `receipts/K05.md` |
| A207 | Key rotation recovers from interruption without mixed-key ambiguity. | PASS | `receipts/K06.md`, `../../../evidence/G2/G2.2/K06/a207-security-review-pass.md` |
| A208 | Protected backup preview writes nothing; tamper/wrong passphrase fail; confirmed restore preserves mappings. | PASS | `receipts/K06.md`, `../../../evidence/G2/G2.2/K06/a208-security-review-pass.md` |
| A209 | Restart reconstructs authoritative active heads and lifecycle state without inferring from revision order. | PASS | `receipts/K05D.md`, `../../../evidence/G2/G2.2/K05D/immutable-lease-security-review-pass.md` |
| A210 | Decrypted retrieval bodies and derived in-memory copies zeroize on success, retry, error, and timeout before the desktop read lease may return. | PASS | `receipts/K04D.md`, `../../../evidence/G2/G2.2/K05D/immutable-lease-security-review-pass.md` |

## G2.3 — Turn continuity and durable writes

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A301 | Pre-turn retrieval performs zero persistent mutations and never exceeds 48 KiB. | PASS | `receipts/T01.md`, `../../../evidence/G2/G2.3/T01/security-review-pass.md` |
| A302 | Retrieved/imported text cannot alter tools, permissions, routing, signing, or system authority. | PASS | `receipts/T01.md`, `../../../evidence/G2/G2.3/T01/security-review-pass.md` |
| A303 | Same resident key and continuity survive fresh runtime and app relaunch. | NOT RUN | |
| A304 | Fresh Hermes and OpenClaw sessions recall an unresolved thread without first-contact language. | NOT RUN | |
| A305 | Continuity timeout, lock, corruption, absence, disablement, or store loss never blocks chat. | PASS | `receipts/T01.md`, `receipts/T02.md`, `../../../evidence/G2/G2.3/T02/security-review-pass.md` |
| A306 | Cancelled/failed/ambiguous turns produce no durable continuity. | NOT RUN | |
| A307 | Duplicate/replayed final events produce one terminal continuity result. | NOT RUN | |
| A308 | Automatic private changes retain complete revisions and rollback. | NOT RUN | |
| A309 | Owner corrections remain pinned; sensitive profiling is rejected. | NOT RUN | |
| A310 | Shared-brain changes are proposals and never auto-commit. | NOT RUN | |
| A311 | Group primary/observer rules use the canonical dispatch set. | NOT RUN | |
| A312 | Resident-private records and packets never cross residents. | NOT RUN | |
| A313 | Capsule is compact, versioned, tamper-evident, and never treated as full notebook authority. | PASS | `receipts/T03.md`, `receipts/T03D.md`, `../../../evidence/G2/G2.3/T03D/security-review-pass.md` |
| A314 | Restart during an active continuity job produces exactly one terminal outcome and no duplicate mutation. | NOT RUN | |

## G2.4 — Universal brain and imports

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A401 | Grants persist, are visible/revocable, and are independently receipted per resident. | NOT RUN | |
| A402 | Revoked/stale grants remove data from the effective provider request. | NOT RUN | |
| A403 | Binding change stales egress consent; unknown destination is remote; remote embeddings default off. | NOT RUN | |
| A404 | Discovery reports available/absent/degraded/failed without reading credentials or mutating native configuration. | NOT RUN | |
| A405 | Supported format matrix parses locally; unsupported/binary inputs remain explicit. | NOT RUN | |
| A406 | Import preview is local and source-backed; no visible row exists before atomic commit. | NOT RUN | |
| A407 | Cancellation/crash removes complete staging; identical reimport is idempotent; changes show a diff. | NOT RUN | |
| A408 | Agent-native data maps only through an identity-backed resident mapping. | NOT RUN | |
| A409 | Imported histories retain provenance without fabricated signatures and stay out of the live sidebar. | NOT RUN | |
| A410 | Model organization is explicit opt-in with provider-egress consent. | NOT RUN | |
| A411 | Onboarding import is optional and the same importer remains available in Brain Setup. | NOT RUN | |
| A412 | Captured remote provider payload excludes denied/local-only bodies and local filesystem paths. | NOT RUN | |
| A413 | Migration proposals cannot silently rewrite resident identity or commit owner-brain changes. | NOT RUN | |

## G2.5 — Bounded inner life

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A501 | Inner life is disabled by default and off prevents new jobs/messages. | NOT RUN | |
| A502 | Idle, cadence, daily budget, quiet hours, sleep, catch-up, and no-storm rules pass clock tests. | NOT RUN | |
| A503 | User conversation preempts scheduled work. | NOT RUN | |
| A504 | Scheduled tools and permission requests are denied by default. | NOT RUN | |
| A505 | Resident-authored reflection uses the exact resident runtime/model with no substitution. | NOT RUN | |
| A506 | Only approved cognition outcomes are persisted/published. | NOT RUN | |
| A507 | Proactive candidates pass novelty, usefulness, privacy, repetition, quiet-hours, and rate gates. | NOT RUN | |
| A508 | Proactive DM is signed by correct resident and published exactly once. | NOT RUN | |
| A509 | Default permits at most one proactive DM per resident per rolling 24 hours and suppresses duplicate topics for 30 days. | NOT RUN | |
| A510 | Disabled, limited, offline, quiet-hours, or cancelled residents produce no proactive message. | NOT RUN | |
| A511 | Every model-assisted inner-life cycle records body-free cost and usage receipts. | NOT RUN | |

## G2.6 — Installed application

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A601 | Rebuilt signed macOS app runs real Hermes and OpenClaw residents in DMs and a mixed room. | NOT RUN | |
| A602 | Installed app proves relaunch continuity, sleep/catch-up, import, backup/restore, rollback, and failure drills. | NOT RUN | |
| A603 | Right rail, Brain Setup, Activity, and compact chat indicators expose function without private-body leakage. | NOT RUN | |
| A604 | Focused tests, full repository gate, production build, native smoke, and artifact scans pass. | NOT RUN | |
| A605 | Independent security and milestone reviews have no open critical findings. | NOT RUN | |
| A606 | Signed G2 verdict and continuation handoff are committed and pushed. | NOT RUN | |

## Explicit non-acceptance

The following never constitute G2 proof by themselves:

- source inspection;
- unit tests without installed-app behavior;
- simulated continuity text;
- native runtime session-resume claims without direct evidence;
- plaintext development stores;
- browser-only screenshots;
- a portable Capsule existing without local notebook/brain authority;
- model output that merely says it remembers.
