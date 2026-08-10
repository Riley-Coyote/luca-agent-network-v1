# Polyphonic Luca operator and native Agent Forge acceptance

## Product checkpoint

- Branch: `codex/luca-operator-native-forge`
- Product commit: `30467845b5c4267d1c94168c21f900b03e2521b5`
- Evidence commit: the commit titled `Finalize native acceptance and release evidence`
- Remote publication: not authorized

## Automated acceptance

- Luca remains internally compatible with `builtin:fizz`, but only Luca is exposed.
- Default runtime targets are owner-scoped, versioned, and cover Codex, Claude Code, Hermes, OpenClaw, legacy managed runtimes, and no selection.
- Chat drafts accept only name, purpose, runtime family, and provisioning intent.
- Preview and execute are separate owner actions; dismissal changes nothing.
- Hermes provisioning uses `hermes profile create` and allowlisted clone material.
- OpenClaw provisioning uses supported agent add, identity, validation, and deletion commands.
- Transactions are body-free and support rediscovery, reconciliation, and rollback.
- Manual creation, onboarding, Settings, and Luca-generated proposals share the same review surface.
- Existing residents, native configuration, credentials, sessions, schedules, and unrelated workspaces are not mutated by automated tests.

## Signed native acceptance still required

Release promotion remains pending a disposable signed-app matrix that proves:

- Luca on every locally available runtime family;
- direct reversible room creation from an explicit request;
- approval and rejection for Codex, Claude Code, Hermes, and OpenClaw proposals;
- fresh and reviewed clone creation for Hermes and OpenClaw;
- native-created/link-failed relaunch reconciliation without duplication;
- rollback and retained-workspace reporting;
- stable Polyphonic resident identities after relaunch and runtime changes;
- ordinary DMs and mixed rooms;
- byte-identical protected native credentials, sessions, schedules, and unrelated workspaces.

The current rebuild script preserves the live development profile and installed bundle. It is not an isolated native-provisioning harness, so this matrix was not run against Riley's real native homes. No release PASS is claimed from automated checks alone.
