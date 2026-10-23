import CoreGraphics
import Foundation

// How the liquid moves. Every shape is an anchor and a size on springs with SwiftUI's own meaning (a response in
// seconds and a damping fraction), stepped on one clock at 240 steps a second, so a shape interrupted mid-flight
// carries on from where it is and every piece stays in step with the others. Necks, pinches and merges are never
// animated: they fall out of the outline as these shapes move (LiquidOutline.swift).
//
// From Prompt Ghost's DropEngine.swift (DropMotion, DropSpring, DropBody) and DropFlight.swift (SpringAxis).

/// A spring's response and damping, with optional lag on sideways travel and on growth.
struct LiquidMotion: Equatable, Sendable {
    var response: Double
    var damping: Double
    /// Sideways travel, when it should lag the rise: the drop goes up first, then drifts over, in an arc.
    var lateral: Axis?
    /// Growth, when it should lag the travel: a small drop goes to its place, then opens there.
    var sizing: Axis?

    struct Axis: Equatable, Sendable {
        var response: Double
        var damping: Double
    }

    init(response: Double, damping: Double, lateral: Axis? = nil, sizing: Axis? = nil) {
        self.response = response
        self.damping = damping
        self.lateral = lateral
        self.sizing = sizing
    }

    // The named motions, as the drop uses them.

    /// An answer rising out of a drop and unrolling upward.
    static let rise = LiquidMotion(response: 0.42, damping: 0.74, lateral: Axis(response: 0.7, damping: 0.9))
    /// Words leaving their line: slower than a rise, so the neck can be seen stretching and letting go.
    static let send = LiquidMotion(response: 0.56, damping: 0.74, lateral: Axis(response: 0.85, damping: 0.9))
    /// Welling up out of a piece while still joined to it (about a third of a second, then `send`).
    static let swell = LiquidMotion(response: 0.3, damping: 0.86)
    /// Poured back out of a drop: a small drop travels to its place and opens there.
    static let pour = LiquidMotion(response: 0.4, damping: 0.8, lateral: Axis(response: 0.55, damping: 0.9),
                                   sizing: Axis(response: 0.62, damping: 0.86))
    /// A line pouring out of a drop's side, or running back in.
    static let line = LiquidMotion(response: 0.42, damping: 0.84)
    /// Draining into a drop, newest first.
    static let drain = LiquidMotion(response: 0.32, damping: 0.94)
    /// A drop's fall or flight across the screen.
    static let flight = LiquidMotion(response: 0.6, damping: 0.8)
    static let calm = LiquidMotion(response: 0.22, damping: 1)
    /// Under the fingers: close to direct, just soft enough not to tick.
    static let scroll = LiquidMotion(response: 0.07, damping: 1)
    /// Welling out of a black lip, still joined to it.
    static let lip = LiquidMotion(response: 0.5, damping: 0.9)
    /// Melting into its home.
    static let home = LiquidMotion(response: 0.42, damping: 0.95)
    /// Drawn away from a lip, or rising into it: gentle, near critically damped.
    static let pull = LiquidMotion(response: 0.24, damping: 0.95)
    /// A neck reaching down to an arriving drop, or springing back once it lets go.
    static let drip = LiquidMotion(response: 0.12, damping: 1)
    /// Carried by the hand: a quick spring that follows it.
    static let carry = LiquidMotion(response: 0.16, damping: 0.8)
    /// Let go after a carry.
    static let settle = LiquidMotion(response: 0.38, damping: 0.78)
    /// The glass's joining distance.
    static let joins = LiquidMotion(response: 0.2, damping: 1)
    /// An edge closing over what no longer fits: never past where it's going.
    static let edge = LiquidMotion(response: 0.36, damping: 1)
    /// Drifting about slowly.
    static let drift = LiquidMotion(response: 1.05, damping: 0.9)
    /// Pressing an edge out: a soft push that wobbles as it gives back.
    static let press = LiquidMotion(response: 0.5, damping: 0.6)
    /// Swimming out and back: down first, then over, a soft arc.
    static let swim = LiquidMotion(response: 0.85, damping: 0.84, lateral: Axis(response: 1.15, damping: 0.86))
    /// A drop carried a long way (a letter to another place): a little slower than a fall.
    static let letter = LiquidMotion(response: 0.75, damping: 0.82)
    /// How much a black drop simmers while it thinks: coming on and settling, never at once.
    static let churn = LiquidMotion(response: 0.7, damping: 1)
    /// Coming into the light, or going out of it.
    static let lit = LiquidMotion(response: 0.5, damping: 1)
}

/// One value on a spring.
struct LiquidSpring: Equatable, Sendable {
    var value: Double
    var velocity = 0.0
    var target: Double

    init(_ value: Double) {
        self.value = value
        target = value
    }

    /// Semi-implicit Euler, which is stable at 240 steps a second. Stiffness (2π / response)², friction
    /// 4π · damping / response: SwiftUI's own spring.
    mutating func step(_ dt: Double, _ motion: LiquidMotion) {
        let stiffness = pow(2 * .pi / motion.response, 2), friction = 4 * .pi * motion.damping / motion.response
        velocity += (-stiffness * (value - target) - friction * velocity) * dt
        value += velocity * dt
    }

    mutating func snap() {
        value = target
        velocity = 0
    }

    var resting: Bool { abs(value - target) < 0.02 && abs(velocity) < 0.3 }
}

/// A shape's anchor point and size, each on its own spring: interrupted, it carries on from where it is. The anchor
/// is the point that holds still while the shape grows: the centre, or (for an answer that unrolls upward from a
/// line's start) its bottom-left corner.
struct LiquidBody: Equatable, Sendable {
    var x, y, w, h: LiquidSpring
    let anchor: CGPoint

    init(_ rect: CGRect, anchor: CGPoint = CGPoint(x: 0.5, y: 0.5)) {
        self.anchor = anchor
        x = LiquidSpring(rect.minX + anchor.x * rect.width)
        y = LiquidSpring(rect.minY + anchor.y * rect.height)
        w = LiquidSpring(rect.width)
        h = LiquidSpring(rect.height)
    }

    var rect: CGRect {
        let width = max(w.value, 0), height = max(h.value, 0)
        return CGRect(x: x.value - anchor.x * width, y: y.value - anchor.y * height, width: width, height: height)
    }

    var goal: CGRect {
        CGRect(x: x.target - anchor.x * w.target, y: y.target - anchor.y * h.target, width: w.target, height: h.target)
    }

    mutating func aim(_ rect: CGRect) {
        x.target = rect.minX + anchor.x * rect.width
        y.target = rect.minY + anchor.y * rect.height
        w.target = rect.width
        h.target = rect.height
    }

    /// Straight there, no motion.
    mutating func place(_ rect: CGRect) {
        aim(rect)
        x.snap(); y.snap(); w.snap(); h.snap()
    }

    mutating func step(_ dt: Double, _ motion: LiquidMotion) {
        x.step(dt, motion.lateral.map { LiquidMotion(response: $0.response, damping: $0.damping) } ?? motion)
        y.step(dt, motion)
        let growth = motion.sizing.map { LiquidMotion(response: $0.response, damping: $0.damping) } ?? motion
        w.step(dt, growth)
        h.step(dt, growth)
    }

    /// Once resting, exactly on its goal: a spring left a hair short puts every word between pixels, and on a 1×
    /// display that smears them all.
    mutating func settleExactly() {
        guard resting else { return }
        x.snap(); y.snap(); w.snap(); h.snap()
    }

    var resting: Bool { x.resting && y.resting && w.resting && h.resting }
    /// Points a second, growth counted at half.
    var speed: Double { hypot(x.velocity, y.velocity) + 0.5 * (abs(w.velocity) + abs(h.velocity)) }
    var velocity: CGVector { CGVector(dx: x.velocity, dy: y.velocity) }
}

/// The one clock: a frame's time, never more than `maxFrame`, in steps of 1/240 s. Every spring steps in every step.
struct LiquidClock {
    var timeScale: Double = 1

    /// Calls `step` once per substep with its length in seconds; returns how much time passed (scaled).
    @discardableResult
    func advance(frame: Double, _ step: (Double) -> Void) -> Double {
        let dt = min(max(frame, 0), LiquidMeasure.maxFrame) * timeScale
        let count = max(1, Int((dt * LiquidMeasure.stepsPerSecond).rounded(.up)))
        let h = dt / Double(count)
        for _ in 0..<count { step(h) }
        return dt
    }
}

/// One axis of a spring in closed form: where it is relative to its target, and how fast it's going, any moment after
/// it was let go. Use it when several axes or several views must stay in exact step (a drop flying in an arc, the
/// liquid around it and its face): two SwiftUI animations started in one update share one spring, so an arc flies
/// straight. Work the motion out from time instead, and place views with a non-animating effect.
struct SpringAxis: Equatable, Sendable {
    var response: Double
    var damping: Double

    func state(after t: Double, offset x0: Double, velocity v0: Double) -> (offset: Double, velocity: Double) {
        let w0 = 2 * Double.pi / response
        guard damping < 1 else {
            // As fast as it can come home without passing it.
            let b = v0 + w0 * x0, decay = exp(-w0 * t)
            return ((x0 + b * t) * decay, (b - w0 * (x0 + b * t)) * decay)
        }
        let s = damping * w0, wd = w0 * (1 - damping * damping).squareRoot()
        let b = (v0 + s * x0) / wd, decay = exp(-s * t), c = cos(wd * t), n = sin(wd * t)
        return (decay * (x0 * c + b * n), decay * ((b * wd - s * x0) * c - (x0 * wd + s * b) * n))
    }
}

/// A trip from one point to another, across and down each on a spring of its own so it travels in an arc
/// (across 0.56 / 0.86 is slower than down 0.44 / 0.82, so it falls in a curve).
struct LiquidFlight: Equatable, Sendable {
    var from: CGPoint
    var to: CGPoint
    /// How fast it was already going as it set off, when one trip turns into another.
    var velocity: CGVector = .zero
    var across = SpringAxis(response: 0.56, damping: 0.86)
    var vertical = SpringAxis(response: 0.44, damping: 0.82)

    func state(after t: Double) -> (center: CGPoint, velocity: CGVector) {
        let t = max(0, t)
        let x = across.state(after: t, offset: Double(from.x - to.x), velocity: Double(velocity.dx))
        let y = vertical.state(after: t, offset: Double(from.y - to.y), velocity: Double(velocity.dy))
        return (CGPoint(x: to.x + x.offset, y: to.y + y.offset), CGVector(dx: x.velocity, dy: y.velocity))
    }
}

extension CGRect {
    init(liquidCenter center: CGPoint, size: CGSize) {
        self.init(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height)
    }

    /// A drop drawn out along its way when it's fast, and a little narrower across it.
    func stretched(along velocity: CGVector) -> CGRect {
        let stretch = min(LiquidMeasure.stretchMax, hypot(velocity.dx, velocity.dy) / LiquidMeasure.stretchSpeed)
        guard stretch > 0.01 else { return self }
        let vertical = abs(velocity.dy) >= abs(velocity.dx)
        let long = 1 + stretch, thin = 1 - LiquidMeasure.stretchThin * stretch
        return CGRect(liquidCenter: CGPoint(x: midX, y: midY),
                      size: CGSize(width: width * (vertical ? thin : long), height: height * (vertical ? long : thin)))
    }

    /// On the display's pixel grid, so nothing on it is resampled between pixels.
    func onPixels(scale: CGFloat) -> CGRect {
        let s = max(scale, 1)
        return CGRect(x: (minX * s).rounded() / s, y: (minY * s).rounded() / s,
                      width: (width * s).rounded() / s, height: (height * s).rounded() / s)
    }
}
