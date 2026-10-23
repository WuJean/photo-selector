import XCTest
import SwiftUI
import UIKit
@testable import PhotoSelector

/// Pins the crease gradient that appears when the device folds.
@MainActor
final class FoldGradientTests: XCTestCase {
    /// Renders the overlay over a white page and reads pixels back.
    private func render(bands: [CGRect], intensity: Double) -> UIImage? {
        let view = FoldGradientOverlay(bands: bands, intensity: intensity)
            .frame(width: 100, height: 100)
            .background(Color.white)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        return renderer.uiImage
    }

    private func brightness(_ image: UIImage, x: Int, y: Int) -> Double? {
        guard let cgImage = image.cgImage, cgImage.width > x, cgImage.height > y else { return nil }
        var value = [UInt8](repeating: 0, count: 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let bitmap = CGContext(data: &value, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        bitmap.interpolationQuality = .none
        bitmap.draw(cgImage, in: CGRect(x: -x, y: -y, width: cgImage.width, height: cgImage.height))
        return (Double(value[0]) + Double(value[1]) + Double(value[2])) / 3 / 255
    }

    /// The crease is veiled with a gradient, so the middle of the band is
    /// darker than the untouched page.
    func testCreaseIsVeiledWithAGradient() throws {
        let image = try XCTUnwrap(render(bands: [CGRect(x: 40, y: 40, width: 20, height: 20)], intensity: 1))
        let inside = try XCTUnwrap(brightness(image, x: 50, y: 50))
        let outside = try XCTUnwrap(brightness(image, x: 10, y: 10))
        XCTAssertLessThan(inside, outside - 0.05, "折痕处应当被渐变压暗")
    }

    /// The veil is a gradient, not a flat plate: it fades towards the edges of
    /// the band.
    ///
    /// A band that is taller than it is wide is a vertical crease, so the
    /// gradient runs across the band and has to be sampled along x.
    func testCreaseFadesTowardsTheBandEdges() throws {
        let image = try XCTUnwrap(render(bands: [CGRect(x: 40, y: 20, width: 20, height: 60)], intensity: 1))
        let centre = try XCTUnwrap(brightness(image, x: 50, y: 50))
        let edge = try XCTUnwrap(brightness(image, x: 41, y: 50))
        XCTAssertLessThan(centre, edge, "折痕中心应当比边缘更暗")
    }

    /// A flat device shows no crease at all.
    func testFlatDeviceShowsNoCrease() throws {
        let image = try XCTUnwrap(render(bands: [CGRect(x: 40, y: 40, width: 20, height: 20)], intensity: 0))
        let inside = try XCTUnwrap(brightness(image, x: 50, y: 50))
        let outside = try XCTUnwrap(brightness(image, x: 10, y: 10))
        XCTAssertEqual(inside, outside, accuracy: 0.01)
    }

    /// The intensity follows the hinge posture.
    func testFoldIntensityFollowsTheHingePosture() {
        XCTAssertEqual(HingePosture.fullyOpen.foldIntensity, 0)
        XCTAssertEqual(HingePosture.unknown.foldIntensity, 0)
        XCTAssertGreaterThan(HingePosture.partiallyOpen.foldIntensity, 0)
        XCTAssertEqual(HingePosture.closed.foldIntensity, 1)
        XCTAssertTrue(HingePosture.partiallyOpen.isTent, "部分张开就是帐篷姿态")
        XCTAssertFalse(HingePosture.closed.isTent)
    }
}
