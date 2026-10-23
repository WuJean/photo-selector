import CoreGraphics
import Foundation
import UIKit

/// Editorial copy printed on the artwork band of a poster.
struct PosterMeta: Equatable, Sendable {
    var series = ""
    var title = ""
    var caption = ""
    var location = ""
    var date = Date()
    var index = 1
    var total = 1

    static let placeholder = PosterMeta(series: "EDITORIAL", title: "未命名", caption: "", location: "", date: Date(), index: 1, total: 1)
}

/// Draws the two-band editorial poster.
///
/// The upper band keeps the whole original frame visible: the photograph is
/// fitted, never cropped, so composition, faces and proportions survive
/// untouched. The remaining space is filled with a soft field built from the
/// photograph's own colours, so the band reads as one continuous image.
///
/// The lower band carries the generated artwork with the editorial typography.
/// Both bands are tied together by a colour gradient sampled from the
/// photograph and by a shared film grain, so they read as one printed cover
/// rather than two stacked pictures.
enum PosterRenderer {
    static func render(photo: UIImage, artwork: UIImage?, meta: PosterMeta, grainSeed: UInt64 = 0x9E3779B9) -> UIImage {
        let canvas = PosterSpec.canvasSize
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: canvas, format: format).image { renderer in
            let context = renderer.cgContext
            let top = PosterSpec.topFrame
            let bottom = PosterSpec.bottomFrame

            context.setFillColor(UIColor(white: 0.07, alpha: 1).cgColor)
            context.fill(CGRect(origin: .zero, size: canvas))

            drawPhotographBand(photo, in: top, context: context)
            drawArtworkBand(artwork, photo: photo, in: bottom, context: context)
            drawTypography(meta, in: bottom, context: context)
            applyGrain(to: CGRect(origin: .zero, size: canvas), context: context, alpha: 0.055, seed: grainSeed)
        }
    }

    // MARK: - Bands

    private static func drawPhotographBand(_ photo: UIImage, in rect: CGRect, context: CGContext) {
        context.saveGState()
        context.clip(to: rect)
        // The band is filled with a soft field built from the photograph's own
        // colours. Cropping and blurring a zoomed copy instead would drag a
        // dark, unrelated corner of the picture into the margins.
        let top = averageColor(of: photo, region: .upperThird) ?? UIColor(white: 0.10, alpha: 1)
        let bottom = averageColor(of: photo, region: .lowerThird) ?? UIColor(white: 0.07, alpha: 1)
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1]) {
            context.drawLinearGradient(gradient, start: CGPoint(x: rect.midX, y: rect.minY), end: CGPoint(x: rect.midX, y: rect.maxY), options: [])
        }
        // A soft light behind the picture lifts the centre of the band.
        if let light = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [UIColor.white.withAlphaComponent(0.16).cgColor, UIColor.white.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1]) {
            let radius = rect.height * 0.62
            context.drawRadialGradient(light, startCenter: CGPoint(x: rect.midX, y: rect.midY), startRadius: 0, endCenter: CGPoint(x: rect.midX, y: rect.midY), endRadius: radius, options: [])
        }
        // The photograph itself is fitted, not cropped: nothing of the original
        // frame is cut away.
        draw(photo, in: rect, mode: .fit, context: context)
        context.restoreGState()
    }

    private static func drawArtworkBand(_ artwork: UIImage?, photo: UIImage, in rect: CGRect, context: CGContext) {
        context.saveGState()
        context.clip(to: rect)
        if let artwork {
            draw(artwork, in: rect, mode: .fill, context: context)
        } else {
            context.setFillColor(UIColor(white: 0.12, alpha: 1).cgColor)
            context.fill(rect)
        }
        // Blend the seam: the colour of the photograph rises into the artwork
        // band so the two halves belong to the same printed object.
        if let tint = averageColor(of: photo, region: .lowerThird) {
            let colors = [tint.withAlphaComponent(0.75).cgColor, tint.withAlphaComponent(0).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                context.saveGState()
                context.clip(to: rect)
                context.drawLinearGradient(gradient, start: CGPoint(x: rect.minX, y: rect.minY), end: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.25), options: [])
                context.restoreGState()
            }
        }
        // Darken the lower part so the typography stays legible over any artwork.
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [UIColor.black.withAlphaComponent(0).cgColor, UIColor.black.withAlphaComponent(0.55).cgColor] as CFArray, locations: [0, 1]) {
            context.drawLinearGradient(gradient, start: CGPoint(x: rect.minX, y: rect.maxY - rect.height * 0.55), end: CGPoint(x: rect.minX, y: rect.maxY), options: [])
        }
        context.restoreGState()
    }

    // MARK: - Typography

    private static func drawTypography(_ meta: PosterMeta, in rect: CGRect, context: CGContext) {
        let margin = PosterSpec.scaled(34)
        let top = rect.minY + PosterSpec.scaled(30)

        let overline = NSAttributedString(string: meta.series.uppercased(), attributes: [
            .font: UIFont.systemFont(ofSize: PosterSpec.scaled(15), weight: .semibold),
            .foregroundColor: UIColor.white.withAlphaComponent(0.82),
            .kern: PosterSpec.scaled(2.4),
        ])
        overline.draw(in: CGRect(x: rect.minX + margin, y: top, width: rect.width - margin * 2, height: PosterSpec.scaled(24)))

        let titleSize = PosterSpec.scaled(46)
        let title = NSAttributedString(string: meta.title, attributes: [
            .font: serifFont(size: titleSize),
            .foregroundColor: UIColor.white.withAlphaComponent(0.96),
        ])
        let titleRect = CGRect(x: rect.minX + margin, y: top + PosterSpec.scaled(26), width: rect.width - margin * 2, height: titleSize * 1.5)
        title.draw(in: titleRect)

        // Hairline under the title block.
        let ruleY = titleRect.maxY + PosterSpec.scaled(6)
        context.setFillColor(UIColor.white.withAlphaComponent(0.35).cgColor)
        context.fill(CGRect(x: rect.minX + margin, y: ruleY, width: rect.width - margin * 2, height: max(1, PosterSpec.scaled(1.2))))

        // Bottom row: caption on the left, folio on the right.
        let bottom = rect.maxY - margin - PosterSpec.scaled(62)
        var captionText = meta.caption
        if !meta.location.isEmpty { captionText += captionText.isEmpty ? meta.location : "  ·  " + meta.location }
        let caption = NSAttributedString(string: captionText, attributes: [
            .font: UIFont.systemFont(ofSize: PosterSpec.scaled(19), weight: .regular),
            .foregroundColor: UIColor.white.withAlphaComponent(0.78),
        ])
        caption.draw(in: CGRect(x: rect.minX + margin, y: bottom, width: rect.width - margin * 2 - PosterSpec.scaled(150), height: PosterSpec.scaled(28)))

        let dateText = DateFormatter.poster.string(from: meta.date)
        let folio = NSAttributedString(string: "\(String(format: "%02d", meta.index)) / \(String(format: "%02d", meta.total))", attributes: [
            .font: UIFont.monospacedDigitSystemFont(ofSize: PosterSpec.scaled(22), weight: .medium),
            .foregroundColor: UIColor.white.withAlphaComponent(0.92),
        ])
        let folioSize = folio.size()
        folio.draw(at: CGPoint(x: rect.maxX - margin - folioSize.width, y: bottom - PosterSpec.scaled(3)))

        let date = NSAttributedString(string: dateText, attributes: [
            .font: UIFont.systemFont(ofSize: PosterSpec.scaled(15), weight: .regular),
            .foregroundColor: UIColor.white.withAlphaComponent(0.6),
            .kern: PosterSpec.scaled(1.2),
        ])
        let dateSize = date.size()
        date.draw(at: CGPoint(x: rect.maxX - margin - dateSize.width, y: bottom + PosterSpec.scaled(26)))
    }

    static func serifFont(size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .light)
        guard let descriptor = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: descriptor, size: size)
    }

    // MARK: - Helpers

    enum ContentMode { case fit, fill }

    static func draw(_ image: UIImage, in rect: CGRect, mode: ContentMode, context: CGContext) {
        guard image.size.width > 0, image.size.height > 0 else { return }
        let scale: CGFloat = mode == .fit ? min(rect.width / image.size.width, rect.height / image.size.height) : max(rect.width / image.size.width, rect.height / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let origin = CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2)
        context.saveGState()
        context.clip(to: rect)
        context.interpolationQuality = .high
        image.draw(in: CGRect(origin: origin, size: size))
        context.restoreGState()
    }

    enum ColorRegion { case upperThird, lowerThird, whole }

    /// Average colour of a horizontal band of the photograph.
    ///
    /// The band is rendered into a known RGBA8 bitmap so the read-back does not
    /// depend on the source image's pixel format.
    static func averageColor(of image: UIImage, region: ColorRegion) -> UIColor? {
        guard image.size.width > 0, image.size.height > 0, let cgImage = image.cgImage else { return nil }
        let width = cgImage.width, height = cgImage.height
        let band: CGRect
        switch region {
        case .upperThird: band = CGRect(x: 0, y: 0, width: width, height: height / 3)
        case .lowerThird: band = CGRect(x: 0, y: height - height / 3, width: width, height: height / 3)
        case .whole: band = CGRect(x: 0, y: 0, width: width, height: height)
        }
        guard band.width > 0, band.height > 0, let cropped = cgImage.cropping(to: band) else { return nil }
        // Render the band small; the average is meant to describe the colour
        // field, not every pixel of a large photo.
        let sampleWidth = 48, sampleHeight = 48
        var pixels = [UInt8](repeating: 0, count: sampleWidth * sampleHeight * 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB), let bitmap = CGContext(data: &pixels, width: sampleWidth, height: sampleHeight, bitsPerComponent: 8, bytesPerRow: sampleWidth * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        bitmap.interpolationQuality = .medium
        bitmap.draw(cropped, in: CGRect(x: 0, y: 0, width: sampleWidth, height: sampleHeight))
        var r = 0.0, g = 0.0, b = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            r += Double(pixels[i]); g += Double(pixels[i + 1]); b += Double(pixels[i + 2])
        }
        let count = Double(sampleWidth * sampleHeight)
        return UIColor(red: r / count / 255, green: g / count / 255, blue: b / count / 255, alpha: 1)
    }

    /// Deterministic film grain, tiled across the given rect.
    static func applyGrain(to rect: CGRect, context: CGContext, alpha: CGFloat, seed: UInt64) {
        guard alpha > 0 else { return }
        let tile = grainTile(size: 256, seed: seed)
        context.saveGState()
        context.setBlendMode(.overlay)
        context.setAlpha(alpha)
        var y = rect.minY
        while y < rect.maxY {
            var x = rect.minX
            while x < rect.maxX {
                context.draw(tile, in: CGRect(x: x, y: y, width: 256, height: 256))
                x += 256
            }
            y += 256
        }
        context.restoreGState()
    }

    static func grainTile(size: Int, seed: UInt64) -> CGImage {
        var bytes = [UInt8](repeating: 0, count: size * size * 4)
        var state = seed &* 6364136223846793005 &+ 1442695040888963407
        for i in stride(from: 0, to: bytes.count, by: 4) {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            let value = UInt8(truncatingIfNeeded: state >> 33)
            bytes[i] = value
            bytes[i + 1] = value
            bytes[i + 2] = value
            bytes[i + 3] = 255
        }
        let provider = CGDataProvider(data: Data(bytes) as CFData)!
        return CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    }
}

extension DateFormatter {
    static let poster: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy.MM.dd"
        return formatter
    }()
}
