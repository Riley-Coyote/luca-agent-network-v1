#!/usr/bin/env bash
# Build the dedicated exact-revision macOS bundle used by the native Artifact
# Canvas containment acceptance. This never copies or edits an already signed
# Luca application bundle.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
EXPECTED_ID="com.luca.agent-network.artifact-security"
PRODUCT_NAME="Luca Artifact Security"
CONFIG_PATH="$REPO_ROOT/desktop/src-tauri/tauri.artifact-security.conf.json"
ENTITLEMENTS_PATH="$REPO_ROOT/desktop/src-tauri/Entitlements.plist"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "The Artifact Canvas native security bundle can only be built on macOS." >&2
    exit 2
fi

if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
    echo "CARGO_TARGET_DIR must point to dedicated external build storage." >&2
    exit 2
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to build an exact-revision bundle from a dirty worktree." >&2
    exit 2
fi

SOURCE_REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)
SOURCE_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
if [[ -z "$SOURCE_BRANCH" ]]; then
    SOURCE_BRANCH="DETACHED"
fi

cd "$REPO_ROOT"
. ./bin/activate-hermit

echo "Building native sidecars for Artifact Canvas acceptance at $SOURCE_REVISION..."
cargo build \
    -p buzz-acp \
    -p buzz-agent \
    -p buzz-dev-mcp \
    -p buzz-cli \
    -p git-credential-nostr

TARGET=$(rustc -vV | /usr/bin/sed -n 's|host: ||p')
BINARIES_DIR="$REPO_ROOT/desktop/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"
for bin in buzz-acp buzz-agent buzz-dev-mcp git-credential-nostr buzz; do
    source_binary="$CARGO_TARGET_DIR/debug/$bin"
    bundled_binary="$BINARIES_DIR/$bin-$TARGET"
    if [[ ! -f "$bundled_binary" ]] || ! cmp -s "$source_binary" "$bundled_binary"; then
        /usr/bin/ditto "$source_binary" "$bundled_binary"
        chmod +x "$bundled_binary"
    fi
done

echo "Building dedicated $PRODUCT_NAME.app..."
(
    cd desktop
    pnpm exec tauri build --debug --bundles app \
        --config "$CONFIG_PATH" --ci
)

APP_BUNDLE="$CARGO_TARGET_DIR/debug/bundle/macos/$PRODUCT_NAME.app"
PLIST="$APP_BUNDLE/Contents/Info.plist"
RECEIPT="$APP_BUNDLE/Contents/Resources/luca-artifact-native-build.json"
if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "Expected bundle was not produced: $APP_BUNDLE" >&2
    exit 1
fi

BUILT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")
if [[ "$BUILT_ID" != "$EXPECTED_ID" ]]; then
    echo "Unexpected Artifact Canvas test bundle identifier: $BUILT_ID" >&2
    exit 1
fi
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :LucaArtifactNativeSecurityBundle' "$PLIST")" != "true" ]]; then
    echo "Dedicated Artifact Canvas test-bundle marker is missing." >&2
    exit 1
fi

mkdir -p "$(dirname "$RECEIPT")"
LUCA_RECEIPT_PATH="$RECEIPT" \
LUCA_SOURCE_REVISION="$SOURCE_REVISION" \
LUCA_SOURCE_BRANCH="$SOURCE_BRANCH" \
LUCA_BUNDLE_IDENTIFIER="$BUILT_ID" \
node -e '
  const fs = require("node:fs");
  const receipt = {
    schemaVersion: 1,
    sourceRevision: process.env.LUCA_SOURCE_REVISION,
    sourceBranch: process.env.LUCA_SOURCE_BRANCH,
    worktreeClean: true,
    bundleIdentifier: process.env.LUCA_BUNDLE_IDENTIFIER,
    productName: "Luca Artifact Security",
  };
  fs.writeFileSync(process.env.LUCA_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
'

CODESIGN_IDENTITY="${LUCA_ARTIFACT_CODESIGN_IDENTITY:-}"
if [[ -z "$CODESIGN_IDENTITY" ]]; then
    CODESIGN_IDENTITY=$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
        | /usr/bin/sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
        | /usr/bin/head -1)
fi
if [[ -z "$CODESIGN_IDENTITY" ]]; then
    CODESIGN_IDENTITY="-"
fi

# The receipt is written before the final signature. Unlike the retired
# acceptance path, nothing inside the signed bundle is mutated afterward.
/usr/bin/codesign --force --deep --timestamp=none --sign "$CODESIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS_PATH" "$APP_BUNDLE"
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"

EXECUTABLE="$APP_BUNDLE/Contents/MacOS/buzz-desktop"
echo "Artifact native security bundle: $APP_BUNDLE"
echo "Source revision: $SOURCE_REVISION"
echo "Bundle identifier: $BUILT_ID"
echo "Signing identity: $CODESIGN_IDENTITY"
echo "Executable SHA-256: $(/usr/bin/shasum -a 256 "$EXECUTABLE" | /usr/bin/awk '{print $1}')"
