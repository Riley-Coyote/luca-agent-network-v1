# F11 Native Failure-Injection Amendment

Status: approved narrow verification correction after F11 stop on 2026-07-31

## Observed contradiction

F11 must prove in the real Tauri app that personal-home provisioning failure
renders Luca's focused retry/error state. That state is reached only when the
native `get_default_relay_url` invocation rejects, but the command is currently
infallible and the repository contains no native failpoint. Browser bridge
failure is explicitly insufficient for F11.

## Required implementation

F11 may add one debug-build-only environment failpoint to
`get_default_relay_url` that:

1. is compiled only under `debug_assertions`;
2. is disabled unless one exact Luca test environment variable has the exact
   documented value;
3. returns a stable non-secret error before resolving the relay URL;
4. leaves release behavior, relay selection, authorization and persistence
   unchanged;
5. is exercised only with isolated F11 app data and development keyring state.

The normal success response remains the same string value. This does not
authorize a general fault-injection framework, runtime-configurable production
failure, relay mutation, or any live-profile test.

## Ownership and ordering

`desktop/src-tauri/src/commands/identity.rs` is already frozen under F19's
`m1_authority_integration` mutex. To avoid cross-mutex ownership, F19 owns and
implements the seam; F11 consumes it only after F19 is integrated.

F19's existing ownership of that file is limited here to this debug-only
failpoint and its unit test. F11 gains no product-source ownership.
