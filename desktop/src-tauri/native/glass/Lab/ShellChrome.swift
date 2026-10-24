import AppKit
import SwiftUI
import WebKit

// The shell study's glass above the page (docs/luca/rail-system/SHELL_STUDY.md, "Glass above"): a few small pieces of
// Apple's Liquid Glass floating over the conversation, in one container, their symbols and words inside the glass,
// where Apple puts a Mac app's chrome. The page lays everything else out and says where the pieces go and what they
// hold; a press here goes back to the page, which acts on it as if its own button had been clicked. Lab only for now:
// the app's build (build.rs) compiles PolyphonicGlass.swift and Engine/, not this.
//
// The page talks to it through one WebKit message handler, `shellChrome`:
//   {type: "chrome", on: false}                    no pieces (another frame, or the study gone)
//   {type: "chrome", on: true, variant, h, r, card, modal, lead, tabs, places}
//       variant      "regular" | "clear"           Apple's two types of glass, every piece the same
//       h, r                                       the top pieces' height and corner radius
//       card         "#rrggbb"                     the card's surface: where you are is a chip of it
//       modal        Bool                          something modal is open: the pieces take no presses and their ink
//                                                  goes faint (the page's own scrim, beneath the glass, darkens it)
//       lead         {x, y, items}                 the rail's toggle, back and forward
//       tabs         {x, y, maxW, items} | null    the open conversations
//       places       {x, y, w, h, r, items}        the places pane, full height, its corners concentric with the window's
//     items: {id, kind, symbol?, label, title?, selected?, disabled?}: label is what VoiceOver says, title (when there
//       is one) what a tab shows and a tooltip says. kind one of
//       "button" (a symbol), "place" (a symbol that can be where you are), "tab" (a title, closable), "avatar" (an
//       initial in a circle), "gap" (a little space), "flex" (the rest of the pane's height)
// Back to the page: window.dispatchEvent(new CustomEvent("polyphonic-chrome", {detail: {action: id}})), and for a
// tab's close button {action: "close:" + the tab's id without "tab:"}. And the window itself, whenever it changes:
// "polyphonic-window" with {radius, key}: the window's corner radius (read from AppKit on macOS 27, where every window
// is 16) and whether it's the one in use.
// Coordinates are the page's CSS pixels from the web view's top-left, which are points. The host ignores the title
// bar's safe area, so they are its own too.

@available(macOS 26.0, *)
@MainActor
final class ShellChrome: NSObject, WKScriptMessageHandler {
    private static let handlerName = "shellChrome"

    private weak var webView: WKWebView?
    private let model: ChromeModel
    private let host: ChromeHostingView
    private var radiusProbe: NSView?
    private var windowRadius: CGFloat = 16
    private var observers: [NSObjectProtocol] = []

    private init(webView: WKWebView) {
        self.webView = webView
        let model = ChromeModel()
        self.model = model
        host = ChromeHostingView(rootView: ChromeRoot(model: model, act: { _ in }))
        super.init()
        host.rootView = ChromeRoot(model: model, act: { [weak self] action in self?.act(action) })
        host.model = model
    }

    /// Puts the pieces above `webView` and starts listening to its page. Nil without a superview.
    static func attach(above webView: WKWebView) -> ShellChrome? {
        guard let parent = webView.superview else { return nil }
        let chrome = ShellChrome(webView: webView)
        chrome.host.frame = webView.frame
        chrome.host.autoresizingMask = [.width, .height]
        chrome.host.sizingOptions = []
        // A full-size window gives the host a safe area under its title bar; the page's points start at the top.
        chrome.host.safeAreaRegions = []
        parent.addSubview(chrome.host, positioned: .above, relativeTo: webView)
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: handlerName)
        controller.add(chrome, name: handlerName)
        chrome.watchWindow()
        return chrome
    }

    // MARK: the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        // A page that has just loaded asks where it is.
        if body["type"] as? String == "window" { tellWindow(); return }
        guard body["type"] as? String == "chrome" else { return }
        let on = body["on"] as? Bool ?? false
        guard on else {
            if model.on { withAnimation(.smooth(duration: 0.35)) { model.on = false } }
            return
        }
        let appearing = !model.on
        let lead = body["lead"] as? [String: Any]
        let tabs = (body["tabs"] as? [String: Any]).map { box in
            ChromeModel.Tabs(origin: Self.point(box), maxWidth: Self.number(box["maxW"]) ?? 600, items: Self.items(box["items"]))
        }
        let places = (body["places"] as? [String: Any]).map { box in
            ChromeModel.Places(frame: CGRect(origin: Self.point(box), size: CGSize(width: Self.number(box["w"]) ?? 40,
                                                                                   height: Self.number(box["h"]) ?? 400)),
                               radius: Self.number(box["r"]) ?? 10, items: Self.items(box["items"]))
        }
        let update = { [model] in
            model.clear = body["variant"] as? String == "clear"
            model.height = Self.number(body["h"]) ?? 28
            model.radius = Self.number(body["r"]) ?? 10
            if let card = (body["card"] as? String).flatMap(NSColor.init(hex:)) { model.card = Color(nsColor: card) }
            model.modal = body["modal"] as? Bool ?? false
            if let lead {
                model.lead = Self.point(lead)
                model.leadItems = Self.items(lead["items"])
            }
            model.tabs = tabs
            model.places = places
            model.on = true
        }
        // Pieces come and go by the material (materialize), so a change that adds or takes one away is animated as one;
        // everything else is simply where the page says.
        if appearing || (model.tabs == nil) != (tabs == nil) || (model.places == nil) != (places == nil) {
            withAnimation(.smooth(duration: 0.35), update)
        } else {
            update()
        }
    }

    /// A new page is loading: until it reports, there are no pieces to draw or press.
    func reset() {
        model.on = false
        model.pieces = [:]
    }

    private func act(_ action: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["action": action]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('polyphonic-chrome', {detail: \(json)}));")
    }

    // MARK: the window

    private func watchWindow() {
        guard let window = webView?.window else { return }
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.tellWindow() }
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

    private static func point(_ box: [String: Any]) -> CGPoint {
        CGPoint(x: number(box["x"]) ?? 0, y: number(box["y"]) ?? 0)
    }

    private static func items(_ value: Any?) -> [ChromeItem] {
        guard let list = value as? [[String: Any]] else { return [] }
        return list.compactMap { box in
            guard let id = box["id"] as? String, let kind = (box["kind"] as? String).flatMap(ChromeItem.Kind.init) else {
                return nil
            }
            return ChromeItem(id: id, kind: kind, symbol: box["symbol"] as? String, label: box["label"] as? String ?? "",
                              title: box["title"] as? String, selected: box["selected"] as? Bool ?? false,
                              disabled: box["disabled"] as? Bool ?? false)
        }
    }
}

// MARK: - what the pieces hold

struct ChromeItem: Identifiable, Equatable {
    enum Kind: String { case button, place, tab, avatar, gap, flex }
    let id: String
    let kind: Kind
    let symbol: String?
    let label: String
    let title: String?
    let selected: Bool
    let disabled: Bool
}

@available(macOS 26.0, *)
@MainActor
@Observable
final class ChromeModel {
    struct Tabs: Equatable {
        var origin: CGPoint
        var maxWidth: CGFloat
        var items: [ChromeItem]
    }

    struct Places: Equatable {
        var frame: CGRect
        var radius: CGFloat
        var items: [ChromeItem]
    }

    var on = false
    var clear = false
    var height: CGFloat = 28
    var radius: CGFloat = 10
    var card = Color(red: 0.07, green: 0.07, blue: 0.07)
    var modal = false
    var lead: CGPoint = .zero
    var leadItems: [ChromeItem] = []
    var tabs: Tabs?
    var places: Places?
    /// Where each piece is now, in the page's coordinates: only there does a click land on the glass.
    var pieces: [String: CGRect] = [:]

    func hits(_ point: CGPoint) -> Bool {
        on && !modal && pieces.values.contains { $0.contains(point) }
    }
}

// MARK: - the host

/// Above the page, clear, and only in the way where a piece is.
@available(macOS 26.0, *)
final class ChromeHostingView: NSHostingView<ChromeRoot> {
    weak var model: ChromeModel?

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let top = isFlipped ? local : NSPoint(x: local.x, y: bounds.height - local.y)
        guard MainActor.assumeIsolated({ model?.hits(top) ?? false }) else { return nil }
        return super.hitTest(point)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
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

// MARK: - the pieces

@available(macOS 26.0, *)
struct ChromeRoot: View {
    let model: ChromeModel
    let act: (String) -> Void
    @Namespace private var marks

    var body: some View {
        GlassEffectContainer(spacing: 4) {
            ZStack(alignment: .topLeading) {
                Color.clear
                if model.on {
                    LeadPiece(model: model, act: act)
                        .placed(at: model.lead, as: "lead", in: model)
                    if let tabs = model.tabs {
                        TabsPiece(model: model, tabs: tabs, marks: marks, act: act)
                            .frame(maxWidth: tabs.maxWidth, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .placed(at: tabs.origin, as: "tabs", in: model)
                    }
                    if let places = model.places {
                        PlacesPiece(model: model, places: places, marks: marks, act: act)
                            .frame(width: places.frame.width, height: places.frame.height)
                            .placed(at: places.frame.origin, as: "places", in: model)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .coordinateSpace(.named(ChromeRoot.space))
        .environment(\.colorScheme, .dark)
        // Glass is never faded: while something modal is open the pieces only stop taking presses and their ink goes
        // faint, and the page's scrim beneath them darkens what the glass shows.
        .disabled(model.modal)
        .allowsHitTesting(!model.modal)
    }

    nonisolated static let space = "chrome"
}

@available(macOS 26.0, *)
private extension View {
    /// At a point in the page's coordinates, by layout (glass samples where a view is laid out, not where it's moved to),
    /// telling the host where it is so clicks land on it.
    func placed(at origin: CGPoint, as id: String, in model: ChromeModel) -> some View {
        fixedSize()
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(ChromeRoot.space)) } action: { frame in
                model.pieces[id] = frame
            }
            .onDisappear { model.pieces[id] = nil }
            .padding(.leading, origin.x)
            .padding(.top, origin.y)
    }

    /// Apple's glass in a squircle. Interactive only where the whole piece is something you press: a full-height pane
    /// answers with its own items, not as one slab.
    func piece(_ model: ChromeModel, radius: CGFloat, interactive: Bool = true) -> some View {
        glassEffect((model.clear ? Glass.clear : Glass.regular).interactive(interactive),
                    in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .glassEffectTransition(.materialize)
    }
}

/// The rail's toggle, a little space, then back and forward: one piece.
@available(macOS 26.0, *)
private struct LeadPiece: View {
    let model: ChromeModel
    let act: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(model.leadItems.enumerated()), id: \.element.id) { index, item in
                if index == 1 { Color.clear.frame(width: ChromeMetrics.leadGap, height: 1) }
                SymbolButton(item: item, card: model.card, size: ChromeMetrics.symbol, width: ChromeMetrics.leadButton,
                             height: model.height - ChromeMetrics.inset * 2, radius: model.radius - ChromeMetrics.inset, act: act)
            }
        }
        .padding(ChromeMetrics.inset)
        .frame(height: model.height)
        .piece(model, radius: model.radius)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Navigation")
    }
}

/// The open conversations: one piece, as wide as their names; the open one a chip of the card set into the glass.
@available(macOS 26.0, *)
private struct TabsPiece: View {
    let model: ChromeModel
    let tabs: ChromeModel.Tabs
    let marks: Namespace.ID
    let act: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs.items) { item in
                TabItem(item: item, model: model, marks: marks, act: act)
            }
        }
        .padding(ChromeMetrics.inset)
        .frame(maxWidth: tabs.maxWidth, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: model.radius, style: .continuous))
        .frame(height: model.height)
        .animation(reduceMotion ? nil : ChromeMetrics.slide, value: tabs.items.first(where: \.selected)?.id)
        .piece(model, radius: model.radius)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open conversations")
    }
}

@available(macOS 26.0, *)
private struct TabItem: View {
    let item: ChromeItem
    let model: ChromeModel
    let marks: Namespace.ID
    let act: (String) -> Void
    @State private var hover = false
    @Environment(\.appearsActive) private var active
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let height = model.height - ChromeMetrics.inset * 2
        // Concentric with the piece: 2 in from its corners.
        let radius = model.radius - ChromeMetrics.inset
        let name = item.title ?? item.label
        let close = { act("close:" + item.id.dropFirst("tab:".count)) }
        Button { act(item.id) } label: {
            // The open tab's name is medium; every tab keeps room for that, so choosing one never nudges the rest.
            ZStack {
                Text(name).font(.system(size: 13, weight: .medium)).hidden()
                Text(name).font(.system(size: 13, weight: item.selected ? .medium : .regular))
            }
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(!enabled ? HierarchicalShapeStyle.quaternary : item.selected || hover ? .primary : .secondary)
            .opacity(active ? 1 : 0.7)
            .padding(.horizontal, 12)
            .frame(minWidth: 64, maxWidth: 200, minHeight: height, maxHeight: height)
            .mask {
                // On hover the name fades out under the close button, as a browser's tabs do.
                LinearGradient(stops: hover ? [.init(color: .black, location: 0.62), .init(color: .clear, location: 0.82)]
                                   : [.init(color: .black, location: 1), .init(color: .black, location: 1)],
                               startPoint: .leading, endPoint: .trailing)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(name)
        .accessibilityLabel(name)
        .accessibilityAddTraits(item.selected ? [.isSelected] : [])
        .accessibilityAction(named: "Close", close)
        .overlay(alignment: .trailing) {
            if hover {
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .frame(width: 16, height: 16)
                        .frame(width: 20, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PlateStyle(radius: radius - 2))
                .help("Close \(name)")
                .accessibilityLabel("Close \(name)")
                .padding(.trailing, 4)
            }
        }
        .background {
            if item.selected {
                CardChip(color: model.card, radius: radius)
                    .matchedGeometryEffect(id: "tab", in: marks)
                    .transition(.scale(scale: 0.6, anchor: .bottom).combined(with: .opacity))
            } else if hover && enabled {
                Plate(radius: radius)
            }
        }
        .onHover { hover = $0 }
    }
}

/// The places: new and search, the five places, and at the foot Settings and the avatar.
@available(macOS 26.0, *)
private struct PlacesPiece: View {
    let model: ChromeModel
    let places: ChromeModel.Places
    let marks: Namespace.ID
    let act: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let side = ChromeMetrics.place
        VStack(spacing: 4) {
            ForEach(places.items) { item in
                switch item.kind {
                case .gap: Color.clear.frame(width: 1, height: 10)
                case .flex: Spacer(minLength: 10)
                case .avatar:
                    Text(item.title ?? "")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(.white.opacity(0.14)))
                        .padding(.top, 4)
                        .help(item.label)
                        .accessibilityLabel(item.label)
                default:
                    SymbolButton(item: item, card: model.card, size: ChromeMetrics.symbol, width: side, height: side,
                                 radius: ChromeMetrics.chip, marks: marks, act: act)
                }
            }
        }
        .padding(.top, 6)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(reduceMotion ? nil : ChromeMetrics.slide, value: places.items.first(where: \.selected)?.id)
        .piece(model, radius: places.radius, interactive: false)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Places")
    }
}

/// A symbol you press. A place can be where you are: then it stands on the card's chip.
@available(macOS 26.0, *)
private struct SymbolButton: View {
    let item: ChromeItem
    let card: Color
    let size: CGFloat
    let width: CGFloat
    let height: CGFloat
    let radius: CGFloat
    var marks: Namespace.ID?
    let act: (String) -> Void

    var body: some View {
        Button { act(item.id) } label: {
            Image(systemName: item.symbol ?? "questionmark")
                .font(.system(size: size))
                .symbolRenderingMode(.monochrome)
                .frame(width: width, height: height)
                .contentShape(Rectangle())
        }
        .buttonStyle(PlateStyle(radius: radius, selected: item.selected))
        .disabled(item.disabled)
        .help(item.title ?? item.label)
        .accessibilityLabel(item.label)
        .accessibilityAddTraits(item.selected ? [.isSelected] : [])
        .background {
            if item.selected, let marks {
                CardChip(color: card, radius: radius)
                    .matchedGeometryEffect(id: "place", in: marks)
            }
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

/// A faint plate under what the pointer is over.
@available(macOS 26.0, *)
private struct Plate: View {
    let radius: CGFloat
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.white.opacity(contrast == .increased ? 0.18 : 0.07))
    }
}

/// Ink that lifts on hover, a plate beneath it, a little give on a press; faint when it can't be pressed.
@available(macOS 26.0, *)
private struct PlateStyle: ButtonStyle {
    var radius: CGFloat
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        PlateBody(configuration: configuration, radius: radius, selected: selected)
    }
}

@available(macOS 26.0, *)
private struct PlateBody: View {
    let configuration: ButtonStyleConfiguration
    let radius: CGFloat
    let selected: Bool
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.appearsActive) private var active

    var body: some View {
        configuration.label
            .foregroundStyle(!enabled ? HierarchicalShapeStyle.quaternary : selected || hover ? .primary : .secondary)
            .background { if hover && enabled && !selected { Plate(radius: radius) } }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.snappy(duration: 0.16), value: configuration.isPressed)
            .opacity(active ? 1 : 0.7)
            .onHover { hover = $0 }
    }
}

/// The measures the page lays out around (ShellStudy.tsx keeps the same numbers).
enum ChromeMetrics {
    /// Items sit this far inside their piece.
    static let inset: CGFloat = 2
    /// The lead piece: buttons this wide, and this much space between the toggle and back.
    static let leadButton: CGFloat = 30
    static let leadGap: CGFloat = 4
    /// A place: this square.
    static let place: CGFloat = 28
    /// Every symbol in the chrome: one size, one grey at rest, full ink when lit.
    static let symbol: CGFloat = 15
    /// Where you are, and the plate under the pointer: this round, a squircle's, never a pill's.
    static let chip: CGFloat = 8
    /// The house's slide: where you are moves on it (response 0.38, damping 0.8).
    static let slide = Animation.spring(response: 0.38, dampingFraction: 0.8)
}
