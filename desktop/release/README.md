# Beta release overlay

`tauri.beta.conf.json` is the Tauri config overlay used to build the **Polyphonic**
beta from this repo. It is applied on top of `desktop/src-tauri/tauri.conf.json`:

```sh
cd desktop
pnpm exec tauri build --bundles app,dmg --config ../release/tauri.beta.conf.json --ci
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
| `plugins.updater.endpoints` | `[]` | the updater is compiled out of this build; the empty list keeps the UI honest |

`desktop/src-tauri/Info.plist` is **not** touched by any of this — the Dev app
(`com.luca.agent-network.dev`) keeps calling itself Luca.

## Running a candidate without touching real data

Two env vars make a signed release build safe to smoke test:

- `BUZZ_DESKTOP_DATA_DIR` — absolute path; when set, every app-data lookup uses it
  instead of `~/Library/Application Support/<identifier>`. Relative or empty values
  are ignored with a warning. See `desktop/src-tauri/src/data_dir.rs`.
- `BUZZ_DESKTOP_KEYRING_SERVICE` — honoured by **release** builds only when the value
  starts with `buzz-desktop-test.`; anything else (including `buzz-desktop` itself and
  any `buzz-desktop-dev*` name) falls back to the real `buzz-desktop` service. So a
  stray env var can never repoint a release binary at the real keyring.
  See `desktop/src-tauri/src/app_state_keyring.rs`.

Debug builds are unchanged: they still use `buzz-desktop-dev`, with
`BUZZ_DEV_KEYRING_SERVICE` scoping under `buzz-desktop-dev.`.

```sh
BUZZ_DESKTOP_DATA_DIR=/private/tmp/smoke/data \
BUZZ_DESKTOP_KEYRING_SERVICE=buzz-desktop-test.smoke \
  open -a /path/to/Polyphonic.app
```

Delete any test keychain item you create afterwards:

```sh
security delete-generic-password -s buzz-desktop-test.smoke
```
