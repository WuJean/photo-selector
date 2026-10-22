import XCTest
import UIKit
import PhotoCore
@testable import PhotoSelector

final class NativeTests: XCTestCase {
    func testChangedCardFileIsNotCopiedAsSelectedOriginal() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let input = folder.appendingPathComponent("card"), media = try MediaStore(root: folder.appendingPathComponent("library"))
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        let original = input.appendingPathComponent("photo.jpg")
        func jpeg(_ color: UIColor) -> Data {
            UIGraphicsImageRenderer(size: CGSize(width: 100, height: 100)).jpegData(withCompressionQuality: 0.9) { c in color.setFill(); c.fill(CGRect(x: 0, y: 0, width: 100, height: 100)) }
        }
        try jpeg(.red).write(to: original)
        let assets = try await media.externalAssets(input)
        let prepared = try await media.prepare(XCTUnwrap(assets.first))
        let originalDigest = try await media.sourceDigest(prepared)
        XCTAssertEqual(prepared.digest, originalDigest)
        let changed = jpeg(.blue); try changed.write(to: original)
        do { _ = try await media.copyOriginal(prepared); XCTFail("Changed source must not be accepted") } catch {}
        XCTAssertEqual(try Data(contentsOf: original), changed)
        XCTAssertFalse(FileManager.default.fileExists(atPath: try media.url("originals/\(prepared.id).jpg").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: try media.url("staging/\(prepared.id).partial").path))
    }
    func testOriginalCopyPreviewAndBackupRoundtrip() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let root = folder.appendingPathComponent("library"), input = folder.appendingPathComponent("card"), output = folder.appendingPathComponent("backups")
        try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 400), format: format).image { c in UIColor.orange.setFill(); c.fill(CGRect(x: 0, y: 0, width: 300, height: 400)) }
        let original = input.appendingPathComponent("sample.jpg"); try XCTUnwrap(image.jpegData(compressionQuality: 0.9)).write(to: original)
        let originalDigest = try MediaStore.digest(original)
        let media = try MediaStore(root: root)
        let imported = try await media.externalAssets(input); XCTAssertEqual(imported.count, 1)
        let prepared = try await media.prepare(imported[0]); XCTAssertNotNil(prepared.previewPath); XCTAssertNotNil(prepared.perceptualHash)
        let copied = try await media.copyOriginal(prepared); XCTAssertEqual(copied.digest, originalDigest)
        XCTAssertEqual(try MediaStore.digest(original), originalDigest)
        var state = LocalLibraryState(); state.assets = [copied]
        var batch = ImportBatch(name: "Test"); batch.photos = [BatchPhoto(copied.id)]; state.batches = [batch]
        try state.decide(batchID: batch.id, ids: [copied.id], round: .coarse, decision: .keep, focusID: copied.id)
        try state.decide(batchID: batch.id, ids: [copied.id], round: .fine, decision: .keep, focusID: copied.id)
        let portfolio = Portfolio(name: "旅行"); state.portfolios = [portfolio]; try state.addToPortfolio([copied.id], portfolioID: portfolio.id)
        let service = BackupService(); let saved = try await service.export(state: state, media: media, destination: output, allowNetwork: false)
        let restored = try await service.restore(folder: saved, media: media)
        XCTAssertEqual(restored.assets.count, 1); XCTAssertNotEqual(restored.assets[0].id, copied.id)
        XCTAssertEqual(restored.assets[0].digest, originalDigest); XCTAssertEqual(restored.portfolios[0].assetIDs, [restored.assets[0].id])
        XCTAssertNil(restored.assets[0].bookmark)
        try await media.removePreview(prepared); XCTAssertTrue(FileManager.default.fileExists(atPath: original.path))
        XCTAssertThrowsError(try media.url("../secret"))
    }
    func testCollageRenderSizeAndSourcePreserved() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); defer { try? FileManager.default.removeItem(at: root) }
        let media = try MediaStore(root: root); var assets: [LocalAsset] = []
        for color in [UIColor.red, .green, .blue] {
            var asset = LocalAsset(source: .owned, sourceID: UUID().uuidString, name: "test.jpg"); asset.ownedPath = "originals/\(asset.id).jpg"
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 100), format: format).image { c in color.setFill(); c.fill(CGRect(x: 0, y: 0, width: 200, height: 100)) }
            try image.jpegData(compressionQuality: 1)!.write(to: media.url(asset.ownedPath!)); assets.append(asset)
        }
        var draft = CollageDraft(collectionID: "test"); draft.cells = assets.map { CollageCell($0.id) }; draft.watermark = "测试"
        let result = try await CollageRenderer().render(draft: draft, assets: assets, media: media, longEdge: 1200, originals: true)
        XCTAssertEqual(result.size.width, 900); XCTAssertEqual(result.size.height, 1200)
        XCTAssertEqual(CollageLayout.frames(layout: "grid", width: 900, height: 1200, gap: 10, frame: 20).count, 4)
    }
    func testCorruptBackupDoesNotRestore() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); defer { try? FileManager.default.removeItem(at: root) }
        let media = try MediaStore(root: root)
        let folder = root.appendingPathComponent("backup"); try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let manifest = BackupService.Manifest(state: LocalLibraryState(), checksums: ["../outside": "bad"])
        try JSONEncoder().encode(manifest).write(to: folder.appendingPathComponent("manifest.json"))
        do { _ = try await BackupService().restore(folder: folder, media: media); XCTFail("Traversal must fail") } catch {}
    }
}

private final class MockAIProtocol: URLProtocol {
    static var status = 200
    static var payload = ""
    static var calls = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.calls += 1
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: [:])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.payload.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
extension NativeTests {
    func testRemoteAIValidationAndAuthentication() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [MockAIProtocol.self]
        let service = Intelligence(configuration: configuration)
        var config = AIConfiguration(); config.remoteEnabled = true; config.baseURL = "https://model.example/v1"; config.model = "mock"
        MockAIProtocol.status = 401; MockAIProtocol.calls = 0
        do { _ = try await service.response(prompt: "test", images: [], config: config, key: "test-only-key"); XCTFail("Authentication must fail") } catch Intelligence.Failure.unauthorized {} catch { XCTFail("\(error)") }
        XCTAssertEqual(MockAIProtocol.calls, 1)
        MockAIProtocol.status = 200; MockAIProtocol.calls = 0
        let invalid = "{\"subject\":\"库外标签\",\"distance\":\"远景\",\"extras\":[],\"description\":\"山峰\"}"
        MockAIProtocol.payload = String(data: try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": invalid]]]]), encoding: .utf8)!
        let image = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10)).image { c in UIColor.red.setFill(); c.fill(CGRect(x: 0, y: 0, width: 10, height: 10)) }
        MockAIProtocol.calls = 0
        do { _ = try await service.analyze(image, tags: LibraryTag.defaults, config: config, key: "test-only-key"); XCTFail("Invalid label must fail") } catch {}
        XCTAssertEqual(MockAIProtocol.calls, 2)
        config.baseURL = "http://insecure.example/v1"; MockAIProtocol.calls = 0
        do { _ = try await service.response(prompt: "test", images: [], config: config, key: "test-only-key"); XCTFail("HTTP must fail") } catch {}
        XCTAssertEqual(MockAIProtocol.calls, 0)
    }
}

extension NativeTests {
    func testThreeThousandJPEGProgressivePages() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); defer { try? FileManager.default.removeItem(at: root) }
        let media = try MediaStore(root: root), format = UIGraphicsImageRendererFormat(); format.scale = 1
        let data = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 3000), format: format).jpegData(withCompressionQuality: 0.8) { c in
            UIColor.darkGray.setFill(); c.fill(CGRect(x: 0, y: 0, width: 4000, height: 3000)); UIColor.orange.setFill(); c.fill(CGRect(x: 200, y: 100, width: 1600, height: 2000))
        }
        var assets: [LocalAsset] = []
        for i in 0..<3000 {
            var a = LocalAsset(source: .owned, sourceID: "stress-\(i)", name: "\(i).jpg"); a.ownedPath = "originals/\(i).jpg"
            try data.write(to: media.url(a.ownedPath!)); assets.append(a)
        }
        let began = Date()
        for offset in [0, 1480, 2960] {
            for asset in assets[offset..<(offset + 40)] {
                let image = try await media.image(asset, maxSize: 480)
                XCTAssertLessThanOrEqual(max(image.size.width, image.size.height), 480)
            }
        }
        print("3000 JPEG files / 120 progressive thumbnails: \(Date().timeIntervalSince(began)) seconds; source dimensions 4000×3000")
        XCTAssertEqual(assets.count, 3000)
    }
}
