import AppKit
import Metal
import QuartzCore

// The light on black: light straight from above, a fine line along every edge that faces up, fading down the curves,
// and a softer one a little further in where a surface turns toward the sky. Each piece takes its own share of it,
// blended across a neck as the shapes are, so a drop leaving a lit body leaves the light behind as it separates.
// Worked out per pixel on the GPU from the same smooth union the outline is traced from (LiquidOutline.swift), over
// just the part that's lit, and kept on the black by the ink's own outline.
//
// From Prompt Ghost's DropLight.swift, unchanged but for names. The light belongs to the one living body (a black drop
// that is someone); what it pours out stays flat at rest and is lit only while it moves ("wet"), never permanently:
// lighting every piece made a conversation read like more widgets.

@MainActor
final class LiquidLightView: NSView {
    /// One piece of the liquid, in the order the ink joins them, with its share of the light (0 is flat black).
    struct Piece: Equatable {
        var rect: CGRect
        var radius: CGFloat
        var blend: CGFloat
        var share: CGFloat
    }

    private let renderer = LiquidLightRenderer()
    private let surface = CAMetalLayer()
    private let clip = CAShapeLayer()
    private var drawn: (pieces: [Piece], scale: CGFloat)?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        let still: [String: any CAAction] = ["position": NSNull(), "bounds": NSNull(), "frame": NSNull(), "hidden": NSNull(),
                                             "contents": NSNull(), "path": NSNull(), "anchorPoint": NSNull()]
        surface.device = renderer?.device
        surface.pixelFormat = LiquidLightRenderer.pixelFormat
        surface.isOpaque = false
        surface.framebufferOnly = true
        // In step with the Core Animation layers around it: commit, wait until scheduled, then present.
        surface.presentsWithTransaction = true
        surface.anchorPoint = .zero
        surface.actions = still
        surface.isHidden = true
        layer?.addSublayer(surface)
        clip.fillColor = NSColor.black.cgColor
        clip.actions = still
        layer?.mask = clip
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        clip.frame = bounds
        CATransaction.commit()
    }

    /// Lights `pieces` (in this view's points), kept within `outline` (the black), at `scale` pixels a point.
    func draw(_ pieces: [Piece], outline: CGPath?, scale: CGFloat) {
        let lit = pieces.filter { $0.share > 0.004 }
        guard let renderer, !lit.isEmpty, let outline else {
            if !surface.isHidden { surface.isHidden = true }
            drawn = nil
            return
        }
        clip.path = outline
        guard drawn.map({ $0.pieces != pieces || $0.scale != scale }) ?? true else { return }
        // Only on screen: off it, the GPU's next drawable can keep the main thread waiting for up to a second.
        guard let window, window.occlusionState.contains(.visible) else {
            drawn = nil
            return
        }
        // Only where a share of the light can reach: the lit pieces, and as far as each joins its neighbours.
        let reach = lit.reduce(CGRect.null) { $0.union($1.rect.insetBy(dx: -$1.blend - 2, dy: -$1.blend - 2)) }
        let area = reach.intersection(bounds.insetBy(dx: -8, dy: -8))
        guard !area.isNull, area.width >= 1, area.height >= 1 else {
            surface.isHidden = true
            drawn = nil
            return
        }
        // On the pixel grid, so the line along an edge is drawn, never resampled; its size in steps, so it isn't made
        // anew every frame as the body moves.
        let origin = CGPoint(x: (area.minX * scale).rounded(.down) / scale, y: (area.minY * scale).rounded(.down) / scale)
        let step = LiquidLightRenderer.sizeStep
        let pixels = CGSize(width: ((area.maxX - origin.x) * scale / step).rounded(.up) * step,
                            height: ((area.maxY - origin.y) * scale / step).rounded(.up) * step)
        if surface.drawableSize != pixels { surface.drawableSize = pixels }
        surface.contentsScale = scale
        surface.frame = CGRect(origin: origin, size: CGSize(width: pixels.width / scale, height: pixels.height / scale))
        guard let drawable = surface.nextDrawable() else { return }
        renderer.render(pieces, origin: origin, scale: scale, into: drawable.texture) { commands in
            commands.commit()
            commands.waitUntilScheduled()
            drawable.present()
        }
        surface.isHidden = false
        drawn = (pieces, scale)
    }
}

/// The light's shader and what it needs.
@MainActor
final class LiquidLightRenderer {
    static let pixelFormat = MTLPixelFormat.bgra8Unorm
    /// The lit area's size moves in steps of this many pixels.
    static let sizeStep: CGFloat = 64
    /// At most this many pieces join the light; more are left flat.
    static let mostPieces = 64

    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(),
              let library = try? device.makeLibrary(source: Self.shader, options: nil),
              let vertex = library.makeFunction(name: "liquidLightVertex"), let fragment = library.makeFunction(name: "liquidLightFragment")
        else { return nil }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.label = "Liquid light"
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = Self.pixelFormat
        guard let pipeline = try? device.makeRenderPipelineState(descriptor: descriptor) else { return nil }
        self.device = device
        self.queue = queue
        self.pipeline = pipeline
    }

    /// Draws the light of `pieces` into `texture`, whose top-left pixel is at `origin` (in points), `scale` pixels a
    /// point; hands the command buffer to `finish` to commit (and present).
    func render(_ pieces: [LiquidLightView.Piece], origin: CGPoint, scale: CGFloat, into texture: MTLTexture,
                finish: (MTLCommandBuffer) -> Void) {
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        pass.colorAttachments[0].storeAction = .store
        guard let commands = queue.makeCommandBuffer(), let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else { return }
        var packed: [SIMD4<Float>] = []
        for piece in pieces.prefix(Self.mostPieces) {
            let r = max(0, min(piece.radius, min(piece.rect.width, piece.rect.height) / 2))
            packed.append(SIMD4(Float(piece.rect.midX), Float(piece.rect.midY), Float(max(piece.rect.width / 2, 0.01)),
                                Float(max(piece.rect.height / 2, 0.01))))
            packed.append(SIMD4(Float(r), Float(max(piece.blend, 0.01)), Float(piece.share), 0))
        }
        var uniforms = SIMD4<Float>(Float(origin.x), Float(origin.y), Float(scale), Float(packed.count / 2))
        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<SIMD4<Float>>.stride, index: 0)
        if packed.isEmpty { packed.append(.zero) }
        encoder.setFragmentBytes(packed, length: packed.count * MemoryLayout<SIMD4<Float>>.stride, index: 1)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        finish(commands)
    }

    /// y points down, as a flipped view's does.
    private static let shader = """
    #include <metal_stdlib>
    using namespace metal;

    struct LightOut { float4 position [[position]]; };

    vertex LightOut liquidLightVertex(uint id [[vertex_id]]) {
        float2 corner = float2((id << 1) & 2, id & 2);
        LightOut out;
        out.position = float4(corner * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
        return out;
    }

    static float roundedBox(float2 p, float2 b, float r) {
        float2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    // uniforms: origin x, origin y (points), pixels a point, piece count. pieces: centre and half size; then corner
    // radius, reach (how far it joins), its share of the light.
    fragment float4 liquidLightFragment(LightOut in [[stage_in]], constant float4 &u [[buffer(0)]],
                                        constant float4 *pieces [[buffer(1)]]) {
        float2 p = u.xy + in.position.xy / u.z;
        float d = 1e5;
        float share = 0.0;
        int count = int(u.w);
        for (int i = 0; i < count; i++) {
            float4 b = pieces[2 * i];
            float4 q = pieces[2 * i + 1];
            float sd = roundedBox(p - b.xy, b.zw, min(q.x, min(b.z, b.w)));
            if (i == 0) { d = sd; share = q.z; continue; }
            float k = max(q.y, 0.01);
            // the light's share blends across the neck as the shapes do
            share = mix(q.z, share, clamp(0.5 + 0.5 * (sd - d) / k, 0.0, 1.0));
            // the polynomial smooth minimum: the neck
            float h = max(k - abs(d - sd), 0.0) / k;
            d = min(d, sd) - h * h * k * 0.25;
        }
        // the light, from above: along every edge that faces up, fading down the curves
        float2 g = float2(dfdx(d), dfdy(d));
        float gl = length(g);
        float2 n = gl > 1e-6 ? g / gl : float2(0.0, 1.0);
        float up = smoothstep(0.08, 0.95, -n.y);
        float px = 1.0 / u.z;
        float a = clamp(0.5 - d / px, 0.0, 1.0);
        float inside = max(-d, 0.0);
        float lit = (exp(-inside / \(LiquidMeasure.rimFall)) * \(LiquidMeasure.rimLight) + exp(-inside / \(LiquidMeasure.skyFall)) * \(LiquidMeasure.skyLight))
            * up * clamp(share, 0.0, 1.0) * a;
        return float4(lit, lit, lit, lit);
    }
    """
}
