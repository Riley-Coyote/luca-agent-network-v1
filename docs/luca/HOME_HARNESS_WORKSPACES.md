# Home and native harness workspaces — beta.14

This is the implementation of Riley’s approved Home / Claude Code / Codex study.
It does not replace the last-conversation startup route or Luca’s canonical home DM.

## Destinations

- Home (`/dashboard`) has a separate icon above Chats: actual outstanding requests,
  recorded work, a receipt-based timeline, results, and local usage.
- All work includes the current native Claude/Codex catalogues. Opening a row goes
  directly to its exact harness workspace and selection.
- Claude Code and Codex sidebar entries open their workspaces directly. Other
  harnesses and the classic, shell-off page keep their existing behavior.
- Home’s Luca composer and side conversation send to the existing canonical DM.
  Selected work is an explicitly visible reference, not a tool instruction or grant.
  Closing a view never stops work; Stop remains a separate action.

## Native session boundaries

`list_harness_sessions` reads at most 50 sessions per current native profile.
Opening a listed session reads a filtered, role-preserving recent transcript tail
(up to 32 messages / 256 KiB input, 16 KiB per message / 64 KiB response).
No Brain import, observation, note-keeping or sharing permission is created.

Read/action references expire after five minutes and on process restart. They bind
owner, relay, app profile, native profile, resident, conversation and runtime binding.
Refresh obtains new references without changing the stable UI selection or draft.
Resident tools cannot use owner-dashboard references as lookup/read authority.

Starting, continuing and messaging are distinct existing runtime-task operations:

- New task uses the owner’s chosen working folder and normal permissions.
- Continue reviews the exact saved session, original folder and native policy.
- Send targets the exact supported live native controller. Native approvals and
  native-owned Stop stay in the harness; a queued native message is not completion.
- Polyphonic-owned task Stop affects that task only. Navigation and panel closure
  do not cancel, continue, retry or duplicate a task.

The live Claude probe uses an explicit CLI pin, or the fixed shim published by
existing discovery. It never performs full CLI discovery from a catalogue read.
Unsupported controllers, expired references and uncertain delivery fail closed.

## Honest data

Local task counts, lifecycle, steps and durations come from actual retained receipts.
Recently modified files are not treated as active tasks. Transcript metadata is not
treated as current controller availability. Native queue acknowledgement is labeled
as a handoff, not a finished task.

Provider-wide quota, token budget, reset, credit balance and API spend are unavailable
unless a trustworthy provider source supplies them. This version does not estimate
them. Selected-session usage is explicitly unavailable when native metadata is absent.
Billing connection reads only the existing secure connection status; keys are never
copied to this page. No new Grok, social, Mnemos or Ghost integration is included.

## Verification entry points

- `src/features/dashboard/dashboardModel.test.mjs`
- `src/features/harness-dashboard/model.test.mjs`
- Rust `runtime_tasks` tests, including owner-dashboard leases and transcript bounds
- `tests/e2e/shell-harness-dashboard.spec.ts`

Browser fixture data is opt-in and test-only. It proves layout and UI routing, not
native controller availability, provider billing, live delivery or glass materials.
The isolated unsigned Rail Glass candidate is the native walkthrough target. Its
profile and receipt are outside the one shared Cargo build cache; the daily app and
daily data are not replaced. Nothing is published by preparing this candidate.
