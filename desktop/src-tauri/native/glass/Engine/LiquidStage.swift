import AppKit
import QuartzCore

// A stage for the liquid: Apple's real glass for the material, and our own black, veil and light drawn in front of
// it for everything Apple's glass can't do. This is the pattern Prompt Ghost's drop is built on, reduced to its parts:
//
//   1. One NSGlassEffectContainerView holds a bare NSGlassEffectView per piece. Its `spacing` is a spring: 5 at rest,
//      up to 18 with speed, at least 24 while a piece is pulled out of another. So pieces melt into one liquid with
//      necks while they move, and stand apart at rest. Only travel loosens the glass.
//   2. The glass is never tinted (macOS drops a tint whenever the window isn't the one in use) and never faded or
//      masked (container glass ignores alpha and masks; only `isHidden` works). Darkness is drawn instead.
//   3. In front of the glass, beneath the words: the ink (black bodies, and in Black everything) and the veil (Dark's
//      0.58, or the bright-page veil for Clear and Smoked), both traced every frame from one outline of every piece at
//      the glass's own reach, so the dark necks follow the glass necks. In front, because Apple's glass doesn't
//      reliably look again at what's behind it when only that changes.
//   4. Above that, the light from above on the black (LiquidLight.swift), then each piece's content. Words are never
//      inside glass.
//   5. One display link, every spring stepped 240 times a second, resting pieces snapped onto whole pixels.
//
// Put it in a borderless, clear, non-activating panel to float over the desktop, or in any window over content.
// Judge the glass only with the window in front: macOS relaxes Liquid Glass in windows that aren't key.
//
// Mac only (AppKit). On iOS, use LiquidMaterial, LiquidSpring and LiquidOutline with UIGlassEffect views in a
// UIGlassContainerEffect, and draw the ink and veil the same way, in front.
//
// Using it:
//
//     let stage = LiquidStageView(frame: window.contentView!.bounds)
//     stage.material = .dark
//     let body = LiquidStageView.Drop(id: "body", kind: .ink, rect: CGRect(x: 80, y: 400, width: 38, height: 38))
//     body.stretches = true
//     stage.add(body)
//     stage.add(LiquidStageView.Drop(id: "line", rect: CGRect(x: 126, y: 400, width: 380, height: 38)))
//     stage.aim("line", to: CGRect(x: 126, y: 300, width: 380, height: 38), motion: .rise)   // it flows; necks follow
//     // Over the desktop, keep the veil honest: read the screen behind where the glass opens.
//     Task { if let light = await LiquidBackdrop.lightness(of: globalRect, excluding: CGWindowID(window.windowNumber)) {
//         stage.backdropLightness = light } }
//
// The workbench's material tab (workbench/Sources/MaterialBench.swift) is a fuller example.

// Apple's glass is macOS 26 and later; an app that runs on older systems keeps this behind `#available`.
@available(macOS 26.0, *)
@MainActor
final class LiquidStageView: NSView {
    /// One piece of the liquid.
    @MainActor
    final class Drop {
        enum Kind {
            /// Apple's glass in the stage's material: a line, a message, a sheet.
            case glass
            /// A body of black that is someone (a ghost, a mark): glass at its edge so it can be one liquid with what
            /// it pours out, never wrapped in glass, lit from above.
            case ink
        }

        let id: String
        let kind: Kind
        var body: LiquidBody
        var motion: LiquidMotion = .settle
        /// Its corners; nil for a capsule (half its short side). Never derived from height for a tall shape: a
        /// growing composer fattens into a pill that way. Cap it at the one-line radius instead.
        var radius: CGFloat?
        /// Whether it stretches along its way when it's fast (drops do; sheets don't).
        var stretches = false
        /// Whether it's part of the liquid. Kept apart, a black body keeps its own black disc but makes no necks:
        /// words leaving a line beside it shouldn't hood it in glass.
        var joins = true
        /// A black lip a body comes out of and melts back into (a notch, a dock's edge): ink with no glass, never lit.
        /// A body near it raises the join (so it pulls a long neck before it lets go), and where a body meets it the
        /// ink fills the web with a rolling ball's fillet instead of the grey the glass would draw.
        var isLip = false
        /// Whether a hand can carry it.
        var draggable = false
        /// What sits on it, above all the glass: words, a face. Placed over its body each frame.
        var content: NSView?
        /// How far `content` sits inside the body.
        var contentInset = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        /// A black body's share of the light from above (0 flat … 1 lit), eased.
        var lit = LiquidSpring(1)
        /// In Black, how wet a piece is from moving: it catches the light while it moves and dries back to flat.
        fileprivate(set) var wet = 0.0

        fileprivate let glass = NSGlassEffectView()
        fileprivate let black = CALayer()

        init(id: String, kind: Kind = .glass, rect: CGRect, radius: CGFloat? = nil, anchor: CGPoint = CGPoint(x: 0.5, y: 0.5)) {
            self.id = id
            self.kind = kind
            self.radius = radius
            body = LiquidBody(rect, anchor: anchor)
        }

        fileprivate func corner(for rect: CGRect) -> CGFloat {
            let half = min(rect.width, rect.height) / 2
            return radius.map { min($0, half) } ?? half
        }
    }

    /// What the liquid is made of.
    var material: LiquidMaterial = .dark { didSet { if material != oldValue { dress(); wake() } } }
    /// How light the screen behind the liquid is (0 … 1, see `liquidLightness`): the bright-page veil reads it.
    var backdropLightness: Double = 0.1 { didSet { wake() } }
    /// Whether black bodies are lit from above (and, in Black, wet pieces while they move).
    var lightFromAbove = true { didSet { wake() } }
    /// Films and checks: everything this many times slower, and the same.
    var slowMotion: Double = 1 { didSet { clock.timeScale = 1 / max(slowMotion, 1) } }
    /// While a piece is being pulled out of another, the glass reaches at least `joinSending`, so the neck shows.
    var pulling = false { didSet { wake() } }
    /// The glass's joining distance this frame, for films and checks.
    var joinReach: Double { spacing.value }
    /// Called after every frame is drawn, and when a carried piece is let go.
    var onFrame: ((LiquidStageView) -> Void)?
    var onRelease: ((Drop) -> Void)?

    private(set) var drops: [Drop] = []
    private let container = NSGlassEffectContainerView()
    private let stage = LiquidFlippedView()
    private let overlay = LiquidFlippedView()
    private let bodyHost = LiquidFlippedView()
    private let veil = CAShapeLayer()
    private let ink = CAShapeLayer()
    private let light = LiquidLightView()
    private var outline = LiquidOutline()
    private var spacing = LiquidSpring(LiquidMeasure.joinRest)
    private var clock = LiquidClock()
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var carried: (drop: Drop, grab: CGSize)?
    private var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    private var reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    private var watching: NSObjectProtocol?

    /// The material as drawn: Reduce Transparency draws everything as Black.
    var shown: LiquidMaterial { material.respecting(reduceTransparency: reduceTransparency) }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        // Glass pieces live in one container, so any two that come close are one liquid.
        container.contentView = stage
        addSubview(container)
        // Everything that isn't glass sits above it, in our own order.
        overlay.layer?.masksToBounds = false
        addSubview(overlay)
        bodyHost.layer?.masksToBounds = false
        overlay.addSubview(bodyHost)
        for layer in [veil, ink] {
            layer.fillColor = NSColor.black.cgColor
            layer.fillRule = .evenOdd
            layer.actions = ["path": NSNull(), "opacity": NSNull(), "hidden": NSNull()]
            bodyHost.layer?.addSublayer(layer)
        }
        overlay.addSubview(light)
        appearance = NSAppearance(named: .darkAqua)
        watching = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.readAccessibility() }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    // MARK: pieces

    func add(_ drop: Drop) {
        drops.append(drop)
        drop.glass.tintColor = nil
        stage.addSubview(drop.glass)
        drop.black.backgroundColor = NSColor.black.cgColor
        drop.black.actions = ["position": NSNull(), "bounds": NSNull(), "cornerRadius": NSNull(), "hidden": NSNull()]
        // Back to front on the overlay: the veil and the ink, each black body's disc, the light, then every piece's
        // content (added last, so words and faces sit above the light).
        if drop.kind == .ink { bodyHost.layer?.addSublayer(drop.black) }
        if let content = drop.content { overlay.addSubview(content) }
        dress()
        wake()
    }

    func remove(_ id: String) {
        guard let index = drops.firstIndex(where: { $0.id == id }) else { return }
        let drop = drops.remove(at: index)
        drop.glass.removeFromSuperview()
        drop.black.removeFromSuperlayer()
        drop.content?.removeFromSuperview()
        wake()
    }

    func drop(_ id: String) -> Drop? { drops.first { $0.id == id } }

    /// Sends a piece toward `rect` on `motion`, from wherever it is now.
    func aim(_ id: String, to rect: CGRect, motion: LiquidMotion? = nil) {
        guard let drop = drop(id) else { return }
        if let motion { drop.motion = motion }
        drop.body.aim(rect)
        wake()
    }

    /// Puts a piece at `rect` at once.
    func place(_ id: String, at rect: CGRect) {
        guard let drop = drop(id) else { return }
        drop.body.place(rect)
        wake()
    }

    // MARK: the clock

    private func wake() {
        guard window != nil else { return }
        if link == nil {
            let link = displayLink(target: self, selector: #selector(tick(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            self.link = link
            last = CACurrentMediaTime()
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil {
            link?.invalidate()
            link = nil
        } else {
            dress()
            wake()
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        let frame = now - last
        last = now
        if reduceMotion {
            // With Reduce Motion every spring lands at once, and nothing is wet.
            for drop in drops {
                drop.body.place(drop.body.goal)
                drop.lit.snap()
                drop.wet = 0
            }
            spacing.target = joinTarget()
            spacing.snap()
        } else {
            clock.advance(frame: frame) { h in
                for drop in drops {
                    drop.body.step(h, drop.motion)
                    drop.lit.step(h, .lit)
                    if shown == .black, drop.kind == .glass {
                        let flowing = min(max((drop.body.speed - LiquidMeasure.wetFrom) / LiquidMeasure.wetOver, 0), 1)
                        let tau = flowing > drop.wet ? LiquidMeasure.wetCatch : LiquidMeasure.wetDry
                        drop.wet += (flowing - drop.wet) * (1 - exp(-h / tau))
                        if drop.wet < 0.002, flowing == 0 { drop.wet = 0 }
                    } else {
                        drop.wet = 0
                    }
                }
                spacing.target = joinTarget()
                spacing.step(h, .joins)
                spacing.value = max(spacing.value, 0)
            }
        }
        let still = drops.allSatisfy { $0.body.resting && $0.lit.resting && $0.wet == 0 } && spacing.resting && carried == nil
        if still {
            for drop in drops { drop.body.settleExactly() }
            spacing.snap()
        }
        apply()
        onFrame?(self)
        if still {
            link.invalidate()
            self.link = nil
        }
    }

    /// The glass's joining distance: at rest, plus travel; at least `joinSending` while a piece is pulled out; furthest
    /// near a black lip. Only travel loosens it: a piece growing as its words stream counts its travel, not its growth
    /// (a black body counts both, as it swells and pinches).
    private func joinTarget() -> Double {
        let speeds = drops.filter { $0.joins && !$0.isLip }.map { drop in
            drop.kind == .ink ? drop.body.speed : hypot(drop.body.x.velocity, drop.body.y.velocity)
        }
        var target = LiquidMeasure.joinRest + LiquidMeasure.joinTravel * min(1, (speeds.max() ?? 0) / LiquidMeasure.joinSpeed)
        if pulling { target = max(target, LiquidMeasure.joinSending) }
        for lip in drops where lip.isLip {
            let edge = lip.body.rect
            for body in drops where body.kind == .ink && !body.isLip && body.joins {
                let c = CGPoint(x: body.body.rect.midX, y: body.body.rect.midY)
                let dx = max(edge.minX - c.x, 0, c.x - edge.maxX), dy = max(edge.minY - c.y, 0, c.y - edge.maxY)
                let near = min(max((LiquidMeasure.lipReach - Double(hypot(dx, dy))) / LiquidMeasure.lipFalloff, 0), 1)
                target = max(target, LiquidMeasure.joinLip * near)
            }
        }
        return target
    }

    // MARK: drawing

    private func dress() {
        let material = shown
        for drop in drops {
            // A black body's glass is only its joining edge, always regular (as Ghost's is); what it pours out takes
            // the material's style.
            drop.glass.style = material.clearGlass && drop.kind == .glass ? .clear : .regular
            // Nothing here is a tint, which macOS drops whenever the window isn't the one in use.
            drop.glass.tintColor = nil
        }
    }

    private func apply() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let scale = window?.backingScaleFactor ?? 2
        let material = shown
        container.spacing = material.drawsGlass ? CGFloat(spacing.value) : 0
        var lipPieces: [LiquidPiece] = []
        var inkPieces: [LiquidPiece] = []
        var glassPieces: [LiquidPiece] = []
        var lipLight: [LiquidLightView.Piece] = []
        var lightPieces: [LiquidLightView.Piece] = []
        let reach = CGFloat(spacing.value)
        let inkReach = max(reach, LiquidMeasure.inkReach)
        // Where a body meets a black lip, a rolling ball's fillet fills the web the glass would draw grey.
        let fillet = drops.contains(where: \.isLip) ? LiquidMeasure.webBall * reach : nil
        for drop in drops {
            var rect = drop.body.rect
            if drop.stretches { rect = rect.stretched(along: drop.body.velocity) }
            if drop.body.resting { rect = rect.onPixels(scale: scale) }
            let corner = drop.corner(for: rect)
            if drop.glass.frame != rect { drop.glass.frame = rect }
            if drop.glass.cornerRadius != corner { drop.glass.cornerRadius = corner }
            drop.glass.isHidden = !material.drawsGlass || !drop.joins || drop.isLip || rect.width < 1 || rect.height < 1
            let piece = LiquidPiece(rect: rect, radius: corner)
            switch drop.kind {
            case .ink where drop.isLip:
                // A lip is ink alone, never lit: a body's edge buried in it catches no light.
                drop.black.isHidden = true
                lipPieces.append(piece)
                lipLight.append(.init(rect: rect, radius: corner, blend: inkReach, share: 0))
            case .ink:
                // Its black reaches a hair past its glass, so the glass's rim never shows round it.
                let bleed = LiquidMeasure.blackBleed
                drop.black.frame = rect.insetBy(dx: -bleed, dy: -bleed)
                drop.black.cornerRadius = corner + bleed
                drop.black.isHidden = rect.width < 1
                if drop.joins { inkPieces.append(LiquidPiece(rect: rect, radius: corner, round: fillet)) }
                let disc = LiquidPiece(rect: rect.insetBy(dx: -bleed, dy: -bleed), radius: corner + bleed)
                lightPieces.append(.init(rect: disc.rect, radius: disc.radius, blend: drop.joins ? inkReach : 0.01,
                                         share: lightFromAbove ? CGFloat(drop.lit.value) : 0))
            case .glass:
                if drop.joins { glassPieces.append(piece) }
                if material == .black, drop.joins {
                    lightPieces.append(.init(rect: rect, radius: corner, blend: inkReach,
                                             share: lightFromAbove ? LiquidMeasure.wetShare * CGFloat(drop.wet) : 0))
                }
            }
            if let content = drop.content {
                let inset = drop.contentInset
                let frame = CGRect(x: rect.minX + inset.left, y: rect.minY + inset.top,
                                   width: max(0, rect.width - inset.left - inset.right),
                                   height: max(0, rect.height - inset.top - inset.bottom))
                if content.frame != frame { content.frame = frame }
            }
        }
        // The ink: lips first (so a body's fillet meets them), then black bodies (their necks to each other and to a
        // lip are black); in Black, everything.
        ink.path = material == .black
            ? outline.outline(of: lipPieces + inkPieces + glassPieces, reach: inkReach)
            : outline.outline(of: lipPieces + inkPieces, reach: inkReach)
        // The veil: Dark's darkness, or the bright-page veil, over every piece and neck alike.
        let shade = material.veil(over: backdropLightness)
        veil.isHidden = shade < 0.01
        if !veil.isHidden {
            veil.opacity = shade
            veil.path = outline.outline(of: lipPieces + inkPieces + glassPieces, reach: reach * LiquidMeasure.veilReach)
        }
        // The light, kept on the black: the ink's outline and every black disc. Lips first, unlit, in the ink's order.
        let mask = CGMutablePath()
        if let path = ink.path { mask.addPath(path) }
        for drop in drops where drop.kind == .ink && !drop.black.isHidden {
            mask.addRoundedRect(in: drop.black.frame, cornerWidth: drop.black.cornerRadius, cornerHeight: drop.black.cornerRadius)
        }
        light.draw(lipLight + lightPieces, outline: mask, scale: scale)
        CATransaction.commit()
    }

    override func layout() {
        super.layout()
        // Only the stage's own size: never reset a piece here, or layout fights the springs.
        for view in [container, overlay, bodyHost, light] where view.frame != bounds { view.frame = bounds }
        stage.frame = container.bounds
        apply()
    }

    private func readAccessibility() {
        reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        dress()
        wake()
    }

    // MARK: carrying

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        if let hit = super.hitTest(point), hit !== self, hit !== overlay, hit !== container, hit !== stage, hit !== bodyHost {
            return hit
        }
        return drops.last(where: { $0.draggable && $0.body.rect.contains(local) }) != nil ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard let drop = drops.last(where: { $0.draggable && $0.body.rect.contains(point) }) else { return }
        let rect = drop.body.rect
        carried = (drop, CGSize(width: point.x - rect.midX, height: point.y - rect.midY))
        drop.motion = .carry
    }

    override func mouseDragged(with event: NSEvent) {
        guard let (drop, grab) = carried else { return }
        let point = convert(event.locationInWindow, from: nil)
        let goal = drop.body.goal
        drop.body.aim(CGRect(liquidCenter: CGPoint(x: point.x - grab.width, y: point.y - grab.height), size: goal.size))
        wake()
    }

    override func mouseUp(with event: NSEvent) {
        guard let (drop, _) = carried else { return }
        carried = nil
        drop.motion = .settle
        onRelease?(drop)
        wake()
    }
}

/// A plain flipped view, for coordinates that read top-down as the stage's do.
final class LiquidFlippedView: NSView {
    override var isFlipped: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }
    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}
