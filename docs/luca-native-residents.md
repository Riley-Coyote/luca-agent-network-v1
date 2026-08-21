# Luca native residents

Imported Hermes and OpenClaw agents keep a stable Luca resident identity while
their executable, version, and native configuration remain a replaceable runtime
binding.

## Identity and binding

- Hermes identity is the canonical Hermes home plus the exact profile name.
- OpenClaw identity is the canonical daemon configuration, configured gateway
  locator, and exact agent ID.
- A binding fingerprint covers the executable, reported version, and normalized
  binding configuration. Re-importing the same semantic identity reuses the
  resident key and refreshes the binding only after revalidation.
- Offline or degraded bindings remain attached to the same resident. Luca never
  substitutes another profile, agent, gateway, or executable.

Passive discovery and import do not copy native credentials or mutate
Hermes/OpenClaw configuration. After an explicit owner request, any resident
may operate a native harness through the local capability broker, preferring
supported native commands and validating the result. Imported native processes
receive their native-owned configuration, but not Luca owner keys, signing
capabilities, relay credentials, copied provider credentials, or a desktop
master capability.

## Relaunch behavior

Residents with `start_on_app_launch` enabled are restarted with a fresh ACP
session. Luca rehydrates bounded signed conversation history; this is Luca
continuity, not a claim that the native runtime restored its own transcript.
Missing runtimes or configuration leave the resident visible and degraded.

Before fresh dispatch authority is granted, Luca performs one bounded recovery
pass over the encrypted final-publication outbox. Prior-epoch active dispatches
are then marked `Interrupted(Restart)` when recovery is known to be terminal.

## Permissions and cancellation

Managed runtime permission requests use a local-only control channel. The UI
shows only the choices supplied by the runtime, and decisions are bound to the
resident, session epoch, turn, conversation, and ACP request ID. Requests fail
closed on timeout, cancellation, stale sessions, malformed options, runtime
exit, or app closure. Permission payloads are never relay events.

Cancellation is persisted before the owner control event is sent. Because the
current relay path does not expose a harness acknowledgement to the desktop,
Luca waits five seconds and then conservatively restarts the exact managed
process group. If a final was already submitted, the result is explicitly
reported as `publication_ambiguous` rather than claiming it cannot appear.
