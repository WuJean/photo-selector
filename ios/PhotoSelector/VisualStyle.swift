import SwiftUI
import UIKit

enum PhotoPalette {
    static let accent = adaptive(
        light: UIColor(red: 0.08, green: 0.48, blue: 0.48, alpha: 1),
        dark: UIColor(red: 0.48, green: 0.79, blue: 0.73, alpha: 1)
    )

    static let onAccent = adaptive(
        light: .white,
        dark: UIColor(red: 0.07, green: 0.18, blue: 0.18, alpha: 1)
    )

    static let peach = adaptive(
        light: UIColor(red: 0.96, green: 0.72, blue: 0.62, alpha: 1),
        dark: UIColor(red: 0.54, green: 0.31, blue: 0.40, alpha: 1)
    )

    static let softTeal = adaptive(
        light: UIColor(red: 0.55, green: 0.77, blue: 0.71, alpha: 1),
        dark: UIColor(red: 0.22, green: 0.44, blue: 0.45, alpha: 1)
    )

    static let cardSurface = adaptive(
        light: UIColor(red: 1.00, green: 0.99, blue: 0.97, alpha: 1),
        dark: UIColor(red: 0.17, green: 0.15, blue: 0.22, alpha: 1)
    )

    static let glassStroke = adaptive(
        light: UIColor.white.withAlphaComponent(0.72),
        dark: UIColor.white.withAlphaComponent(0.13)
    )

    static let glassTint = adaptive(
        light: UIColor(red: 0.97, green: 0.87, blue: 0.79, alpha: 0.30),
        dark: UIColor(red: 0.52, green: 0.40, blue: 0.60, alpha: 0.24)
    )

    static let shadow = adaptive(
        light: UIColor(red: 0.31, green: 0.24, blue: 0.19, alpha: 0.12),
        dark: UIColor.black.withAlphaComponent(0.24)
    )

    static let lightSky = Color(red: 0.96, green: 0.80, blue: 0.69)
    static let deepSky = Color(red: 0.33, green: 0.29, blue: 0.45)

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

extension View {
    func photoBackdrop() -> some View {
        background {
            PhotoAmbientBackground()
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    func photoGlass(cornerRadius: CGFloat = 24) -> some View {
        modifier(PhotoGlassModifier(cornerRadius: cornerRadius))
    }
}

private struct PhotoAmbientBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(
                    colors: isDark
                        ? [Color(red: 0.10, green: 0.09, blue: 0.15), Color(red: 0.18, green: 0.13, blue: 0.22), Color(red: 0.10, green: 0.12, blue: 0.17)]
                        : [Color(red: 0.99, green: 0.97, blue: 0.93), Color(red: 0.97, green: 0.91, blue: 0.86), Color(red: 0.91, green: 0.95, blue: 0.92)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                if !reduceTransparency {
                    Circle()
                        .fill(isDark ? PhotoPalette.peach.opacity(0.16) : PhotoPalette.peach.opacity(0.25))
                        .frame(width: geometry.size.width * 0.88)
                        .blur(radius: 58)
                        .offset(x: geometry.size.width * 0.40, y: -geometry.size.height * 0.32)

                    Circle()
                        .fill(isDark ? PhotoPalette.softTeal.opacity(0.19) : PhotoPalette.softTeal.opacity(0.24))
                        .frame(width: geometry.size.width * 0.9)
                        .blur(radius: 64)
                        .offset(x: -geometry.size.width * 0.48, y: geometry.size.height * 0.42)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
    }
}

private struct PhotoGlassModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        Group {
            if reduceTransparency {
                solidCard(content, shape: shape)
            } else {
                glassCard(content, shape: shape)
            }
        }
    }

    @ViewBuilder
    private func glassCard(_ content: Content, shape: RoundedRectangle) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(PhotoPalette.glassTint), in: shape)
                .overlay(shape.strokeBorder(PhotoPalette.glassStroke, lineWidth: 1))
                .shadow(color: PhotoPalette.shadow, radius: 18, x: 0, y: 8)
        } else {
            materialCard(content, shape: shape)
        }
        #else
        materialCard(content, shape: shape)
        #endif
    }

    private func materialCard(_ content: Content, shape: RoundedRectangle) -> some View {
        content
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(PhotoPalette.glassStroke, lineWidth: 1))
            .shadow(color: PhotoPalette.shadow, radius: 18, x: 0, y: 8)
    }

    private func solidCard(_ content: Content, shape: RoundedRectangle) -> some View {
        content
            .background(Color(uiColor: .secondarySystemBackground), in: shape)
            .overlay(shape.strokeBorder(PhotoPalette.glassStroke, lineWidth: 1))
            .shadow(color: PhotoPalette.shadow, radius: 14, x: 0, y: 6)
    }
}

struct GlassSectionHeader: View {
    let title: String
    var subtitle: String = ""
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 42, height: 42)
                .background(PhotoPalette.accent.opacity(0.11), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

struct GuidedEmptyState: View {
    let title: String
    let message: String
    let symbol: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 66, height: 66)
                .background(PhotoPalette.accent.opacity(0.11), in: Circle())
                .accessibilityHidden(true)

            Text(title)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .padding(24)
        .photoGlass(cornerRadius: 28)
        .accessibilityElement(children: .combine)
    }
}

struct PhotoStoryIllustration: View {
    var height: CGFloat = 208

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height

            ZStack {
                Circle()
                    .fill(PhotoPalette.peach.opacity(0.20))
                    .frame(width: min(width * 0.68, height * 1.12))
                    .offset(x: -width * 0.12, y: height * 0.04)

                postcard(width: width * 0.43, height: height * 0.74, tint: PhotoPalette.softTeal)
                    .rotationEffect(.degrees(-10))
                    .offset(x: -width * 0.20, y: height * 0.05)

                postcard(width: width * 0.43, height: height * 0.78, tint: PhotoPalette.peach)
                    .rotationEffect(.degrees(9))
                    .offset(x: width * 0.19, y: -height * 0.01)

                Image(systemName: "sparkle")
                    .font(.system(size: 21, weight: .medium))
                    .foregroundStyle(PhotoPalette.accent)
                    .padding(12)
                    .background(PhotoPalette.cardSurface, in: Circle())
                    .overlay(Circle().strokeBorder(PhotoPalette.glassStroke, lineWidth: 1))
                    .shadow(color: PhotoPalette.shadow, radius: 12, x: 0, y: 5)
                    .offset(x: width * 0.34, y: -height * 0.33)
            }
            .frame(width: width, height: height)
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }

    private func postcard(width: CGFloat, height: CGFloat, tint: Color) -> some View {
        VStack(spacing: 0) {
            ZStack {
                LinearGradient(
                    colors: [PhotoPalette.lightSky.opacity(0.92), PhotoPalette.deepSky.opacity(0.65)],
                    startPoint: .top,
                    endPoint: .bottom
                )

                GeometryReader { geometry in
                    Circle()
                        .fill(Color(red: 1.0, green: 0.86, blue: 0.62))
                        .frame(width: geometry.size.width * 0.22)
                        .position(x: geometry.size.width * 0.73, y: geometry.size.height * 0.27)

                    LandscapeLayer(heights: [0.66, 0.31, 0.61, 0.38, 0.70])
                        .fill(tint.opacity(0.92))

                    LandscapeLayer(heights: [0.86, 0.56, 0.73, 0.48, 0.84])
                        .fill(PhotoPalette.accent.opacity(0.86))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(7)

            HStack(spacing: 5) {
                Circle()
                    .fill(tint)
                    .frame(width: 7, height: 7)
                Capsule().fill(PhotoPalette.accent.opacity(0.26)).frame(width: width * 0.34, height: 4)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 9)
        }
        .frame(width: width, height: height)
        .background(PhotoPalette.cardSurface, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 19, style: .continuous).strokeBorder(PhotoPalette.glassStroke, lineWidth: 1))
        .shadow(color: PhotoPalette.shadow, radius: 16, x: 0, y: 8)
    }
}

private struct LandscapeLayer: Shape {
    let heights: [CGFloat]

    func path(in rect: CGRect) -> Path {
        guard heights.count > 1 else { return Path() }
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        for (index, height) in heights.enumerated() {
            let progress = CGFloat(index) / CGFloat(heights.count - 1)
            path.addLine(to: CGPoint(x: rect.minX + rect.width * progress, y: rect.minY + rect.height * height))
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
