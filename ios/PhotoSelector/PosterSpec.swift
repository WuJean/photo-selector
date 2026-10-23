import CoreGraphics
import Foundation

/// Geometry of the editorial poster.
///
/// The poster reproduces the iPhone Duo full-screen canvas exactly and is split
/// into two bands of strictly equal height:
///
/// * the upper half carries the original photograph, untouched;
/// * the lower half carries the generated artwork plus the editorial typography.
///
/// The Duo panel is 2007 x 2853 device pixels, an odd height that cannot be cut
/// into two whole pixel rows. The master raster is therefore rendered on twice
/// the device pixel grid (4014 x 5706), where 5706 / 2 = 2853 px falls on an
/// exact boundary. Both halves stay pixel-identical in height while the aspect
/// ratio still matches the Duo screen to the pixel.
enum PosterSpec {
    /// iPhone Duo full-screen size in points.
    static let pointSize = CGSize(width: 669, height: 951)
    /// iPhone Duo full-screen size in device pixels.
    static let pixelSize = CGSize(width: 2007, height: 2853)
    /// Master raster scale relative to the device pixel grid.
    static let masterScale: CGFloat = 2

    /// Full master canvas in pixels.
    static var canvasSize: CGSize { CGSize(width: pixelSize.width * masterScale, height: pixelSize.height * masterScale) }
    /// Height of the photographic band. Exactly half of the canvas.
    static var topHeight: CGFloat { canvasSize.height / 2 }
    /// Height of the artwork band. Exactly half of the canvas.
    static var bottomHeight: CGFloat { canvasSize.height / 2 }
    /// Frame of the photographic band.
    static var topFrame: CGRect { CGRect(x: 0, y: 0, width: canvasSize.width, height: topHeight) }
    /// Frame of the artwork band.
    static var bottomFrame: CGRect { CGRect(x: 0, y: topHeight, width: canvasSize.width, height: bottomHeight) }

    /// Aspect ratio of the Duo full-screen canvas.
    static var aspectRatio: CGFloat { pixelSize.width / pixelSize.height }
    /// The poster keeps the Duo ratio, never a generic page ratio.
    static var posterAspectRatio: CGFloat { canvasSize.width / canvasSize.height }

    /// True when the two bands are exactly equal in height.
    static var bandsAreEqual: Bool { topHeight == bottomHeight && topHeight == canvasSize.height / 2 }

    /// Type scale derived from the canvas width so the layout holds at any raster size.
    static func scaled(_ value: CGFloat) -> CGFloat { value * canvasSize.width / 1000 }
}
