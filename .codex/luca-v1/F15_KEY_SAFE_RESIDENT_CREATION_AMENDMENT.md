# F15 Key-Safe Resident Creation Amendment

Status: approved narrow authority correction after implementation stop on
2026-07-31

## Observed contradiction

F15 must create durable cryptographic residents through a direct setup UI. The
only existing callable Buzz creation path, `create_managed_agent`, returns
`private_key_nsec` through Tauri IPC and the existing agent UI renders a secret
reveal dialog. Luca's F14 and security contracts require a managed resident's
private key to remain inside desktop/keychain authority and never enter the
renderer, model, logs, or normal diagnostic surfaces.

The original F15 ownership covered the resident registry and agent UI but not
the Tauri command registration or test-bridge parity needed to expose a safe
resident-registry wrapper. A selection-only UI would not create real residents
and cannot satisfy F15.

## Required implementation

F15 may add one Luca-specific resident-creation command and client adapter that:

1. reuse the existing managed-agent creation validation and keychain-backed
   persistence path;
2. return only the public managed-agent summary plus non-secret setup errors;
3. never serialize, log, cache, or render `private_key_nsec`;
4. leave the upstream legacy `create_managed_agent` behavior unchanged for
   compatibility, while Luca-owned setup calls only the safe command;
5. prove through IPC serialization and UI tests that no resident nsec reaches
   the renderer or model/runtime descendant.

The safe path must also be retry-safe at the resident/persona boundary. A
failed attempt may not leave an invisible orphan persona or mint a second
resident identity when the same setup is retried. Luca's synthetic bridge must
model the public-only boundary directly; it may not create, retain, or strip a
renderer-side fake nsec as a shortcut.

The compatibility command's generated temporary nsec must use an RAII
zeroizing guard until it is deliberately copied into the existing legacy
response and persistence record. This is memory-hygiene hardening only: it may
not change legacy IPC response shape or storage compatibility.

This does not authorize a generic signing command, renderer key access, a new
key store, a migration, or changes to resident/model permissions.

## Narrow ownership addition

F15 already owns the resident registry and Luca feature UI where the safe
command and caller belong. It additionally owns only the two integration seams
required to register and test that wrapper:

- `desktop/src-tauri/src/lib.rs`;
- `desktop/src-tauri/src/commands/agents.rs`, only for the generated temporary
  nsec zeroizing guard described above;
- `desktop/src/testing/e2eBridge.ts`.

All remain serialized under the existing `m1_authority_integration` mutex and
after F14. F15 must not weaken or bypass the F14 broker/keychain boundary.
