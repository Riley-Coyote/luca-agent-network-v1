# Luca G1 completion checklist

This is the live checklist for claiming **G1 - Personal agent home** from the
current integrated branch. It reconciles the formal gate in
`.codex/luca-v1/MILESTONE_GATES.md` with the later Hermes/OpenClaw reliability
work. Passing focused unit tests alone is not a G1 verdict.

## Candidate lock

- [ ] Start from `agent/runtime-reliability` at or after commit `fa1c5194`.
- [ ] Record the exact candidate commit, dependency/toolchain versions, relay
      topology, app bundle identifier, and native runtime versions.
- [ ] Restart/rebuild the app and `buzz-acp`; do not smoke-test stale processes.
- [ ] Confirm no unrelated local changes are included.

## Native import and identity

- [ ] Hermes discovery visibly reports available/absent/degraded/failed.
- [ ] OpenClaw discovery visibly reports available/absent/degraded/failed.
- [ ] Import the same Hermes profile twice; one resident and one public key.
- [ ] Import the same OpenClaw agent twice; one resident and one public key.
- [ ] Change/revalidate a binding path or version and confirm the resident key
      remains stable.
- [ ] Hash relevant Hermes/OpenClaw configuration before and after; confirm Luca
      did not modify it.
- [ ] Remove or stop a native dependency and confirm the same resident remains
      visible as degraded with no fallback substitution.

## Messaging matrix

- [ ] Hermes DM: send one message and receive exactly one resident-authored final.
- [ ] OpenClaw DM: send one message and receive exactly one resident-authored final.
- [ ] Mixed Hermes/OpenClaw room: address both and receive correctly attributed,
      correctly placed replies.
- [ ] Confirm normal top-level sends, inline replies, unread boundaries, search
      targets, pagination, and scroll anchoring remain correct.
- [ ] Confirm attachment/media send and render smoke.
- [ ] Confirm search smoke against the installed/native app.
- [ ] Run the relevant upstream Buzz messaging regression suite.

## Relaunch and recovery

- [ ] Relaunch and confirm residents with `start_on_app_launch` return under the
      same public keys.
- [ ] Continue each DM after relaunch and demonstrate understanding from bounded
      signed Luca history through a fresh ACP session.
- [ ] Confirm Luca makes no native transcript/session restoration claim.
- [ ] Crash during generation; no duplicate final and an honest interrupted state.
- [ ] Reconcile an already-frozen final exactly once after restart.
- [ ] Missing executable/profile/gateway after restart leaves the resident
      visible and degraded with a useful error.

## Cancellation

- [ ] Cancel a long Hermes turn.
- [ ] Cancel a long OpenClaw turn.
- [ ] Conversation Stop cancels every active resident in that conversation.
- [ ] After the five-second grace, an unacknowledged runtime process group is
      restarted and can answer a fresh message.
- [ ] A final already submitted to the relay yields `publication_ambiguous`, not
      a false guarantee that it cannot arrive.
- [ ] Provisional activity clears and the UI reports the actual outcome.

## Permissions

- [ ] Trigger a real managed permission request.
- [ ] Approve using an exact runtime-advertised allow option.
- [ ] Reject using an exact runtime-advertised reject option.
- [ ] Cancel the turn while approval is pending.
- [ ] Expire a request after the configured timeout.
- [ ] Close the app while a request is pending.
- [ ] Reject stale session-epoch/request decisions.
- [ ] Confirm permission payloads never appear in relay events.
- [ ] Confirm model/tool descendants do not inherit the local control socket.
- [ ] Confirm legacy unmanaged Buzz ACP behavior is unchanged.

## Clean personal-home product

- [ ] Run a clean native profile from onboarding through the main app.
- [ ] Internal personal-home tenancy provisions/selects automatically.
- [ ] No Buzz community/workspace setup, Fizz/Honey/Bumble defaults, Buzz color
      treatment, or Buzz product branding is visible in the Luca path.
- [ ] No conductor or organization-first blocker exists.
- [ ] Owner recovery is usable and accurately explains custody.
- [ ] Persistent resident setup works with one real ACP provider.
- [ ] Conversation works when every continuity/Mnemos service is absent.

## Security and quality

- [ ] No owner/resident key, signing-broker capability, provider credential from
      Luca, or permission bootstrap descriptor reaches model/tool descendants.
- [ ] Artifact/secret scan passes on candidate evidence.
- [ ] Focused Rust and frontend tests pass.
- [ ] Typecheck and production frontend build pass.
- [ ] Relevant native desktop build/smoke passes.
- [ ] Formal G1 evidence record includes logs, safe traces, screenshots, versions,
      candidate commit, and an independent reviewer.
- [ ] No unresolved P0/P1 findings.

## Verdict rule

Claim G1 only when every required item above is either passed against one exact
candidate or explicitly removed from the formal G1 contract by a documented
Riley-approved scope decision. Do not reinterpret a missing proof as a pass.

G1 still does **not** include Mnemos retrieval/writing, Continuity Capsule,
Polyphonic inner life, shared whiteboard, mobile, multi-user collaboration, or
full G8 release hardening.
