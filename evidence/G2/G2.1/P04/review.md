# P04 independent review

Final verdict: PASS

No P0, P1, or P2 findings remain after one bounded repair.

The reviewer verified:

- the exact synthetic fixture set is `{hermes, openclaw}` and is honestly
  labeled as non-native proof;
- both distinct resident keys traverse real dispatch, signing-broker, and
  encrypted-outbox state machines in DMs and a mixed room;
- expected publication and cancellation counts derive from fixture values;
- cancelled dispatches publish no finals;
- the real private desktop managed-permission registry preserves advertised
  allow/reject options, cancellation, exact request binding, stale-decision
  rejection, and session-epoch isolation with continuity absent;
- production managed-permission code is unchanged; only test code was added;
- the desktop lockfile synchronization is legitimate and locked metadata
  resolves.

This is source/conformance evidence for G2.1. It does not replace the installed
Hermes/OpenClaw and native application evidence required by G2.6.
