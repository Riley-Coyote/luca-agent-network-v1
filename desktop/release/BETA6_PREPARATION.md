# Beta.6 candidate preparation — September 12, 2026

## Release preparation update — September 14

Riley authorized preparation through a second-Mac test installer, without
publishing to testers. Current integrated source is `codex/first-meeting-finish`:
`56411afcb` includes the onboarding work, conductor-first contract cleanup
(`c09db545c`), glyph preference fix and inline activity indicator refinement.
The signed installed Dev app already contains these UI fixes; runtime helpers
and the installed Polyphonic beta were preserved.

Current checks: frontend typecheck/build and seven focused browser tests pass;
the planning-kit validator and `git diff --check` pass. These checks are not
full release acceptance.

Release gates still open:

- Connected-Brain index-page capacity has a schema-5 repair; see
  `docs/luca/INDEX_RETENTION_REPAIR_2026_09_14.md`. Source checks passed, including
  32 Brain tests and migration of a populated encrypted database copy. Retain a
  paired pre-migration database backup for installation; old binaries cannot
  read schema 5. Installed verification belongs in the delivery receipt.
- Developer ID signing is available. No notarization credential profile has
  been verified; the attempted `AC_PASSWORD` profile does not exist. Do not
  report notarization as complete or put credentials in source/chat.
- Release sidecars, the beta.6 version cut, notarization/stapling and isolated
  release launch remain pending. No beta.6 installer has been produced yet.

The earlier Docker/Postgres/Redis outage was repaired without resetting data;
it is not the remaining Brain capacity problem. Handoff-authorship verification
remains explicitly deferred, as recorded in the continuity wrap-up.

The older preparation notes below are historical context; their branch/base
and pre-authorization wording are superseded by this update.

This pass prepares a Dev candidate. It does not bump the beta version, publish,
notarize, or replace the installed Polyphonic beta.

## Source and retained behavior

Base: `0b8bc855cb20f7e67a83ee4f4f38aa9834fc6c71`.
Integration branch: `codex/beta6-visual-cleanup`.
The final installed revision is recorded in the Dev bundle's
`Contents/Resources/luca-source.json` and the delivery receipt.

Runtime setup fixes `989954c1b` and `99e68f04a` are ancestors of this candidate.
The candidate retains persistent activity history, Quick Chat, session-context
attachments, Canvas, the polished rail, 4px card seams, and 8px outer lips.

The default shell uses the neutral baseline. Fresh installs select that shell;
existing saved theme selections are preserved, including Riley's Vesper selection.
Instrument Sans chrome and Inter reading text remain. Technical content stays mono.

## Preparation checks

Activity page integration continues on `codex/activity-page-beta6` from
`90d262ad0`, porting the single `wp/provenance1` feature commit `f3dd9c76c`.
It preserves Now / Signed record and adds current-field signature checks,
timestamp-boundary pagination, and reader/community-scoped query cancellation.
The signed record reads authorized relay history; local in-thread activity is
stored separately. A timestamp bucket reaching the relay's 2,000-event cap
stops with an explicit error instead of silently skipping history.
Focused source/browser checks and installed Dev review belong to this candidate's
delivery receipt; the beta release process below remains separate.

- Review the clean source diff and installed revision before the release cut.
- Verify focused visual/focus checks and the signed Dev app; see delivery receipts.
- Recheck free internal-drive space before release builds (97 GiB available at prep).
- Account for all six sidecars: buzz, buzz-acp, buzz-agent, buzz-dev-mcp, buzz-relay,
  and git-credential-nostr. Rebuild release sidecars from the frozen release source;
  the current Dev binaries are not release artifacts.
- Keep the beta overlay at beta.5 until the separate release cut is authorized.

## Subsequent release cut

Follow `README.md` and the existing signed/notarized beta release recipe. Set
`release/tauri.beta.conf.json` to beta.6 only at that step. Check the beta plist,
permission wording, nested signatures, entitlements, and architecture. Build with
an explicitly reviewed environment so developer relay/data settings are not baked in.

Beta identity: `Polyphonic`, `chat.polyphonic.desktop`, release keyring
`buzz-desktop`. Dev identity: `Luca Agent Network Dev`,
`com.luca.agent-network.dev`, scoped `buzz-desktop-dev.*` keyring.
Do not copy identities or data between them.

Sign/notarize/staple the app and final DMG, verify quarantined launch, and run an
isolated first-launch/no-development-environment smoke. Use a dedicated data directory
and `buzz-desktop-test.*` release keyring for isolation. The window-state plugin still
uses the real bundle-specific support path: preserve/restore its geometry file;
never delete an existing beta support directory as smoke-test cleanup.

Then run Riley's second-Mac WP-SETUP1 walkthrough: discover the bundled signed-in
Codex installation, reject the obsolete CLI, avoid unnecessary adapter/auth steps,
and send a real first message. This walkthrough has not been performed by this pass.

Onboarding redesign, new features, updater publication, and unrelated branches are
outside this candidate.
