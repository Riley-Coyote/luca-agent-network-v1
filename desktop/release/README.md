# Beta release overlay

`tauri.beta.conf.json` is the Tauri config overlay used to build the **Polyphonic**
beta from this repo. It is applied on top of `desktop/src-tauri/tauri.conf.json`:

```sh
cd desktop
pnpm exec tauri build --bundles app,dmg --config release/tauri.beta.conf.json --ci
```

What it changes:

| key | value | why |
| --- | --- | --- |
| `productName` | `Polyphonic` | the app is Polyphonic; Luca is the resident inside it |
| `identifier` | `chat.polyphonic.desktop` | separate bundle id → separate app data dir from the Dev app |
| `version` | the beta version | |
| `bundle.macOS.infoPlist` | `Info.beta.plist` | Polyphonic `CFBundleName` / `CFBundleDisplayName` and Polyphonic-worded permission strings |
| `bundle.macOS.signingIdentity` | Developer ID | so Tauri signs every nested binary and the bundle |
| `bundle.macOS.minimumSystemVersion` | `14.0` | |
| `plugins.updater.endpoints` | `Riley-Coyote/polyphonic-app` release manifest | existing trusted Polyphonic update channel |
| `build.beforeBuildCommand` | `VITE_LUCA_SHELL_FRAME=1 pnpm build` | the beta draws the new shell by default (beta.14 on) |

### The shell is on in the beta (beta.14)

The overlay builds the page with `VITE_LUCA_SHELL_FRAME=1`, the way the
rail-glass test app's build does, so the beta opens in the new shell. Nothing
else sets it: `pnpm build` alone (the Dev app), `vite` (dev) and
`vite build --mode e2e` (every test suite) keep the shell off by default, behind
its preview switch, so the suites keep comparing both layouts.

Where the shell is on by default, Settings → Appearance offers **Classic
layout** for this one release: on, the layout from before beta.14 comes back at
once and stays across launches (`polyphonic-classic-layout` in the page's
storage); off, the shell returns. Remove the row and the key in the release
after beta.14.

Check it from the files, without launching: the built `dist/index.html` (and
the app's bundled copy) carries `var frameBuild = "1"`. A build without the
flag carries the placeholder `%VITE_LUCA_SHELL_FRAME%` instead.

The overlay alone does not enable the native updater. Export
`BUZZ_UPDATER_PUBLIC_KEY` and `BUZZ_UPDATER_ENDPOINT` from this overlay before
compilation; `src-tauri/build.rs` requires both. Keep the existing trusted key.
Do not use the upstream Buzz publishing workflow for Polyphonic.

For Tauri's updater-archive signing, set `TAURI_SIGNING_PRIVATE_KEY` to the
existing private-key **file path**, not its contents. Tauri's build command does
not read `TAURI_SIGNING_PRIVATE_KEY_PATH` (the separate `tauri signer sign`
command does). Never echo key material or passwords into a receipt or build log.

Build all six release sidecars through `scripts/with-internal-build-cache.sh`
using the selected internal `CARGO_TARGET_DIR`, then stage them with
`scripts/bundle-sidecars.sh` using the same target directory. The optional target
triple must match whether Cargo was invoked with `--target`. Verify staged hashes.
Do not package helpers left over from a debug candidate or another checkout.

`desktop/src-tauri/Info.plist` is **not** touched by any of this — the Dev app
(`com.luca.agent-network.dev`) keeps calling itself Luca.

## Running a candidate without touching real data

The following overrides isolate parts of a release build for testing. They do
not isolate every Tauri plugin or WebKit store; use a disposable account for a
fully isolated production-identity acceptance test. Never replace a production
app with a renamed debug build: the compiled keyring routing differs.

- `BUZZ_DESKTOP_DATA_DIR` — absolute path; when set, every app-data lookup uses it
  instead of `~/Library/Application Support/<identifier>`. Relative or empty values
  are ignored with a warning. See `desktop/src-tauri/src/data_dir.rs`.
- `BUZZ_DESKTOP_KEYRING_SERVICE` — honoured by **release** builds only when the value
  starts with `buzz-desktop-test.`; anything else (including `buzz-desktop` itself and
  any `buzz-desktop-dev*` name) falls back to the real `buzz-desktop` service. An
  invalid override does not isolate anything: it falls back to the production
  service. Validate the test prefix before launching.
  See `desktop/src-tauri/src/app_state_keyring.rs`.

Debug builds are unchanged: they still use `buzz-desktop-dev`, with
`BUZZ_DEV_KEYRING_SERVICE` scoping under `buzz-desktop-dev.`.

Native runtime state also needs its separately verified isolation override.
Record the exact app, data, native-state and keyring mapping before a test;
preserve the existing installation and profile. Avoid relying on environment
variables passed to `open -a`, which can reuse an already-running instance.
Cleanup must target only records created by the specific test, after verifying
ownership. Do not delete a real profile or Keychain entry as a test reset.

## Known residue: `.window-state.json`

`tauri-plugin-window-state` resolves its own path through Tauri's path resolver, not
through `BUZZ_DESKTOP_DATA_DIR`, so a smoke-test launch still leaves exactly one file:

```
~/Library/Application Support/<identifier>/.window-state.json
```

That directory can also contain the user's complete production profile.
**Never delete the directory to clean up a smoke test.** Preserve existing
geometry and use the isolated-test procedure above. Old beta.2 isolation evidence
is not proof that all later plugin and native-runtime paths are isolated.

## Candidate and publication gates

Record exact source SHA, config, release profile, architecture and helper hashes.
Verify fresh-install and upgrade behavior on the actual signed release-mode app
before an owner-approved daily-app switch. Keep a compatible app-and-data rollback.
After notarization/stapling, assemble the DMG and updater archive from the same
final app and compare their extracted contents. Smoke-test the distributed app.
No publication or update-manifest changes until Riley accepts the walkthrough
and explicitly authorizes shipping. Upload immutable assets before the manifest.
