import CoreGraphics
import CoreImage
import Foundation
import UIKit

/// Builds the abstract artwork band on device.
///
/// When no image-generation model is configured the poster still needs a lower
/// band that belongs to the upper photograph. This renderer samples the
/// photograph on a coarse grid, keeps its colours in their original places and
/// turns them into a soft colour field, so the result is derived from that
/// specific photo instead of a generic texture.
enum LocalArtwork {
    static func make(from photo: UIImage, size: CGSize = CGSize(width: 640, height: 640), seed: UInt64 = 0x5DEECE66D) -> UIImage {
        let grid = (columns: 4, rows: 3)
        let samples = sampleGrid(from: photo, columns: grid.columns, rows: grid.rows)
        let working = CGSize(width: 160, height: 160)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let small = UIGraphicsImageRenderer(size: working, format: format).image { renderer in
            let context = renderer.cgContext
            // Deep base so the colour field reads as ink on paper.
            context.setFillColor(UIColor(white: 0.06, alpha: 1).cgColor)
            context.fill(CGRect(origin: .zero, size: working))
            for (index, sample) in samples.enumerated() {
                let center = CGPoint(x: sample.point.x * working.width, y: sample.point.y * working.height)
                let radius = working.width * (0.42 + 0.12 * Double(index % 3))
                let colors = [sample.color.withAlphaComponent(0.92).cgColor, sample.color.withAlphaComponent(0).cgColor] as CFArray
                guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) else { continue }
                context.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: radius, options: [])
            }
        }
        return upscale(small, to: size, seed: seed)
    }

    /// Reads one colour per grid cell, keeping the cell positions.
    static func sampleGrid(from photo: UIImage, columns: Int, rows: Int) -> [(point: CGPoint, color: UIColor)] {
        guard let cgImage = photo.cgImage, cgImage.width > 0, cgImage.height > 0 else {
            return (0..<(columns * rows)).map { _ in (point: CGPoint(x: 0.5, y: 0.5), color: UIColor.gray) }
        }
        let width = cgImage.width, height = cgImage.height
        let samples = (0..<(columns * rows)).map { index -> (point: CGPoint, color: UIColor) in
            let column = index % columns, row = index / columns
            let u = (CGFloat(column) + 0.5) / CGFloat(columns)
            let v = (CGFloat(row) + 0.5) / CGFloat(rows)
            let pixel = CGRect(x: (u * CGFloat(width)).rounded(.down), y: (v * CGFloat(height)).rounded(.down), width: 1, height: 1)
            return (point: CGPoint(x: u, y: v), color: color(of: cgImage, at: pixel) ?? .gray)
        }
        return samples
    }

    private static func color(of cgImage: CGImage, at rect: CGRect) -> UIColor? {
        guard let cropped = cgImage.cropping(to: rect.intersection(CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))), cropped.width > 0, cropped.height > 0 else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB), let bitmap = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        bitmap.interpolationQuality = .none
        bitmap.draw(cropped, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return UIColor(red: CGFloat(pixel[0]) / 255, green: CGFloat(pixel[1]) / 255, blue: CGFloat(pixel[2]) / 255, alpha: 1)
    }

    /// Gaussian blur used to keep the colour field painterly.
    private static func softened(_ image: UIImage, radius: Double) -> UIImage? {
        guard let input = CIImage(image: image),
              let filter = CIFilter(name: "CIGaussianBlur", parameters: [kCIInputImageKey: input, kCIInputRadiusKey: radius]),
              let output = filter.outputImage else { return nil }
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let cgImage = context.createCGImage(output, from: CGRect(origin: .zero, size: size(of: image))) else { return nil }
        return UIImage(cgImage: cgImage, scale: image.scale, orientation: image.imageOrientation)
    }

    private static func size(of image: UIImage) -> CGSize { image.size }

    /// Scales the colour field up with a soft Lanczos pass and a final grain.
    private static func upscale(_ image: UIImage, to size: CGSize, seed: UInt64) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let scaled = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            let context = renderer.cgContext
            context.interpolationQuality = .high
            image.draw(in: CGRect(origin: .zero, size: size))
            // A gentle blur keeps the field painterly instead of banded.
            if let softened = LocalArtwork.softened(image, radius: 14) {
                context.saveGState()
                context.setAlpha(0.55)
                softened.draw(in: CGRect(origin: .zero, size: size))
                context.restoreGState()
            }
            PosterRenderer.applyGrain(to: CGRect(origin: .zero, size: size), context: context, alpha: 0.08, seed: seed)
        }
        return scaled
    }
}
