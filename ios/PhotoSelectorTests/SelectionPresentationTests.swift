import XCTest
import PhotoCore
@testable import PhotoSelector

final class SelectionPresentationTests: XCTestCase {
    func testOnlyDigestMatchesAreLabeledAsExactDuplicates() {
        var first = asset("a")
        var second = asset("b")
        let similar = asset("c")
        first.digest = "same-bytes"
        second.digest = "same-bytes"

        let group = [["a", "b", "c"]]
        let assets = [first, second, similar]
        XCTAssertEqual(SelectionPresentation.badge(for: "a", groups: group, assets: assets), "重复 2")
        XCTAssertEqual(SelectionPresentation.badge(for: "b", groups: group, assets: assets), "重复 2")
        XCTAssertEqual(SelectionPresentation.badge(for: "c", groups: group, assets: assets), "相似 3")
    }

    func testImmersiveOrderKeepsEachSimilarityGroupTogether() {
        let order = SelectionPresentation.immersiveOrder(
            ["a", "x", "b", "y", "c"],
            groups: [["a", "b", "c"]]
        )

        XCTAssertEqual(order, ["a", "b", "c", "x", "y"])
        XCTAssertEqual(Set(order).count, 5, "重新排序不能遗漏或重复照片")
    }

    func testLandscapeComparisonShowsAtMostThreeNeighborsAroundCurrentPhoto() {
        let group = (0..<10).map { "photo-\($0)" }

        XCTAssertEqual(
            SelectionPresentation.comparisonWindow(group, currentID: "photo-5"),
            ["photo-4", "photo-5", "photo-6"]
        )
        XCTAssertEqual(
            SelectionPresentation.comparisonWindow(group, currentID: "photo-0"),
            ["photo-0", "photo-1", "photo-2"]
        )
        XCTAssertEqual(
            SelectionPresentation.comparisonWindow(group, currentID: "photo-9"),
            ["photo-7", "photo-8", "photo-9"]
        )
    }

    func testNextDecisionWrapsToFirstUnresolvedPhotoWithoutSkipping() {
        let queue = ["a", "b", "c", "d"]

        XCTAssertEqual(
            SelectionPresentation.nextUnresolvedID(in: queue, after: "b", unresolved: ["c", "d"]),
            "c"
        )
        XCTAssertEqual(
            SelectionPresentation.nextUnresolvedID(in: queue, after: "d", unresolved: ["a", "c"]),
            "a",
            "After the last item, continue from the first still-unresolved item"
        )
        XCTAssertNil(SelectionPresentation.nextUnresolvedID(in: queue, after: "d", unresolved: []))
    }

    func testReviewPassMovesAcrossSnapshotOnceAndStopsAfterLastUnvisitedItem() {
        let queue = ["a", "b", "c"]

        XCTAssertEqual(
            SelectionPresentation.nextUnvisitedID(in: queue, after: "c", visited: ["a", "c"]),
            "b"
        )
        XCTAssertNil(SelectionPresentation.nextUnvisitedID(in: queue, after: "c", visited: ["a", "b", "c"]))
    }

    private func asset(_ id: String) -> LocalAsset {
        var value = LocalAsset(source: .owned, sourceID: id, name: "\(id).jpg")
        value.id = id
        return value
    }
}
