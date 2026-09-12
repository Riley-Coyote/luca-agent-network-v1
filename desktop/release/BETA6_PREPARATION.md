# Beta.6 candidate preparation — September 12, 2026

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
