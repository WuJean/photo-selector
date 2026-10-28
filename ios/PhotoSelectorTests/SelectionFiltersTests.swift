import XCTest
import UIKit
import Photos
import ImageIO
import PhotoCore
@testable import PhotoSelector

final class SelectionFiltersTests: XCTestCase {
    func testOrientationClassifiesLandscapePortraitSquareAndUnknown() {
        XCTAssertEqual(PhotoOrientation.classify(width: 1600, height: 900), .landscape)
        XCTAssertEqual(PhotoOrientation.classify(width: 900, height: 1600), .portrait)
        XCTAssertEqual(PhotoOrientation.classify(width: 1000, height: 980), .square)
        XCTAssertEqual(PhotoOrientation.classify(width: 0, height: 100), .unknown)
    }

    func testCoarseFiltersOnlyByFocalClassAndOrientation() {
        let portrait = asset("portrait", focal: 85, width: 800, height: 1200, labels: ["人像", "近景"], description: "山间近景")
        let landscape = asset("landscape", focal: 24, width: 1600, height: 900, labels: ["风景", "远景"], description: "雪山远景")
        let result = SelectionFilters.filter(
            [portrait, landscape], mode: .coarse,
            query: "does-not-match", selectedTags: ["不存在"],
            selectedFocalClasses: ["中焦"], selectedOrientations: [.portrait]
        )
        XCTAssertEqual(result.map(\.id), [portrait.id])
    }

    func testFineFiltersByNameDescriptionAndSelectedAITags() {
        let portrait = asset("portrait", focal: 85, width: 800, height: 1200, labels: ["人像", "近景", "清冷"], description: "雪山下的旅行人像")
        let landscape = asset("landscape", focal: 24, width: 1600, height: 900, labels: ["风景", "远景", "清冷"], description: "雪山全景")

        let allMatches = SelectionFilters.filter(
            [portrait, landscape], mode: .fine,
            query: "雪山", selectedTags: ["清冷", "远景"], matchesAny: false,
            selectedFocalClasses: ["标准"]
        )
        XCTAssertEqual(allMatches.map(\.id), [landscape.id])

        let anyMatches = SelectionFilters.filter(
            [portrait, landscape], mode: .fine,
            query: "portrait", selectedTags: ["清冷", "远景"], matchesAny: true
        )
        XCTAssertEqual(anyMatches.map(\.id), [portrait.id])
    }

    func testAIConfigurationDefaultsRemoteAndMigratesSeparateImageKey() throws {
        XCTAssertTrue(AIConfiguration().remoteEnabled)
        XCTAssertTrue(AIConfiguration().imageUsesChatKey)

        let old = Data(#"{"remoteEnabled":false,"imageEnabled":true,"imageModel":"old-image-model"}"#.utf8)
        let migrated = try JSONDecoder().decode(AIConfiguration.self, from: old)
        XCTAssertFalse(migrated.remoteEnabled)
        XCTAssertFalse(migrated.imageUsesChatKey)
        XCTAssertEqual(migrated.imageModel, "old-image-model")
    }

    func testAIWithoutRemoteConfigurationDoesNotFallBackToDeviceModel() async {
        do {
            _ = try await Intelligence().response(prompt: "test", images: [], config: AIConfiguration(remoteEnabled: false), key: "")
            XCTFail("An unconfigured remote model should not run on-device")
        } catch Intelligence.Failure.notConfigured {
            // Expected: the queued task remains waiting for service configuration.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testFocalMetadataUsesPhotoKitLocalOnlyRequest() async throws {
        let provider = StubLocalPhotoProvider(data: try jpeg())
        let media = try MediaStore(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "local-photo-id", name: "photo.jpg")

        let metadata = try await media.focalMetadata(asset)

        XCTAssertFalse(provider.lastAllowNetwork)
        XCTAssertEqual(metadata?.width, 120)
        XCTAssertEqual(metadata?.height, 80)
        XCTAssertNil(metadata?.equivalentFocalLength)
    }

    private func asset(_ name: String, focal: Double, width: Int, height: Int, labels: [String], description: String) -> LocalAsset {
        var result = LocalAsset(source: .owned, sourceID: name, name: "\(name).jpg")
        result.equivalentFocalLength = focal
        result.width = width
        result.height = height
        result.analysis = PhotoAnalysis(subject: labels.first ?? "其他", distance: labels.dropFirst().first ?? "不确定", extras: Array(labels.dropFirst(2)), description: description, model: "test")
        return result
    }

    private func jpeg() throws -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 80), format: format).image { context in
            UIColor.orange.setFill(); context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        }
        return try XCTUnwrap(image.jpegData(compressionQuality: 0.9))
    }
}

private final class StubLocalPhotoProvider: PhotoKitImageProviding {
    let data: Data
    private(set) var lastAllowNetwork = true

    init(data: Data) { self.data = data }

    func requestImage(identifier: String, targetSize: CGSize, deliveryMode: PhotoImageDeliveryMode, allowNetwork: Bool, completion: @escaping (UIImage?, Bool, Error?) -> Void) -> PHImageRequestID {
        completion(nil, false, PhotoError.message("not used"))
        return 1
    }

    func requestOriginalData(identifier: String, allowNetwork: Bool, completion: @escaping (Data?, Error?) -> Void) -> PHImageRequestID {
        lastAllowNetwork = allowNetwork
        completion(data, nil)
        return 2
    }

    func cancel(_ requestID: PHImageRequestID) {}
}

@MainActor
final class FocalMetadataRegressionTests: XCTestCase {
    func testStalePreparationSnapshotCannotEraseNewFocalMetadata() throws {
        var current = LocalAsset(source: .photos, sourceID: "photo", name: "photo.jpg")
        current.focalLength = 35
        current.equivalentFocalLength = 50
        current.camera = "Camera"

        let stalePreparation = LocalAsset(source: .photos, sourceID: "photo", name: "photo.jpg")
        AppModel.mergePreparedMedia(stalePreparation, into: &current)

        XCTAssertEqual(current.focalLength, 35)
        XCTAssertEqual(current.equivalentFocalLength, 50)
        XCTAssertEqual(current.camera, "Camera")
    }

    func testMissingEXIFIsAttemptedOnceUntilExplicitRetry() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let provider = CountingPhotoProvider(data: try jpegWithFocalLength(nil))
        let model = try AppModel(root: root, photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "photo", name: "photo.jpg")
        try model.change { $0.assets = [asset] }

        await model.loadFocalMetadata(assetIDs: [asset.id])
        await model.loadFocalMetadata(assetIDs: [asset.id])
        XCTAssertEqual(provider.requestCount, 1, "reopening the filter must not re-read a missing EXIF item")
        XCTAssertEqual(model.state.assets.first?.width, 0, "empty focal metadata must not write the whole library")

        await model.retryFocalMetadata(assetIDs: [asset.id])
        XCTAssertEqual(provider.requestCount, 2, "explicit retry should allow another local-only lookup")
        XCTAssertEqual(provider.networkRequests, [false, false])
    }

    func testPreparationFlushPreservesEXIFReadWhileItWasSuspended() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = PreparationGate()
        let provider = CountingPhotoProvider(data: try jpegWithFocalLength(50))
        let model = try AppModel(root: root, prepareAsset: { asset, _ in
            await gate.suspend()
            var prepared = asset
            prepared.perceptualHash = 123
            return prepared
        }, photoProvider: provider)
        let batchID = try model.createBatch("metadata race")
        let asset = LocalAsset(source: .photos, sourceID: "photo", name: "photo.jpg")
        try model.register([asset], batchID: batchID)
        model.startMediaPreparation()
        await gate.waitUntilEntered()

        await model.loadFocalMetadata(assetIDs: [asset.id])
        XCTAssertEqual(model.state.assets.first?.equivalentFocalLength, 50)
        gate.release()

        let flushed = await eventually { model.state.assets.first?.perceptualHash == 123 }
        XCTAssertTrue(flushed)
        XCTAssertEqual(model.state.assets.first?.equivalentFocalLength, 50, "stale media preparation must merge instead of erasing newer EXIF")
        XCTAssertEqual(provider.networkRequests, [false])
    }

    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }

    private func jpegWithFocalLength(_ equivalent: Double?) throws -> Data {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 80), format: format).image { context in
            UIColor.orange.setFill(); context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        }
        guard let jpeg = image.jpegData(compressionQuality: 0.9) else { throw PhotoError.message("生成测试照片失败") }
        guard let equivalent else { return jpeg }

        // Build a minimal valid little-endian EXIF IFD. ImageIO's destination
        // writer omits FocalLenIn35mmFilm when supplied as a floating NSNumber,
        // which made the old race fixture contain no focal data at all.
        var tiff = Data([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00])
        func append16(_ value: UInt16, to data: inout Data) {
            data.append(UInt8(value & 0xff)); data.append(UInt8((value >> 8) & 0xff))
        }
        func append32(_ value: UInt32, to data: inout Data) {
            data.append(UInt8(value & 0xff)); data.append(UInt8((value >> 8) & 0xff))
            data.append(UInt8((value >> 16) & 0xff)); data.append(UInt8((value >> 24) & 0xff))
        }
        // IFD0: ExifIFDPointer -> offset 26.
        append16(1, to: &tiff)
        append16(0x8769, to: &tiff); append16(4, to: &tiff); append32(1, to: &tiff); append32(26, to: &tiff)
        append32(0, to: &tiff)
        // Exif IFD at 26; the focal rational is stored at offset 56.
        append16(2, to: &tiff)
        append16(0x920a, to: &tiff); append16(5, to: &tiff); append32(1, to: &tiff); append32(56, to: &tiff)
        append16(0xa405, to: &tiff); append16(3, to: &tiff); append32(1, to: &tiff); append32(UInt32(equivalent), to: &tiff)
        append32(0, to: &tiff)
        append32(35, to: &tiff); append32(1, to: &tiff)
        guard tiff.count == 64 else { throw PhotoError.message("生成测试 EXIF 失败") }

        var payload = Data([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]) // Exif\0\0
        payload.append(tiff)
        let segmentLength = payload.count + 2
        var segment = Data([0xff, 0xe1, UInt8(segmentLength >> 8), UInt8(segmentLength & 0xff)])
        segment.append(payload)
        guard jpeg.count >= 2, jpeg[0] == 0xff, jpeg[1] == 0xd8 else { throw PhotoError.message("测试 JPEG 无效") }
        var result = Data(jpeg.prefix(2)); result.append(segment); result.append(contentsOf: jpeg.dropFirst(2))

        guard let source = CGImageSourceCreateWithData(result as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any],
              let decoded = (exif[kCGImagePropertyExifFocalLenIn35mmFilm] as? NSNumber)?.doubleValue,
              decoded == equivalent else { throw PhotoError.message("测试 EXIF 焦段未能被 ImageIO 读取") }
        return result
    }
}

@MainActor
private final class PreparationGate {
    private var entered = false
    private var releaseRequested = false
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func suspend() async {
        entered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation in
            if releaseRequested { continuation.resume() }
            else { releaseContinuation = continuation }
        }
    }

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { enteredContinuation = $0 }
    }

    func release() {
        releaseRequested = true
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}

private final class CountingPhotoProvider: PhotoKitImageProviding, @unchecked Sendable {
    private let lock = NSLock()
    private let data: Data
    private var requests = 0
    private var networkFlags: [Bool] = []

    init(data: Data) { self.data = data }
    var requestCount: Int { lock.lock(); defer { lock.unlock() }; return requests }
    var networkRequests: [Bool] { lock.lock(); defer { lock.unlock() }; return networkFlags }

    func requestImage(identifier: String, targetSize: CGSize, deliveryMode: PhotoImageDeliveryMode, allowNetwork: Bool, completion: @escaping (UIImage?, Bool, Error?) -> Void) -> PHImageRequestID {
        completion(nil, false, PhotoError.message("not used"))
        return 1
    }

    func requestOriginalData(identifier: String, allowNetwork: Bool, completion: @escaping (Data?, Error?) -> Void) -> PHImageRequestID {
        lock.lock(); requests += 1; networkFlags.append(allowNetwork); lock.unlock()
        completion(data, nil)
        return 2
    }

    func cancel(_ requestID: PHImageRequestID) {}
}
