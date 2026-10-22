import Foundation

public struct LayoutRect: Equatable, Sendable {
    public var x: Double; public var y: Double; public var width: Double; public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
}
public enum CollageLayout {
    public static func frames(layout: String, width: Double, height: Double, gap: Double, frame: Double) -> [LayoutRect] {
        let inset = max(0, min(frame, min(width, height) / 8)), w = width - 2 * inset, h = height - 2 * inset
        let g = max(0, min(gap, min(w, h) / 10))
        switch layout {
        case "columns":
            let cw = (w - g * 2) / 3
            return (0..<3).map { LayoutRect(x: inset + Double($0) * (cw + g), y: inset, width: cw, height: h) }
        case "grid":
            let cw = (w - g) / 2, ch = (h - g) / 2
            return (0..<4).map { LayoutRect(x: inset + Double($0 % 2) * (cw + g), y: inset + Double($0 / 2) * (ch + g), width: cw, height: ch) }
        case "hero":
            let top = (h - g) * 0.6, bottom = h - g - top, cw = (w - g) / 2
            return [.init(x: inset, y: inset, width: w, height: top), .init(x: inset, y: inset + top + g, width: cw, height: bottom), .init(x: inset + cw + g, y: inset + top + g, width: cw, height: bottom)]
        default:
            let ch = (h - g * 2) / 3
            return (0..<3).map { LayoutRect(x: inset, y: inset + Double($0) * (ch + g), width: w, height: ch) }
        }
    }
}
