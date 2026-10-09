#!/usr/bin/env bash
# Local macOS preflight only: no cleanup, downloads, target creation or builds.
set -euo pipefail

storage_fail() {
    printf 'Build storage: %s\n' "$*" >&2
    exit 1
}

if [[ $# -eq 0 ]]; then
    printf 'Usage: bash %s --check | <command> [arguments...]\n' "$0" >&2
    exit 2
fi
[[ "$(uname -s)" == Darwin ]] || storage_fail 'this local helper requires macOS'

storage_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
storage_target="${CARGO_TARGET_DIR:-$HOME/Library/Caches/luca-build/cargo-target}"
storage_cargo_home="${CARGO_HOME:-$HOME/.cargo}"
storage_reserve="${POLYPHONIC_BUILD_RESERVE_GIB:-20}"
[[ "$storage_reserve" =~ ^[0-9]+$ && ${#storage_reserve} -le 5 ]] || storage_fail 'reserve must be a whole number of GiB'
(( 10#$storage_reserve >= 8 )) || storage_fail 'reserve must be at least 8 GiB'

case "$storage_target" in
    "$HOME/Library/Caches/luca-build/"?*) ;;
    *) storage_fail 'target must be a dedicated folder under ~/Library/Caches/luca-build' ;;
esac
case "$storage_target/" in
    *'/../'*|*'/./'*|*'//'*|*$'\n'*|*$'\r'*|*$'\t'*) storage_fail 'target path is not canonical' ;;
esac

storage_device() {
    local storage_path="$1"
    [[ "$storage_path" == /* ]] || storage_fail 'storage paths must be absolute'
    while [[ ! -d "$storage_path" ]]; do
        [[ "$storage_path" != / ]] || storage_fail 'cannot resolve storage path'
        storage_path="$(dirname "$storage_path")"
    done
    storage_path="$(cd "$storage_path" && pwd -P)"
    case "$storage_path/" in
        /Volumes/*) storage_fail 'active storage must stay on the internal data volume, not under /Volumes' ;;
    esac
    df -Pk "$storage_path" | awk 'NR == 2 {print $1}'
}

storage_internal_device="$(storage_device /System/Volumes/Data)"
[[ -n "$storage_internal_device" ]] || storage_fail 'cannot identify the internal data volume'
for storage_path in "$storage_repo" "$storage_target" "$storage_cargo_home"; do
    [[ "$(storage_device "$storage_path")" == "$storage_internal_device" ]] || storage_fail 'active source, Cargo home and target must stay on the internal data volume'
done

storage_available_kib="$(df -Pk /System/Volumes/Data | awk 'NR == 2 {print $4}')"
[[ "$storage_available_kib" =~ ^[0-9]+$ ]] || storage_fail 'cannot measure available SSD space'
storage_reserve_kib=$((10#$storage_reserve * 1024 * 1024))
(( storage_available_kib >= storage_reserve_kib )) || storage_fail "less than ${storage_reserve} GiB free; archive verified cold outputs before starting another build"

export CARGO_TARGET_DIR="$storage_target"
export CARGO_HOME="$storage_cargo_home"
export CARGO_INCREMENTAL=0

if [[ "$1" == --check ]]; then
    [[ $# -eq 1 ]] || storage_fail '--check takes no other arguments'
    printf 'Internal target: %s\nIncremental snapshots: disabled\n' "$CARGO_TARGET_DIR"
    awk -v available="$storage_available_kib" -v reserve="$storage_reserve" 'BEGIN {printf "SSD available: %.1f GiB (preflight reserve: %s GiB)\n", available / 1048576, reserve}'
    exit 0
fi
exec "$@"
