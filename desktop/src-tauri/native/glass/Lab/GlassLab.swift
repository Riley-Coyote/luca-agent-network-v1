import AppKit
import WebKit

// The glass lab: Polyphonic's own page, from the dev server, in front of Apple's glass. It checks and films the native
// rail glass without the app, a profile or anyone's keyboard: a borderless window one level below normal windows, on
// the screen without the menu bar when there is one, never key and never clickable (the Liquid Glass Workbench's film
// window). Its glass has the relaxed look of a window not in use, so judge the look in the app, in front.
//
//   glass-lab [url]   default http://localhost:1488/scripts/shell-lab.template.html?scene=ad
//
// Commands, as JSON through DistributedNotificationCenter `chat.polyphonic.glass-lab.command`
// (scripts/native-glass-lab.sh post '<json>'):
//   {"js": "<script>"}   runs in the page; to the glass: window.webkit.messageHandlers.polyphonicGlass.postMessage(…)
//   {"page": "hide" | "show"}   the glass alone, or with the page over it
//   {"size": [w, h]}            resizes the lab, keeping its top edge
//   {"quit": true}

@main
enum GlassLab {
    @MainActor static func main() {
        setvbuf(stdout, nil, _IOLBF, 0)
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let address = CommandLine.arguments.dropFirst().first ?? "http://localhost:1488/scripts/shell-lab.template.html?scene=ad"
        guard let url = URL(string: address) else { fatalError("glass-lab: not a URL: \(address)") }
        let lab = Lab(url: url)
        withExtendedLifetime(lab) { app.run() }
    }
}

@MainActor
final class Lab: NSObject, WKNavigationDelegate {
    private let window: LabWindow
    private let webView: WKWebView
    private var attached = false

    init(url: URL) {
        let size = CGSize(width: 1440, height: 900)
        window = LabWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel],
                           backing: .buffered, defer: false)
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: WKWebViewConfiguration())
        super.init()
        window.title = "Polyphonic Glass Lab"
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.appearance = NSAppearance(named: .darkAqua)
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        webView.autoresizingMask = [.width, .height]
        // The page draws nothing where the glass shows; the glass and its floor sit beneath it, as in the app.
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        content.addSubview(webView)
        window.contentView = content
        let screen = NSScreen.screens.dropFirst().first ?? NSScreen.screens.first
        if let visible = screen?.visibleFrame {
            window.setFrameOrigin(NSPoint(x: visible.minX + 24, y: visible.maxY - size.height - 24))
        }
        window.orderFrontRegardless()
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(command(_:)),
                                                            name: Notification.Name("chat.polyphonic.glass-lab.command"),
                                                            object: nil, suspensionBehavior: .deliverImmediately)
        webView.load(URLRequest(url: url))
        print("glass-lab: window \(window.windowNumber), loading \(url.absoluteString)")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !attached else { return }
        if #available(macOS 26.0, *) {
            attached = PolyphonicGlass.attach(to: webView)
        }
        print("glass-lab: page loaded, glass \(attached ? "attached" : "unavailable")")
    }

    @objc private func command(_ note: Notification) {
        guard let json = note.object as? String, let data = json.data(using: .utf8),
              let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        if command["quit"] as? Bool == true { NSApp.terminate(nil) }
        if let size = command["size"] as? [Double], size.count == 2 {
            var frame = window.frame
            frame.origin.y += frame.height - size[1]
            frame.size = CGSize(width: size[0], height: size[1])
            window.setFrame(frame, display: true)
        }
        // Checks: the glass alone, without the page over it.
        if let page = command["page"] as? String { webView.isHidden = page == "hide" }
        if let script = command["js"] as? String {
            webView.evaluateJavaScript(script) { result, error in
                if let error { print("glass-lab: js error: \(error.localizedDescription)") } else if let result { print("glass-lab: js: \(result)") }
            }
        }
    }
}

/// Never the window in use: it only shows.
final class LabWindow: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
