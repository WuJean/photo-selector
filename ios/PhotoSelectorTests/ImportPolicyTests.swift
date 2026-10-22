import XCTest
import UIKit
import PhotoCore
@testable import PhotoSelector

@MainActor
final class ImportPolicyTests: XCTestCase {
    /// One import must never register more photos than the documented limit.
    func testFileImportStopsAtThePerImportLimit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let folder = root.appendingPathComponent("shots", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let extra = 12
        for index in 0..<(ImportPolicy.maxPhotosPerImport + extra) {
            try jpeg(index).write(to: folder.appendingPathComponent("shot-\(index).jpg"))
        }
        let model = try AppModel(root: root.appendingPathComponent("library"), prepareAsset: { asset, _ in
            var prepared = asset; prepared.previewPath = "previews/\(asset.id).jpg"; return prepared
        })
        let batchID = try model.createBatch("测试")
        await model.importFiles([folder], batchID: batchID)

        XCTAssertEqual(model.state.assets.count, ImportPolicy.maxPhotosPerImport, "一次导入不能超过上限")
        XCTAssertEqual(model.state.batches.first?.photos.count, ImportPolicy.maxPhotosPerImport)
        XCTAssertEqual(model.alertTitle, "已按上限导入")
        XCTAssertTrue(model.error?.contains("超出") == true, "超出上限时必须告诉用户还有多少张没导入")
    }

    /// A small folder is imported completely and without a warning.
    func testSmallFileImportIsNotLimited() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let folder = root.appendingPathComponent("shots", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for index in 0..<5 { try jpeg(index).write(to: folder.appendingPathComponent("shot-\(index).jpg")) }
        let model = try AppModel(root: root.appendingPathComponent("library"), prepareAsset: { asset, _ in
            var prepared = asset; prepared.previewPath = "previews/\(asset.id).jpg"; return prepared
        })
        let batchID = try model.createBatch("测试")
        await model.importFiles([folder], batchID: batchID)

        XCTAssertEqual(model.state.assets.count, 5)
        XCTAssertNotEqual(model.alertTitle, "已按上限导入")
    }

    /// Every photo gets exactly one preview, even when several are compressed
    /// at the same time.
    func testConcurrentPreparationPreviewsEveryAssetExactlyOnce() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let probe = Counter()
        let model = try AppModel(root: root.appendingPathComponent("library"), prepareAsset: { asset, _ in
            probe.record(asset.id)
            try await Task.sleep(for: .milliseconds(1))
            var prepared = asset; prepared.previewPath = "previews/\(asset.id).jpg"; return prepared
        })
        let batchID = try model.createBatch("测试")
        let assets = (0..<40).map { index -> LocalAsset in
            var asset = LocalAsset(source: .owned, sourceID: "asset-\(index)", name: "\(index).jpg"); asset.id = "asset-\(index)"; return asset
        }
        try model.register(assets, batchID: batchID)
        model.startMediaPreparation()
        let finished = await eventually { model.state.assets.allSatisfy { $0.previewPath != nil } && model.progress.isEmpty }

        XCTAssertTrue(finished, "所有照片都应该拿到预览")
        XCTAssertEqual(probe.count, assets.count, "每张照片只准备一次")
        XCTAssertEqual(Set(probe.ids), Set(assets.map(\.id)))
    }

    /// Similar photos still land in the same group after the grouping rewrite.
    func testSimilarityGroupingIsUnchanged() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let media = try MediaStore(root: root)
        let taken = Date(timeIntervalSince1970: 1_000_000)
        var first = LocalAsset(source: .owned, sourceID: "first", name: "first.jpg")
        var second = LocalAsset(source: .owned, sourceID: "second", name: "second.jpg")
        var other = LocalAsset(source: .owned, sourceID: "other", name: "other.jpg")
        first.perceptualHash = 0b1010_1010; second.perceptualHash = 0b1010_1010; other.perceptualHash = 0b0101_0101
        first.takenAt = taken; second.takenAt = taken.addingTimeInterval(10); other.takenAt = taken

        let groups = await media.groups([first, second, other])
        XCTAssertEqual(groups.count, 2, "相同指纹的照片应该归为一组")
        XCTAssertEqual(groups.first { $0.contains(first.id) }, [first.id, second.id])
        XCTAssertTrue(groups.contains { $0 == [other.id] })
    }

    private func jpeg(_ index: Int) -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 80, height: 60), format: format).jpegData(withCompressionQuality: 0.8) { context in
            UIColor(hue: CGFloat(index % 12) / 12, saturation: 0.5, brightness: 0.7, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 80, height: 60))
        }
    }

    private func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
        for _ in 0..<400 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }
}

@MainActor
private final class Counter {
    private(set) var ids: [String] = []
    var count: Int { ids.count }
    func record(_ id: String) { ids.append(id) }
}
