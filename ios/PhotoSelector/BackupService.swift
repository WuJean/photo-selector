import Foundation
import PhotoCore

actor BackupService {
    struct Manifest: Codable { var version = 1; var state: LocalLibraryState; var checksums: [String: String] }
    func export(state: LocalLibraryState, media: MediaStore, destination: URL, allowNetwork: Bool) async throws -> URL {
        let access = destination.startAccessingSecurityScopedResource(); defer { if access { destination.stopAccessingSecurityScopedResource() } }
        let folder = destination.appendingPathComponent("选片助手备份-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var completed = false
        defer { if !completed { try? FileManager.default.removeItem(at: folder) } }
        var temporaryExports: [URL] = []
        defer { for file in temporaryExports { try? FileManager.default.removeItem(at: file) } }
        var snapshot = state; var checksums: [String: String] = [:]
        for i in snapshot.assets.indices {
            let asset = snapshot.assets[i]
            let source = try await media.exportOriginal(asset, allowNetwork: allowNetwork)
            if asset.ownedPath == nil { temporaryExports.append(source) }
            let relative = "originals/\(asset.id).\(source.pathExtension)"
            let backupFile = folder.appendingPathComponent(relative)
            try copy(source, to: backupFile)
            let digest = try MediaStore.digest(backupFile)
            if let expected = asset.digest, expected != digest {
                throw PhotoError.message("原片校验失败，备份已取消")
            }
            checksums[relative] = digest
            snapshot.assets[i].source = .owned; snapshot.assets[i].sourceID = ""; snapshot.assets[i].bookmark = nil; snapshot.assets[i].ownedPath = relative; snapshot.assets[i].previewPath = nil
            snapshot.assets[i].digest = digest
        }
        for creation in snapshot.creations {
            if let path = creation.path { let source = try media.url(path); try copy(source, to: folder.appendingPathComponent(path)); checksums[path] = try MediaStore.digest(folder.appendingPathComponent(path)) }
        }
        snapshot.tasks = []; snapshot.undo = []
        let manifest = Manifest(state: snapshot, checksums: checksums)
        try JSONEncoder().encode(manifest).write(to: folder.appendingPathComponent("manifest.json"), options: .atomic)
        completed = true
        return folder
    }
    func restore(folder: URL, media: MediaStore) async throws -> LocalLibraryState {
        let access = folder.startAccessingSecurityScopedResource(); defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let manifestURL = folder.appendingPathComponent("manifest.json")
        let backupRoot = folder.resolvingSymlinksInPath().standardizedFileURL
        let manifestValues = try manifestURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        let resolvedManifest = manifestURL.resolvingSymlinksInPath().standardizedFileURL
        guard manifestValues.isRegularFile == true, manifestValues.isSymbolicLink != true,
              resolvedManifest.path.hasPrefix(backupRoot.path + "/") else { throw PhotoError.message("备份清单路径无效") }
        let size = manifestValues.fileSize ?? 0
        guard size <= 50 * 1024 * 1024 else { throw PhotoError.message("备份清单过大") }
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
        guard manifest.version == 1, manifest.state.version == 1 else { throw PhotoError.message("不支持的备份版本") }
        let assetIDs = manifest.state.assets.map(\.id), portfolioIDs = manifest.state.portfolios.map(\.id)
        let assetIDSet = Set(assetIDs)
        guard Set(assetIDs).count == assetIDs.count, Set(portfolioIDs).count == portfolioIDs.count,
              manifest.state.batches.allSatisfy({ $0.photos.allSatisfy { assetIDs.contains($0.assetID) } }),
              manifest.state.portfolios.allSatisfy({ $0.assetIDs.allSatisfy { assetIDs.contains($0) } && ($0.coverID.map { assetIDSet.contains($0) } ?? true) }),
              manifest.state.creations.allSatisfy({ portfolioIDs.contains($0.collectionID) && $0.sourceIDs.allSatisfy { assetIDSet.contains($0) } }) else { throw PhotoError.message("备份包含重复或无效引用") }
        for (path, expected) in manifest.checksums {
            _ = try media.url(path)
            let source = folder.appendingPathComponent(path).standardizedFileURL
            let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            let resolved = source.resolvingSymlinksInPath().standardizedFileURL
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  resolved.path.hasPrefix(backupRoot.path + "/"), try MediaStore.digest(resolved) == expected else { throw PhotoError.message("备份文件校验失败：\(path)") }
        }
        let restoreWorkspace = try media.url("staging/restore-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: restoreWorkspace, withIntermediateDirectories: false)
        var createdFiles: [URL] = []
        var restoreCompleted = false
        defer {
            if !restoreCompleted {
                for file in createdFiles.reversed() { try? FileManager.default.removeItem(at: file) }
            }
            try? FileManager.default.removeItem(at: restoreWorkspace)
        }
        var restored = manifest.state
        let idMap = Dictionary(uniqueKeysWithValues: restored.assets.map { ($0.id, UUID().uuidString) })
        let portfolioMap = Dictionary(uniqueKeysWithValues: restored.portfolios.map { ($0.id, UUID().uuidString) })
        for i in restored.assets.indices {
            guard let path = restored.assets[i].ownedPath, path.hasPrefix("originals/"),
                  let expected = manifest.checksums[path],
                  restored.assets[i].digest == nil || restored.assets[i].digest == expected else { throw PhotoError.message("备份缺少原片或摘要不匹配") }
            let id = idMap[restored.assets[i].id]!, newPath = "originals/\(id).\(URL(fileURLWithPath: path).pathExtension)"
            let target = try media.url(newPath)
            try copyForRestore(folder.appendingPathComponent(path), to: target, using: restoreWorkspace, createdFiles: &createdFiles)
            guard try MediaStore.digest(target) == expected else { throw PhotoError.message("备份原片复制校验失败") }
            restored.assets[i].id = id; restored.assets[i].ownedPath = newPath; restored.assets[i].previewPath = nil; restored.assets[i].bookmark = nil; restored.assets[i].source = .owned; restored.assets[i].sourceID = id; restored.assets[i].digest = expected
        }
        for i in restored.batches.indices { restored.batches[i].id = UUID().uuidString; for j in restored.batches[i].photos.indices { guard let id = idMap[restored.batches[i].photos[j].assetID] else { throw PhotoError.message("备份资产引用无效") }; restored.batches[i].photos[j].assetID = id } }
        for i in restored.portfolios.indices { restored.portfolios[i].id = portfolioMap[restored.portfolios[i].id]!; restored.portfolios[i].assetIDs = restored.portfolios[i].assetIDs.compactMap { idMap[$0] }; restored.portfolios[i].coverID = restored.portfolios[i].coverID.flatMap { idMap[$0] } }
        for i in restored.creations.indices {
            restored.creations[i].id = UUID().uuidString; guard let collection = portfolioMap[restored.creations[i].collectionID] else { throw PhotoError.message("备份作品集引用无效") }; restored.creations[i].collectionID = collection; restored.creations[i].sourceIDs = restored.creations[i].sourceIDs.compactMap { idMap[$0] }
            if let path = restored.creations[i].path {
                guard path.hasPrefix("creations/"), manifest.checksums[path] != nil else { throw PhotoError.message("创作文件缺失") }
                let newPath = "creations/\(restored.creations[i].id).\(URL(fileURLWithPath: path).pathExtension)"
                try copyForRestore(folder.appendingPathComponent(path), to: media.url(newPath), using: restoreWorkspace, createdFiles: &createdFiles)
                restored.creations[i].path = newPath
            }
        }
        restored.tasks = []; restored.undo = []; restored.drafts = []
        restoreCompleted = true
        return restored
    }
    private func copyForRestore(_ source: URL, to target: URL, using workspace: URL, createdFiles: inout [URL]) throws {
        guard !FileManager.default.fileExists(atPath: target.path) else { throw PhotoError.message("恢复目标文件冲突") }
        let staged = workspace.appendingPathComponent(UUID().uuidString).appendingPathExtension(target.pathExtension)
        try copy(source, to: staged)
        try FileManager.default.moveItem(at: staged, to: target)
        createdFiles.append(target)
    }
    private func copy(_ source: URL, to target: URL) throws {
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        var error: NSError?; var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], writingItemAt: target, options: [], error: &error) { from, to in result = Result { try FileManager.default.copyItem(at: from, to: to) } }
        if let error { throw error }; guard let result else { throw PhotoError.message("文件协调失败") }; try result.get()
    }
}
