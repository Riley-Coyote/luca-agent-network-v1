#!/usr/bin/env bash
# The glass lab (desktop/src-tauri/native/glass/Lab/GlassLab.swift): Polyphonic's own page from the dev server in
# front of Apple's glass, without the app or a profile, and without taking anyone's keyboard.
#   native-glass-lab.sh build            compile it (into $TMPDIR, a few megabytes; no Cargo involved)
#   native-glass-lab.sh run [url]        the film window: behind every other window, never key; prints its window id
#   native-glass-lab.sh open [url]       a real window to use, with working traffic lights; it opens behind every
#                                        other window and waits there (stopping an earlier lab either way)
#   native-glass-lab.sh front            bring the open window forward: it takes the keyboard, so only on request
#   native-glass-lab.sh post '<json>'    send it a command: {"js": "..."} or {"quit": true}
#   native-glass-lab.sh window           print its window id, for screencapture -x -o -l<id>
# Needs macOS 26 or later and, for the default page, the desktop dev server on port 1488.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
SOURCE="$REPO_ROOT/desktop/src-tauri/native/glass"
OUT="${TMPDIR:-/tmp}/polyphonic-glass-lab"
LAB="$OUT/glass-lab"
APP="$OUT/Polyphonic Glass Lab.app"
POST="$OUT/post"
WINDOWS="$OUT/windows"

build() {
    mkdir -p "$OUT"
    xcrun swiftc -parse-as-library -swift-version 6 -O -target arm64-apple-macos26.0 \
        "$SOURCE"/Engine/*.swift "$SOURCE"/PolyphonicGlass.swift "$SOURCE"/Lab/*.swift -o "$LAB"
    # The same program as an app, so the open window has a name in the Dock and can be brought forward by it.
    rm -rf "$APP"
    mkdir -p "$APP/Contents/MacOS"
    cp "$LAB" "$APP/Contents/MacOS/glass-lab"
    cat >"$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>glass-lab</string>
    <key>CFBundleIdentifier</key><string>chat.polyphonic.glass-lab</string>
    <key>CFBundleName</key><string>Polyphonic Glass Lab</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
    codesign --force --sign - "$APP" >/dev/null
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
if let lab = all.first(where: { ["glass-lab", "Polyphonic Glass Lab"].contains($0[kCGWindowOwnerName as String] as? String ?? "")
    && ($0[kCGWindowName as String] as? String) == "Polyphonic Glass Lab" }) {
    print(lab[kCGWindowNumber as String] as? Int ?? 0)
}
SWIFT
    xcrun swiftc -O "$OUT/windows.swift" -o "$WINDOWS"
}

ready() {
    [[ -x "$LAB" && -x "$POST" && -x "$WINDOWS" && -d "$APP" ]] || build
    pkill -x glass-lab 2>/dev/null || true
    sleep 0.3
}

case "${1:-}" in
    build) build ;;
    run)
        ready
        "$LAB" ${2:+"$2"} >"$OUT/lab.log" 2>&1 &
        disown
        sleep 2
        cat "$OUT/lab.log"
        ;;
    open)
        ready
        # -g: launched in the background, never brought forward; -n: a fresh instance with these arguments.
        open -g -n "$APP" --stdout "$OUT/lab.log" --stderr "$OUT/lab.log" --args --window ${2:+"$2"}
        sleep 3
        cat "$OUT/lab.log"
        ;;
    front) open "$APP" ;;
    post) "$POST" "$2" ;;
    window) "$WINDOWS" ;;
    *) sed -n '2,11p' "$0"; exit 2 ;;
esac
