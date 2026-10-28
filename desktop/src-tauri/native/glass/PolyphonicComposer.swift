import AppKit
import SwiftUI
import WebKit

// The composer in Apple's real glass, above the page, so the conversation scrolling beneath it bends in the glass
// (Riley, 2026-10-27: "theres not a whole lot of purpose behind even having the glass composer if it isnt able to do
// the things that make it so awesome"). Its look is Ghost's dark glass from the phone: Apple's regular glass under a
// 0.58 black veil, with the words above both. For now only the composer-glass test app asks for it.
//
// The page keeps its composer for everything it knows (drafts, mentions, suggestions, sending, the + menu, editing a
// sent message): it hides its own surface and words, keeps their place, and says where they are. This side draws the
// glass there and holds the words in the Mac's own text view (input methods, dictation, spelling). Every change goes
// back to the page's composer as it's typed, and Return sends through the page, so a message goes out the way it
// always has.
//
// The page talks to it through one WebKit message handler, `polyphonicComposer`:
//   {type: "frame", visible, x, y, w, h, hint, dark}   where the page's composer is (its points from the web view's
//                                                      top-left), what it says while empty, and the page's mode
//   {type: "text", text}                               the words, when the page changes them (a draft restored, a
//                                                      message sent, a suggestion taken)
//   {type: "focus"}                                    the page's composer was focused: the words take the keyboard
//   {type: "keys", on}                                 the page's suggestions are open: the arrows, Return, Tab and
//                                                      Escape go to the page
//   {type: "off"}                                      the page no longer has a composer in the glass
// and calls the page's `window.__polyphonicComposer`: input(text), send(), plus(), key(name), height(points).
// Nothing is drawn, and nothing takes a click, until the page's first frame.

@available(macOS 26.0, *)
@MainActor
final class PolyphonicComposer: NSObject, WKScriptMessageHandler {
    /// One per web view, kept alive by the web view's own content controller.
    private static let handlerName = "polyphonicComposer"

    private weak var webView: WKWebView?
    private let state = ComposerState()
    private var host: ComposerHost?

    static func attach(to webView: WKWebView) {
        let composer = PolyphonicComposer()
        composer.webView = webView
        composer.wire()
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: handlerName)
        controller.add(composer, name: handlerName)
        let announce = "window.__POLYPHONIC_NATIVE_COMPOSER__ = 1;"
        controller.addUserScript(WKUserScript(source: announce, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(announce + " window.dispatchEvent(new Event('polyphonic-native-composer'));")
    }

    private func wire() {
        state.onInput = { [weak self] words in self?.call("input", Self.literal(words)) }
        state.onSend = { [weak self] in self?.call("send") }
        state.onPlus = { [weak self] in self?.call("plus") }
        state.onKey = { [weak self] name in self?.call("key", Self.literal(name)) }
        state.onHeight = { [weak self] height in self?.call("height", String(Int(height.rounded()))) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "frame": frame(body)
        case "text": state.setText(body["text"] as? String ?? "")
        case "focus": state.focusRequests += 1
        case "keys": state.pageKeys = body["on"] as? Bool ?? false
        case "off":
            state.visible = false
            host?.isHidden = true
        default: break
        }
    }

    private func frame(_ body: [String: Any]) {
        let dark = body["dark"] as? Bool ?? true
        if dark != state.dark { state.dark = dark }
        let shown = body["visible"] as? Bool ?? false
        guard shown, let x = body["x"] as? Double, let y = body["y"] as? Double, let width = body["w"] as? Double,
              let height = body["h"] as? Double, width > 0 else {
            if state.visible { state.visible = false }
            host?.isHidden = true
            return
        }
        let host = ensureHost()
        host?.isHidden = false
        host?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        // Whole points: a fractional resting place smears every word on a 1× display.
        let rect = CGRect(x: x.rounded(), y: y.rounded(), width: width.rounded(), height: height.rounded())
        let widthChanged = rect.width != state.rect.width
        if rect != state.rect { state.rect = rect }
        if let hint = body["hint"] as? String, hint != state.hint { state.hint = hint }
        if !state.visible { state.visible = true }
        if widthChanged { state.reshape() }
    }

    /// The glass's own view, above the page, made on the page's first frame.
    private func ensureHost() -> ComposerHost? {
        if let host { return host }
        guard let webView, let parent = webView.superview else { return nil }
        let made = ComposerHost(rootView: ComposerOverlay(state: state))
        made.state = state
        made.frame = webView.frame
        made.autoresizingMask = [.width, .height]
        // Full-size windows otherwise push SwiftUI below the title bar, away from where the page measured.
        made.safeAreaRegions = []
        parent.addSubview(made, positioned: .above, relativeTo: webView)
        host = made
        return made
    }

    private func call(_ name: String, _ argument: String = "") {
        webView?.evaluateJavaScript("window.__polyphonicComposer?.\(name)(\(argument)); void 0", completionHandler: nil)
    }

    /// A string as a JavaScript literal.
    private static func literal(_ words: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [words]),
              let list = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(list.dropFirst().dropLast())
    }
}

// MARK: - Measures

/// One line is a capsule 48 tall, its buttons 7 in from every edge so their circles are concentric with its ends; past
/// one line the words take the whole width and the buttons keep their own row beneath (the page's composer shape).
@MainActor
enum ComposerMetrics {
    static let capsule: CGFloat = 48
    static let inset: CGFloat = 7
    static let button: CGFloat = 34
    static let radius: CGFloat = 24
    /// Between a button and the words, on one line.
    static let gap: CGFloat = 6
    /// Open, the words sit 10 further in than the buttons.
    static let openSide: CGFloat = 17
    static let openTop: CGFloat = 11
    static let rowGap: CGFloat = 4
    /// The words at the conversation's size, on a 26 line, about nine lines before they scroll.
    static let font = NSFont.systemFont(ofSize: 16)
    static let line: CGFloat = 26
    static let mostWords: CGFloat = 234

    static func capsuleLine(_ width: CGFloat) -> CGFloat { width - 2 * (inset + button + gap) }
    static func openLine(_ width: CGFloat) -> CGFloat { width - 2 * openSide }
    static func openHeight(_ words: CGFloat) -> CGFloat { openTop + min(words, mostWords) + rowGap + button + inset }

    static let paragraph: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = line
        style.maximumLineHeight = line
        return style
    }()

    /// A fixed line puts its extra room above the glyphs; this lifts them back to its middle, on a whole point.
    static let lift: CGFloat = ((line - (font.ascender - font.descender)) / 2).rounded()

    static func attributes(_ color: NSColor) -> [NSAttributedString.Key: Any] {
        [.font: font, .paragraphStyle: paragraph, .baselineOffset: lift, .foregroundColor: color]
    }

    /// The words' height at a width, laid out as the text view lays them out.
    static func wordsHeight(_ words: String, width: CGFloat) -> CGFloat {
        let storage = NSTextStorage(string: words.isEmpty ? " " : words, attributes: attributes(.white))
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: max(1, width), height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        layout.ensureLayout(for: container)
        var height = layout.usedRect(for: container).height
        if words.hasSuffix("\n"), layout.extraLineFragmentRect.height == 0 { height += line }
        return max(line, ceil(height))
    }
}

// MARK: - The composer

@MainActor @Observable
final class ComposerState {
    /// Where the page's composer is, in its points from the web view's top-left.
    var rect: CGRect = .zero
    var visible = false
    var hint = ""
    var text = ""
    var dark = true
    var wordsHeight: CGFloat = ComposerMetrics.line
    var open = false
    var focusRequests = 0
    /// The page's suggestions are open: the keys that move through them go to the page.
    var pageKeys = false
    @ObservationIgnored var onInput: (String) -> Void = { _ in }
    @ObservationIgnored var onSend: () -> Void = {}
    @ObservationIgnored var onPlus: () -> Void = {}
    @ObservationIgnored var onKey: (String) -> Void = { _ in }
    @ObservationIgnored var onHeight: (CGFloat) -> Void = { _ in }

    var height: CGFloat { open ? ComposerMetrics.openHeight(wordsHeight) : ComposerMetrics.capsule }
    /// The glass, anchored at the bottom of the page's composer: it grows upward.
    var frame: CGRect { CGRect(x: rect.minX, y: rect.maxY - height, width: rect.width, height: height) }
    var armed: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The page changed the words.
    func setText(_ words: String) {
        guard words != text else { return }
        text = words
        reshape()
    }

    /// The words changed, or the width: their height at the open width, and which shape holds them. One line stays the
    /// capsule until the words would pass the capsule's own line, and goes back once they fit it again.
    func reshape() {
        let width = rect.width
        guard width > 0 else { return }
        let single = (text as NSString).size(withAttributes: [.font: ComposerMetrics.font]).width
        let next = text.contains("\n") || single > ComposerMetrics.capsuleLine(width) - 2
        let measured = ComposerMetrics.wordsHeight(text, width: ComposerMetrics.openLine(width))
        if measured != wordsHeight { wordsHeight = measured }
        if next != open { open = next }
        onHeight(height)
    }
}

/// The words, in the Mac's own text view. Return sends; Shift- or Option-Return makes a new line. While the page's
/// suggestions are open, the keys that move through them go to the page, as do Escape and ↑ in an empty composer
/// (editing your last message).
final class ComposerWordsView: NSTextView {
    var onSend: () -> Void = {}
    var onKey: (String) -> Void = { _ in }
    var pageKeys: () -> Bool = { false }

    override func keyDown(with event: NSEvent) {
        guard !hasMarkedText(), let name = Self.name(of: event) else {
            super.keyDown(with: event)
            return
        }
        let newLine = event.modifierFlags.contains(.shift) || event.modifierFlags.contains(.option)
        if pageKeys(), !(name == "Enter" && newLine) {
            onKey(name)
            return
        }
        switch name {
        case "Escape":
            onKey(name)
        case "ArrowUp" where string.isEmpty:
            onKey(name)
        case "Enter":
            if newLine { insertNewlineIgnoringFieldEditor(nil) } else { onSend() }
        case "Tab":
            window?.selectNextKeyView(nil)
        default:
            super.keyDown(with: event)
        }
    }

    private static func name(of event: NSEvent) -> String? {
        switch event.keyCode {
        case 126: "ArrowUp"
        case 125: "ArrowDown"
        case 36, 76: "Enter"
        case 48: "Tab"
        case 53: "Escape"
        default: nil
        }
    }
}

@available(macOS 26.0, *)
struct ComposerWords: NSViewRepresentable {
    let state: ComposerState

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        let state: ComposerState
        weak var view: ComposerWordsView?
        var focusSeen = 0
        var darkSeen: Bool?

        init(_ state: ComposerState) { self.state = state }

        func textDidChange(_ notification: Notification) {
            guard let view else { return }
            state.text = view.string
            state.reshape()
            state.onInput(view.string)
        }

        func takeKeyboard() {
            guard let view, let window = view.window else { return }
            window.makeFirstResponder(view)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(state) }

    func makeNSView(context: Context) -> NSScrollView {
        let view = ComposerWordsView(usingTextLayoutManager: false)
        view.delegate = context.coordinator
        view.drawsBackground = false
        view.isRichText = false
        view.importsGraphics = false
        view.allowsUndo = true
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        view.font = ComposerMetrics.font
        view.defaultParagraphStyle = ComposerMetrics.paragraph
        let state = state
        view.onSend = { if state.armed { state.onSend() } }
        view.onKey = { name in state.onKey(name) }
        view.pageKeys = { state.pageKeys }
        context.coordinator.view = view
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        scroll.hasHorizontalScroller = false
        scroll.verticalScrollElasticity = .none
        scroll.documentView = view
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        guard let view = coordinator.view else { return }
        let ink = state.dark ? NSColor.white : NSColor(white: 0.07, alpha: 1)
        if view.string != state.text {
            // The page changed the words: a draft restored, a message sent, a suggestion taken.
            view.string = state.text
            view.setSelectedRange(NSRange(location: (state.text as NSString).length, length: 0))
            coordinator.darkSeen = nil
        }
        if coordinator.darkSeen != state.dark {
            coordinator.darkSeen = state.dark
            view.typingAttributes = ComposerMetrics.attributes(ink)
            view.textStorage?.setAttributes(ComposerMetrics.attributes(ink),
                                            range: NSRange(location: 0, length: (view.string as NSString).length))
            // The caret is light at night, never the system's blue.
            view.insertionPointColor = state.dark ? NSColor(red: 0.933, green: 0.949, blue: 0.973, alpha: 1) : ink
        }
        if coordinator.focusSeen != state.focusRequests {
            coordinator.focusSeen = state.focusRequests
            Task { @MainActor in coordinator.takeKeyboard() }
        }
    }
}

@available(macOS 26.0, *)
struct ComposerPiece: View {
    let state: ComposerState
    @State private var plusHover = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: ComposerMetrics.radius, style: .continuous)
        let width = state.rect.width
        let height = state.height
        let words: CGRect = state.open
            ? CGRect(x: ComposerMetrics.openSide, y: ComposerMetrics.openTop, width: ComposerMetrics.openLine(width),
                     height: min(state.wordsHeight, ComposerMetrics.mostWords))
            : CGRect(x: ComposerMetrics.inset + ComposerMetrics.button + ComposerMetrics.gap,
                     y: (ComposerMetrics.capsule - ComposerMetrics.line) / 2,
                     width: ComposerMetrics.capsuleLine(width), height: ComposerMetrics.line)
        let dark = state.dark
        let buttonsY = height - ComposerMetrics.inset - ComposerMetrics.button
        ZStack(alignment: .topLeading) {
            Color.clear
            if state.text.isEmpty {
                Text(state.hint)
                    .font(.system(size: 16))
                    .foregroundStyle(dark ? Color.white.opacity(0.54) : Color.black.opacity(0.45))
                    .lineLimit(1)
                    .frame(width: words.width, height: ComposerMetrics.line, alignment: .leading)
                    .offset(x: words.minX, y: words.minY)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            ComposerWords(state: state)
                .frame(width: words.width, height: words.height)
                .offset(x: words.minX, y: words.minY)
                .accessibilityLabel(state.hint)
            Button(action: { state.onPlus() }) {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(dark ? Color.white.opacity(0.88) : Color.black.opacity(0.72))
                    .frame(width: ComposerMetrics.button, height: ComposerMetrics.button)
                    .background {
                        Circle().fill(plusHover ? (dark ? Color.white.opacity(0.08) : Color.black.opacity(0.05)) : .clear)
                    }
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .onHover { plusHover = $0 }
            .accessibilityLabel("Add to message")
            .offset(x: ComposerMetrics.inset, y: buttonsY)
            ComposerSend(armed: state.armed, dark: dark) { if state.armed { state.onSend() } }
                .offset(x: width - ComposerMetrics.inset - ComposerMetrics.button, y: buttonsY)
        }
        .frame(width: width, height: height, alignment: .topLeading)
        // Ghost's dark glass: the veil is the glass's content, so it sits in front of the glass and beneath the words.
        .background { if dark { shape.fill(.black.opacity(Double(LiquidMeasure.veilAlpha))) } }
        .glassEffect(.regular, in: shape)
        .contentShape(shape)
        .onTapGesture { state.focusRequests += 1 }
    }
}

/// The one primary action: an untinted white disc at night, the house blue by day; quiet until there are words.
@available(macOS 26.0, *)
struct ComposerSend: View {
    let armed: Bool
    let dark: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(armed ? armedFill : quietFill)
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(armed ? armedInk : quietInk)
            }
            .frame(width: ComposerMetrics.button, height: ComposerMetrics.button)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!armed)
        .animation(.easeOut(duration: 0.16), value: armed)
        .accessibilityLabel("Send message")
    }

    private var armedFill: Color { dark ? .white.opacity(0.96) : Color(red: 0, green: 0.48, blue: 1) }
    private var armedInk: Color { dark ? .black : .white }
    private var quietFill: Color { dark ? .white.opacity(0.08) : .black.opacity(0.06) }
    private var quietInk: Color { dark ? .white.opacity(0.34) : .black.opacity(0.3) }
}

@available(macOS 26.0, *)
struct ComposerOverlay: View {
    let state: ComposerState

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if state.visible, state.rect.width > 0 {
                ComposerPiece(state: state)
                    .offset(x: state.rect.minX, y: state.rect.maxY - state.height)
                    .environment(\.colorScheme, state.dark ? .dark : .light)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        // The line's spring: the glass grows and settles as one piece, its words and buttons with it.
        .animation(.spring(response: 0.42, dampingFraction: 0.84), value: state.height)
        .animation(.spring(response: 0.42, dampingFraction: 0.84), value: state.open)
    }
}

/// Clear everywhere but the glass: a click anywhere else reaches the page beneath.
@available(macOS 26.0, *)
final class ComposerHost: NSHostingView<ComposerOverlay> {
    var state: ComposerState?

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let state, state.visible, !isHidden else { return nil }
        var local = convert(point, from: superview)
        if !isFlipped { local.y = bounds.height - local.y }
        guard state.frame.contains(local) else { return nil }
        return super.hitTest(point)
    }
}
