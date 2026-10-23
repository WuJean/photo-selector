import XCTest
import UIKit
import PhotoCore
@testable import PhotoSelector

/// Pins the poster geometry, the fidelity of the photographic half and the
/// rule that every photograph is processed on its own.
final class PosterTests: XCTestCase {

    // MARK: - Helpers

    /// Solid colour image of the given size.
    private func image(width: Int, height: Int, _ color: UIColor) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: width, height: height)).image { context in
            color.setFill(); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    /// Image with a red band on top and a blue band at the bottom.
    private func stripedImage(size: Int) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { context in
            UIColor(red: 0.2, green: 0.8, blue: 0.3, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: size, height: size))
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: size, height: size / 10))
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: size - size / 10, width: size, height: size / 10))
        }
    }

    /// Reads a single pixel of an image.
    ///
    /// The image is drawn through UIKit so the row index is the one a reader
    /// sees; reading the raw bitmap would flip the image vertically and every
    /// band assertion would look at the wrong half.
    private func pixel(_ image: UIImage, x: Int, y: Int) -> (r: Double, g: Double, b: Double)? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let tiny = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1), format: format).image { _ in
            image.draw(in: CGRect(x: -CGFloat(x), y: -CGFloat(y), width: image.size.width, height: image.size.height))
        }
        guard let cgImage = tiny.cgImage else { return nil }
        var value = [UInt8](repeating: 0, count: 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let bitmap = CGContext(data: &value, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        bitmap.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return (Double(value[0]) / 255, Double(value[1]) / 255, Double(value[2]) / 255)
    }

    /// Components of a colour; iOS has no `redComponent` accessor.
    private func components(_ color: UIColor) -> (r: Double, g: Double, b: Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b))
    }

    // MARK: - Geometry

    /// The canvas must copy the Duo full-screen ratio and the two bands must be
    /// exactly equal.
    func testCanvasKeepsDuoRatioAndSplitsInHalf() {
        XCTAssertEqual(PosterSpec.pixelSize, CGSize(width: 2007, height: 2853))
        XCTAssertEqual(PosterSpec.pointSize, CGSize(width: 669, height: 951))
        XCTAssertEqual(PosterSpec.posterAspectRatio, PosterSpec.aspectRatio, accuracy: 0.000_001)
        XCTAssertTrue(PosterSpec.bandsAreEqual)
        XCTAssertEqual(PosterSpec.topHeight, PosterSpec.bottomHeight)
        XCTAssertEqual(PosterSpec.topHeight, PosterSpec.canvasSize.height / 2)
        // Both halves start and end where the spec says they do.
        XCTAssertEqual(PosterSpec.topFrame.minY, 0)
        XCTAssertEqual(PosterSpec.bottomFrame.minY, PosterSpec.topHeight)
        XCTAssertEqual(PosterSpec.bottomFrame.maxY, PosterSpec.canvasSize.height)
        XCTAssertEqual(PosterSpec.topFrame.height, PosterSpec.bottomFrame.height)
        // The split has to land on a whole pixel row, otherwise the two halves
        // cannot be equal.
        XCTAssertEqual(PosterSpec.topHeight, PosterSpec.topHeight.rounded())
    }

    // MARK: - Rendering

    /// The rendered poster has the specified size and the photograph sits in
    /// the upper half while the artwork sits in the lower half.
    func testRenderedPosterKeepsPhotoOnTopAndArtworkBelow() throws {
        let photo = image(width: 400, height: 400, .red)
        let artwork = image(width: 400, height: 400, .green)
        let poster = PosterRenderer.render(photo: photo, artwork: artwork, meta: PosterMeta(title: "测试", index: 1, total: 1))
        XCTAssertEqual(poster.size.width, PosterSpec.canvasSize.width)
        XCTAssertEqual(poster.size.height, PosterSpec.canvasSize.height)

        let middle = Int(PosterSpec.canvasSize.width / 2)
        let top = try XCTUnwrap(pixel(poster, x: middle, y: Int(PosterSpec.topHeight) - 3))
        // Sample inside the artwork band, past the colour blend that ties the
        // two halves together.
        let bottom = try XCTUnwrap(pixel(poster, x: middle, y: Int(PosterSpec.topHeight + PosterSpec.bottomHeight / 2)))
        XCTAssertGreaterThan(top.r, top.g, "上半部分必须是原始照片")
        XCTAssertGreaterThan(bottom.g, bottom.r, "下半部分必须是生成的抽象图")
    }

    /// The boundary between the two halves sits exactly on the midpoint.
    func testBandBoundaryIsExactlyHalfWayDown() throws {
        let poster = PosterRenderer.render(photo: image(width: 200, height: 200, .red), artwork: image(width: 200, height: 200, .green), meta: .placeholder)
        let middle = Int(PosterSpec.canvasSize.width / 2)
        let lastTopRow = try XCTUnwrap(pixel(poster, x: middle, y: Int(PosterSpec.topHeight) - 1))
        let insideBottom = try XCTUnwrap(pixel(poster, x: middle, y: Int(PosterSpec.topHeight + PosterSpec.bottomHeight / 2)))
        XCTAssertGreaterThan(lastTopRow.r, lastTopRow.g, "上半部分在分界线上仍是照片")
        XCTAssertGreaterThan(insideBottom.g, insideBottom.r, "分界线以下已经是抽象图")
    }

    /// The whole original frame survives: the photograph is fitted, never
    /// cropped, so the top and the bottom of the picture both remain visible.
    func testPhotographIsNotCropped() throws {
        let poster = PosterRenderer.render(photo: stripedImage(size: 400), artwork: image(width: 200, height: 200, .black), meta: .placeholder)
        let middle = Int(PosterSpec.canvasSize.width / 2)
        let nearTop = try XCTUnwrap(pixel(poster, x: middle, y: 12))
        let nearBottom = try XCTUnwrap(pixel(poster, x: middle, y: Int(PosterSpec.topHeight) - 12))
        XCTAssertGreaterThan(nearTop.r, nearTop.b, "照片顶部应当保留")
        XCTAssertGreaterThan(nearBottom.b, nearBottom.r, "照片底部应当保留")
    }

    /// Two photographs produce two different posters; a poster is never a
    /// collage of several photographs.
    func testEachPhotographProducesItsOwnPoster() throws {
        let red = PosterRenderer.render(photo: image(width: 200, height: 200, .red), artwork: image(width: 200, height: 200, .green), meta: .placeholder)
        let blue = PosterRenderer.render(photo: image(width: 200, height: 200, .blue), artwork: image(width: 200, height: 200, .green), meta: .placeholder)
        let middle = Int(PosterSpec.canvasSize.width / 2)
        let first = try XCTUnwrap(pixel(red, x: middle, y: Int(PosterSpec.topHeight) - 3))
        let second = try XCTUnwrap(pixel(blue, x: middle, y: Int(PosterSpec.topHeight) - 3))
        XCTAssertGreaterThan(first.r, first.b)
        XCTAssertGreaterThan(second.b, second.r)
        XCTAssertNotEqual(red.pngData(), blue.pngData())
    }

    /// Without a configured model the artwork is still derived from that one
    /// photograph.
    func testLocalArtworkKeepsTheColourOfItsPhotograph() throws {
        let red = LocalArtwork.make(from: image(width: 200, height: 200, .red), size: CGSize(width: 128, height: 128))
        let blue = LocalArtwork.make(from: image(width: 200, height: 200, .blue), size: CGSize(width: 128, height: 128))
        let redAverage = try XCTUnwrap(PosterRenderer.averageColor(of: red, region: .whole))
        let blueAverage = try XCTUnwrap(PosterRenderer.averageColor(of: blue, region: .whole))
        let redParts = components(redAverage)
        let blueParts = components(blueAverage)
        XCTAssertGreaterThan(redParts.r, redParts.b)
        XCTAssertGreaterThan(blueParts.b, blueParts.r)
    }
}

/// Keeps the configuration readable across the versions that existed before
/// the image model was introduced.
final class AIConfigurationTests: XCTestCase {
    func testConfigurationSavedBeforeImageModelStillDecodes() throws {
        let legacy = #"{"remoteEnabled":true,"baseURL":"https://example.com/v1","model":"vision-model"}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(AIConfiguration.self, from: legacy)
        XCTAssertTrue(decoded.remoteEnabled)
        XCTAssertEqual(decoded.baseURL, "https://example.com/v1")
        XCTAssertEqual(decoded.model, "vision-model")
        XCTAssertFalse(decoded.imageEnabled)
        XCTAssertEqual(decoded.imageModel, "")
        XCTAssertEqual(decoded.imageSize, "1024x1024")
    }

    func testImageSettingsSurviveARoundTrip() throws {
        let config = AIConfiguration(remoteEnabled: true, baseURL: "https://example.com/v1", model: "vision", imageEnabled: true, imageBaseURL: "https://images.example.com/v1", imageModel: "image-model", imageSize: "1024x1536")
        let decoded = try JSONDecoder().decode(AIConfiguration.self, from: try JSONEncoder().encode(config))
        XCTAssertEqual(decoded, config)
    }

    /// A model without a key, or a non-HTTPS host, is not usable and must not
    /// be treated as configured.
    func testImageModelIsOnlyConfiguredWithHostModelAndKey() {
        var config = AIConfiguration(imageEnabled: true, imageBaseURL: "https://images.example.com/v1", imageModel: "image-model")
        XCTAssertFalse(ImageGeneration.isConfigured(config: config, key: ""))
        XCTAssertTrue(ImageGeneration.isConfigured(config: config, key: "secret"))
        config.imageBaseURL = "http://images.example.com/v1"
        XCTAssertFalse(ImageGeneration.isConfigured(config: config, key: "secret"), "明文地址不得视为可用")
        config.imageBaseURL = "https://images.example.com/v1"
        config.imageEnabled = false
        XCTAssertFalse(ImageGeneration.isConfigured(config: config, key: "secret"))
    }

    /// The prompt asks for one abstract image, never a collage.
    func testPosterPromptAsksForASingleAbstractImage() {
        var asset = LocalAsset(source: .owned, sourceID: "x", name: "a.jpg")
        asset.analysis = PhotoAnalysis(subject: "风景", distance: "远景", extras: ["自然"], description: "海边日落", model: "fixture")
        let prompt = ImageGeneration.posterPrompt(for: asset)
        XCTAssertTrue(prompt.contains("no collage"))
        XCTAssertTrue(prompt.contains("one image only"))
        XCTAssertTrue(prompt.contains("海边日落"))
    }
}
