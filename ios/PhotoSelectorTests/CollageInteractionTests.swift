import XCTest
import PhotoCore
@testable import PhotoSelector

final class CollageInteractionTests: XCTestCase {
    func testCanvasFitsRatioWithoutCroppingTheCanvas() {
        XCTAssertEqual(
            CollageInteractionGeometry.aspectFit(aspect: 0.75, inside: CGSize(width: 600, height: 400)),
            CGSize(width: 300, height: 400)
        )
        XCTAssertEqual(
            CollageInteractionGeometry.aspectFit(aspect: 4.0 / 3.0, inside: CGSize(width: 400, height: 600)),
            CGSize(width: 400, height: 300)
        )
    }

    func testCropZoomIsClampedToRendererSupportedRange() {
        XCTAssertEqual(CollageCropMath.scale(starting: 1.5, magnification: 2), 3)
        XCTAssertEqual(CollageCropMath.scale(starting: 3, magnification: 2), 4)
        XCTAssertEqual(CollageCropMath.scale(starting: 1.5, magnification: 0.2), 1)
    }

    func testCropPanUsesCellNormalizedCoordinatesAndClampsExtremeDrag() {
        let moved = CollageCropMath.offset(
            origin: CGPoint(x: 0.25, y: -0.25),
            translation: CGSize(width: 100, height: -50),
            cellSize: CGSize(width: 200, height: 100)
        )
        XCTAssertEqual(moved.x, 0.75, accuracy: 0.0001)
        XCTAssertEqual(moved.y, -0.75, accuracy: 0.0001)

        let clamped = CollageCropMath.offset(
            origin: .zero,
            translation: CGSize(width: 10_000, height: -10_000),
            cellSize: CGSize(width: 100, height: 100)
        )
        XCTAssertEqual(clamped.x, CollageCropMath.maximumOffset)
        XCTAssertEqual(clamped.y, CollageCropMath.minimumOffset)
    }

    func testInteractiveFramesUseSameCoreLayoutAsExport() {
        var draft = CollageDraft(collectionID: "test")
        draft.layout = "grid"
        draft.gap = 24
        draft.frame = 30

        let previewSize = CGSize(width: 1200, height: 1600)
        let frames = CollageInteractionGeometry.frames(draft: draft, size: previewSize)

        // Export uses a 3000px long edge. The editor scales every geometry
        // value by the preview's long-edge ratio, so compare against the
        // actual export frames reduced to the preview size.
        let exportScale = 1600.0 / 3000.0
        let exportFrames = CollageLayout.frames(layout: "grid", width: 2250, height: 3000, gap: draft.gap, frame: draft.frame)
        let expected = exportFrames.map {
            LayoutRect(x: $0.x * exportScale, y: $0.y * exportScale, width: $0.width * exportScale, height: $0.height * exportScale)
        }
        XCTAssertEqual(frames.count, expected.count)
        for (actual, scaledExport) in zip(frames, expected) {
            XCTAssertEqual(actual.x, scaledExport.x, accuracy: 0.0001)
            XCTAssertEqual(actual.y, scaledExport.y, accuracy: 0.0001)
            XCTAssertEqual(actual.width, scaledExport.width, accuracy: 0.0001)
            XCTAssertEqual(actual.height, scaledExport.height, accuracy: 0.0001)
        }
    }

    func testRecommendationVersionRejectsEveryChangedSelectionConstraint() {
        let original = CollageRecommendationVersion(
            draftFingerprint: "draft-a",
            allFinalists: false,
            candidateFingerprint: "assets-a",
            requirements: [CollageSlot(subject: "人像", distance: "近景")],
            configuration: AIConfiguration(baseURL: "https://example.test/v1", model: "vision-a")
        )
        XCTAssertTrue(CollageRecommendationFreshness.canApply(started: original, current: original))

        var changed = original
        changed.draftFingerprint = "draft-b"
        XCTAssertFalse(CollageRecommendationFreshness.canApply(started: original, current: changed))

        changed = original
        changed.allFinalists = true
        XCTAssertFalse(CollageRecommendationFreshness.canApply(started: original, current: changed))

        changed = original
        changed.candidateFingerprint = "assets-b"
        XCTAssertFalse(CollageRecommendationFreshness.canApply(started: original, current: changed))

        changed = original
        changed.requirements = [CollageSlot(subject: "风景", distance: "远景")]
        XCTAssertFalse(CollageRecommendationFreshness.canApply(started: original, current: changed))

        changed = original
        changed.configuration.model = "vision-b"
        XCTAssertFalse(CollageRecommendationFreshness.canApply(started: original, current: changed))
    }
}
