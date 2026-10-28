import XCTest
import Photos
import UIKit
import PhotoCore
@testable import PhotoSelector

final class PhotoReferenceTests: XCTestCase {
    func testDisplayStreamsDegradedThenFinalLocalRendition() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let requested = expectation(description: "local PhotoKit request")
        let provider = StubPhotoKitImageProvider()
        provider.onImageRequest = { _ in requested.fulfill() }
        let media = try MediaStore(root: root, photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "photo-id", name: "photo.heic")
        let stream = await media.displayImages(asset, maxSize: 480)
        let consumer = Task { try await Self.collect(stream) }

        await fulfillment(of: [requested], timeout: 2)
        let low = Self.solidImage(.gray)
        let high = Self.solidImage(.orange)
        provider.completeImageRequest(at: 0, image: low, degraded: true)
        provider.completeImageRequest(at: 0, image: high, degraded: false)

        let images = try await consumer.value
        XCTAssertEqual(images.count, 2)
        XCTAssertTrue(images[0] === low)
        XCTAssertTrue(images[1] === high)
        let calls = provider.imageCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertFalse(calls[0].allowNetwork)
    }

    func testDisplayRetriesMissingLocalRenditionWithBoundedCloudThumbnail() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localRequested = expectation(description: "local PhotoKit request")
        let cloudRequested = expectation(description: "cloud thumbnail request")
        let provider = StubPhotoKitImageProvider()
        provider.onImageRequest = { call in
            (call.allowNetwork ? cloudRequested : localRequested).fulfill()
        }
        let media = try MediaStore(root: root, photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "icloud-photo-id", name: "photo.heic")
        let stream = await media.displayImages(asset, maxSize: 1200)
        let consumer = Task { try await Self.collect(stream) }

        await fulfillment(of: [localRequested], timeout: 2)
        provider.completeImageRequest(at: 0, image: nil, degraded: false)
        await fulfillment(of: [cloudRequested], timeout: 2)
        provider.completeImageRequest(at: 1, image: Self.solidImage(.purple), degraded: false)

        let images = try await consumer.value
        XCTAssertEqual(images.count, 1)
        let calls = provider.imageCalls
        XCTAssertEqual(calls.count, 2)
        XCTAssertFalse(calls[0].allowNetwork)
        XCTAssertEqual(calls[0].targetSize, CGSize(width: 1200, height: 1200))
        XCTAssertTrue(calls[1].allowNetwork)
        XCTAssertEqual(calls[1].targetSize, CGSize(width: 480, height: 480))
        XCTAssertEqual(provider.originalDataRequestCount, 0)
    }

    func testStalledLocalRequestTimesOutBeforeRequestingCloudThumbnail() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localRequested = expectation(description: "local PhotoKit request")
        let cloudRequested = expectation(description: "cloud thumbnail request")
        let provider = StubPhotoKitImageProvider()
        provider.onImageRequest = { call in
            (call.allowNetwork ? cloudRequested : localRequested).fulfill()
        }
        let media = try MediaStore(
            root: root,
            photoProvider: provider,
            localPhotoRequestTimeout: 0.02,
            networkPhotoRequestTimeout: 1
        )
        let asset = LocalAsset(source: .photos, sourceID: "icloud-photo-id", name: "photo.heic")
        let stream = await media.displayImages(asset, maxSize: 320)
        let consumer = Task { try await Self.collect(stream) }

        await fulfillment(of: [localRequested], timeout: 2)
        await fulfillment(of: [cloudRequested], timeout: 2)
        provider.completeImageRequest(at: 1, image: Self.solidImage(.purple), degraded: false)

        let images = try await consumer.value
        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(provider.cancelledRequestIDs, [1], "The stalled local-only request should be cancelled on timeout")
        XCTAssertEqual(provider.imageCalls.map(\.allowNetwork), [false, true])
    }

    func testSynchronousPhotoKitCallbackBeforeRequestIDInstallationIsDelivered() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let image = Self.solidImage(.blue)
        let provider = StubPhotoKitImageProvider()
        provider.synchronousImageResponse = (image, false, nil)
        let media = try MediaStore(root: root, photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "photo-id", name: "photo.heic")

        let images = try await Self.collect(await media.displayImages(asset, maxSize: 360))

        XCTAssertEqual(images.count, 1)
        XCTAssertTrue(images[0] === image)
        XCTAssertTrue(provider.cancelledRequestIDs.isEmpty)
    }

    func testCancellingDisplayCancelsTheActivePhotoKitRequest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let requested = expectation(description: "PhotoKit request")
        let cancelled = expectation(description: "PhotoKit request cancelled")
        let provider = StubPhotoKitImageProvider()
        provider.onImageRequest = { _ in requested.fulfill() }
        provider.onCancel = { _ in cancelled.fulfill() }
        let media = try MediaStore(root: root, photoProvider: provider)
        let asset = LocalAsset(source: .photos, sourceID: "photo-id", name: "photo.heic")
        let stream = await media.displayImages(asset, maxSize: 360)
        let consumer = Task { try await Self.collect(stream) }

        await fulfillment(of: [requested], timeout: 2)
        consumer.cancel()
        _ = await consumer.result
        await fulfillment(of: [cancelled], timeout: 2)
        XCTAssertEqual(provider.cancelledRequestIDs, [1])
    }

    func testCancellationBeforeRequestIDInstallationCancelsLateID() {
        let provider = StubPhotoKitImageProvider()
        let control = PhotoImageRequestControl(provider: provider)

        control.cancel()
        control.installRequestID(73)

        XCTAssertEqual(provider.cancelledRequestIDs, [73])
    }

    func testPhotoPreparationUsesSmallLocalThumbnailWithoutOriginalOrJPEG() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let thumbnail = Self.solidImage(.green)
        let provider = StubPhotoKitImageProvider()
        provider.synchronousImageResponse = (thumbnail, false, nil)
        let media = try MediaStore(root: root, photoProvider: provider, localPhotoRequestTimeout: 0.02)
        let asset = LocalAsset(source: .photos, sourceID: "photo-id", name: "photo.heic")

        let prepared = try await media.prepare(asset, allowNetwork: true)

        XCTAssertNotNil(prepared.perceptualHash)
        XCTAssertNil(prepared.previewPath)
        XCTAssertNil(prepared.digest)
        XCTAssertEqual(provider.originalDataRequestCount, 0)
        XCTAssertEqual(provider.imageCalls.count, 1)
        XCTAssertEqual(provider.imageCalls[0].targetSize, CGSize(width: 320, height: 320))
        XCTAssertFalse(provider.imageCalls[0].allowNetwork)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: media.url("previews").path).isEmpty)
    }

    func testOwnedPhotoCopyRemainsDisplayFallbackWhenPhotoKitIsUnavailable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let provider = StubPhotoKitImageProvider()
        let media = try MediaStore(root: root, photoProvider: provider, localPhotoRequestTimeout: 0.02)
        let original = Self.solidImage(.red)
        var asset = LocalAsset(source: .photos, sourceID: "missing-photo-id", name: "photo.jpg")
        asset.ownedPath = "originals/owned.jpg"
        try XCTUnwrap(original.jpegData(compressionQuality: 1)).write(to: media.url(asset.ownedPath!))

        let images = try await Self.collect(await media.displayImages(asset, maxSize: 300))

        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(provider.imageCalls.count, 1)
        XCTAssertFalse(provider.imageCalls[0].allowNetwork)
        XCTAssertEqual(provider.imageCalls[0].targetSize, CGSize(width: 300, height: 300))
    }

    private static func collect(_ stream: AsyncThrowingStream<UIImage, Error>) async throws -> [UIImage] {
        var images: [UIImage] = []
        for try await image in stream { images.append(image) }
        return images
    }

    private static func solidImage(_ color: UIColor) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24), format: format).image { context in
            color.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
        }
    }
}

private final class StubPhotoKitImageProvider: PhotoKitImageProviding {
    struct ImageCall {
        let identifier: String
        let targetSize: CGSize
        let deliveryMode: PhotoImageDeliveryMode
        let allowNetwork: Bool
    }

    private typealias ImageCompletion = (UIImage?, Bool, Error?) -> Void
    private let lock = NSLock()
    private var storedImageCalls: [ImageCall] = []
    private var imageCompletions: [ImageCompletion] = []
    private var storedCancelledRequestIDs: [PHImageRequestID] = []
    private var storedOriginalDataRequestCount = 0

    var onImageRequest: ((ImageCall) -> Void)?
    var onCancel: ((PHImageRequestID) -> Void)?
    var synchronousImageResponse: (UIImage?, Bool, Error?)?

    var imageCalls: [ImageCall] {
        lock.lock(); defer { lock.unlock() }
        return storedImageCalls
    }

    var cancelledRequestIDs: [PHImageRequestID] {
        lock.lock(); defer { lock.unlock() }
        return storedCancelledRequestIDs
    }

    var originalDataRequestCount: Int {
        lock.lock(); defer { lock.unlock() }
        return storedOriginalDataRequestCount
    }

    @discardableResult
    func requestImage(
        identifier: String,
        targetSize: CGSize,
        deliveryMode: PhotoImageDeliveryMode,
        allowNetwork: Bool,
        completion: @escaping (UIImage?, Bool, Error?) -> Void
    ) -> PHImageRequestID {
        let call = ImageCall(identifier: identifier, targetSize: targetSize, deliveryMode: deliveryMode, allowNetwork: allowNetwork)
        lock.lock()
        let requestID = PHImageRequestID(storedImageCalls.count + 1)
        storedImageCalls.append(call)
        imageCompletions.append(completion)
        let response = synchronousImageResponse
        let requestHandler = onImageRequest
        lock.unlock()

        requestHandler?(call)
        if let response { completion(response.0, response.1, response.2) }
        return requestID
    }

    @discardableResult
    func requestOriginalData(
        identifier: String,
        allowNetwork: Bool,
        completion: @escaping (Data?, Error?) -> Void
    ) -> PHImageRequestID {
        lock.lock()
        storedOriginalDataRequestCount += 1
        let requestID = PHImageRequestID(storedImageCalls.count + storedOriginalDataRequestCount + 1)
        lock.unlock()
        completion(nil, PhotoError.message("Unexpected original-data request in this test"))
        return requestID
    }

    func cancel(_ requestID: PHImageRequestID) {
        lock.lock()
        storedCancelledRequestIDs.append(requestID)
        let cancelHandler = onCancel
        lock.unlock()
        cancelHandler?(requestID)
    }

    func completeImageRequest(at index: Int, image: UIImage?, degraded: Bool, error: Error? = nil) {
        lock.lock()
        let completion = imageCompletions[index]
        lock.unlock()
        completion(image, degraded, error)
    }
}
