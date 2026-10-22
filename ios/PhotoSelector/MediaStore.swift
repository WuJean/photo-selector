import Foundation
import UIKit
import Photos
import Vision
import ImageIO
import CryptoKit
import UniformTypeIdentifiers
import PhotoCore

actor MediaStore {
    let root: URL
    init(root: URL) throws {
        self.root = root
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
        if asset.source == .photos, let data = try? await photoData(asset.sourceID, allowNetwork: false), let source = CGImageSourceCreateWithData(data as CFData, nil) { Self.metadata(source, asset: &asset) }
        let image = try await image(asset, maxSize: 1600, allowNetwork: allowNetwork)
        guard let cg = image.cgImage, let jpeg = image.jpegData(compressionQuality: 0.83) else { throw PhotoError.message("无法生成预览") }
        let relative = "previews/\(asset.id).jpg"
        try jpeg.write(to: url(relative), options: .atomic); asset.previewPath = relative
        #if !targetEnvironment(simulator)
        let request = VNGenerateImageFeaturePrintRequest(); let handler = VNImageRequestHandler(cgImage: cg)
        // A feature-model failure must never make the photo unbrowseable.
        if (try? handler.perform([request])) != nil, let result = request.results?.first { asset.feature = try? NSKeyedArchiver.archivedData(withRootObject: result, requiringSecureCoding: true) }
        #endif
        asset.perceptualHash = Self.hash(cg)
        return asset
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
    func photoThumbnail(_ id: String, maxSize: Int, allowNetwork: Bool) async throws -> UIImage {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { throw PhotoError.message("照片不可访问，请检查相册授权") }
        return try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = allowNetwork; options.deliveryMode = .highQualityFormat; options.resizeMode = .fast
            PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: maxSize, height: maxSize), contentMode: .aspectFit, options: options) { image, info in
                if info?[PHImageResultIsDegradedKey] as? Bool == true { return }
                if let error = info?[PHImageErrorKey] as? Error { continuation.resume(throwing: error) }
                else if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: PhotoError.message("照片未下载或授权已变化")) }
            }
        }
    }
    func photoData(_ id: String, allowNetwork: Bool) async throws -> Data {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { throw PhotoError.message("照片不可访问，请检查相册授权") }
        return try await withCheckedThrowingContinuation { continuation in
            let options = PHImageRequestOptions(); options.isNetworkAccessAllowed = allowNetwork; options.version = .original; options.deliveryMode = .highQualityFormat
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                if let error = info?[PHImageErrorKey] as? Error { continuation.resume(throwing: error) }
                else if let data { continuation.resume(returning: data) }
                else { continuation.resume(throwing: PhotoError.message("原片在 iCloud 或不可访问；可启用 iCloud 下载后重试")) }
            }
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
    func groups(_ assets: [LocalAsset]) -> [[String]] {
        var groups: [[LocalAsset]] = []
        for asset in assets {
            if let index = groups.firstIndex(where: { group in
                guard let rep = group.first else { return false }
                if let a = asset.digest, a == rep.digest { return true }
                if let a = asset.takenAt, let b = rep.takenAt, abs(a.timeIntervalSince(b)) > 120 { return false }
                guard let a = asset.perceptualHash, let b = rep.perceptualHash, (a ^ b).nonzeroBitCount <= 14 else { return false }
                guard let x = asset.feature, let y = rep.feature else { return (a ^ b).nonzeroBitCount <= 5 }
                guard
                      let fa = try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: x),
                      let fb = try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: y) else { return false }
                var distance: Float = 100; try? fa.computeDistance(&distance, to: fb); return distance < 0.5
            }) { groups[index].append(asset) } else { groups.append([asset]) }
        }
        return groups.map { $0.map(\.id) }
    }
}
