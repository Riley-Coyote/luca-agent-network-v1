import CoreGraphics
import Foundation

// The four materials of the liquid, and every measure they're made of. These are Prompt Ghost's own numbers
// (Sources/PromptGhost/Stage/Drop/DropEngine.swift), settled with Riley in October 2026 and checked by eye and by
// measurement on his screens. Copy this file into a project as it is; change a number only when a render tells you to.

/// What the liquid is made of. A body of this material is always one liquid: the necks between its pieces are the
/// same material as the pieces.
enum LiquidMaterial: String, CaseIterable, Identifiable, Sendable {
    /// Apple's clear glass: the most liquid. Needs help over bright backgrounds (see `veil(over:)`).
    case clear
    /// Apple's regular glass, which reads as smoked: darker than what's behind it, legible over most things.
    case smoked
    /// Regular glass with black showing through it: a 0.58 veil drawn in front of the glass, pieces and necks alike.
    case dark
    /// Solid black ink, no glass at all. It catches the light from above only while it moves.
    case black

    var id: String { rawValue }

    var name: String {
        switch self {
        case .clear: "Clear"
        case .smoked: "Smoked"
        case .dark: "Dark"
        case .black: "Black"
        }
    }

    /// Whether Apple's glass is drawn at all. Black is ink alone.
    var drawsGlass: Bool { self != .black }

    /// Whether the glass is Apple's clear style (otherwise regular).
    var clearGlass: Bool { self == .clear }

    /// How dark the veil in front of the glass is, given how light the screen behind it is (0 black … 1 white).
    /// Dark always carries its own darkness. Apple's own glass (Clear, Smoked) turns light behind white words over a
    /// bright page, so a veil comes up only as much as the page asks: none below 0.4, as dark as 0.6 by 0.85. That
    /// kept words at 6.5:1 on Clear and 9:1 on Smoked over a white page, and changes nothing over a dark one.
    func veil(over backdropLightness: Double) -> Float {
        switch self {
        case .dark:
            return LiquidMeasure.veilAlpha
        case .black:
            return 0
        case .clear, .smoked:
            let t = min(max((backdropLightness - LiquidMeasure.shadeFrom) / (LiquidMeasure.shadeFull - LiquidMeasure.shadeFrom), 0), 1)
            return LiquidMeasure.shadeMost * Float(t * t * (3 - 2 * t))
        }
    }

    /// With Reduce Transparency on, every material is drawn as Black: solid, and the same everywhere.
    func respecting(reduceTransparency: Bool) -> LiquidMaterial { reduceTransparency ? .black : self }
}

/// The liquid's measures.
enum LiquidMeasure {
    // MARK: the material

    /// Dark's veil, in front of the glass.
    static let veilAlpha: Float = 0.58
    /// The bright-page veil for Clear and Smoked: from this lightness, as dark as `shadeMost` by `shadeFull`.
    static let shadeFrom: Double = 0.4
    static let shadeFull: Double = 0.85
    static let shadeMost: Float = 0.6
    /// The veil sits a little inside the glass's own join, so it never darkens the desktop beside a neck.
    static let veilReach: CGFloat = 0.85
    /// The ink always joins at least this far, so a black drip holds even when the glass stands apart.
    static let inkReach: CGFloat = 5
    /// Black drawn over a glass piece reaches this far past it, so the glass's rim never shows round it.
    static let blackBleed: CGFloat = 0.5
    /// Where black meets black at rest, a rolling ball's fillet of this share of the join (a concave arc tangent to
    /// both, as glass meets glass) fills the web the glass would otherwise draw grey.
    static let webBall: CGFloat = 0.55

    // MARK: the light from above, on black

    /// A fine line along every edge that faces up, this bright, fading this fast inward…
    static let rimLight: Float = 0.34
    static let rimFall: Float = 0.9
    /// …and a softer one further in, where a surface turns toward the sky.
    static let skyLight: Float = 0.045
    static let skyFall: Float = 6
    /// In Black, what's poured out takes this share of the light while it moves, from this speed (points a second),
    /// all of it by this much faster; it catches the light this fast and dries back to flat this slowly.
    static let wetShare: CGFloat = 0.6
    static let wetFrom: Double = 30
    static let wetOver: Double = 320
    static let wetCatch: Double = 0.07
    static let wetDry: Double = 0.5

    // MARK: the join

    /// The glass's joining distance (container spacing): at rest; how much travel adds; the speed that adds all of
    /// it; while a piece is pulled out of another; near a black lip it leaves. Only travel loosens the glass.
    static let joinRest: Double = 5
    static let joinTravel: Double = 13
    static let joinSpeed: Double = 260
    static let joinSending: Double = 24
    static let joinLip: Double = 30
    /// The lip reaches furthest within this of a body, falling off over this much: a drop leaving the notch pulls a
    /// long neck before it lets go.
    static let lipReach: Double = 130
    static let lipFalloff: Double = 60

    // MARK: a drop in flight

    /// A drop stretches along its way when it's fast, up to about half again as long, and thins across it.
    static let stretchMax: CGFloat = 0.45
    static let stretchSpeed: CGFloat = 2600
    static let stretchThin: CGFloat = 0.4

    // MARK: the clock

    /// Never more than this per frame (a slow frame would otherwise jump), stepped this finely. Every spring steps
    /// in every substep: one stepped once per frame ran away below zero at background frame rates and broke the necks.
    static let maxFrame: Double = 1.0 / 30
    static let stepsPerSecond: Double = 240

    // MARK: words on the liquid

    /// The words: the system face at 15 points, 3 between lines (a 20.5-point pitch), white under a dark appearance.
    static let textSize: CGFloat = 15
    static let textLineSpacing: CGFloat = 3
    /// Quiet words (what it's doing, hints): this white, brighter with Increase Contrast.
    static let quietInk: CGFloat = 0.54
    static let quietInkContrast: CGFloat = 0.85
}

/// How light a colour looks, 0 black … 1 white: CIE lightness from sRGB, the measure the bright-page veil reads.
func liquidLightness(red: Double, green: Double, blue: Double) -> Double {
    func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    let y = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    return y <= 0.008856 ? 9.033 * y : 1.16 * pow(y, 1.0 / 3) - 0.16
}
