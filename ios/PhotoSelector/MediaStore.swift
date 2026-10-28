import Foundation
import UIKit
import Photos
import Vision
import ImageIO
import CryptoKit
import UniformTypeIdentifiers
import PhotoCore

struct FocalMetadata: Sendable {
    var focalLength: Double?
    var equivalentFocalLength: Double?
    var width: Int
    var height: Int
}

actor MediaStore {
    let root: URL
    private let photoProvider: PhotoKitImageProviding
    private let localPhotoRequestTimeout: TimeInterval
    private let networkPhotoRequestTimeout: TimeInterval
    init(
        root: URL,
        photoProvider: PhotoKitImageProviding = PhotosImageProvider(),
        localPhotoRequestTimeout: TimeInterval = 3,
        networkPhotoRequestTimeout: TimeInterval = 30
    ) throws {
        self.root = root
        self.photoProvider = photoProvider
        self.localPhotoRequestTimeout = max(0.01, localPhotoRequestTimeout)
        self.networkPhotoRequestTimeout = max(0.01, networkPhotoRequestTimeout)
        for folder in ["previews", "originals", "creations", "staging"] { try FileManager.default.createDirectory(at: root.appendingPathComponent(folder), withIntermediateDirectories: true) }
    }
    nonisolated func url(_ relative: String) throws -> URL {
        guard !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw PhotoError.message("无效资源路径") }
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        let rootPath = try Self.canonicalPath(canonicalRoot.path)
        let targetPath = try Self.canonicalPath(canonicalRoot.appendingPathComponent(relative).standardizedFileURL.path)
        let rootPrefix = rootPath == "/" ? "/" : rootPath + "/"
        guard targetPath != rootPath, targetPath.hasPrefix(rootPrefix) else {
            throw PhotoError.message("资源超出照片库")
        }
        return URL(fileURLWithPath: targetPath)
    }
    private static func canonicalPath(_ path: String) throws -> String {
        var pending = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        var resolved: [String] = []
        var followedSymlinks = 0
        while !pending.isEmpty {
            let component = pending.removeFirst()
            if component == "." { continue }
            if component == ".." {
                if !resolved.isEmpty { resolved.removeLast() }
                continue
            }
            let candidate = "/" + (resolved + [component]).joined(separator: "/")
            if let destination = try? FileManager.default.destinationOfSymbolicLink(atPath: candidate) {
                followedSymlinks += 1
                guard followedSymlinks <= 40 else { throw PhotoError.message("资源超出照片库") }
                if destination.hasPrefix("/") { resolved.removeAll() }
                pending = destination.split(separator: "/", omittingEmptySubsequences: true).map(String.init) + pending
            } else {
                resolved.append(component)
            }
        }
        return resolved.isEmpty ? "/" : "/" + resolved.joined(separator: "/")
    }
    func image(_ asset: LocalAsset, maxSize: Int = 1600, original: Bool = false, allowNetwork: Bool = false) async throws -> UIImage {
        if !original, let path = asset.previewPath, let source = CGImageSourceCreateWithURL(try url(path) as CFURL, nil), let cg = Self.thumbnail(source, maxSize: maxSize) { return UIImage(cgImage: cg) }
        if let path = asset.ownedPath { return try await decode(url(path), maxSize: maxSize) }
        if asset.source == .photos {
            if !original { return try await photoThumbnail(asset.sourceID, maxSize: maxSize, allowNetwork: allowNetwork) }
            let data = try await photoData(asset.sourceID, allowNetwork: allowNetwork)
            guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = Self.thumbnail(source, maxSize: maxSize) else { throw PhotoError.message("照片解码失败") }
            return UIImage(cgImage: image)
        }
        return try withExternal(asset) { file in
            guard let source = CGImageSourceCreateWithURL(file as CFURL, nil), let cg = Self.thumbnail(source, maxSize: maxSize) else { throw PhotoError.message("照片不可访问，请重新连接存储卡") }
            return UIImage(cgImage: cg)
        }
    }
    /// Streams local PhotoKit renditions as they arrive. If PhotoKit has no
    /// usable local image, request a bounded thumbnail over the network for
    /// this visible cell; never ask for the original here.
    func displayImages(_ asset: LocalAsset, maxSize: Int) async -> AsyncThrowingStream<UIImage, Error> {
        AsyncThrowingStream { continuation in
            let task = Task { [weak self] in
                guard let self else { continuation.finish(); return }
                do {
                    if asset.source == .photos {
                        try await self.produceDisplayImages(asset, maxSize: maxSize, continuation: continuation)
                    } else {
                        let image = try await self.image(asset, maxSize: maxSize)
                        try Task.checkCancellation()
                        if case .terminated = continuation.yield(image) { return }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }

    private enum PhotoImageResult {
        case image
        case failed(Error?)
        case cancelled
    }

    private func produceDisplayImages(
        _ asset: LocalAsset,
        maxSize: Int,
        continuation: AsyncThrowingStream<UIImage, Error>.Continuation
    ) async throws {
        var hasCachedImage = false
        if let path = asset.previewPath, let preview = try? await decode(url(path), maxSize: maxSize) {
            if case .terminated = continuation.yield(preview) { throw CancellationError() }
            hasCachedImage = true
        }
        if !hasCachedImage, let path = asset.ownedPath, let backup = try? await decode(url(path), maxSize: maxSize) {
            if case .terminated = continuation.yield(backup) { throw CancellationError() }
            hasCachedImage = true
        }

        let localRequest = photoImageEvents(
            id: asset.sourceID,
            maxSize: maxSize,
            deliveryMode: .opportunistic,
            allowNetwork: false
        )
        switch await emitPhotoImages(localRequest, continuation: continuation) {
        case .image:
            return
        case .cancelled:
            throw CancellationError()
        case .failed(let localError):
            if hasCachedImage { return }
            try Task.checkCancellation()
            // Cloud access is limited to the visible cell's display size and
            // runs only after PhotoKit reports that no local rendition exists.
            let cloudSize = min(max(1, maxSize), 480)
            let cloudRequest = photoImageEvents(
                id: asset.sourceID,
                maxSize: cloudSize,
                deliveryMode: .opportunistic,
                allowNetwork: true
            )
            switch await emitPhotoImages(cloudRequest, continuation: continuation) {
            case .image:
                return
            case .cancelled:
                throw CancellationError()
            case .failed(let cloudError):
                try Task.checkCancellation()
                throw cloudError ?? localError ?? PhotoError.message("照片未下载或授权已变化，请连接网络后重试")
            }
        }
    }

    private func emitPhotoImages(
        _ request: PhotoImageRequestEvents,
        continuation: AsyncThrowingStream<UIImage, Error>.Continuation
    ) async -> PhotoImageResult {
        await withTaskCancellationHandler {
            var receivedImage = false
            for await outcome in request.stream {
                if Task.isCancelled { return .cancelled }
                switch outcome {
                case .ignored:
                    continue
                case .image(let image, let final):
                    if case .terminated = continuation.yield(image) { return .cancelled }
                    receivedImage = true
                    if final { return .image }
                case .finished(let fallback, let error):
                    if let fallback {
                        if !receivedImage, case .terminated = continuation.yield(fallback) { return .cancelled }
                        return .image
                    }
                    return .failed(error)
                }
            }
            if Task.isCancelled { return .cancelled }
            return receivedImage ? .image : .failed(nil)
        } onCancel: {
            request.control.cancel()
        }
    }

    private func photoImageEvents(
        id: String,
        maxSize: Int,
        deliveryMode: PhotoImageDeliveryMode,
        allowNetwork: Bool
    ) -> PhotoImageRequestEvents {
        let pair = AsyncStream<PhotoImageRequestControl.CallbackOutcome>.makeStream(bufferingPolicy: .unbounded)
        let control = PhotoImageRequestControl(provider: photoProvider)
        pair.continuation.onTermination = { @Sendable _ in control.cancel() }
        control.installCancellationHandler { pair.continuation.finish() }

        let side = max(1, maxSize)
        let requestID = photoProvider.requestImage(
            identifier: id,
            targetSize: CGSize(width: side, height: side),
            deliveryMode: deliveryMode,
            allowNetwork: allowNetwork
        ) { image, degraded, error in
            let outcome = control.receive(image: image, degraded: degraded, error: error)
            switch outcome {
            case .ignored:
                break
            case .image(_, let final):
                pair.continuation.yield(outcome)
                if final { pair.continuation.finish() }
            case .finished:
                pair.continuation.yield(outcome)
                pair.continuation.finish()
            }
        }
        control.installRequestID(requestID)

        let timeoutSeconds = allowNetwork ? networkPhotoRequestTimeout : localPhotoRequestTimeout
        let timeoutNanoseconds = UInt64(timeoutSeconds * 1_000_000_000)
        let timeout = Task {
            do { try await Task.sleep(nanoseconds: timeoutNanoseconds) } catch { return }
            let outcome = control.timeOut(error: PhotoError.message("读取照片超时"))
            if case .ignored = outcome { return }
            pair.continuation.yield(outcome)
            pair.continuation.finish()
        }
        control.installTimeout(timeout)
        return PhotoImageRequestEvents(stream: pair.stream, control: control)
    }
    func decode(_ file: URL, maxSize: Int) async throws -> UIImage {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil), let image = Self.thumbnail(source, maxSize: maxSize) else { throw PhotoError.message("图片损坏或格式不受支持") }
        return UIImage(cgImage: image)
    }
    static func thumbnail(_ source: CGImageSource, maxSize: Int) -> CGImage? {
        CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxSize, kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }
    func prepare(_ input: LocalAsset, allowNetwork: Bool = false) async throws -> LocalAsset {
        var asset = input
        if asset.source == .external && asset.ownedPath == nil { asset.digest = try withExternal(asset) { try Self.digest($0) } }
        if asset.source == .photos {
            // Similarity enrichment needs only a small local rendition. Do not
            // download a Photos original or write an app-owned preview JPEG.
            let thumbnail = try await photoThumbnail(asset.sourceID, maxSize: 320, allowNetwork: false)
            guard let cg = thumbnail.cgImage else { throw PhotoError.message("无法读取照片缩略图") }
            return try await Self.renderPhotoFingerprint(cg, asset: asset)
        }
        let image = try await image(asset, maxSize: 1600, allowNetwork: allowNetwork)
        guard let cg = image.cgImage else { throw PhotoError.message("无法生成预览") }
        // JPEG encoding, the Vision feature print and the perceptual hash are
        // CPU bound. Running them off the actor lets several photos be
        // compressed at the same time instead of one after another.
        return try await Self.renderPreview(cg, asset: asset, destination: url("previews/\(asset.id).jpg"))
    }

    /// Reads EXIF only when the user opens focal-length filtering. PhotoKit is
    /// explicitly local-only here: iCloud-only originals remain unknown until
    /// they are already available on-device, and this path never downloads them.
    func focalMetadata(_ asset: LocalAsset) async throws -> FocalMetadata? {
        let data: Data
        if let path = asset.ownedPath, FileManager.default.fileExists(atPath: try url(path).path) {
            data = try Data(contentsOf: url(path), options: .mappedIfSafe)
        } else if asset.source == .photos {
            data = try await photoData(asset.sourceID, allowNetwork: false)
        } else if asset.source == .external {
            data = try withExternal(asset) { try Data(contentsOf: $0, options: .mappedIfSafe) }
        } else {
            return nil
        }
        return await Self.readFocalMetadata(data)
    }

    nonisolated private static func readFocalMetadata(_ data: Data) async -> FocalMetadata? {
        await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
            let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
            return FocalMetadata(
                focalLength: exif[kCGImagePropertyExifFocalLength] as? Double,
                equivalentFocalLength: (exif[kCGImagePropertyExifFocalLenIn35mmFilm] as? NSNumber)?.doubleValue,
                width: properties[kCGImagePropertyPixelWidth] as? Int ?? 0,
                height: properties[kCGImagePropertyPixelHeight] as? Int ?? 0
            )
        }.value
    }
    /// Encodes the preview, computes the similarity fingerprint and writes the
    /// thumbnail. Runs on a background executor so the actor stays responsive.
    nonisolated private static func renderPreview(_ cg: CGImage, asset: LocalAsset, destination: URL) async throws -> LocalAsset {
        try await Task.detached(priority: .userInitiated) {
            var asset = asset
            guard let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.83) else { throw PhotoError.message("无法生成预览") }
            try jpeg.write(to: destination, options: .atomic)
            asset.previewPath = "previews/\(asset.id).jpg"
            #if !targetEnvironment(simulator)
            let request = VNGenerateImageFeaturePrintRequest(); let handler = VNImageRequestHandler(cgImage: cg)
            // A feature-model failure must never make the photo unbrowseable.
            if (try? handler.perform([request])) != nil, let result = request.results?.first { asset.feature = try? NSKeyedArchiver.archivedData(withRootObject: result, requiringSecureCoding: true) }
            #endif
            asset.perceptualHash = Self.hash(cg)
            return asset
        }.value
    }
    /// Computes the lightweight similarity data for Photos without retaining
    /// image bytes or creating an app-owned display preview.
    nonisolated private static func renderPhotoFingerprint(_ cg: CGImage, asset: LocalAsset) async throws -> LocalAsset {
        try await Task.detached(priority: .utility) {
            var asset = asset
            #if !targetEnvironment(simulator)
            let request = VNGenerateImageFeaturePrintRequest(); let handler = VNImageRequestHandler(cgImage: cg)
            // A feature-model failure must never make the photo unbrowseable.
            if (try? handler.perform([request])) != nil, let result = request.results?.first { asset.feature = try? NSKeyedArchiver.archivedData(withRootObject: result, requiringSecureCoding: true) }
            #endif
            asset.perceptualHash = Self.hash(cg)
            return asset
        }.value
    }
    func externalAssets(_ selected: URL) throws -> [LocalAsset] {
        let scoped = selected.startAccessingSecurityScopedResource(); defer { if scoped { selected.stopAccessingSecurityScopedResource() } }
        let directory = (try selected.resourceValues(forKeys: [.isDirectoryKey])).isDirectory ?? false
        let bookmark = try selected.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        let files: [URL]
        if directory {
            files = (FileManager.default.enumerator(at: selected, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles, .skipsPackageDescendants])?.allObjects as? [URL] ?? [])
        } else { files = [selected] }
        return try files.filter { ["jpg", "jpeg", "png", "heic", "heif"].contains($0.pathExtension.lowercased()) }.sorted { $0.path < $1.path }.compactMap { file in
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { return nil }
            var asset = LocalAsset(source: .external, sourceID: directory ? String(file.path.dropFirst(selected.path.count + 1)) : "", name: file.lastPathComponent, bookmark: bookmark)
            if let source = CGImageSourceCreateWithURL(file as CFURL, nil) { Self.metadata(source, asset: &asset) }
            return asset
        }
    }
    private static func metadata(_ source: CGImageSource, asset: inout LocalAsset) {
        guard let p = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return }
        asset.width = p[kCGImagePropertyPixelWidth] as? Int ?? 0; asset.height = p[kCGImagePropertyPixelHeight] as? Int ?? 0
        if let exif = p[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            asset.focalLength = exif[kCGImagePropertyExifFocalLength] as? Double
            asset.equivalentFocalLength = (exif[kCGImagePropertyExifFocalLenIn35mmFilm] as? NSNumber)?.doubleValue
            if let time = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
                let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy:MM:dd HH:mm:ss"; asset.takenAt = f.date(from: time)
            }
        }
        if let tiff = p[kCGImagePropertyTIFFDictionary] as? [CFString: Any] { asset.camera = tiff[kCGImagePropertyTIFFModel] as? String }
    }
    private func withExternal<T>(_ asset: LocalAsset, action: (URL) throws -> T) throws -> T {
        guard let bookmark = asset.bookmark else { throw PhotoError.message("请重新连接来源文件夹") }
        var stale = false
        let base = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        let access = base.startAccessingSecurityScopedResource(); defer { if access { base.stopAccessingSecurityScopedResource() } }
        guard !asset.sourceID.split(separator: "/").contains(".."), !asset.sourceID.hasPrefix("/") else { throw PhotoError.message("来源路径无效") }
        let file = asset.sourceID.isEmpty ? base : base.appendingPathComponent(asset.sourceID)
        var coordinationError: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &coordinationError) { coordinated in result = Result { try action(coordinated) } }
        if let coordinationError { throw coordinationError }
        guard let result else { throw PhotoError.message("来源暂时不可访问") }
        return try result.get()
    }
    func sourceDigest(_ asset: LocalAsset) throws -> String { try withExternal(asset) { try Self.digest($0) } }
    func copyOriginal(_ input: LocalAsset, allowNetwork: Bool = false) async throws -> LocalAsset {
        var asset = input
        if let path = asset.ownedPath, FileManager.default.fileExists(atPath: try url(path).path) { return asset }
        let relative = "originals/\(asset.id).\(URL(fileURLWithPath: asset.name).pathExtension.lowercased())"
        let destination = try url(relative); let temporary = try url("staging/\(asset.id).partial")
        defer { try? FileManager.default.removeItem(at: temporary) }
        if asset.source == .photos {
            let data = try await photoData(asset.sourceID, allowNetwork: allowNetwork)
            try data.write(to: temporary, options: .atomic)
            asset.digest = try Self.digest(temporary)
        } else {
            let expected = try withExternal(asset) { source -> String in
                let before = try Self.digest(source)
                try? FileManager.default.removeItem(at: temporary)
                try FileManager.default.copyItem(at: source, to: temporary)
                guard try Self.digest(temporary) == before else { throw PhotoError.message("复制校验失败，请重试") }
                return before
            }
            if let old = asset.digest, old != expected { throw PhotoError.message("来源文件已变化，请重新导入") }
            asset.digest = expected
        }
        if FileManager.default.fileExists(atPath: destination.path) {
            guard try Self.digest(destination) == asset.digest else { throw PhotoError.message("目标原片冲突") }
        } else { try FileManager.default.moveItem(at: temporary, to: destination) }
        asset.ownedPath = relative
        return asset
    }
    func exportOriginal(_ asset: LocalAsset, allowNetwork: Bool = false) async throws -> URL {
        if let path = asset.ownedPath {
            let original = try url(path)
            try Self.verifyDigest(original, expected: asset.digest)
            return original
        }
        let ext = URL(fileURLWithPath: asset.name).pathExtension
        let exported = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhotoSelector-export-\(UUID().uuidString)")
            .appendingPathExtension(ext)
        var keepExport = false
        defer { if !keepExport { try? FileManager.default.removeItem(at: exported) } }
        if asset.source == .photos {
            try await photoData(asset.sourceID, allowNetwork: allowNetwork).write(to: exported, options: .atomic)
            try Self.verifyDigest(exported, expected: asset.digest)
        } else {
            try withExternal(asset) { source in
                let sourceDigest = try Self.digest(source)
                if let expected = asset.digest, sourceDigest != expected {
                    throw PhotoError.message("原片校验失败，文件可能已变化，请重新导入")
                }
                try FileManager.default.copyItem(at: source, to: exported)
                guard try Self.digest(exported) == sourceDigest else {
                    throw PhotoError.message("原片复制校验失败，请重试")
                }
            }
        }
        keepExport = true
        return exported
    }
    func removePreview(_ asset: LocalAsset) throws { if let path = asset.previewPath, FileManager.default.fileExists(atPath: try url(path).path) { try FileManager.default.removeItem(at: url(path)) } }
    private func awaitPhotoImage(id: String, maxSize: Int, allowNetwork: Bool) async throws -> UIImage {
        let request = photoImageEvents(
            id: id,
            maxSize: maxSize,
            deliveryMode: .highQuality,
            allowNetwork: allowNetwork
        )
        return try await withTaskCancellationHandler {
            var fallback: UIImage?
            for await outcome in request.stream {
                try Task.checkCancellation()
                switch outcome {
                case .ignored:
                    continue
                case .image(let image, let final):
                    fallback = image
                    if final { return image }
                case .finished(let lastImage, let error):
                    if let lastImage { return lastImage }
                    if let fallback { return fallback }
                    throw error ?? PhotoError.message("照片未下载或授权已变化")
                }
            }
            try Task.checkCancellation()
            if let fallback { return fallback }
            throw PhotoError.message("照片未下载或授权已变化")
        } onCancel: {
            request.control.cancel()
        }
    }
    func photoThumbnail(_ id: String, maxSize: Int, allowNetwork: Bool) async throws -> UIImage {
        try await awaitPhotoImage(id: id, maxSize: maxSize, allowNetwork: allowNetwork)
    }
    func photoData(_ id: String, allowNetwork: Bool) async throws -> Data {
        let control = PhotoOriginalDataRequestControl(provider: photoProvider)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard control.installContinuation(continuation) else { return }
                let requestID = photoProvider.requestOriginalData(identifier: id, allowNetwork: allowNetwork) { data, error in
                    control.receive(data: data, error: error)
                }
                control.installRequestID(requestID)
            }
        } onCancel: {
            control.cancel()
        }
    }
    static func digest(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }; var hash = SHA256()
        while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    static func verifyDigest(_ file: URL, expected: String?) throws {
        if let expected, try digest(file) != expected {
            throw PhotoError.message("原片校验失败，文件可能已变化，请重新导入")
        }
    }
    static func hash(_ image: CGImage) -> UInt64 {
        var pixels = [UInt8](repeating: 0, count: 64)
        guard let c = CGContext(data: &pixels, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 8, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return 0 }
        c.draw(image, in: CGRect(x: 0, y: 0, width: 8, height: 8)); let mean = pixels.reduce(0) { $0 + Int($1) } / 64
        return pixels.enumerated().reduce(UInt64(0)) { $0 | (Int($1.element) >= mean ? UInt64(1) << $1.offset : 0) }
    }
    nonisolated func groups(_ assets: [LocalAsset]) -> [[String]] {
        // Unarchiving a feature print is expensive. Comparing every candidate
        // against every group used to unarchive the same observations again
        // and again, which grew quadratically with the number of photos.
        struct Candidate {
            let asset: LocalAsset
            let observation: VNFeaturePrintObservation?
            let hasFeatureData: Bool
        }
        let candidates = assets.map { asset in
            let data = asset.feature
            let observation = data.flatMap { payload in
                try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: payload)
            }
            return Candidate(asset: asset, observation: observation, hasFeatureData: data != nil)
        }
        var groups: [[Candidate]] = []
        for candidate in candidates {
            if let index = groups.firstIndex(where: { group in
                guard let rep = group.first else { return false }
                if let a = candidate.asset.digest, a == rep.asset.digest { return true }
                if let a = candidate.asset.takenAt, let b = rep.asset.takenAt, abs(a.timeIntervalSince(b)) > 120 { return false }
                guard let a = candidate.asset.perceptualHash, let b = rep.asset.perceptualHash, (a ^ b).nonzeroBitCount <= 14 else { return false }
                guard candidate.hasFeatureData, rep.hasFeatureData else { return (a ^ b).nonzeroBitCount <= 5 }
                guard let fa = candidate.observation, let fb = rep.observation else { return false }
                var distance: Float = 100; try? fa.computeDistance(&distance, to: fb); return distance < 0.5
            }) { groups[index].append(candidate) } else { groups.append([candidate]) }
        }
        return groups.map { $0.map(\.asset.id) }
    }
}
