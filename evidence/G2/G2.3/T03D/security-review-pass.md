# T03D independent security review — PASS

## Scope

Reviewed commit `77db75e6`, which integrates the pure T03 portable continuity
Capsule with trusted desktop key custody, explicit relay transport, the managed
resident signing broker, and the pre-turn continuity context layer.

## Accepted boundary

- The operation is fixed to NIP-AE kind 30174, the versioned Luca Capsule slug,
  exact resident author, exact owner `p` tag, derived `d` tag, and eight-event
  query ceiling.
- Resident signing and encryption stay inside the already-running
  `ResidentSigningBroker`. The bounded internal handle exposes no key, generic
  signer, decryptor, Tauri command, child operation, or protocol expansion.
- Owner keys are acquired only in synchronous preparation/decryption blocks and
  are dropped before every network await.
- Relay response content length and chunk growth are capped, decoded query
  results are rejected above eight events, non-success bodies are not read,
  loads time out, and stores have one absolute eight-second deadline.
- One per-resident async transaction lock covers load through final exact-head
  re-verification. Different residents remain independently writable.
- Signature, fixed-coordinate, projection, binding, revision, successor, and
  exact-head checks fail closed. Stale and invalid states carry no context body.
- A Ready Capsule is independently available when the local notebook lease is
  empty, denied, stale, locked, unavailable, timed out, or invalid. Failure of
  either layer does not block chat or erase the other layer.
- Capsule content is untrusted reference material. It cannot mutate or replace
  the encrypted local notebook or owner brain.

## Review repair

The initial review found three P1 issues: non-independent layer degradation,
missing transaction-wide serialization, and incomplete hostile-relay bounds.
The implementation received one bounded repair. Independent adversarial
re-review found all three resolved and no remaining exact-scope issue.

## Verification

- Trusted Capsule and hostile-relay tests: PASS (11/11).
- Continuity context and independent-layer matrix: PASS (9/9).
- Managed continuity transport: PASS (5/5).
- Resident signing broker regressions: PASS (10/10).
- Native child environment secret exclusion: PASS (1/1).
- Upstream Buzz engram cryptography/validation: PASS (34/34).
- Desktop library check: PASS; only pre-existing G2 dead-code warnings remain.
- G2 control validation and repository diff validation: PASS.

## Verdict

T03D passes. Together with T03, acceptance A313 is satisfied. Portable Capsule
publication is ready for T04's durable post-publication metabolism but is not
yet evidence that T04 automatic continuity writes exist.
