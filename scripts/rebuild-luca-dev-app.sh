#!/usr/bin/env bash
# Rebuild, install, register, and relaunch the frozen Luca development bundle.
#
# This preserves the stable development bundle identity used by macOS
# permissions and computer-use tooling. It does not reset app data or keychain
# state. Run from anywhere inside the repository.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
INSTALL_APP="${LUCA_DEV_INSTALL_APP:-$HOME/Applications/Luca Agent Network Dev.app}"
APP_ID="com.luca.agent-network.dev"
APP_NAME="Luca Agent Network Dev"
DEFAULT_KEYRING_SERVICE="buzz-desktop-dev.luca-v1"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# A stable signing identity keeps macOS Keychain and Accessibility grants tied
# to the application identity across rebuilds. Developers can choose an exact
# certificate; otherwise prefer the first locally available Developer ID and
# fall back to ad-hoc signing on machines without one.
CODESIGN_IDENTITY="${LUCA_DEV_CODESIGN_IDENTITY:-}"
if [[ -z "$CODESIGN_IDENTITY" ]]; then
    CODESIGN_IDENTITY=$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
        | /usr/bin/sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
        | /usr/bin/head -1)
fi
if [[ -z "$CODESIGN_IDENTITY" ]]; then
    CODESIGN_IDENTITY="-"
fi

case "$INSTALL_APP" in
    */Applications/Luca\ Agent\ Network\ Dev.app) ;;
    *)
        echo "Refusing unexpected install path: $INSTALL_APP" >&2
        exit 2
        ;;
esac

cd "$REPO_ROOT"
. ./bin/activate-hermit

echo "Building $APP_NAME from $(git rev-parse --short HEAD)..."
echo "Building native sidecars..."
cargo build \
    -p buzz-acp \
    -p buzz-agent \
    -p buzz-dev-mcp \
    -p buzz-cli \
    -p git-credential-nostr

TARGET=$(rustc -vV | /usr/bin/sed -n 's|host: ||p')
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps \
    | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")
TAURI_TARGET_DIR=$(cargo metadata \
    --manifest-path "$REPO_ROOT/desktop/src-tauri/Cargo.toml" \
    --format-version 1 --no-deps \
    | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")
BUILD_APP="$TAURI_TARGET_DIR/debug/bundle/macos/Luca Agent Network Dev.app"
BINARIES_DIR="$REPO_ROOT/desktop/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"
for bin in buzz-acp buzz-agent buzz-dev-mcp git-credential-nostr buzz; do
    cp "$TARGET_DIR/debug/$bin" "$BINARIES_DIR/$bin-$TARGET"
    chmod +x "$BINARIES_DIR/$bin-$TARGET"
done

(
    cd desktop
    pnpm exec tauri build --debug --bundles app \
        --config src-tauri/tauri.dev.conf.json --ci
)

if [[ ! -d "$BUILD_APP" ]]; then
    echo "Expected bundle was not produced: $BUILD_APP" >&2
    exit 1
fi

KEYRING_SERVICE="$DEFAULT_KEYRING_SERVICE"
if [[ -f "$INSTALL_APP/Contents/Info.plist" ]]; then
    EXISTING_SERVICE=$(/usr/libexec/PlistBuddy \
        -c 'Print :LSEnvironment:BUZZ_DEV_KEYRING_SERVICE' \
        "$INSTALL_APP/Contents/Info.plist" 2>/dev/null || true)
    if [[ -n "$EXISTING_SERVICE" ]]; then
        KEYRING_SERVICE="$EXISTING_SERVICE"
    fi
fi

PLIST="$BUILD_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
if ! /usr/libexec/PlistBuddy -c 'Print :LSEnvironment' "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c 'Add :LSEnvironment dict' "$PLIST"
fi
if /usr/libexec/PlistBuddy -c 'Print :LSEnvironment:BUZZ_DEV_KEYRING_SERVICE' "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :LSEnvironment:BUZZ_DEV_KEYRING_SERVICE $KEYRING_SERVICE" "$PLIST"
else
    /usr/libexec/PlistBuddy -c "Add :LSEnvironment:BUZZ_DEV_KEYRING_SERVICE string $KEYRING_SERVICE" "$PLIST"
fi

codesign --force --deep --timestamp=none --sign "$CODESIGN_IDENTITY" \
    --entitlements "$REPO_ROOT/desktop/src-tauri/Entitlements.plist" \
    "$BUILD_APP"
codesign --verify --deep --strict "$BUILD_APP"

BUILT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")
if [[ "$BUILT_ID" != "$APP_ID" ]]; then
    echo "Unexpected bundle identifier: $BUILT_ID" >&2
    exit 1
fi

STAGE_DIR=$(mktemp -d /tmp/luca-dev-install.XXXXXX)
NEW_APP="$STAGE_DIR/$APP_NAME.app"
OLD_APP="$STAGE_DIR/$APP_NAME.previous.app"
/usr/bin/ditto "$BUILD_APP" "$NEW_APP"
codesign --verify --deep --strict "$NEW_APP"

running_pids() {
    ps -axo pid=,command= | awk -v exe="$INSTALL_APP/Contents/MacOS/buzz-desktop" '
        {
            pid = $1
            sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
            if ($0 == exe) print pid
        }
    '
}

/usr/bin/osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -z "$(running_pids)" ]] && break
    sleep 0.5
done
if [[ -n "$(running_pids)" ]]; then
    running_pids | xargs kill -TERM
    sleep 1
fi

if [[ -d "$INSTALL_APP" ]]; then
    mv "$INSTALL_APP" "$OLD_APP"
fi

rollback() {
    if [[ -d "$OLD_APP" ]]; then
        [[ -d "$INSTALL_APP" ]] && mv "$INSTALL_APP" "$NEW_APP.failed"
        mv "$OLD_APP" "$INSTALL_APP"
        "$LSREGISTER" -f "$INSTALL_APP" || true
        /usr/bin/open -n "$INSTALL_APP" || true
    fi
}
trap rollback ERR

mv "$NEW_APP" "$INSTALL_APP"
codesign --verify --deep --strict "$INSTALL_APP"
"$LSREGISTER" -f "$INSTALL_APP"
/usr/bin/open -n "$INSTALL_APP"

# LaunchServices can retain the prior dev-bundle path while two bundles with
# the same identifier are present during the atomic swap. Give the registered
# launch a bounded chance, then start the exact installed executable rather
# than rolling back a healthy build because macOS resolved the stale path.
for _ in $(seq 1 20); do
    [[ -n "$(running_pids)" ]] && break
    sleep 0.5
done
if [[ -z "$(running_pids)" ]]; then
    INSTALL_LOG="$HOME/Library/Logs/Luca Agent Network Dev.log"
    echo "LaunchServices did not start the installed path; launching its exact executable."
    env BUZZ_DEV_KEYRING_SERVICE="$KEYRING_SERVICE" \
        "$INSTALL_APP/Contents/MacOS/buzz-desktop" \
        >>"$INSTALL_LOG" 2>&1 &
    disown
    for _ in $(seq 1 40); do
        [[ -n "$(running_pids)" ]] && break
        sleep 0.5
    done
fi
if [[ -z "$(running_pids)" ]]; then
    echo "$APP_NAME did not remain running after launch." >&2
    false
fi

trap - ERR
echo "Installed and running: $INSTALL_APP"
echo "Bundle ID: $APP_ID"
echo "Signing identity: $CODESIGN_IDENTITY"
echo "Previous bundle backup: $OLD_APP"
