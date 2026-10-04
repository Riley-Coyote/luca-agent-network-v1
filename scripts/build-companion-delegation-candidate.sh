#!/usr/bin/env bash
# Isolated, opt-in Tauri candidate. Build never installs, launches, resets data,
# changes native provider profiles, or stops an existing application. Run/stop
# address only the exact child recorded by this entrypoint, not an app name.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
readonly EXPECTED_BRANCH="codex/companion-delegation-2026-10-04"
readonly SOURCE_BASE="f84aaafa53386f213b832441983838b23c32c745"
readonly BUNDLE_ID="chat.polyphonic.desktop.companion-delegation.dev"
readonly PRODUCT_NAME="Polyphonic Companion Delegation Candidate"
readonly URL_SCHEME="polyphonic-companion-delegation"
readonly PROTOCOL="polyphonic.companion-delegation-candidate.v1"
readonly CONFIG_PATH="$REPO_ROOT/desktop/src-tauri/tauri.companion-delegation-candidate.conf.json"
readonly ENTITLEMENTS_PATH="$REPO_ROOT/desktop/src-tauri/Entitlements.plist"
readonly SIDECARS=(buzz-acp buzz-agent buzz-dev-mcp git-credential-nostr buzz buzz-relay)

fail() { printf 'Candidate refused: %s\n' "$1" >&2; exit 1; }

usage() {
    printf '%s\n' \
        "Usage: $0 check|build|run|stop --target-dir /absolute/dedicated/target" \
        "       [--instance-root /absolute/dedicated/instance] [--signing-identity name-or-hash]" \
        "check is read-only; build does not launch; run never builds; stop sends only owned SIGTERM." \
        "Default instance root: <target-dir>/companion-delegation-instance. Signing override is build-only." \
        "Rust 1.95.0, existing ~/.cargo, offline locked dependencies, default system-keyring, debug/app-only." \
        "No release/notarization, installed-app replacement, native prompts, or provider configuration edits."
}

# Validate prospectively without creating directories. Refuse symlinked parents,
# control characters, broad roots, installed apps, native profiles, and shared
# Cargo storage; the caller must deliberately choose a dedicated output folder.
validate_directory() {
    local path="$1" probe
    [[ "$path" == /* && "$path" != */ && ! "$path" =~ [[:cntrl:]] ]] || fail "directory must be an absolute canonical path"
    case "$path" in
        /|/tmp|/private/tmp|/Applications|/Applications/*|/Volumes|/Users|/Users/Shared|/Library|/System|/usr|/opt|/private|/Volumes/*/*.app|*.app/*|*.app)
            fail "directory is not dedicated candidate storage" ;;
        *'/../'*|*'/./'*|*'//'*|*/..|*/.) fail "directory must not contain path traversal" ;;
    esac
    if [[ "$path" == /Volumes/* && "${path#/Volumes/}" != */* ]]; then
        fail "a volume root is not dedicated candidate storage"
    fi
    [[ "$path" != "$REPO_ROOT" && "$path" != "$HOME" && "$path" != "$HOME/Library" ]] || fail "directory is too broad"
    case "$path" in
        "$HOME"/.*|"$HOME/Applications"|"$HOME/Applications/"*|"$HOME/Library/Application Support"|"$HOME/Library/Application Support/"*|"$REPO_ROOT/.git"|"$REPO_ROOT/.git/"*)
            fail "directory overlaps personal configuration or installed apps" ;;
        "$HOME/Library/Caches/luca-build/cargo-target") fail "the shared Cargo target is not dedicated candidate storage" ;;
    esac
    probe="$path"
    while [[ ! -e "$probe" && ! -L "$probe" ]]; do
        probe="${probe%/*}"
        [[ -n "$probe" ]] || probe=/
    done
    [[ -d "$probe" && ! -L "$probe" && "$(cd "$probe" && pwd -P)" == "$probe" ]] || fail "directory has a symlinked or non-directory parent"
}

assert_clean_source() {
    local status
    status=$(git -C "$1" status --porcelain --untracked-files=all) || fail "cannot verify the source worktree"
    [[ -z "$status" ]] || fail "source is dirty or has nonignored untracked files; freeze the feature checkpoint first"
}

assert_source() {
    assert_clean_source "$REPO_ROOT"
    [[ "$(git -C "$REPO_ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "this entrypoint is restricted to the companion-delegation feature branch"
    git -C "$REPO_ROOT" merge-base --is-ancestor "$SOURCE_BASE" HEAD || fail "source is not descended from shipped beta.13"
    SOURCE_REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)
}

sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }

# JSON helpers receive only explicit public metadata and local paths. Never
# serialize process.env or capture provider credentials/configuration bodies.
json() {
    node - "$@" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const [action, ...args] = process.argv.slice(2);
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'invalid bounded metadata file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const write = (file, value) => {
  if (fs.existsSync(file)) requireValue(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'metadata path is not a regular file');
  const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
};
try {
  if (action === 'config') {
    const [file, identity, product, scheme] = args;
    const c = read(file);
    requireValue(c.identifier === identity && identity.endsWith('.dev') && c.productName === product && c.version === '0.5.0-beta.13', 'candidate config identity mismatch');
    requireValue(JSON.stringify(c.bundle?.targets) === '["app"]' && c.bundle?.createUpdaterArtifacts === false && c.bundle?.macOS?.minimumSystemVersion === '14.0' && c.bundle?.macOS?.infoPlist === 'Info.beta.plist', 'candidate packaging config mismatch');
    requireValue(JSON.stringify(c.plugins?.updater?.endpoints) === '[]' && JSON.stringify(c.plugins?.['deep-link']?.desktop?.schemes) === JSON.stringify([scheme]), 'candidate updater or URL scheme is not isolated');
    requireValue(!c.build && !c.app && !c.bundle.externalBin && !c.bundle.macOS.signingIdentity, 'candidate config widens the inherited build contract');
  } else if (action === 'scope') {
    process.stdout.write(crypto.createHash('sha256').update(args[0]).digest('hex').slice(0, 24));
  } else if (action === 'owner' || action === 'verify-owner') {
    const [file, protocol, repository, target, instance, identity] = args;
    const owner = { protocol, repository, target, instance, identity };
    if (action === 'owner') write(file, owner);
    else requireValue(JSON.stringify(read(file)) === JSON.stringify(owner), 'candidate instance belongs to another build');
  } else if (action === 'environment') {
    const [data, native, keyring] = args;
    process.stdout.write(JSON.stringify({ BUZZ_DESKTOP_DATA_DIR: data, LUCA_NATIVE_STATE_ISOLATION_ROOT: native, BUZZ_DEV_KEYRING_SERVICE: keyring, BUZZ_RELAY_URL: 'buzz-local://on-this-device' }));
  } else if (action === 'receipt') {
    const [file, protocol, source, base, branch, identity, product, instance, keyring, config, entitlements, target, signing, ...names] = args;
    write(file, { protocol, sourceRevision: source, sourceBase: base, sourceBranch: branch, worktreeClean: true, bundleIdentifier: identity, productName: product, instanceRoot: instance, keyringService: keyring, configSha256: hash(config), entitlementsSha256: hash(entitlements), rustVersion: '1.95.0', architecture: 'aarch64-apple-darwin', profile: 'debug', features: ['default', 'system-keyring'], signingIdentity: signing, notarized: false, sidecars: names.map(name => ({ name, sourceSha256: hash(path.join(target, 'debug', name)) })) });
  } else if (action === 'verify-receipt') {
    const [file, protocol, source, base, branch, identity, product, instance, keyring, config, entitlements, ...names] = args;
    const r = read(file);
    requireValue(r.protocol === protocol && r.sourceRevision === source && r.sourceBase === base && r.sourceBranch === branch && r.worktreeClean === true && r.bundleIdentifier === identity && r.productName === product && r.instanceRoot === instance && r.keyringService === keyring && r.configSha256 === hash(config) && r.entitlementsSha256 === hash(entitlements), 'source or isolation receipt mismatch');
    requireValue(r.rustVersion === '1.95.0' && r.architecture === 'aarch64-apple-darwin' && r.profile === 'debug' && JSON.stringify(r.features) === '["default","system-keyring"]' && r.notarized === false && JSON.stringify(r.sidecars?.map(v => v.name)) === JSON.stringify(names) && r.sidecars.every(v => /^[a-f0-9]{64}$/.test(v.sourceSha256)), 'incomplete candidate source receipt');
  } else if (action === 'manifest' || action === 'verify-manifest') {
    const [file, bundle, protocol, source, ...names] = args;
    const files = ['Contents/Info.plist', 'Contents/Resources/companion-delegation-source.json', ...names.map(n => `Contents/MacOS/${n}`)];
    const m = { protocol, sourceRevision: source, bundlePath: bundle, files: files.map(name => ({ name, sha256: hash(path.join(bundle, name)) })) };
    if (action === 'manifest') write(file, m);
    else requireValue(JSON.stringify(read(file)) === JSON.stringify(m), 'signed candidate hashes changed');
  } else if (action === 'pid-write') {
    const [file, pid, started, executable, source] = args;
    write(file, { pid: Number(pid), started, executable, sourceRevision: source });
  } else if (action === 'pid-read') {
    const [file, executable] = args;
    const r = read(file);
    requireValue(Number.isSafeInteger(r.pid) && r.pid > 1 && r.pid < 2147483648 && typeof r.started === 'string' && r.started.length <= 100 && !/[\r\n]/.test(r.started) && r.executable === executable && /^[a-f0-9]{40}$/.test(r.sourceRevision), 'invalid owned candidate process record');
    process.stdout.write(`${r.pid}\n${r.started}\n`);
  } else if (action === 'plist') {
    const [raw, identity, product, scheme, data, native, keyring] = args;
    const p = JSON.parse(raw);
    requireValue(p.CFBundleIdentifier === identity && p.CFBundleName === product && p.CFBundleDisplayName === product && p.CFBundleExecutable === 'buzz-desktop' && p.CFBundleShortVersionString === '0.5.0-beta.13' && p.LSMinimumSystemVersion === '14.0' && p.LucaCompanionDelegationCandidate === true, 'candidate bundle identity mismatch');
    requireValue(p.CFBundleURLTypes?.length === 1 && JSON.stringify(p.CFBundleURLTypes[0].CFBundleURLSchemes) === JSON.stringify([scheme]), 'candidate bundle URL scheme mismatch');
    requireValue(p.LSEnvironment?.BUZZ_DESKTOP_DATA_DIR === data && p.LSEnvironment?.LUCA_NATIVE_STATE_ISOLATION_ROOT === native && p.LSEnvironment?.BUZZ_DEV_KEYRING_SERVICE === keyring && p.LSEnvironment?.BUZZ_RELAY_URL === 'buzz-local://on-this-device' && Object.keys(p.LSEnvironment).length === 4, 'candidate bundle isolation mismatch');
  } else throw new Error('unknown candidate metadata operation');
} catch {
  console.error('Candidate metadata validation failed. No provider or environment body is reported.');
  process.exit(1);
}
NODE
}

prepare_paths() {
    validate_directory "$TARGET_DIR"
    INSTANCE_ROOT="${INSTANCE_ROOT:-$TARGET_DIR/companion-delegation-instance}"
    validate_directory "$INSTANCE_ROOT"
    [[ "$INSTANCE_ROOT" != "$TARGET_DIR" ]] || fail "candidate instance must be separate from Cargo target contents"
    APP_BUNDLE="$TARGET_DIR/debug/bundle/macos/$PRODUCT_NAME.app"
    APP_EXECUTABLE="$APP_BUNDLE/Contents/MacOS/buzz-desktop"
    PLIST="$APP_BUNDLE/Contents/Info.plist"
    RECEIPT="$APP_BUNDLE/Contents/Resources/companion-delegation-source.json"
    DATA_DIR="$INSTANCE_ROOT/app-data"
    NATIVE_ROOT="$INSTANCE_ROOT/native-state"
    CONTROL_DIR="$INSTANCE_ROOT/control"
    OWNER_FILE="$CONTROL_DIR/instance-owner.json"
    PID_FILE="$CONTROL_DIR/owned-candidate.json"
    MANIFEST="$CONTROL_DIR/signed-candidate.json"
    KEYRING_SERVICE="buzz-desktop-dev.companion-delegation-$(json scope "$INSTANCE_ROOT")"
}

process_started() { ps -p "$1" -o lstart= | /usr/bin/sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

process_matches() {
    local pid="$1" started="$2" command
    kill -0 "$pid" 2>/dev/null || return 1
    [[ -n "$started" && "$(process_started "$pid")" == "$started" ]] || return 1
    command=$(ps -p "$pid" -o command= | /usr/bin/sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ "$command" == "$APP_EXECUTABLE" ]]
}

load_owned_pid() {
    local record
    record=$(json pid-read "$PID_FILE" "$APP_EXECUTABLE") || return 1
    OWNED_PID="${record%%$'\n'*}"
    OWNED_STARTED="${record#*$'\n'}"
}

# Only used before disown, for the run child created in this very shell. Check
# the live job table as well as start identity: an exited/reused PID is not ours.
live_shell_child() {
    local child_pid="$1" job
    while IFS= read -r job; do
        [[ "$job" != "$child_pid" ]] || return 0
    done < <(jobs -pr)
    return 1
}

new_child_running() {
    live_shell_child "$1" && [[ -n "$2" && "$(process_started "$1")" == "$2" ]]
}

cleanup_new_child() {
    local child_pid="$1" started="$2" attempt
    if new_child_running "$child_pid" "$started"; then
        kill -TERM "$child_pid" 2>/dev/null || true
        for ((attempt=0; attempt<40; attempt++)); do
            new_child_running "$child_pid" "$started" || break
            sleep 0.25
        done
        if new_child_running "$child_pid" "$started"; then
            # Last resort is this same still-owned direct child only, never a
            # record loaded from disk, a process group, app name, or native job.
            kill -KILL "$child_pid" 2>/dev/null || true
        fi
    fi
    live_shell_child "$child_pid" && fail "run child identity could not be safely cleaned up; inspect the exact candidate PID $child_pid"
    wait "$child_pid" 2>/dev/null || true
}

refuse_running_candidate() {
    if [[ -e "$PID_FILE" || -L "$PID_FILE" ]]; then
        load_owned_pid || fail "cannot validate the previous owned process record"
        if process_matches "$OWNED_PID" "$OWNED_STARTED"; then
            fail "the tracked candidate is still running; stop it explicitly before rebuilding or running"
        fi
    fi
}

lock_instance() {
    umask 077
    if [[ -e "$INSTANCE_ROOT" && -n "$(ls -A "$INSTANCE_ROOT")" ]]; then
        json verify-owner "$OWNER_FILE" "$PROTOCOL" "$REPO_ROOT" "$TARGET_DIR" "$INSTANCE_ROOT" "$BUNDLE_ID" || fail "refusing to adopt nonempty unowned candidate state"
    fi
    mkdir -p "$CONTROL_DIR" "$DATA_DIR" "$NATIVE_ROOT"
    validate_directory "$CONTROL_DIR"
    validate_directory "$DATA_DIR"
    validate_directory "$NATIVE_ROOT"
    mkdir "$CONTROL_DIR/operation.lock" 2>/dev/null || fail "candidate operation is already locked; inspect a stale lock rather than assuming ownership"
    trap 'rmdir "$CONTROL_DIR/operation.lock"' EXIT
    json owner "$OWNER_FILE" "$PROTOCOL" "$REPO_ROOT" "$TARGET_DIR" "$INSTANCE_ROOT" "$BUNDLE_ID"
}

clear_candidate_environment() {
    local name
    while IFS= read -r name; do
        case "$name" in
            BUZZ_*|LUCA_*|VITE_*|TAURI_*|APPLE_*|CARGO_BUILD_TARGET|CARGO_ENCODED_RUSTFLAGS|RUSTFLAGS)
                unset "$name" ;;
        esac
    done < <(compgen -e)
}

verify_executable() {
    [[ -f "$1" && ! -L "$1" && -s "$1" && -x "$1" ]] || fail "a required executable is missing, empty, symlinked, or not executable"
    [[ "$(/usr/bin/lipo -archs "$1")" == arm64 ]] || fail "a required executable is not exactly ARM64"
    [[ "$(/usr/bin/file -b "$1")" == *'Mach-O 64-bit executable arm64'* ]] || fail "a required sidecar is not a real Mach-O executable"
}

verify_bundle() {
    local name plist_json
    [[ -d "$APP_BUNDLE" && ! -L "$APP_BUNDLE" ]] || fail "candidate bundle is missing or symlinked"
    plist_json=$(/usr/bin/plutil -convert json -o - "$PLIST")
    json plist "$plist_json" "$BUNDLE_ID" "$PRODUCT_NAME" "$URL_SCHEME" "$DATA_DIR" "$NATIVE_ROOT" "$KEYRING_SERVICE"
    json verify-receipt "$RECEIPT" "$PROTOCOL" "$SOURCE_REVISION" "$SOURCE_BASE" "$EXPECTED_BRANCH" "$BUNDLE_ID" "$PRODUCT_NAME" "$INSTANCE_ROOT" "$KEYRING_SERVICE" "$CONFIG_PATH" "$ENTITLEMENTS_PATH" "${SIDECARS[@]}"
    for name in buzz-desktop "${SIDECARS[@]}"; do
        verify_executable "$APP_BUNDLE/Contents/MacOS/$name"
        /usr/bin/codesign --verify --strict "$APP_BUNDLE/Contents/MacOS/$name"
    done
    /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
}

build_candidate() {
    local rust_bin signing name built_revision
    refuse_running_candidate
    lock_instance
    clear_candidate_environment
    cd "$REPO_ROOT"
    # Generated Hermit activation is independently maintained by the repository.
    # shellcheck source=/dev/null
    . ./bin/activate-hermit
    rust_bin="$HOME/.rustup/toolchains/1.95.0-aarch64-apple-darwin/bin"
    [[ -x "$rust_bin/cargo" && -x "$rust_bin/rustc" && -d "$HOME/.cargo" ]] || fail "Rust 1.95.0 and the existing user Cargo cache are required"
    export PATH="$rust_bin:$PATH" CARGO_HOME="$HOME/.cargo" CARGO_TARGET_DIR="$TARGET_DIR"
    export RUSTC="$rust_bin/rustc" RUSTDOC="$rust_bin/rustdoc" CARGO_NET_OFFLINE=true
    [[ "$(rustc --version)" == 'rustc 1.95.0 '* && "$(rustc -vV | /usr/bin/sed -n 's/^host: //p')" == aarch64-apple-darwin ]] || fail "unexpected Rust compiler or host architecture"
    # Scoped candidate-only compile setting; never contacts the shared dev relay.
    export BUZZ_RELAY_URL='buzz-local://on-this-device'
    signing="$SIGNING_IDENTITY"
    if [[ -z "$signing" ]]; then
        signing=$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null | /usr/bin/sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | /usr/bin/head -1)
        [[ -n "$signing" ]] || fail "no Developer ID is available; choose an explicit signing identity (or '-' for disclosed local ad-hoc signing)"
    fi
    [[ ! "$signing" =~ [[:cntrl:]] ]] || fail "invalid signing identity"
    mkdir -p "$TARGET_DIR"
    validate_directory "$TARGET_DIR"
    cargo build --offline --locked -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p buzz-cli -p git-credential-nostr -p buzz-relay
    for name in "${SIDECARS[@]}"; do verify_executable "$TARGET_DIR/debug/$name"; done
    mkdir -p "$REPO_ROOT/desktop/src-tauri/binaries"
    for name in "${SIDECARS[@]}"; do
        /usr/bin/ditto "$TARGET_DIR/debug/$name" "$REPO_ROOT/desktop/src-tauri/binaries/$name-aarch64-apple-darwin"
        chmod +x "$REPO_ROOT/desktop/src-tauri/binaries/$name-aarch64-apple-darwin"
        [[ "$(sha256 "$TARGET_DIR/debug/$name")" == "$(sha256 "$REPO_ROOT/desktop/src-tauri/binaries/$name-aarch64-apple-darwin")" ]] || fail "staged helper bytes differ from the current build"
    done
    (cd desktop && pnpm exec tauri build --debug --bundles app --config "$CONFIG_PATH" --ci --no-sign -- --offline --locked)
    # Source must stay frozen while Cargo/Tauri run; ignored outputs are allowed.
    built_revision="$SOURCE_REVISION"
    assert_source
    [[ "$SOURCE_REVISION" == "$built_revision" ]] || fail "source changed during the build"
    /usr/bin/plutil -replace CFBundleName -string "$PRODUCT_NAME" "$PLIST"
    /usr/bin/plutil -replace CFBundleDisplayName -string "$PRODUCT_NAME" "$PLIST"
    /usr/bin/plutil -insert LucaCompanionDelegationCandidate -bool true "$PLIST"
    /usr/bin/plutil -insert LSEnvironment -json "$(json environment "$DATA_DIR" "$NATIVE_ROOT" "$KEYRING_SERVICE")" "$PLIST"
    mkdir -p "$APP_BUNDLE/Contents/Resources"
    json receipt "$RECEIPT" "$PROTOCOL" "$SOURCE_REVISION" "$SOURCE_BASE" "$EXPECTED_BRANCH" "$BUNDLE_ID" "$PRODUCT_NAME" "$INSTANCE_ROOT" "$KEYRING_SERVICE" "$CONFIG_PATH" "$ENTITLEMENTS_PATH" "$TARGET_DIR" "$signing" "${SIDECARS[@]}"
    # All source/isolation metadata precedes the final signature. Nothing inside
    # the signed bundle is changed afterward. No notarization or release occurs.
    /usr/bin/codesign --force --deep --timestamp=none --sign "$signing" --entitlements "$ENTITLEMENTS_PATH" "$APP_BUNDLE"
    verify_bundle
    json manifest "$MANIFEST" "$APP_BUNDLE" "$PROTOCOL" "$SOURCE_REVISION" buzz-desktop "${SIDECARS[@]}"
    printf 'Built (not launched or installed): %s\nSource: %s\nSigning: %s\nSigned hashes: %s\n' "$APP_BUNDLE" "$SOURCE_REVISION" "$signing" "$MANIFEST"
}

run_candidate() {
    local pid started attempt
    refuse_running_candidate
    lock_instance
    verify_bundle
    json verify-manifest "$MANIFEST" "$APP_BUNDLE" "$PROTOCOL" "$SOURCE_REVISION" buzz-desktop "${SIDECARS[@]}"
    [[ ! -L "$CONTROL_DIR/candidate.log" ]] || fail "candidate log must not be a symlink"
    # Spawn the verified executable inside its signed Tauri .app so $! is an
    # actual owned app PID. LaunchServices/open does not return that app PID.
    # Native authentication/profile variables and HOME are deliberately intact.
    (
        clear_candidate_environment
        export BUZZ_DESKTOP_DATA_DIR="$DATA_DIR" LUCA_NATIVE_STATE_ISOLATION_ROOT="$NATIVE_ROOT"
        export BUZZ_DEV_KEYRING_SERVICE="$KEYRING_SERVICE" BUZZ_RELAY_URL='buzz-local://on-this-device'
        exec "$APP_EXECUTABLE"
    ) >>"$CONTROL_DIR/candidate.log" 2>&1 &
    pid=$!
    started=$(process_started "$pid")
    # The exact child may still be between fork and exec when ps first runs.
    for attempt in {1..20}; do
        process_matches "$pid" "$started" && break
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
    done
    if ! process_matches "$pid" "$started"; then
        cleanup_new_child "$pid" "$started"
        fail "candidate did not remain running; no other process is adopted or stopped"
    fi
    if ! json pid-write "$PID_FILE" "$pid" "$started" "$APP_EXECUTABLE" "$SOURCE_REVISION"; then
        cleanup_new_child "$pid" "$started"
        fail "could not persist exact candidate ownership"
    fi
    disown "$pid"
    printf 'Started owned candidate PID %s\nApp: %s\nDisposable state: %s\n' "$pid" "$APP_BUNDLE" "$INSTANCE_ROOT"
}

stop_candidate() {
    local attempt
    [[ -e "$PID_FILE" || -L "$PID_FILE" ]] || fail "no candidate launched by this entrypoint is recorded"
    load_owned_pid || fail "cannot validate owned candidate process record"
    process_matches "$OWNED_PID" "$OWNED_STARTED" || fail "recorded PID is no longer the exact owned candidate; no signal sent"
    lock_instance
    process_matches "$OWNED_PID" "$OWNED_STARTED" || fail "candidate process identity changed before stop; no signal sent"
    kill -TERM "$OWNED_PID"
    for ((attempt=0; attempt<40; attempt++)); do
        if ! process_matches "$OWNED_PID" "$OWNED_STARTED"; then
            printf 'Stopped owned candidate PID %s. Disposable state and scoped keyring are retained.\n' "$OWNED_PID"
            return
        fi
        sleep 0.25
    done
    fail "owned candidate did not finish graceful stop; no SIGKILL or unrelated cleanup was attempted"
}

main() {
    MODE="${1:-}"
    [[ "$MODE" == check || "$MODE" == build || "$MODE" == run || "$MODE" == stop ]] || { usage; return 2; }
    shift
    TARGET_DIR='' INSTANCE_ROOT='' SIGNING_IDENTITY=''
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --target-dir|--instance-root|--signing-identity)
                [[ $# -ge 2 && -n "$2" ]] || { usage; return 2; }
                case "$1" in
                    --target-dir) TARGET_DIR="$2" ;;
                    --instance-root) INSTANCE_ROOT="$2" ;;
                    --signing-identity) SIGNING_IDENTITY="$2" ;;
                esac
                shift 2 ;;
            *) usage; return 2 ;;
        esac
    done
    [[ -n "$TARGET_DIR" ]] || { usage; return 2; }
    [[ -z "$SIGNING_IDENTITY" || "$MODE" == build ]] || fail "signing override is build-only"
    [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail "candidate requires Apple Silicon macOS"
    command -v node >/dev/null || fail "an existing Node runtime is required"
    prepare_paths
    if [[ "$MODE" != stop ]]; then
        assert_source
        json config "$CONFIG_PATH" "$BUNDLE_ID" "$PRODUCT_NAME" "$URL_SCHEME"
    fi
    case "$MODE" in
        check)
            printf 'Read-only checks passed. Source: %s\nApp: %s\nDisposable state: %s\nNo build or launch performed.\n' "$SOURCE_REVISION" "$APP_BUNDLE" "$INSTANCE_ROOT" ;;
        build) build_candidate ;;
        run) run_candidate ;;
        stop) stop_candidate ;;
    esac
}

# Sourcing exposes pure validation helpers to the script-specific fixture; no
# test bypass is present in the executable entrypoint.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
