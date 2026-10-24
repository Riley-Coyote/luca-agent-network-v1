import AppKit
import SwiftUI
import WebKit

// The shell study's glass floor (docs/luca/rail-system/SHELL_STUDY.md, "The glass floor"): the frame as one piece of
// Apple's Liquid Glass beneath the page, the cards sitting on it. Everything the frame holds (the lip's buttons, the
// tabs' names, the places, the avatar) is drawn inside the glass, so the glass keeps it legible as its own. Darkness,
// when wanted, goes beneath the glass, never over it. The floor can hold the look Apple's glass has when its window
// isn't in use (Riley's favourite): then it lives in a window of its own just behind the app's, which is never the one
// in use. The page lays everything out, keeps its own buttons where they are (without their ink, so clicks, keys and
// focus stay the page's) and says where things are and how they look. Lab only for now: the app's build (build.rs)
// compiles PolyphonicGlass.swift and Engine/, not this.
//
// The page talks to it through one WebKit message handler, `shellFloor`:
//   {type: "floor", on: false}                       no floor (another frame, or Apple's frosted material instead)
//   {type: "floor", on: true, style, tint, dim, r, rest, cardColor, items}
//       style        "regular" | "clear"             Apple's two types of glass
//       tint         "#rrggbbaa" | null              Apple's own tint for the glass
//       dim          0…1                             black beneath the glass, in its shape
//       r                                            the window's corner radius
//       rest         Bool                            hold the look of a window not in use (the floor's own window)
//       cardColor    "#rrggbb"                       the card's surface: where you are is a chip of it
//       items        [{id, kind, x, y, w, h, symbol?, size?, text?, parts?, align?, pad?, r?, inset?, selected?,
//                    disabled?, hover?, pressed?, fade?, strong?}]
//                    kind "symbol" | "text" | "avatar"; r is the radius of the plate under it on hover and press (and of
//                    the chip under it when it's where you are), inset how far that plate stands in from its top and
//                    bottom; fade fades a name's end under its close button; parts are words in tones: [{text, tone:
//                    "full" | "muted" | "faint", weight}]
//   {type: "window"}                                 a page that has just loaded asks where it is
// Back to the page: "polyphonic-window" with {radius, key}: the window's corner radius (read from AppKit on macOS 27,
// where every window is 16) and whether it's the one in use; and "polyphonic-floor-ready" once the handler is in place.
// Coordinates are the page's CSS pixels from the web view's top-left, which are points.

@available(macOS 26.0, *)
@MainActor
final class ShellFloor: NSObject, WKScriptMessageHandler {
    private static let handlerName = "shellFloor"

    private weak var webView: WKWebView?
    private let model: FloorModel
    private let host: FloorHostingView
    private var radiusProbe: NSView?
    private var windowRadius: CGFloat = 16
    private var observers: [NSObjectProtocol] = []
    /// The floor's own window, while it holds the resting look, and what the app's window was before it came.
    private var restWindow: NSWindow?
    private var windowHadShadow = true
    private var windowIgnoredMouse = false

    private init(webView: WKWebView) {
        self.webView = webView
        let model = FloorModel()
        self.model = model
        host = FloorHostingView(rootView: FloorView(model: model))
        super.init()
    }

    /// Puts the floor directly beneath `webView` and starts listening to its page. Nil without a superview.
    static func attach(below webView: WKWebView) -> ShellFloor? {
        guard let parent = webView.superview else { return nil }
        let floor = ShellFloor(webView: webView)
        floor.host.frame = webView.frame
        floor.host.autoresizingMask = [.width, .height]
        floor.host.sizingOptions = []
        // A full-size window gives the host a safe area under its title bar; the page's points start at the top.
        floor.host.safeAreaRegions = []
        parent.addSubview(floor.host, positioned: .below, relativeTo: webView)
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: handlerName)
        controller.add(floor, name: handlerName)
        floor.watchWindow()
        // A page that reported before the handler was here says it all again.
        webView.evaluateJavaScript("window.dispatchEvent(new Event('polyphonic-floor-ready'));")
        return floor
    }

    /// A new page is loading: until it reports, there is no floor.
    func reset() {
        model.on = false
    }

    // MARK: the resting look

    /// Apple's glass relaxes when its window isn't the one in use: flatter, more diffused, its tint dropped, and nothing
    /// public holds that look. A window is in use or not as a whole, so the floor holding it moves to a borderless
    /// window of its own, exactly over the app's and one step behind it, which never becomes the one in use. The app's
    /// window then takes clicks everywhere (its frame is clear) and leaves the shadow to the floor's window.
    private func rest(_ on: Bool) {
        guard let webView, let window = webView.window else { return }
        if on {
            let rest = restWindow ?? makeRestWindow()
            if restWindow == nil {
                restWindow = rest
                windowHadShadow = window.hasShadow
                windowIgnoredMouse = window.ignoresMouseEvents
            }
            rest.level = window.level
            rest.collectionBehavior = window.collectionBehavior
            rest.setFrame(window.frame, display: false)
            if host.superview !== rest.contentView, let content = rest.contentView {
                host.removeFromSuperview()
                host.frame = content.bounds
                content.addSubview(host)
            }
            if rest.parent !== window { window.addChildWindow(rest, ordered: .below) }
            window.hasShadow = false
            if !windowIgnoredMouse { window.ignoresMouseEvents = false }
        } else {
            guard let rest = restWindow, let parent = webView.superview else { return }
            host.removeFromSuperview()
            host.frame = webView.frame
            parent.addSubview(host, positioned: .below, relativeTo: webView)
            window.removeChildWindow(rest)
            rest.orderOut(nil)
            restWindow = nil
            window.hasShadow = windowHadShadow
            window.ignoresMouseEvents = windowIgnoredMouse
            window.invalidateShadow()
        }
    }

    private func makeRestWindow() -> NSWindow {
        let rest = NSWindow(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
        rest.isOpaque = false
        rest.backgroundColor = .clear
        rest.hasShadow = true
        rest.ignoresMouseEvents = true
        rest.isReleasedWhenClosed = false
        rest.appearance = NSAppearance(named: .darkAqua)
        rest.contentView = NSView()
        return rest
    }

    /// The floor's window keeps the app window's size (a child window follows its moves, not its resizes).
    private func followWindow() {
        guard let rest = restWindow, let window = webView?.window else { return }
        rest.setFrame(window.frame, display: true)
    }

    // MARK: the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "window" { tellWindow(); return }
        guard body["type"] as? String == "floor" else { return }
        guard body["on"] as? Bool == true else {
            model.on = false
            rest(false)
            return
        }
        model.clear = body["style"] as? String == "clear"
        model.tint = (body["tint"] as? String).flatMap(NSColor.init(hexWithAlpha:)).map(Color.init(nsColor:))
        model.dim = Self.number(body["dim"]) ?? 0
        model.radius = Self.number(body["r"]) ?? 16
        if let color = (body["cardColor"] as? String).flatMap(NSColor.init(hex:)) { model.cardColor = Color(nsColor: color) }
        model.items = Self.items(body["items"])
        model.on = true
        rest(body["rest"] as? Bool == true)
    }

    // MARK: the window

    private func watchWindow() {
        guard let window = webView?.window else { return }
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.tellWindow() }
            })
        }
        for name in [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.followWindow() }
            })
        }
        if #available(macOS 27.0, *), let content = window.contentView {
            let probe = WindowRadiusProbe(frame: content.bounds)
            probe.autoresizingMask = [.width, .height]
            probe.onRadius = { [weak self] radius in
                guard let self, radius > 0, radius != self.windowRadius else { return }
                self.windowRadius = radius
                self.tellWindow()
            }
            content.addSubview(probe, positioned: .below, relativeTo: nil)
            radiusProbe = probe
            if let radius = probe.effectiveCornerRadii?.topLeft, radius > 0 { windowRadius = radius }
        }
        tellWindow()
    }

    /// The window's radius and whether it's in use, to the page.
    func tellWindow() {
        let key = webView?.window?.isKeyWindow ?? false
        webView?.evaluateJavaScript(
            "window.__polyphonicWindow = {radius: \(windowRadius), key: \(key)};"
                + " window.dispatchEvent(new CustomEvent('polyphonic-window', {detail: window.__polyphonicWindow}));")
    }

    // MARK: reading the page's numbers

    private static func number(_ value: Any?) -> CGFloat? {
        guard let double = value as? Double, double.isFinite else { return nil }
        return CGFloat(double)
    }

    private static func rect(_ value: Any?) -> CGRect? {
        guard let box = value as? [String: Any], let x = number(box["x"]), let y = number(box["y"]),
              let w = number(box["w"]), let h = number(box["h"]), w >= 1, h >= 1 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    private static func items(_ value: Any?) -> [FloorItem] {
        guard let list = value as? [[String: Any]] else { return [] }
        return list.compactMap { box in
            guard let id = box["id"] as? String, let kind = (box["kind"] as? String).flatMap(FloorItem.Kind.init),
                  let frame = rect(box) else { return nil }
            let parts = (box["parts"] as? [[String: Any]])?.map { part in
                FloorItem.Part(text: part["text"] as? String ?? "", tone: part["tone"] as? String ?? "full",
                               weight: number(part["weight"]) ?? 400)
            }
            return FloorItem(id: id, kind: kind, frame: frame, symbol: box["symbol"] as? String, size: number(box["size"]),
                             text: box["text"] as? String, parts: parts, centred: box["align"] as? String == "center",
                             pad: number(box["pad"]) ?? 0, radius: number(box["r"]) ?? 8, inset: number(box["inset"]) ?? 0,
                             selected: box["selected"] as? Bool ?? false, disabled: box["disabled"] as? Bool ?? false,
                             hover: box["hover"] as? Bool ?? false, pressed: box["pressed"] as? Bool ?? false,
                             fade: box["fade"] as? Bool ?? false, strong: box["strong"] as? Bool ?? false)
        }
    }
}

// MARK: - what the floor holds

struct FloorItem: Identifiable, Equatable {
    enum Kind: String { case symbol, text, avatar }
    /// Words in one tone: the title's home, its slash and its session.
    struct Part: Equatable {
        let text: String
        let tone: String
        let weight: CGFloat
    }

    let id: String
    let kind: Kind
    let frame: CGRect
    let symbol: String?
    let size: CGFloat?
    let text: String?
    let parts: [Part]?
    let centred: Bool
    let pad: CGFloat
    let radius: CGFloat
    let inset: CGFloat
    let selected: Bool
    let disabled: Bool
    let hover: Bool
    let pressed: Bool
    let fade: Bool
    let strong: Bool
}

@available(macOS 26.0, *)
@MainActor
@Observable
final class FloorModel {
    var on = false
    var clear = false
    var tint: Color?
    var dim: CGFloat = 0
    var radius: CGFloat = 16
    var cardColor = Color(white: 0.07)
    var items: [FloorItem] = []
}

// MARK: - the host

/// Beneath the page and never in the way: the page above takes every click.
@available(macOS 26.0, *)
final class FloorHostingView: NSHostingView<FloorView> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// Reads the window's corner radius the only way AppKit gives it: a view as big as the window, its corners concentric
/// with the window's (macOS 27).
@available(macOS 27.0, *)
final class WindowRadiusProbe: NSView {
    var onRadius: ((CGFloat) -> Void)?

    override var cornerConfiguration: NSViewCornerConfiguration? { .uniformCorners(radius: .containerConcentric) }

    override func viewDidChangeEffectiveCornerRadii() {
        super.viewDidChangeEffectiveCornerRadii()
        if let radius = effectiveCornerRadii?.topLeft { onRadius?(radius) }
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

// MARK: - the floor

@available(macOS 26.0, *)
struct FloorView: View {
    let model: FloorModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // One piece of glass, the window's own shape; the cards sit on it.
        let shape = RoundedRectangle(cornerRadius: model.radius, style: .continuous)
        let chip = model.items.first { $0.selected && $0.kind == .symbol }
        ZStack {
            if model.on {
                // Darkness beneath the glass, never over it: the glass bends a darker desktop and keeps its light.
                if model.dim > 0 { shape.fill(.black.opacity(model.dim)) }
                ZStack(alignment: .topLeading) {
                    Color.clear
                    if let chip {
                        CardChip(color: model.cardColor, radius: chip.radius)
                            .frame(width: chip.frame.width, height: chip.frame.height)
                            .padding(.leading, chip.frame.minX)
                            .padding(.top, chip.frame.minY)
                            .animation(reduceMotion ? nil : FloorMetrics.slide, value: chip.id)
                    }
                    ForEach(model.items) { item in
                        FloorItemView(item: item, lit: false)
                            .frame(width: item.frame.width, height: item.frame.height)
                            .padding(.leading, item.frame.minX)
                            .padding(.top, item.frame.minY)
                    }
                    if let chip {
                        // Where you are carries the light: the symbols again in full ink, seen only through the chip,
                        // so a place lights as the chip arrives and dims as it leaves, never ahead of it.
                        ZStack(alignment: .topLeading) {
                            Color.clear
                            ForEach(model.items.filter { $0.kind == .symbol }) { item in
                                FloorItemView(item: item, lit: true)
                                    .frame(width: item.frame.width, height: item.frame.height)
                                    .padding(.leading, item.frame.minX)
                                    .padding(.top, item.frame.minY)
                            }
                        }
                        .mask(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: chip.radius, style: .continuous)
                                .frame(width: chip.frame.width, height: chip.frame.height)
                                .padding(.leading, chip.frame.minX)
                                .padding(.top, chip.frame.minY)
                                .animation(reduceMotion ? nil : FloorMetrics.slide, value: chip.id)
                        }
                        .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .glassEffect(glass, in: shape)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .environment(\.colorScheme, .dark)
        .accessibilityHidden(true)
    }

    private var glass: Glass {
        let glass = model.clear ? Glass.clear : Glass.regular
        return model.tint.map { glass.tint($0) } ?? glass
    }
}

/// One thing the frame holds, inside the glass. Its ink rests at the frame's muted tier and lifts to full when the
/// pointer is over it or it's pressed (the page says which), with a faint plate beneath it then; faint when it can't be
/// pressed. `lit` is its copy seen through the chip: plain light ink on the card's black.
@available(macOS 26.0, *)
private struct FloorItemView: View {
    let item: FloorItem
    let lit: Bool
    @Environment(\.appearsActive) private var active
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if lit {
            content.foregroundStyle(.white)
        } else {
            let raised = item.hover || item.pressed
            content
                .foregroundStyle(item.disabled ? HierarchicalShapeStyle.tertiary : .primary)
                .opacity((item.disabled || raised ? 1 : FloorMetrics.resting) * (active ? 1 : 0.7))
                .scaleEffect(item.pressed && item.kind == .symbol && !reduceMotion ? 0.96 : 1)
                .background {
                    if raised && !item.selected && !item.disabled {
                        RoundedRectangle(cornerRadius: item.radius, style: .continuous)
                            .fill(.white.opacity(item.pressed ? 0.14 : contrast == .increased ? 0.18 : 0.08))
                            .padding(.vertical, item.inset)
                    }
                }
                .animation(.easeOut(duration: 0.12), value: item.hover)
                .animation(.easeOut(duration: 0.08), value: item.pressed)
        }
    }

    @ViewBuilder private var content: some View {
        switch item.kind {
        case .symbol:
            Image(systemName: item.symbol ?? "questionmark")
                .font(.system(size: FloorMetrics.size(of: item.symbol, base: item.size ?? FloorMetrics.symbol)))
                .symbolRenderingMode(.monochrome)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .text:
            words
                .lineLimit(1)
                .truncationMode(.tail)
                // A centred title is never cut short: the glass's text runs a hair wider than the page's box for it,
                // and it stays centred on that box.
                .fixedSize(horizontal: item.centred, vertical: false)
                .padding(.horizontal, item.pad)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: item.centred ? .center : .leading)
                .mask {
                    // Under its close button a name fades out, as a browser's tabs do.
                    GeometryReader { box in
                        let width = max(box.size.width, 1)
                        LinearGradient(stops: item.fade
                                           ? [.init(color: .black, location: max(0, (width - 34) / width)),
                                              .init(color: .clear, location: max(0, (width - 22) / width))]
                                           : [.init(color: .black, location: 0), .init(color: .black, location: 1)],
                                       startPoint: .leading, endPoint: .trailing)
                    }
                }
        case .avatar:
            Text(item.text ?? "")
                .font(.system(size: 11, weight: .semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Circle().fill(.white.opacity(0.14)))
        }
    }

    /// One line of words, or the title's parts in their tones: the home muted, the slash faint, the session full.
    private var words: Text {
        guard let parts = item.parts, !parts.isEmpty else {
            return Text(item.text ?? "").font(.system(size: 13, weight: item.strong ? .medium : .regular))
        }
        return parts.enumerated().reduce(Text("")) { line, entry in
            let (index, part) = entry
            let tone: CGFloat = part.tone == "faint" ? 0.56 : part.tone == "muted" ? 0.78 : 1
            let weight: Font.Weight = part.weight >= 600 ? .semibold : part.weight >= 500 ? .medium : .regular
            let piece = Text((index > 0 ? "\u{2002}" : "") + part.text)
                .font(.system(size: 13, weight: weight))
                .foregroundStyle(lit ? AnyShapeStyle(.white) : AnyShapeStyle(HierarchicalShapeStyle.primary.opacity(tone)))
            return Text("\(line)\(piece)")
        }
    }
}

/// Where you are: a piece of the card's own black set into the glass, lit along its top, its shadow soft beneath it.
@available(macOS 26.0, *)
private struct CardChip: View {
    let color: Color
    let radius: CGFloat
    @Environment(\.appearsActive) private var active
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(color)
            .overlay {
                shape.strokeBorder(LinearGradient(colors: [.white.opacity(active ? 0.16 : 0.07), .white.opacity(0)],
                                                  startPoint: .top, endPoint: .center), lineWidth: 0.5)
            }
            .overlay {
                // With Increase Contrast, Apple's glass turns black or white with a border: the chip keeps its edge.
                if contrast == .increased { shape.strokeBorder(.white.opacity(0.6), lineWidth: 1) }
            }
            .shadow(color: .black.opacity(0.32), radius: 0.75, y: 0.5)
            .shadow(color: .black.opacity(active ? 0.22 : 0.1), radius: 5, y: 2.5)
    }
}

@MainActor
enum FloorMetrics {
    /// Every symbol in the frame starts at one size; the widest are drawn smaller (`size(of:base:)`).
    static let symbol: CGFloat = 15
    /// The frame's ink at rest, the page's old muted tier; full ink when lit.
    static let resting: Double = 0.78
    /// No symbol wider than this, so a wide one (the bubble pair, the books) doesn't crowd its chip or outweigh its
    /// neighbours.
    static let widest: CGFloat = 17
    private static var sizes: [String: CGFloat] = [:]

    /// The point size that keeps `symbol` within `widest` when drawn at `base`.
    static func size(of symbol: String?, base: CGFloat) -> CGFloat {
        guard let symbol else { return base }
        let key = "\(symbol)@\(base)"
        if let known = sizes[key] { return known }
        let width = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: base, weight: .regular))?.size.width ?? 0
        let size = width > widest ? (base * widest / width).rounded(.down) : base
        sizes[key] = size
        return size
    }
    /// The house's slide: where you are moves on it (response 0.38, damping 0.8).
    static let slide = Animation.spring(response: 0.38, dampingFraction: 0.8)
}
