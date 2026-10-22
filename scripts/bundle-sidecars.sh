#!/usr/bin/env bash
set -euo pipefail

SIDECARS=(buzz-acp buzz-agent buzz-dev-mcp git-credential-nostr buzz buzz-relay)
HOST=$(rustc -vV | sed -n 's|host: ||p')
TARGET=${1:-$HOST}
BINARIES_DIR="desktop/src-tauri/binaries"
BUILD_TARGET_DIR="${CARGO_TARGET_DIR:-target}"

# When --target is passed explicitly to cargo (even if it matches the host),
# binaries land in target/<triple>/release/. Without --target, they land in
# target/release/. The script receives the target as $1 only when cargo was
# invoked with --target, so use the qualified path whenever $1 is set.
if [[ -n "${1:-}" ]]; then
    SRC_DIR="${BUILD_TARGET_DIR}/${TARGET}/release"
else
    SRC_DIR="${BUILD_TARGET_DIR}/release"
fi

# MSVC emits <name>.exe; Tauri's externalBin then expects binaries/<name>-<triple>.exe.
if [[ "$TARGET" == *windows* ]]; then
    EXE=".exe"
else
    EXE=""
fi

missing=()
for bin in "${SIDECARS[@]}"; do
    [[ -f "$SRC_DIR/${bin}${EXE}" ]] || missing+=("${bin}${EXE}")
done
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: missing release binaries in $SRC_DIR: ${missing[*]}" >&2
    echo "Run 'cargo build --release -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli -p buzz-relay' with the same CARGO_TARGET_DIR first." >&2
    exit 1
fi

mkdir -p "$BINARIES_DIR"
for bin in "${SIDECARS[@]}"; do
    cp "$SRC_DIR/${bin}${EXE}" "$BINARIES_DIR/${bin}-${TARGET}${EXE}"
done
echo "Sidecars bundled for $TARGET"
