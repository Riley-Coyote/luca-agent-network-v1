#!/usr/bin/env bash
# The glass lab (desktop/src-tauri/native/glass/Lab/GlassLab.swift): Polyphonic's own page from the dev server in
# front of Apple's glass, in a window behind every other window that is never key, so nothing takes the keyboard.
#   native-glass-lab.sh build            compile it (into $TMPDIR, a few megabytes; no Cargo involved)
#   native-glass-lab.sh run [url]        build if needed, start it (stopping an earlier lab), print its window id
#   native-glass-lab.sh post '<json>'    send it a command: {"js": "..."} or {"quit": true}
#   native-glass-lab.sh window           print its window id, for screencapture -x -o -l<id>
# Needs macOS 26 or later and, for the default page, the desktop dev server on port 1488.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SOURCE="$REPO_ROOT/desktop/src-tauri/native/glass"
OUT="${TMPDIR:-/tmp}/polyphonic-glass-lab"
LAB="$OUT/glass-lab"
POST="$OUT/post"
WINDOWS="$OUT/windows"

build() {
    mkdir -p "$OUT"
    xcrun swiftc -parse-as-library -swift-version 6 -O -target arm64-apple-macos26.0 \
        "$SOURCE"/Engine/*.swift "$SOURCE"/PolyphonicGlass.swift "$SOURCE"/Lab/GlassLab.swift -o "$LAB"
    cat >"$OUT/post.swift" <<'SWIFT'
import Foundation
DistributedNotificationCenter.default().postNotificationName(Notification.Name("chat.polyphonic.glass-lab.command"),
    object: CommandLine.arguments[1], userInfo: nil, deliverImmediately: true)
RunLoop.current.run(until: Date().addingTimeInterval(0.05))
SWIFT
    xcrun swiftc -O "$OUT/post.swift" -o "$POST"
    cat >"$OUT/windows.swift" <<'SWIFT'
import CoreGraphics
let all = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
// WebKit gives the lab a hidden window of its own; the lab's is the one with its title.
if let lab = all.first(where: { ($0[kCGWindowOwnerName as String] as? String) == "glass-lab"
    && ($0[kCGWindowName as String] as? String) == "Polyphonic Glass Lab" }) {
    print(lab[kCGWindowNumber as String] as? Int ?? 0)
}
SWIFT
    xcrun swiftc -O "$OUT/windows.swift" -o "$WINDOWS"
}

case "${1:-}" in
    build) build ;;
    run)
        [[ -x "$LAB" && -x "$POST" && -x "$WINDOWS" ]] || build
        pkill -x glass-lab 2>/dev/null || true
        "$LAB" ${2:+"$2"} >"$OUT/lab.log" 2>&1 &
        disown
        sleep 2
        cat "$OUT/lab.log"
        ;;
    post) "$POST" "$2" ;;
    window) "$WINDOWS" ;;
    *) sed -n '2,8p' "$0"; exit 2 ;;
esac
