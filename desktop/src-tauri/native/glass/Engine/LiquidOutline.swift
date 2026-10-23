import CoreGraphics
import Foundation

// The liquid's outline: one shape for every piece and every neck between them. Prompt Ghost draws its black ink and
// its veils from this outline, in front of Apple's glass, because the glass's own necks are always plain glass and
// it can't be faded or tinted reliably. Traced on the CPU into a CGPath for CAShapeLayers; the same field is worked
// out per pixel on the GPU for the light (LiquidLight.swift), so the two always agree.
//
// From Prompt Ghost's DropEngine.swift (DropBlob, DropLiquidField), unchanged but for names.

/// One piece of the liquid: a rounded rectangle (a pill, a drop, a lip). A piece can join the rest with its own reach
/// instead of the liquid's (a body that should keep its exact edge until it presses another, or a stir that mustn't
/// reach further for its neighbours), and can meet what's before it with a rolling ball's fillet.
struct LiquidPiece: Equatable, Sendable {
    var rect: CGRect
    var radius: CGFloat
    /// Its own joining reach, instead of the liquid's.
    var blend: CGFloat? = nil
    /// Where it meets what's before it, also a concave arc of this radius tangent to both, as glass meets glass.
    var round: CGFloat? = nil
}

/// The smooth union of the pieces. Pieces that come within `reach` of each other share one body, with a neck between
/// them; apart from their necks each keeps its exact shape. The zero line of a polynomial smooth minimum of the
/// pieces' distance fields, traced with marching squares on a grid a few points fine.
///
/// Pieces further apart than `reach` can't change each other's edge, so each group that touches is traced on its own
/// small grid, and a piece alone is emitted as its exact rounded rectangle. Each piece is worked out only over the band
/// around its edge. Together these took scrolling and resizing from about 40 frames a second to about 120.
struct LiquidOutline {
    /// The grid, in points. 2.5 is fine enough that no step shows at any reach the liquid uses.
    var cell: CGFloat = 2.5
    private var values: [Float] = []

    init(cell: CGFloat = 2.5) { self.cell = cell }

    mutating func outline(of blobs: [LiquidPiece], reach: CGFloat) -> CGPath? {
        let pieces = blobs.filter { b in
            [b.rect.minX, b.rect.minY, b.rect.width, b.rect.height, b.radius].allSatisfy(\.isFinite) && b.rect.width > 0.5 && b.rect.height > 0.5
        }
        guard !pieces.isEmpty else { return nil }
        let path = CGMutablePath()
        for group in Self.groups(of: pieces, reach: max(reach, 0)) {
            if group.count == 1, let piece = group.first {
                // A piece on its own is its own outline: exactly its rounded rectangle, with nothing to trace.
                let radius = max(0, min(piece.radius, min(piece.rect.width, piece.rect.height) / 2))
                path.addRoundedRect(in: piece.rect, cornerWidth: radius, cornerHeight: radius)
            } else if let traced = trace(group, reach: reach) {
                path.addPath(traced)
            }
        }
        return path
    }

    /// The pieces in touching groups: two share a group when their boxes come within `reach`.
    static func groups(of pieces: [LiquidPiece], reach: CGFloat) -> [[LiquidPiece]] {
        var parent = Array(pieces.indices)
        func root(_ i: Int) -> Int {
            var i = i
            while parent[i] != i {
                parent[i] = parent[parent[i]]
                i = parent[i]
            }
            return i
        }
        let grown = pieces.map { piece -> CGRect in
            let near = max(reach, piece.round ?? 0)
            return piece.rect.insetBy(dx: -near / 2 - 1, dy: -near / 2 - 1)
        }
        for a in pieces.indices {
            for b in pieces.indices where b > a && grown[a].intersects(grown[b]) {
                parent[root(a)] = root(b)
            }
        }
        var groups: [Int: [LiquidPiece]] = [:]
        var order: [Int] = []
        for index in pieces.indices {
            let key = root(index)
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(pieces[index])
        }
        return order.compactMap { groups[$0] }
    }

    /// The signed distance from `point` to a rounded rectangle: negative inside.
    static func distance(from point: CGPoint, to piece: LiquidPiece) -> CGFloat {
        let r = max(0, min(piece.radius, min(piece.rect.width, piece.rect.height) / 2))
        let qx = abs(point.x - piece.rect.midX) - piece.rect.width / 2 + r
        let qy = abs(point.y - piece.rect.midY) - piece.rect.height / 2 + r
        return hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
    }

    /// The joined field at `point`, in the pieces' order: what the traced outline is the zero line of.
    static func field(at point: CGPoint, of pieces: [LiquidPiece], reach: CGFloat) -> CGFloat {
        var d = CGFloat.greatestFiniteMagnitude
        for (index, piece) in pieces.enumerated() {
            let sd = distance(from: point, to: piece)
            if index == 0 { d = sd; continue }
            let k = max(piece.blend ?? reach, 0.01)
            let h = max(k - abs(d - sd), 0) / k
            var joined = min(d, sd) - h * h * k * 0.25
            if let ball = piece.round, ball > 0 {
                let ra = max(ball - d, 0), rb = max(ball - sd, 0)
                joined = min(joined, max(ball, min(d, sd)) - hypot(ra, rb))
            }
            d = joined
        }
        return d
    }

    private mutating func trace(_ pieces: [LiquidPiece], reach: CGFloat) -> CGPath? {
        let reach = max(reach, 0)
        let k = Float(max(reach, 0.01))
        // A piece's own reach can be further than the liquid's; the grid and each piece's band reach that far too.
        let furthest = max(reach, pieces.compactMap(\.blend).max() ?? 0, pieces.compactMap(\.round).max() ?? 0)
        var box = pieces.reduce(CGRect.null) { $0.union($1.rect) }
        box = box.insetBy(dx: -(furthest + cell * 2), dy: -(furthest + cell * 2))
        let nx = Int((box.width / cell).rounded(.up)), ny = Int((box.height / cell).rounded(.up))
        guard nx > 1, ny > 1, (nx + 1) * (ny + 1) < 600_000 else { return nil }
        let stride = nx + 1
        if values.count < stride * (ny + 1) { values = [Float](repeating: 0, count: stride * (ny + 1)) }

        struct Piece { var cx, cy, bx, by, r, k, ball: Float }
        let ps = pieces.map { b -> Piece in
            let r = Float(max(0, min(b.radius, min(b.rect.width, b.rect.height) / 2)))
            return Piece(cx: Float(b.rect.midX), cy: Float(b.rect.midY), bx: Float(b.rect.width / 2), by: Float(b.rect.height / 2), r: r,
                         k: b.blend.map { Float(max($0, 0.01)) } ?? k, ball: Float(max(b.round ?? 0, 0)))
        }
        let x0 = Float(box.minX), y0 = Float(box.minY), c = Float(cell)
        let far = Float.greatestFiniteMagnitude
        values.withUnsafeMutableBufferPointer { v in
            for index in 0..<(stride * (ny + 1)) { v[index] = far }
            // Each piece only changes the field near it: further than the reach (and a few cells, for the corners of
            // the squares the edge crosses) it can't move the edge or make a neck, and deep inside it everything is
            // inside. So each piece is worked out over the band around its edge alone, in the same order as ever,
            // and the outline is the same one, for a fraction of the work.
            let margin = Float(furthest) + 4 * c
            for p in ps {
                let i0 = max(0, Int((p.cx - p.bx - margin - x0) / c)), i1 = min(nx, Int((p.cx + p.bx + margin - x0) / c) + 1)
                let j0 = max(0, Int((p.cy - p.by - margin - y0) / c)), j1 = min(ny, Int((p.cy + p.by + margin - y0) / c) + 1)
                guard i0 <= i1, j0 <= j1 else { continue }
                let coreX = p.bx - p.r - 2 * c, coreY = p.by - p.r - 2 * c
                for j in j0...j1 {
                    let y = y0 + Float(j) * c
                    for i in i0...i1 {
                        let x = x0 + Float(i) * c
                        let index = j * stride + i
                        let d = v[index]
                        if abs(x - p.cx) < coreX, abs(y - p.cy) < coreY {
                            // Deep inside: inside, whatever else is near.
                            v[index] = min(d == far ? 0 : d, -2 * c)
                            continue
                        }
                        let qx = abs(x - p.cx) - p.bx + p.r, qy = abs(y - p.cy) - p.by + p.r
                        let ox = max(qx, 0), oy = max(qy, 0)
                        let sd = (ox * ox + oy * oy).squareRoot() + min(max(qx, qy), 0) - p.r
                        if d == far { v[index] = sd; continue }
                        // Polynomial smooth minimum: the neck.
                        let h = max(p.k - abs(d - sd), 0) / p.k
                        var joined = min(d, sd) - h * h * p.k * 0.25
                        if p.ball > 0 {
                            // And a rolling ball's fillet where they meet: a concave arc of its radius, tangent to both.
                            let ra = max(p.ball - d, 0), rb = max(p.ball - sd, 0)
                            joined = min(joined, max(p.ball, min(d, sd)) - (ra * ra + rb * rb).squareRoot())
                        }
                        v[index] = joined
                    }
                }
            }
        }

        // Marching squares. An edge crossing is named by its edge: horizontal edges are even keys, vertical edges
        // odd. Every crossing joins exactly two segments, so the segments chain into loops.
        var points: [Int: CGPoint] = [:]
        var links: [Int: (Int, Int)] = [:]
        func value(_ i: Int, _ j: Int) -> Float { values[j * stride + i] }
        func point(_ key: Int) -> CGPoint {
            if let known = points[key] { return known }
            let index = key >> 1, i = index % stride, j = index / stride
            let (i2, j2) = key & 1 == 0 ? (i + 1, j) : (i, j + 1)
            let a = value(i, j), b = value(i2, j2)
            let t = CGFloat(a / (a - b))
            let p = CGPoint(x: CGFloat(x0) + (CGFloat(i) + t * CGFloat(i2 - i)) * cell,
                            y: CGFloat(y0) + (CGFloat(j) + t * CGFloat(j2 - j)) * cell)
            points[key] = p
            return p
        }
        func link(_ a: Int, _ b: Int) {
            if let (first, _) = links[a] { links[a] = (first, b) } else { links[a] = (b, -1) }
            if let (first, _) = links[b] { links[b] = (first, a) } else { links[b] = (a, -1) }
        }
        for j in 0..<ny {
            for i in 0..<nx {
                let v0 = value(i, j), v1 = value(i + 1, j), v2 = value(i + 1, j + 1), v3 = value(i, j + 1)
                let index = (v0 < 0 ? 1 : 0) | (v1 < 0 ? 2 : 0) | (v2 < 0 ? 4 : 0) | (v3 < 0 ? 8 : 0)
                if index == 0 || index == 15 { continue }
                let top = (j * stride + i) << 1, bottom = ((j + 1) * stride + i) << 1
                let left = ((j * stride + i) << 1) | 1, right = ((j * stride + i + 1) << 1) | 1
                let centre = (v0 + v1 + v2 + v3) / 4 < 0
                switch index {
                case 1, 14: link(left, top)
                case 2, 13: link(top, right)
                case 3, 12: link(left, right)
                case 4, 11: link(right, bottom)
                case 6, 9: link(top, bottom)
                case 7, 8: link(bottom, left)
                case 5:
                    if centre { link(top, right); link(bottom, left) } else { link(left, top); link(right, bottom) }
                case 10:
                    if centre { link(left, top); link(right, bottom) } else { link(top, right); link(bottom, left) }
                default: break
                }
            }
        }

        let path = CGMutablePath()
        var seen = Set<Int>()
        for start in links.keys where !seen.contains(start) {
            var loop: [CGPoint] = []
            var previous = -1, current = start
            while !seen.contains(current) {
                seen.insert(current)
                loop.append(point(current))
                guard let (a, b) = links[current] else { break }
                let next = a != previous ? a : b
                if next < 0 { break }
                previous = current
                current = next
            }
            if loop.count > 2 {
                path.addLines(between: loop)
                path.closeSubpath()
            }
        }
        return path
    }
}
