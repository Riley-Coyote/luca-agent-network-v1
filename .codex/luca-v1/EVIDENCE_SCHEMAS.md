# Executable Evidence Schemas

Schema version: `1`

These documents are the machine-checked gate receipts for Luca Agent Network
V1. All paths are relative to the evidence root. Every referenced file is
content-addressed with a lowercase SHA-256 digest. A gate does not unlock its
successors until this command exits zero:

```text
python3 scripts/validate_planning_kit.py --evidence-only \
  --gate G1 \
  --candidate 0123456789abcdef0123456789abcdef01234567 \
  --evidence-root evidence
```

The validator rejects path traversal, missing evidence, hash drift, candidate
drift, failed tests or scans, a non-independent reviewer, an open P0/P1,
missing milestone task receipts, missing ancestor-gate receipts, and incomplete
proof sets. Structural validation does not require future evidence to exist.

## Common references

A hashed reference is:

```json
{"path":"M1/F01/commands.log","sha256":"<64 lowercase hex>"}
```

Test-log references add `"status":"PASS"`. Task and dependency references add
their respective `task` or `gate` identifier. An identity is:

```json
{"id":"stable-executor-id","independence_group":"implementation:F01"}
```

Independent review requires different `id` and `independence_group` values.
Within a milestone, a task-review identity may execute designated review/proof
tasks but may not author any implementation result. The Ultra gate reviewer
must differ from every milestone executor and task reviewer by both identity
and independence group, and its `independent_of` list names every participant.

## `results.json`

```json
{
  "schema":"luca.evidence.result.v1",
  "task":"F01",
  "candidate_commit":"<40 lowercase hex>",
  "status":"PASS",
  "executor":{"id":"worker-f01","independence_group":"implementation:F01"},
  "outputs":[{"name":"fork_commit","path":"M1/F01/outputs/fork_commit.json","sha256":"<sha256>"}],
  "test_logs":[{"name":"unit","command":"<exact capsule command>","status":"PASS","path":"M1/F01/unit.log","sha256":"<sha256>"}],
  "artifact_scan":{"path":"M1/F01/artifact-secret-scan.json","sha256":"<sha256>"}
}
```

Outputs and test logs must both be non-empty. The artifact scan is validated,
not merely hashed. Output names and paths must exactly equal the task capsule,
and the test-command sequence must exactly equal `capsule.tests`.

## `outputs/<name>.json`

```json
{
  "schema":"luca.evidence.output.v1",
  "task":"F01",
  "name":"fork_commit",
  "candidate_commit":"<40 lowercase hex>",
  "declared_implementation_paths":[".git/config"],
  "implementation_refs":[{"path":".git/config","sha256":"<sha256>"}]
}
```

The declared paths must exactly equal the capsule binding. Every implementation
reference must lie inside those paths and hash against the candidate worktree.
This prevents a named output from being satisfied by an unrelated dummy file.

## `review.json`

```json
{
  "schema":"luca.evidence.review.v1",
  "subject_type":"task",
  "subject_id":"F01",
  "candidate_commit":"<40 lowercase hex>",
  "status":"PASS",
  "reviewer":{"id":"reviewer-a","independence_group":"review:architecture"},
  "independent_of":["worker-f01"],
  "findings":[{"id":"A-1","severity":"P2","status":"ACCEPTED"}]
}
```

`subject_type` is `task` or `gate`. Findings use P0-P3 and CLOSED or ACCEPTED.
P0/P1 findings must be CLOSED; any other state fails validation. An empty
findings list is valid.

## `artifact-secret-scan.json`

```json
{
  "schema":"luca.evidence.artifact-scan.v1",
  "candidate_commit":"<40 lowercase hex>",
  "status":"PASS",
  "scanned":["installed-app","logs","screenshots","recordings"],
  "findings":[]
}
```

A PASS scan has at least one scanned surface and zero findings.

## `proof.json`

```json
{
  "schema":"luca.evidence.proof.v1",
  "proof_id":"P1",
  "candidate_commit":"<40 lowercase hex>",
  "status":"PASS",
  "acceptance_assertions":["<exact frozen assertion>"],
  "mapped_tasks":["F09","F10"],
  "evidence":[{"path":"M1/F09/results.json","sha256":"<sha256>"}]
}
```

The validator requires exact proof assertions and mapped-task order from
`PROOF_TRACE_MATRIX.yaml`. An arbitrary hashed blob cannot satisfy a proof.

## G0 support documents

G0 additionally requires these files beside `gate-verdict.json`:

- `environment.json` — `luca.evidence.environment.v1`, candidate, timestamp,
  non-empty source snapshots, topology and tool versions.
- `M0_evidence_index.json` — `luca.evidence.m0-index.v1`, candidate, PASS,
  source states and hashed M0 artifacts.
- `known_limits.json` — `luca.evidence.known-limits.v1`, candidate, PASS and
  unique structured limits (`id`, `title`, `impact`, `disposition`).
- `results.json` — `luca.evidence.g0-result.v1`, exact index/limits outputs,
  exact G0 capsule test commands and artifact-scan reference.

The G0 verdict's `known_limits` list must exactly equal the structured limit IDs.
Its three proof references must each be a validated `proof.v1` document. G0 is
additionally fail-closed against semantically unrelated but correctly rehashed
evidence: the source manifest must exactly match the four locked M0 repository,
commit and preservation coordinates, and each G0 proof must cite its frozen
evidence-path sequence. Rehashing a substituted test log, fabricated repository
or zero commit therefore cannot produce a valid receipt.

## `gate-verdict.json`

```json
{
  "schema":"luca.evidence.gate-verdict.v1",
  "gate":"G1",
  "candidate_commit":"<40 lowercase hex>",
  "status":"PASS",
  "candidate_author":{"id":"integrator-g1","independence_group":"integration:M1"},
  "dependency_gate_receipts":[
    {"gate":"G0","status":"PASS","path":"gates/G0/gate-verdict.json","sha256":"<sha256>"}
  ],
  "task_results":[
    {"task":"F01","path":"M1/F01/results.json","sha256":"<sha256>"}
  ],
  "task_reviews":[
    {"task":"F01","path":"M1/F01/review.json","sha256":"<sha256>"}
  ],
  "proofs":[
    {"proof_id":"P1","status":"PASS","evidence":[{"path":"M1/proofs/P1.json","sha256":"<sha256>"}]}
  ],
  "test_logs":[
    {"name":"just-ci","status":"PASS","path":"gates/G1/just-ci.log","sha256":"<sha256>"}
  ],
  "artifact_scan":{"path":"gates/G1/artifact-secret-scan.json","sha256":"<sha256>"},
  "review":{"path":"gates/G1/review.json","sha256":"<sha256>"},
  "open_findings":[],
  "known_limits":[]
}
```

The task result/review set is exact: all non-post-gate tasks in the gate's
milestone dependency closure, no omissions or substitutes. The dependency
receipt set is exact: every ancestor gate. Proof identifiers must exactly match
the gate's declared milestone proofs (or the G0 capsule proofs). Every proof has
at least one hashed evidence object.

## Scheduling rule

The scheduler records the validator's zero exit and hash of the accepted gate
verdict. A PASS word in prose, a completed review, or a gate task status field
alone never unlocks dependent implementation.
