import SwiftUI
import UIKit

/// Hinge posture of the device, mirrored from the system so the rest of the
/// app never has to reason about availability.
enum HingePosture: String, Sendable {
    case unknown
    case closed
    case partiallyOpen
    case fullyOpen

    /// Tent posture: the device stands like a tent on a table.
    var isTent: Bool { self == .partiallyOpen }
    /// How strongly the fold should be expressed visually.
    var foldIntensity: Double {
        switch self {
        case .closed: return 1
        case .partiallyOpen: return 0.68
        case .fullyOpen, .unknown: return 0
        }
    }
}

/// Observable hinge state shared by the whole app.
@MainActor final class HingeState: ObservableObject {
    @Published private(set) var posture: HingePosture = .unknown
    @Published private(set) var angle: Double = 0

    /// Applies a hinge update coming from the system.
    func apply(posture: HingePosture, angle: Double) {
        self.angle = angle
        self.posture = posture
    }
}

/// Reports hinge changes to a `HingeState`.
struct HingeObserver: ViewModifier {
    let state: HingeState?
    func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content.onHingeChange { _, newContext in
                state?.apply(posture: HingeObserver.posture(for: newContext.hinge?.status), angle: newContext.hinge?.angle.radians ?? 0)
            }
        } else {
            content
        }
        #else
        content
        #endif
    }

    #if compiler(>=6.4)
    @available(iOS 27.1, *)
    static func posture(for status: DeviceHinge.Status?) -> HingePosture {
        guard let status else { return .unknown }
        if status == .closed { return .closed }
        if status == .partiallyOpen { return .partiallyOpen }
        if status == .fullyOpen { return .fullyOpen }
        return .unknown
    }
    #endif
}

/// Soft gradient across the crease so a folded screen does not end in a hard
/// cut. The occlusion band reported by the system is veiled with a gradient
/// that fades in and out, plus a faint specular line where light catches the
/// fold.
struct FoldGradientOverlay: View {
    /// Active crease bands in the container's coordinate space.
    let bands: [CGRect]
    let intensity: Double

    var body: some View {
        Canvas { context, _ in
            guard intensity > 0.01 else { return }
            for rect in bands {
                guard rect.width > 0, rect.height > 0 else { continue }
                let horizontal = rect.width >= rect.height
                let shade = Color.black.opacity(0.34 * intensity)
                let sheen = Color.white.opacity(0.10 * intensity)

                var path = Path()
                path.addRect(rect)
                context.fill(path, with: .linearGradient(
                    Gradient(colors: [shade.opacity(0), shade, shade.opacity(0)]),
                    startPoint: horizontal ? CGPoint(x: rect.midX, y: rect.minY) : CGPoint(x: rect.minX, y: rect.midY),
                    endPoint: horizontal ? CGPoint(x: rect.midX, y: rect.maxY) : CGPoint(x: rect.maxX, y: rect.midY)
                ))

                // A hairline highlight exactly on the crease.
                var line = Path()
                if horizontal {
                    line.move(to: CGPoint(x: rect.minX, y: rect.midY))
                    line.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
                } else {
                    line.move(to: CGPoint(x: rect.midX, y: rect.minY))
                    line.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
                }
                context.stroke(line, with: .linearGradient(
                    Gradient(colors: [sheen.opacity(0), sheen, sheen.opacity(0)]),
                    startPoint: horizontal ? CGPoint(x: rect.minX, y: rect.midY) : CGPoint(x: rect.midX, y: rect.minY),
                    endPoint: horizontal ? CGPoint(x: rect.maxX, y: rect.midY) : CGPoint(x: rect.midX, y: rect.maxY)
                ), lineWidth: max(1, rect.height * 0.04))
            }
        }
        .allowsHitTesting(false)
        .animation(.smooth(duration: 0.45), value: intensity)
    }
}

/// Film grain laid over a view. The noise is deterministic so repeated renders
/// of the same frame look identical.
struct FilmGrainOverlay: View {
    var opacity: Double = 0.08

    var body: some View {
        Image(uiImage: FilmGrainOverlay.tile)
            .resizable(resizingMode: .tile)
            .blendMode(.overlay)
            .opacity(opacity)
            .allowsHitTesting(false)
    }

    static let tile: UIImage = {
        // A small tile keeps the grain fine on a phone screen; the poster
        // renderer draws its own noise at poster resolution.
        let size = 96
        var bytes = [UInt8](repeating: 0, count: size * size * 4)
        var state: UInt64 = 0x5DEECE66D
        for i in stride(from: 0, to: bytes.count, by: 4) {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            let value = UInt8(truncatingIfNeeded: state >> 33)
            bytes[i] = value; bytes[i + 1] = value; bytes[i + 2] = value; bytes[i + 3] = 255
        }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData),
              let cgImage = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
            return UIImage()
        }
        return UIImage(cgImage: cgImage)
    }()
}
