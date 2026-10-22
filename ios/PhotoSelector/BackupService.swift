import Foundation
import PhotoCore

actor BackupService {
    struct Manifest: Codable { var version = 1; var state: LocalLibraryState; var checksums: [String: String] }
    func export(state: LocalLibraryState, media: MediaStore, destination: URL, allowNetwork: Bool) async throws -> URL {
        let access = destination.startAccessingSecurityScopedResource(); defer { if access { destination.stopAccessingSecurityScopedResource() } }
        let folder = destination.appendingPathComponent("选片助手备份-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var snapshot = state; var checksums: [String: String] = [:]
        for i in snapshot.assets.indices {
            let asset = snapshot.assets[i]
            let source = try await media.exportOriginal(asset, allowNetwork: allowNetwork)
            let relative = "originals/\(asset.id).\(source.pathExtension)"
            try copy(source, to: folder.appendingPathComponent(relative)); checksums[relative] = try MediaStore.digest(folder.appendingPathComponent(relative))
            snapshot.assets[i].source = .owned; snapshot.assets[i].sourceID = ""; snapshot.assets[i].bookmark = nil; snapshot.assets[i].ownedPath = relative; snapshot.assets[i].previewPath = nil
            snapshot.assets[i].digest = checksums[relative]
        }
        for creation in snapshot.creations {
            if let path = creation.path { let source = try media.url(path); try copy(source, to: folder.appendingPathComponent(path)); checksums[path] = try MediaStore.digest(folder.appendingPathComponent(path)) }
        }
        snapshot.tasks = []; snapshot.undo = []
        let manifest = Manifest(state: snapshot, checksums: checksums)
        try JSONEncoder().encode(manifest).write(to: folder.appendingPathComponent("manifest.json"), options: .atomic)
        return folder
    }
    func restore(folder: URL, media: MediaStore) async throws -> LocalLibraryState {
        let access = folder.startAccessingSecurityScopedResource(); defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let manifestURL = folder.appendingPathComponent("manifest.json")
        let size = try manifestURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 50 * 1024 * 1024 else { throw PhotoError.message("备份清单过大") }
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
        guard manifest.version == 1, manifest.state.version == 1 else { throw PhotoError.message("不支持的备份版本") }
        let assetIDs = manifest.state.assets.map(\.id), portfolioIDs = manifest.state.portfolios.map(\.id)
        guard Set(assetIDs).count == assetIDs.count, Set(portfolioIDs).count == portfolioIDs.count,
              manifest.state.batches.allSatisfy({ $0.photos.allSatisfy { assetIDs.contains($0.assetID) } }),
              manifest.state.portfolios.allSatisfy({ $0.assetIDs.allSatisfy { assetIDs.contains($0) } }),
              manifest.state.creations.allSatisfy({ portfolioIDs.contains($0.collectionID) }) else { throw PhotoError.message("备份包含重复或无效引用") }
        for (path, expected) in manifest.checksums {
            _ = try media.url(path)
            let source = folder.appendingPathComponent(path)
            guard source.resolvingSymlinksInPath().path.hasPrefix(folder.resolvingSymlinksInPath().path + "/"), try MediaStore.digest(source) == expected else { throw PhotoError.message("备份文件校验失败：\(path)") }
        }
        var restored = manifest.state
        let idMap = Dictionary(uniqueKeysWithValues: restored.assets.map { ($0.id, UUID().uuidString) })
        let portfolioMap = Dictionary(uniqueKeysWithValues: restored.portfolios.map { ($0.id, UUID().uuidString) })
        for i in restored.assets.indices {
            guard let path = restored.assets[i].ownedPath, manifest.checksums[path] != nil else { throw PhotoError.message("备份缺少原片") }
            let id = idMap[restored.assets[i].id]!, newPath = "originals/\(id).\(URL(fileURLWithPath: path).pathExtension)"
            try copy(folder.appendingPathComponent(path), to: media.url(newPath))
            restored.assets[i].id = id; restored.assets[i].ownedPath = newPath; restored.assets[i].previewPath = nil; restored.assets[i].bookmark = nil; restored.assets[i].source = .owned; restored.assets[i].sourceID = id
        }
        for i in restored.batches.indices { restored.batches[i].id = UUID().uuidString; for j in restored.batches[i].photos.indices { guard let id = idMap[restored.batches[i].photos[j].assetID] else { throw PhotoError.message("备份资产引用无效") }; restored.batches[i].photos[j].assetID = id } }
        for i in restored.portfolios.indices { restored.portfolios[i].id = portfolioMap[restored.portfolios[i].id]!; restored.portfolios[i].assetIDs = restored.portfolios[i].assetIDs.compactMap { idMap[$0] }; restored.portfolios[i].coverID = restored.portfolios[i].coverID.flatMap { idMap[$0] } }
        for i in restored.creations.indices {
            restored.creations[i].id = UUID().uuidString; guard let collection = portfolioMap[restored.creations[i].collectionID] else { throw PhotoError.message("备份作品集引用无效") }; restored.creations[i].collectionID = collection; restored.creations[i].sourceIDs = restored.creations[i].sourceIDs.compactMap { idMap[$0] }
            if let path = restored.creations[i].path {
                guard manifest.checksums[path] != nil else { throw PhotoError.message("创作文件缺失") }
                let newPath = "creations/\(restored.creations[i].id).\(URL(fileURLWithPath: path).pathExtension)"; try copy(folder.appendingPathComponent(path), to: media.url(newPath)); restored.creations[i].path = newPath
            }
        }
        restored.tasks = []; restored.undo = []; restored.drafts = []
        return restored
    }
    private func copy(_ source: URL, to target: URL) throws {
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        var error: NSError?; var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], writingItemAt: target, options: [], error: &error) { from, to in result = Result { try FileManager.default.copyItem(at: from, to: to) } }
        if let error { throw error }; guard let result else { throw PhotoError.message("文件协调失败") }; try result.get()
    }
}
