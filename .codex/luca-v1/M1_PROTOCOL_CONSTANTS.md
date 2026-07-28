# M1 Protocol Constants — Frozen Reconciliation

This is a contract reconciliation for the vendored signing-broker result; it
does not expand V1 scope.

- Broker frame maximum: 131072 UTF-8 bytes. Protocol: `luca.signing.frame.v1`.
  `deadline_unix_ms` is at most now plus 30000 ms. Sequence starts at 1 and
  increments without a gap. `bundle_id` is a lowercase UUIDv4.
- A `final_draft` is 1..65536 UTF-8 bytes and exists only after successful ACP
  termination. Resolved `p` tags: at most 64, unique lowercase 64-hex values,
  lexicographically sorted.
- Owner, resident and event IDs are lowercase 64-hex. Turn, dispatch and
  request IDs are 1..128 ASCII characters from `[A-Za-z0-9._:-]`. Integer JSON
  fields are 0..2^53-1. Timestamps are canonical UTC RFC3339 seconds
  (`YYYY-MM-DDTHH:MM:SSZ`).
- Idempotency bytes are SHA256(`luca.message.publish.v1\\0` ||
  u32be(len(dispatch_receipt_utf8)) || dispatch_receipt_utf8 || decoded 32-byte
  resident_pubkey).
- ACP publication results are body-free: `state`, `event_id`, `event_sha256`,
  `publication_receipt_id`. `exact_event_json` is removed; the exact event stays
  only in the desktop outbox.
- Safe diagnostics permit only `protocol`, `timestamp`, `component`,
  `operation`, `status_code`, optional `request_id`/`turn_id`/`resident_ref`/
  `conversation_ref`, `duration_ms`, and `retryable`. Refs are
  `sha256:<64>`; no message, detail, body, path or arbitrary map is allowed.
- Synthetic crypto vectors derive an in-memory test key from a fixed domain
  string. They never store or log a raw seed/nsec; checked-in artifacts contain
  only public event/id/signature values.
- The F13 repair adds `relay_auth.sign.v1` as the second M1 frame operation.
  Its request is semantic and allowlisted: auth kind (`nip42` or `nip98`),
  resident public key, configured relay origin, challenge or HTTP
  method/canonical URL, optional request-body SHA-256, request nonce and
  expiry. It accepts no arbitrary tags, kind, content or unsigned event bytes.
  The result contains one exact signed public auth event plus its event ID; it
  contains no key, general signer, credential or reusable authorization token.
- `relay_auth.sign.v1` is available only on the desktop-bound managed ACP
  channel. Sequence, session, PID, origin and deadline validation are identical
  to `message.publish.v1`. NIP-42 challenges and NIP-98 URLs are revalidated by
  desktop authority against the configured relay before signing.
