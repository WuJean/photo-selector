import Foundation
import Photos
import UIKit
import PhotoCore

enum PhotoImageDeliveryMode {
    case opportunistic
    case highQuality
}

protocol PhotoKitImageProviding: AnyObject {
    @discardableResult
    func requestImage(
        identifier: String,
        targetSize: CGSize,
        deliveryMode: PhotoImageDeliveryMode,
        allowNetwork: Bool,
        completion: @escaping (UIImage?, Bool, Error?) -> Void
    ) -> PHImageRequestID

    @discardableResult
    func requestOriginalData(
        identifier: String,
        allowNetwork: Bool,
        completion: @escaping (Data?, Error?) -> Void
    ) -> PHImageRequestID

    func cancel(_ requestID: PHImageRequestID)
}

final class PhotosImageProvider: PhotoKitImageProviding {
    private let manager: PHCachingImageManager

    init(manager: PHCachingImageManager = PHCachingImageManager()) {
        self.manager = manager
        manager.allowsCachingHighQualityImages = false
    }

    @discardableResult
    func requestImage(
        identifier: String,
        targetSize: CGSize,
        deliveryMode: PhotoImageDeliveryMode,
        allowNetwork: Bool,
        completion: @escaping (UIImage?, Bool, Error?) -> Void
    ) -> PHImageRequestID {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else {
            completion(nil, false, PhotoError.message("照片不可访问，请检查相册授权"))
            return 0
        }

        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = allowNetwork
        options.deliveryMode = deliveryMode == .opportunistic ? .opportunistic : .highQualityFormat
        options.resizeMode = .fast
        return manager.requestImage(
            for: asset,
            targetSize: targetSize,
            contentMode: .aspectFit,
            options: options
        ) { image, info in
            let degraded = info?[PHImageResultIsDegradedKey] as? Bool ?? false
            let error = info?[PHImageErrorKey] as? Error
            completion(image, degraded, error)
        }
    }

    @discardableResult
    func requestOriginalData(
        identifier: String,
        allowNetwork: Bool,
        completion: @escaping (Data?, Error?) -> Void
    ) -> PHImageRequestID {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else {
            completion(nil, PhotoError.message("照片不可访问，请检查相册授权"))
            return 0
        }

        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = allowNetwork
        options.version = .original
        options.deliveryMode = .highQualityFormat
        return manager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
            completion(data, info?[PHImageErrorKey] as? Error)
        }
    }

    func cancel(_ requestID: PHImageRequestID) {
        guard requestID != 0 else { return }
        manager.cancelImageRequest(requestID)
    }
}

/// Coordinates PhotoKit's callback lifecycle with stream/continuation consumers.
/// The lock covers request-ID installation too, since PhotoKit or an injected
/// provider may invoke its callback before `requestImage` returns.
final class PhotoImageRequestControl: @unchecked Sendable {
    enum CallbackOutcome {
        case ignored
        case image(UIImage, final: Bool)
        case finished(fallback: UIImage?, error: Error?)
    }

    private let lock = NSLock()
    private let provider: PhotoKitImageProviding
    private var requestID: PHImageRequestID?
    private var finished = false
    private var cancelled = false
    private var fallbackImage: UIImage?
    private var timeoutTask: Task<Void, Never>?
    private var cancellationHandler: (() -> Void)?

    init(provider: PhotoKitImageProviding) {
        self.provider = provider
    }

    func installRequestID(_ requestID: PHImageRequestID) {
        lock.lock()
        self.requestID = requestID
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel { provider.cancel(requestID) }
    }

    func installTimeout(_ task: Task<Void, Never>) {
        lock.lock()
        let shouldCancel = cancelled || finished
        if !shouldCancel { timeoutTask = task }
        lock.unlock()
        if shouldCancel { task.cancel() }
    }

    func installCancellationHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        let callImmediately = cancelled
        if !cancelled && !finished { cancellationHandler = handler }
        lock.unlock()
        if callImmediately { handler() }
    }

    func receive(image: UIImage?, degraded: Bool, error: Error?) -> CallbackOutcome {
        lock.lock()
        guard !finished && !cancelled else {
            lock.unlock()
            return .ignored
        }

        if let image { fallbackImage = image }
        if let image {
            let isFinal = !degraded
            let task = isFinal ? timeoutTask : nil
            if isFinal {
                finished = true
                timeoutTask = nil
                cancellationHandler = nil
            }
            lock.unlock()
            task?.cancel()
            return .image(image, final: isFinal)
        }

        guard !degraded else {
            lock.unlock()
            return .ignored
        }
        finished = true
        let fallback = fallbackImage
        let task = timeoutTask
        timeoutTask = nil
        cancellationHandler = nil
        lock.unlock()
        task?.cancel()
        return .finished(fallback: fallback, error: error)
    }

    func timeOut(error: Error) -> CallbackOutcome {
        lock.lock()
        guard !finished && !cancelled else {
            lock.unlock()
            return .ignored
        }
        finished = true
        cancelled = true
        let fallback = fallbackImage
        let requestID = self.requestID
        let task = timeoutTask
        timeoutTask = nil
        cancellationHandler = nil
        lock.unlock()
        task?.cancel()
        if let requestID { provider.cancel(requestID) }
        return .finished(fallback: fallback, error: error)
    }

    func cancel() {
        lock.lock()
        guard !finished && !cancelled else {
            lock.unlock()
            return
        }
        cancelled = true
        finished = true
        let requestID = self.requestID
        let task = timeoutTask
        timeoutTask = nil
        let handler = cancellationHandler
        cancellationHandler = nil
        lock.unlock()
        task?.cancel()
        if let requestID { provider.cancel(requestID) }
        handler?()
    }
}

struct PhotoImageRequestEvents {
    let stream: AsyncStream<PhotoImageRequestControl.CallbackOutcome>
    let control: PhotoImageRequestControl
}

/// Finishes a one-shot original-data continuation exactly once, even when a
/// request is cancelled before PhotoKit returns its request ID.
final class PhotoOriginalDataRequestControl: @unchecked Sendable {
    private let lock = NSLock()
    private let provider: PhotoKitImageProviding
    private var requestID: PHImageRequestID?
    private var continuation: CheckedContinuation<Data, Error>?
    private var finished = false
    private var cancelled = false

    init(provider: PhotoKitImageProviding) {
        self.provider = provider
    }

    func installContinuation(_ continuation: CheckedContinuation<Data, Error>) -> Bool {
        lock.lock()
        guard !cancelled && !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return false
        }
        self.continuation = continuation
        lock.unlock()
        return true
    }

    func installRequestID(_ requestID: PHImageRequestID) {
        lock.lock()
        self.requestID = requestID
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel { provider.cancel(requestID) }
    }

    func receive(data: Data?, error: Error?) {
        lock.lock()
        guard !finished && !cancelled, let continuation else {
            lock.unlock()
            return
        }
        finished = true
        self.continuation = nil
        lock.unlock()

        if let error { continuation.resume(throwing: error) }
        else if let data { continuation.resume(returning: data) }
        else { continuation.resume(throwing: PhotoError.message("原片在 iCloud 或不可访问；可启用 iCloud 下载后重试")) }
    }

    func cancel() {
        lock.lock()
        guard !finished && !cancelled else {
            lock.unlock()
            return
        }
        cancelled = true
        finished = true
        let requestID = self.requestID
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()

        if let requestID { provider.cancel(requestID) }
        continuation?.resume(throwing: CancellationError())
    }
}
