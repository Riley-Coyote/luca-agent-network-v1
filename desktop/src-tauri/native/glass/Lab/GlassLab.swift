import AppKit
import WebKit

// The glass lab: Polyphonic's own page, from the dev server, in front of Apple's glass. It checks and films the native
// rail glass without the app, a profile or anyone's keyboard.
//
//   glass-lab [url]            the film window: borderless, one level below normal windows, on the screen without the
//                              menu bar when there is one, never key and never clickable (the Liquid Glass
//                              Workbench's film window). Its glass has the relaxed look of a window not in use.
//   glass-lab --window [url]   a real window to use: a title bar with working traffic lights over the page (as the
//                              app's Overlay title bar), resizable. It opens behind every other window and stays
//                              there until it is brought forward (its Dock icon, or `open -a` on its bundle): it never
//                              takes the keyboard by itself.
//   default url: http://localhost:1488/scripts/shell-lab.template.html?scene=ad
//
// Commands, as JSON through DistributedNotificationCenter `chat.polyphonic.glass-lab.command`
// (scripts/native-glass-lab.sh post '<json>'):
//   {"js": "<script>"}   runs in the page; to the glass: window.webkit.messageHandlers.polyphonicGlass.postMessage(…)
//   {"page": "hide" | "show"}   the glass alone, or with the page over it
//   {"size": [w, h]}            resizes the lab, keeping its top edge
//   {"move": [dx, dy]}          moves the lab right and down by that much (to clear what covers it in a capture)
//   {"click": [x, y]}           a click at that point from the content's top-left, sent to the window (no pointer moves)
//   {"quit": true}
// The page can move the window by its own title bar: window.webkit.messageHandlers.glassLab.postMessage("drag") from a
// mousedown there; and place the traffic lights on its lip: postMessage({lights: {left, centre}}).

@main
enum GlassLab {
    @MainActor static func main() {
        setvbuf(stdout, nil, _IOLBF, 0)
        let app = NSApplication.shared
        let arguments = CommandLine.arguments.dropFirst()
        let titled = arguments.contains("--window")
        app.setActivationPolicy(titled ? .regular : .accessory)
        let address = arguments.first { !$0.hasPrefix("--") }
            ?? "http://localhost:1488/scripts/shell-lab.template.html?scene=ad"
        guard let url = URL(string: address) else { fatalError("glass-lab: not a URL: \(address)") }
        let lab = Lab(url: url, titled: titled)
        app.delegate = lab
        withExtendedLifetime(lab) { app.run() }
    }
}

@MainActor
final class Lab: NSObject, WKNavigationDelegate, NSApplicationDelegate, WKScriptMessageHandler {
    let window: NSWindow
    private let webView: WKWebView
    private let titled: Bool
    private var attached = false
    /// Where the traffic lights sit in a titled lab: the line the page's top lip is centred on, and the first light's
    /// left edge. The page can move them to its own lip.
    private var lightsCentre: CGFloat = 22
    private var lightsLeft: CGFloat = 16

    init(url: URL, titled: Bool) {
        self.titled = titled
        // The film window keeps to the screen without the menu bar; a window to use opens on the main one, where it
        // will be looked at.
        let screen = titled ? NSScreen.screens.first : NSScreen.screens.dropFirst().first ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1512, height: 944)
        let size = CGSize(width: min(1440, visible.width - 48), height: min(900, visible.height - 48))
        let rect = NSRect(origin: .zero, size: size)
        if titled {
            window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        } else {
            window = LabWindow(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        }
        let configuration = WKWebViewConfiguration()
        if titled {
            // Tells the page the window draws real traffic lights, so it draws none of its own.
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__POLYPHONIC_GLASS_LAB__ = 'window';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: rect, configuration: configuration)
        super.init()
        webView.configuration.userContentController.add(self, name: "glassLab")
        window.title = "Polyphonic Glass Lab"
        window.isOpaque = false
        window.backgroundColor = .clear
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        if titled {
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.minSize = NSSize(width: 800, height: 500)
        } else {
            window.hasShadow = false
            window.ignoresMouseEvents = true
            window.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        }
        let content = NSView(frame: rect)
        webView.autoresizingMask = [.width, .height]
        // The page draws nothing where the glass shows; the glass and its floor sit beneath it, as in the app.
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = self
        content.addSubview(webView)
        window.contentView = content
        window.setFrameOrigin(NSPoint(x: visible.minX + 24, y: visible.maxY - size.height - 24))
        if titled {
            placeLights()
            NotificationCenter.default.addObserver(self, selector: #selector(windowChanged), name: NSWindow.didResizeNotification,
                                                   object: window)
            NotificationCenter.default.addObserver(self, selector: #selector(windowChanged),
                                                   name: NSWindow.didExitFullScreenNotification, object: window)
            // Behind everything, not key: it waits to be brought forward.
            window.orderBack(nil)
        } else {
            window.orderFrontRegardless()
        }
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(command(_:)),
                                                            name: Notification.Name("chat.polyphonic.glass-lab.command"),
                                                            object: nil, suspensionBehavior: .deliverImmediately)
        webView.load(URLRequest(url: url))
        print("glass-lab: window \(window.windowNumber), \(titled ? "titled, behind" : "film"), loading \(url.absoluteString)")
    }

    // MARK: the app

    func applicationDidBecomeActive(_ notification: Notification) {
        // Brought forward on purpose (its Dock icon, `open -a`): now it may have the keyboard.
        guard titled else { return }
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { titled }

    // MARK: the title bar

    /// The traffic lights centred in the page's top lip, as the app's `trafficLightPosition` places them: the title bar
    /// grows to hold them, and each light keeps its spacing.
    private func placeLights() {
        let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap(window.standardWindowButton)
        guard let close = buttons.first, let bar = close.superview?.superview else { return }
        let top = lightsCentre - close.frame.height / 2
        var frame = bar.frame
        frame.size.height = close.frame.height + top
        frame.origin.y = window.frame.height - frame.height
        bar.frame = frame
        let spacing = buttons.count > 1 ? buttons[1].frame.minX - close.frame.minX : 20
        for (index, button) in buttons.enumerated() {
            button.setFrameOrigin(NSPoint(x: lightsLeft + CGFloat(index) * spacing, y: 0))
        }
        let placed = close.convert(close.bounds, to: nil)
        print("glass-lab: lights at x \(Int(placed.minX)), centred \(Int(window.frame.height - placed.midY)) from the top")
    }

    @objc private func windowChanged() { placeLights() }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let lights = (message.body as? [String: Any])?["lights"] as? [String: Any],
           let left = lights["left"] as? Double, let centre = lights["centre"] as? Double, titled {
            lightsLeft = CGFloat(left)
            lightsCentre = CGFloat(centre)
            placeLights()
            return
        }
        // The page's own title bar was pressed: the window moves with the pointer, as a title bar does.
        guard message.body as? String == "drag", let event = NSApp.currentEvent, event.type == .leftMouseDown else { return }
        window.performDrag(with: event)
    }

    // MARK: the page

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !attached else { return }
        if #available(macOS 26.0, *) {
            attached = PolyphonicGlass.attach(to: webView)
        }
        print("glass-lab: page loaded, glass \(attached ? "attached" : "unavailable")")
        if titled { probe() }
    }

    /// Which view a click in the page's top lip reaches: the page must get it, not the title bar.
    private func probe() {
        guard let frameView = window.contentView?.superview else { return }
        for x in [98.0, 300.0, window.frame.width / 2] {
            let point = NSPoint(x: x, y: window.frame.height - lightsCentre)
            // The window's root view sits at the window's origin, so window points are its superview's points.
            let hit = frameView.hitTest(point)
            print("glass-lab: a click at (\(Int(x)), \(Int(lightsCentre))) from the top reaches \(hit.map { String(describing: type(of: $0)) } ?? "nothing")")
        }
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
        if let move = command["move"] as? [Double], move.count == 2 {
            var origin = window.frame.origin
            origin.x += move[0]
            origin.y -= move[1]
            window.setFrameOrigin(origin)
        }
        // Checks: the glass alone, without the page over it.
        if let page = command["page"] as? String { webView.isHidden = page == "hide" }
        // Checks: a click at a point in the page's coordinates, sent to the window itself, so nobody's pointer moves.
        if let click = command["click"] as? [Double], click.count == 2 { self.click(at: CGPoint(x: click[0], y: click[1])) }
        if let script = command["js"] as? String {
            webView.evaluateJavaScript(script) { result, error in
                if let error { print("glass-lab: js error: \(error.localizedDescription)") } else if let result { print("glass-lab: js: \(result)") }
            }
        }
    }
}

extension Lab {
    /// A press and release at a point measured from the content's top-left, through the window's own event dispatch.
    func click(at point: CGPoint) {
        guard let content = window.contentView else { return }
        let location = NSPoint(x: point.x, y: content.bounds.height - point.y)
        let hit = window.contentView?.superview?.hitTest(location).map { String(describing: type(of: $0)) } ?? "nothing"
        print("glass-lab: click at (\(Int(point.x)), \(Int(point.y))) reaches \(hit)")
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: location, modifierFlags: [],
                                                 timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                                 context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)
            else { continue }
            window.sendEvent(event)
        }
    }
}

/// Never the window in use: it only shows.
final class LabWindow: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
