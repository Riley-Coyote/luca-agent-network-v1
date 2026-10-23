import AppKit
import WebKit

// Polyphonic's glass. The rail's selection is a piece of Apple's glass that comes out of the conversation card's edge
// and goes back into it, drawn natively behind the page. The card keeps its own near-black surface, painted by the page
// above the glass, so the selection slides out from under its edge (Riley, 2026-10-23: the glass card read as a bright
// grey slab with a thick rim). The card can be Apple's glass too (`cardGlass`), and then the selection pours out of it
// on a neck. The page is transparent where the glass shows and keeps every word above it: under
// a thin capsule of Apple's glass, words smear. The page says where (the card, the chosen row, the rail's visible
// area); this side says how, on the house springs. The motion is the Liquid Glass Workbench's rail study (creative-mind
// skills/liquid-glass/workbench/Sources/RailStudy.swift, its spec in that file's header); the plan is
// docs/luca/native-rail-glass/PLAN.md. Engine/ holds copies of the liquid-glass skill's Swift engines.
//
// The page talks to it through one WebKit message handler, `polyphonicGlass`:
//   {type: "frame", card: {x, y, w, h, r} | null, floor: "#000000", row: {id, x, y, w, h} | null, clip: {x, y, w, h}}
//       whenever anything moves: the card's place and corners, the floor's colour, the chosen row and the rail area it
//       shows in. A new row id is a choice; the same id moved is the same selection following its row (a scroll, a
//       resize); no row means the selection melts home.
//       The shell study (docs/luca/rail-system/SHELL_STUDY.md) adds, all optional:
//       places: {id, x, y, w, h} | null    the disc under the chosen place in the icon rail, sliding place to place
//       tab: {id, x, y, w, h} | null       the capsule under the open tab in the top lip, sliding tab to tab
//       sheet: {x, y, w, h, r, style} | null   one sheet of Apple's glass for the whole frame, clear or regular
//       floor: "none"                      no floor at all: the window is clear, so the sheet shows the desktop
//       Each mark has its own glass, so it never joins the rail's selection or the other mark.
//   {type: "settings", material, motion, floor, cardGlass, slow}
//                                                       clear|smoked|dark · pour|drop|slide · plain|grain · the card as
//                                                       glass (true) or the page's own surface (false, the default)
//   {type: "off"}                                       the page draws its own floor and card again (Reduce
//                                                       Transparency, or the rail gone): every piece and the floor go
//   {type: "log", on}                                   films and checks: every frame's geometry
// Coordinates are the page's CSS pixels from the web view's top-left, which are points (the app pins WebKit's zoom).
// It announces itself to the page as `window.__POLYPHONIC_NATIVE_GLASS__` and a `polyphonic-native-glass` event.

@available(macOS 26.0, *)
@MainActor
final class PolyphonicGlass: NSObject, WKScriptMessageHandler {
    /// One per web view, kept alive by the web view's own content controller.
    private static let handlerName = "polyphonicGlass"

    private weak var webView: WKWebView?
    private let host = GlassHostView()
    private var stage: LiquidStageView { host.stage }
    /// The card's distance from each edge of the page, so a window resize moves the glass in the same layout pass as
    /// the page instead of waiting for the page's next report.
    private var cardInsets: NSEdgeInsets?
    private var cardRadius: CGFloat = 18
    /// The frame's sheet of glass, kept by its insets for the same reason as the card's.
    private var sheetInsets: NSEdgeInsets?
    private var sheetRadius: CGFloat = 16
    private lazy var placesMark = GlassMark(stage: host.places)
    private lazy var tabMark = GlassMark(stage: host.tabs)
    /// Whether the card is Apple's glass too, or (the default) the page's own surface with the glass beneath its edge.
    private var cardGlass = false
    private var mode = "pour"
    /// The chosen row's id, the piece of glass that belongs to it, and where the row is now.
    private var chosen: String?
    private var current: String?
    private var row: CGRect = .zero
    /// The piece still welling out of the card's edge, before it flows to its row.
    private var welling: String?
    /// Whether a selection has been shown since the page appeared: the first one is simply there.
    private var shown = false
    /// Pieces melting home, taken away once they're wholly inside the card.
    private var going: Set<String> = []
    private var serial = 0
    private var pullSerial = 0
    private var slow = false
    private var log: [[String: Any]]?
    /// When the page saw what the glass last drew (its wall clock, ms), for the lag check.
    private var pageTime: Double?

    /// Puts the glass behind `webView` and starts listening to its page. False when it can't (no superview).
    @discardableResult
    static func attach(to webView: WKWebView) -> Bool {
        guard let parent = webView.superview else { return false }
        let glass = PolyphonicGlass()
        glass.webView = webView
        glass.host.frame = webView.frame
        glass.host.autoresizingMask = [.width, .height]
        glass.host.onLayout = { [weak glass] in
            glass?.placeCard()
            glass?.placeSheet()
        }
        // Directly beneath the page: above any window vibrancy, below every word.
        parent.addSubview(glass.host, positioned: .below, relativeTo: webView)
        for stage in glass.host.stages { stage.material = .clear }
        glass.stage.onFrame = { [weak glass] _ in glass?.frameDrawn() }
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: handlerName)
        controller.add(glass, name: handlerName)
        let announce = "window.__POLYPHONIC_NATIVE_GLASS__ = 1;"
        controller.addUserScript(WKUserScript(source: announce, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(announce + " window.dispatchEvent(new Event('polyphonic-native-glass'));")
        return true
    }

    // MARK: the page

    /// `POLYPHONIC_GLASS_DEBUG=1` prints what the page reports and what the glass does with it.
    private let debug = ProcessInfo.processInfo.environment["POLYPHONIC_GLASS_DEBUG"] == "1"

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if debug { print("polyphonic-glass: received \(type(of: message.body)): \(message.body)") }
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "frame":
            pageTime = body["t"] as? Double
            sheet(body)
            placesMark.show(Self.id(body["places"]), at: Self.rect(body["places"]))
            tabMark.show(Self.id(body["tab"]), at: Self.rect(body["tab"]))
            layout(body)
            select(body)
        case "settings": settings(body)
        case "off": standDown()
        case "log": record(body["on"] as? Bool ?? false)
        case "dump" where debug: dump(host, depth: 0)
        default: break
        }
    }

    private func layout(_ body: [String: Any]) {
        let floor = body["floor"] as? String
        if let floor, floor != "none" { host.floor.color = NSColor(hex: floor) ?? .black }
        // From the page's first report on, the floor is the window's: the page has stopped painting its own. "none"
        // leaves the window clear, for a sheet of glass over the desktop.
        host.floor.isHidden = floor == "none"
        guard let card = Self.rect(body["card"]), card.width > 1, card.height > 1 else {
            // No card on this page: the glass goes, the floor stays.
            removePieces()
            return
        }
        let page = host.bounds
        cardInsets = NSEdgeInsets(top: card.minY, left: card.minX, bottom: page.height - card.maxY, right: page.width - card.maxX)
        if let radius = (body["card"] as? [String: Any])?["r"] as? Double { cardRadius = CGFloat(radius) }
        placeCard()
    }

    /// The card, from its insets and the page's size: at once, never on a spring. Drawn only when the card is glass;
    /// otherwise its place is only where the selection comes from and goes back to, under the page's own card.
    private func placeCard() {
        guard let rect = cardRect else { return }
        guard cardGlass else {
            if stage.drop("card") != nil { stage.remove("card") }
            return
        }
        if debug { print("polyphonic-glass: card \(rect) in \(host.bounds), pieces \(stage.drops.map(\.id))") }
        if let card = stage.drop("card") {
            card.radius = cardRadius
            stage.place("card", at: rect)
        } else {
            stage.add(LiquidStageView.Drop(id: "card", rect: rect, radius: cardRadius))
        }
    }

    private var cardRect: CGRect? { cardInsets.map(inside) }

    private func inside(_ insets: NSEdgeInsets) -> CGRect {
        let page = host.bounds
        return CGRect(x: insets.left, y: insets.top, width: max(0, page.width - insets.left - insets.right),
                      height: max(0, page.height - insets.top - insets.bottom))
    }

    /// The frame as one sheet of Apple's glass, or none. A mode, not a motion: it is simply there or not.
    private func sheet(_ body: [String: Any]) {
        guard let rect = Self.rect(body["sheet"]), rect.width > 1, rect.height > 1, let box = body["sheet"] as? [String: Any] else {
            sheetInsets = nil
            placeSheet()
            return
        }
        let page = host.bounds
        sheetInsets = NSEdgeInsets(top: rect.minY, left: rect.minX, bottom: page.height - rect.maxY, right: page.width - rect.maxX)
        if let radius = box["r"] as? Double { sheetRadius = CGFloat(radius) }
        let style: NSGlassEffectView.Style = box["style"] as? String == "regular" ? .regular : .clear
        if host.sheet.style != style { host.sheet.style = style }
        placeSheet()
    }

    private func placeSheet() {
        guard let insets = sheetInsets else {
            host.sheet.isHidden = true
            return
        }
        let rect = inside(insets)
        if host.sheet.frame != rect { host.sheet.frame = rect }
        if host.sheet.cornerRadius != sheetRadius { host.sheet.cornerRadius = sheetRadius }
        host.sheet.isHidden = false
    }

    private func select(_ body: [String: Any]) {
        guard cardRect != nil else { return }
        guard let id = (body["row"] as? [String: Any])?["id"] as? String, var row = Self.rect(body["row"]) else {
            if chosen != nil { clear() }
            return
        }
        // Where its rail scrolls under an edge, the glass is pressed flat against that edge (the skill's room's
        // edges): it can't be clipped or faded, only shaped.
        if let clip = Self.rect(body["clip"]) {
            let visible = row.intersection(clip)
            row = visible.isNull ? CGRect(x: row.minX, y: row.midY < clip.midY ? clip.minY : clip.maxY, width: row.width, height: 0) : visible
        }
        self.row = row
        if id == chosen {
            follow(row)
        } else {
            choose(id, row)
        }
    }

    private func removePieces() {
        cardInsets = nil
        for drop in stage.drops { stage.remove(drop.id) }
        chosen = nil
        current = nil
        welling = nil
        going = []
        shown = false
    }

    /// The page paints its own floor and card again: nothing native shows until it reports once more.
    private func standDown() {
        removePieces()
        stage.pulling = false
        host.floor.isHidden = true
        placesMark.show(nil, at: nil)
        tabMark.show(nil, at: nil)
        sheetInsets = nil
        placeSheet()
    }

    private func clear() {
        chosen = nil
        current = nil
        welling = nil
        for drop in stage.drops where drop.id != "card" && !going.contains(drop.id) { home(drop) }
    }

    private func settings(_ body: [String: Any]) {
        if let material = (body["material"] as? String).flatMap(LiquidMaterial.init(rawValue:)), material != .black {
            for stage in host.stages { stage.material = material }
        }
        if let motion = body["motion"] as? String, ["pour", "drop", "slide"].contains(motion), motion != mode {
            mode = motion
            // A new motion carries its pieces differently (Pour by the end at the card, the others by the middle):
            // the selection is set down again, at rest, in its row.
            if let current, let drop = stage.drop(current) {
                let rect = drop.body.goal
                stage.remove(current)
                let fresh = newSelection(rect)
                stage.add(fresh)
                self.current = fresh.id
            }
        }
        if let floor = body["floor"] as? String { host.floor.grain = floor == "grain" }
        if let glass = body["cardGlass"] as? Bool, glass != cardGlass {
            cardGlass = glass
            placeCard()
        }
        if let slow = body["slow"] as? Bool {
            self.slow = slow
            for stage in host.stages { stage.slowMotion = slow ? 8 : 1 }
        }
    }

    // MARK: choosing

    private var anchor: CGPoint { mode == "pour" ? CGPoint(x: 1, y: 0.5) : CGPoint(x: 0.5, y: 0.5) }

    private func newSelection(_ rect: CGRect) -> LiquidStageView.Drop {
        serial += 1
        let drop = LiquidStageView.Drop(id: "sel-\(serial)", rect: rect, anchor: anchor)
        drop.stretches = mode != "pour"
        return drop
    }

    private func choose(_ id: String, _ row: CGRect) {
        chosen = id
        guard let card = cardRect else { return }
        if !shown {
            // The first selection after the page appears is simply there.
            shown = true
            let drop = newSelection(row)
            stage.add(drop)
            current = drop.id
            return
        }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            // With Reduce Motion the selection is simply in its row, and the old one simply gone.
            for drop in stage.drops where drop.id != "card" { stage.remove(drop.id) }
            going = []
            welling = nil
            let drop = newSelection(row)
            stage.add(drop)
            current = drop.id
            return
        }
        if mode == "slide", let current, welling == nil, stage.drop(current) != nil {
            stage.aim(current, to: row, motion: GlassMotion.slide)
            return
        }
        for drop in stage.drops where drop.id != "card" && !going.contains(drop.id) { home(drop) }
        pour(into: row, from: card)
    }

    /// The card's edge wells at the row; a bead of it comes out, still joined, then flows to the row.
    private func pour(into row: CGRect, from card: CGRect) {
        let drop = newSelection(bead(at: row.midY, in: card))
        stage.add(drop)
        current = drop.id
        let spill = mode == "pour"
        pull(for: spill ? 0.5 : 0.2)
        let well = CGRect(x: card.minX - GlassMotion.well, y: row.midY - GlassMotion.wellSize / 2,
                          width: GlassMotion.wellSize, height: GlassMotion.wellSize)
        stage.aim(drop.id, to: well, motion: .swell)
        let id = drop.id
        welling = id
        after(spill ? 0.12 : 0.14) { [weak self] in
            guard let self, self.welling == id else { return }
            self.welling = nil
            // Wherever the row is by now: it may have moved while the bead was welling.
            self.stage.aim(id, to: self.row, motion: spill ? GlassMotion.spill : .pour)
        }
    }

    /// The same selection, its row moved: at once when it's at rest, on its own spring when it's still pouring, and
    /// not at all while it's still welling out of the card (it flows to wherever the row is when it leaves).
    private func follow(_ row: CGRect) {
        guard let current, current != welling, let drop = stage.drop(current), !going.contains(current) else { return }
        if drop.body.resting {
            stage.place(current, at: row)
        } else {
            stage.aim(current, to: row)
        }
    }

    /// Back into the card at its own height, on a neck, and gone once it's wholly inside.
    private func home(_ drop: LiquidStageView.Drop) {
        guard let card = cardRect else { stage.remove(drop.id); return }
        going.insert(drop.id)
        if current == drop.id { current = nil }
        if welling == drop.id { welling = nil }
        pull(for: 0.5)
        stage.aim(drop.id, to: bead(at: drop.body.rect.midY, in: card), motion: mode == "pour" ? GlassMotion.drain : .home)
    }

    private func bead(at y: CGFloat, in card: CGRect) -> CGRect {
        CGRect(x: card.minX + 6, y: y - GlassMotion.bead / 2, width: GlassMotion.bead, height: GlassMotion.bead)
    }

    /// The glass reaches furthest while the card pours a piece out or takes one back, so the neck shows.
    private func pull(for seconds: Double) {
        pullSerial += 1
        let mine = pullSerial
        stage.pulling = true
        after(seconds) { [weak self] in
            guard let self, self.pullSerial == mine else { return }
            self.stage.pulling = false
        }
    }

    /// Later, on the main actor. Each step checks it is still wanted when it runs (a newer pour or pull supersedes it),
    /// so none needs keeping or cancelling.
    private func after(_ seconds: Double, _ work: @escaping @MainActor () -> Void) {
        let scaled = seconds * (slow ? 8 : 1)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(scaled))
            work()
        }
    }

    private func frameDrawn() {
        if !going.isEmpty, let card = cardRect?.insetBy(dx: 1, dy: 1) {
            for id in Array(going) {
                guard let drop = stage.drop(id) else { going.remove(id); continue }
                if drop.body.resting, card.contains(drop.body.rect) {
                    stage.remove(id)
                    going.remove(id)
                }
            }
        }
        if log != nil {
            let pieces = stage.drops.filter { $0.id != "card" }.map { drop -> [String: Any] in
                let r = drop.body.rect
                return ["id": drop.id, "x": r.minX, "y": r.minY, "w": r.width, "h": r.height, "going": going.contains(drop.id)]
            }
            log?.append(["t": CACurrentMediaTime(), "wall": Date().timeIntervalSince1970 * 1000, "reach": stage.joinReach,
                         "page": pageTime ?? 0, "pieces": pieces])
        }
    }

    private func dump(_ view: NSView, depth: Int) {
        print(String(repeating: "  ", count: depth) + "\(type(of: view)) \(view.frame) hidden=\(view.isHidden) layer=\(view.layer != nil)")
        for child in view.subviews { dump(child, depth: depth + 1) }
    }

    private func record(_ on: Bool) {
        if on {
            log = []
            return
        }
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("polyphonic-glass-frames.json")
        if let log, let data = try? JSONSerialization.data(withJSONObject: ["slow": slow, "frames": log]) {
            try? data.write(to: url)
        }
        log = nil
    }

    private static func id(_ value: Any?) -> String? { (value as? [String: Any])?["id"] as? String }

    private static func rect(_ value: Any?) -> CGRect? {
        guard let box = value as? [String: Any], let x = box["x"] as? Double, let y = box["y"] as? Double,
              let w = box["w"] as? Double, let h = box["h"] as? Double, [x, y, w, h].allSatisfy(\.isFinite) else { return nil }
        return CGRect(x: x, y: y, width: max(0, w), height: max(0, h))
    }
}

/// The rail's motions, from the house's springs (the liquid-glass skill's references/motion.md).
private enum GlassMotion {
    /// Pour: the selection flows out along its row, its near end leaving the card's edge quickly and its far end
    /// spreading more slowly to the row's start, so it pours rather than snaps.
    static let spill = LiquidMotion(response: 0.36, damping: 0.86, sizing: .init(response: 0.5, damping: 0.84))
    /// Pour, going home: it closes toward its near end while that end runs back into the card.
    static let drain = LiquidMotion(response: 0.42, damping: 0.95, sizing: .init(response: 0.36, damping: 0.95))
    /// Slide: row to row along the rail.
    static let slide = LiquidMotion(response: 0.38, damping: 0.8)
    /// A bead of the card: the size a selection is born at inside the card, and closes to on its way home.
    static let bead: CGFloat = 22
    /// How far a bead bulges out of the card's edge as it wells, and its size then.
    static let well: CGFloat = 18
    static let wellSize: CGFloat = 26
}

/// A mark that slides from one place to the next: the chosen place's disc, the open tab's capsule. Each has its own
/// stage, so its own container: it never joins the rail's selection or the other mark.
@available(macOS 26.0, *)
@MainActor
private final class GlassMark {
    private let stage: LiquidStageView
    private var chosen: String?
    private var current: String?
    private var serial = 0
    /// Whether it has been shown since the page appeared: the first time it is simply there, later it wells up.
    private var appeared = false
    /// Pieces closing away, taken off once they are nothing.
    private var going: Set<String> = []

    init(stage: LiquidStageView) {
        self.stage = stage
        stage.onFrame = { [weak self] _ in self?.frameDrawn() }
    }

    /// The page's report: where the mark is now, or nil when there is none.
    func show(_ id: String?, at rect: CGRect?) {
        guard let id, let rect, rect.width >= 1, rect.height >= 1 else {
            leave()
            return
        }
        if let current, let drop = stage.drop(current) {
            if id == chosen {
                // The same mark moved (a resize, the rail opening beside it): at once at rest, on its spring while
                // it still travels.
                if drop.body.resting { stage.place(current, at: rect) } else { stage.aim(current, to: rect) }
            } else {
                chosen = id
                stage.aim(current, to: rect, motion: GlassMotion.slide)
            }
            return
        }
        chosen = id
        serial += 1
        let drop = LiquidStageView.Drop(id: "mark-\(serial)", rect: appeared ? Self.point(in: rect) : rect)
        drop.stretches = true
        stage.add(drop)
        current = drop.id
        if appeared { stage.aim(drop.id, to: rect, motion: .swell) }
        appeared = true
    }

    /// Gone by its shape, never a fade: it closes to a point at its middle.
    private func leave() {
        chosen = nil
        guard let current, let drop = stage.drop(current) else {
            self.current = nil
            return
        }
        self.current = nil
        going.insert(drop.id)
        stage.aim(drop.id, to: Self.point(in: drop.body.goal), motion: .drain)
    }

    private func frameDrawn() {
        for id in Array(going) {
            guard let drop = stage.drop(id) else {
                going.remove(id)
                continue
            }
            if drop.body.resting {
                stage.remove(id)
                going.remove(id)
            }
        }
    }

    private static func point(in rect: CGRect) -> CGRect { CGRect(x: rect.midX, y: rect.midY, width: 0, height: 0) }
}

/// The floor and the glass, beneath the page.
@available(macOS 26.0, *)
@MainActor
final class GlassHostView: NSView {
    let floor = GlassFloorView()
    /// The frame as one sheet of glass (the shell study's glass frame), hidden unless the page asks for it.
    let sheet = NSGlassEffectView()
    let stage = LiquidStageView()
    let places = LiquidStageView()
    let tabs = LiquidStageView()
    var stages: [LiquidStageView] { [stage, places, tabs] }
    var onLayout: (() -> Void)?

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        // Nothing native shows until the page reports a card: a first run's floating card keeps its transparent
        // window, and a page without the rail keeps its own floor.
        floor.isHidden = true
        addSubview(floor)
        sheet.isHidden = true
        sheet.style = .clear
        sheet.tintColor = nil
        addSubview(sheet)
        for stage in stages { addSubview(stage) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        floor.frame = bounds
        for stage in stages { stage.frame = bounds }
        onLayout?()
    }

    /// The page takes every click and key; nothing here is touched.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The window's floor under the glass: the theme's floor colour, plain or with a fine grain for the glass to bend.
@MainActor
final class GlassFloorView: NSView {
    var color: NSColor = .black { didSet { paint() } }
    var grain = false { didSet { paint() } }
    private let texture = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        paint()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        texture.frame = bounds
    }

    private func paint() {
        layer?.backgroundColor = color.cgColor
        if texture.superlayer == nil {
            texture.actions = ["bounds": NSNull(), "position": NSNull(), "hidden": NSNull()]
            layer?.addSublayer(texture)
        }
        texture.isHidden = !grain
        if grain, texture.backgroundColor == nil, let tile = Self.grainTile {
            texture.backgroundColor = NSColor(patternImage: tile).cgColor
        }
    }

    /// 256 points of even, fine white noise at a few percent: a grain, not a gradient.
    private static let grainTile: NSImage? = {
        let size = 256
        var pixels = [UInt8](repeating: 0, count: size * size * 4)
        var seed: UInt32 = 0x9E37_79B9
        for index in stride(from: 0, to: pixels.count, by: 4) {
            seed ^= seed << 13
            seed ^= seed >> 17
            seed ^= seed << 5
            let alpha = UInt8(Double(seed % 256) / 255 * 0.07 * 255)
            pixels[index] = alpha
            pixels[index + 1] = alpha
            pixels[index + 2] = alpha
            pixels[index + 3] = alpha
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let image = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return nil }
        return NSImage(cgImage: image, size: NSSize(width: size / 2, height: size / 2))
    }()
}

extension NSColor {
    /// `#rrggbb`, as the page writes its floor colour.
    convenience init?(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                  blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}

/// For the app's Rust side: puts the glass behind the window's web view. Returns false before macOS 26, or without a
/// web view. `window` is the NSWindow, `webView` the WKWebView, both unretained.
@_cdecl("polyphonic_glass_attach")
public func polyphonicGlassAttach(_ window: UnsafeMutableRawPointer?, _ webView: UnsafeMutableRawPointer?) -> Bool {
    guard let webView, Thread.isMainThread else { return false }
    // An address crosses into the main actor; the pointer itself can't be sent.
    let address = UInt(bitPattern: webView)
    return MainActor.assumeIsolated {
        guard #available(macOS 26.0, *), let pointer = UnsafeMutableRawPointer(bitPattern: address),
              let view = Unmanaged<AnyObject>.fromOpaque(pointer).takeUnretainedValue() as? WKWebView else { return false }
        return PolyphonicGlass.attach(to: view)
    }
}
