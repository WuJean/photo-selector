import SwiftUI
import Photos
import PhotoCore

@MainActor final class AppModel: ObservableObject {
    @Published private(set) var state: LocalLibraryState
    @Published var error: String?
    @Published var progress = ""
    @Published var busy = false
    @Published var focusedID: String?
    @Published var aiConfig: AIConfiguration
    @Published var allowCloudDownload = false
    @Published var groups: [[String]] = []
    let library: LocalLibrary
    let media: MediaStore
    let intelligence = Intelligence()
    private var analysisRunner: Task<Void, Never>?
    private var copying = false
    private var copyQueue: [String] = []
    private var offlinePhotoCopies = Set<String>()
    private var mediaRunner: Task<Void, Never>?
    let root: URL
    init(root: URL) throws {
        self.root = root; library = try LocalLibrary(url: root.appendingPathComponent("library.sqlite")); state = library.state
        media = try MediaStore(root: root)
        aiConfig = UserDefaults.standard.data(forKey: "ai.config").flatMap { try? JSONDecoder().decode(AIConfiguration.self, from: $0) } ?? AIConfiguration()
    }
    func change(_ action: (inout LocalLibraryState) throws -> Void) throws {
        try library.transaction(action); state = library.state
    }
    func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
    func createBatch(_ name: String) throws -> String {
        let batch = ImportBatch(name: name.isEmpty ? "新导入" : name); try change { $0.batches.append(batch) }; return batch.id
    }
    func saveConfig(_ config: AIConfiguration, key: String) throws {
        try Keychain.save(key); UserDefaults.standard.set(try JSONEncoder().encode(config), forKey: "ai.config"); aiConfig = config
        // User explicitly resumes paused tasks after changing configuration.
    }
    func importPhotos(start: Date, end: Date, albumID: String?, batchID: String, selectedIDs: Set<String>? = nil) async {
        busy = true; defer { busy = false; progress = "" }
        do {
            let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
            guard status == .authorized || status == .limited else { throw PhotoError.message("请在系统设置中允许照片访问") }
            let options = PHFetchOptions(); options.predicate = NSPredicate(format: "mediaType == %d AND creationDate >= %@ AND creationDate < %@", PHAssetMediaType.image.rawValue, start as NSDate, end as NSDate); options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            let fetch: PHFetchResult<PHAsset>
            if let albumID, let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil).firstObject { fetch = PHAsset.fetchAssets(in: album, options: options) }
            else { fetch = PHAsset.fetchAssets(with: options) }
            var chunk: [LocalAsset] = []
            for i in 0..<fetch.count {
                try Task.checkCancellation(); progress = "读取相册 \(i + 1)/\(fetch.count)"
                let photo = fetch.object(at: i)
                if let selectedIDs, !selectedIDs.contains(photo.localIdentifier) { continue }
                var asset = LocalAsset(source: .photos, sourceID: photo.localIdentifier, name: PHAssetResource.assetResources(for: photo).first?.originalFilename ?? "照片.heic")
                asset.takenAt = photo.creationDate; asset.width = photo.pixelWidth; asset.height = photo.pixelHeight
                chunk.append(asset)
                if chunk.count == 40 { try register(chunk, batchID: batchID); chunk = []; await Task.yield() }
            }
            if !chunk.isEmpty { try register(chunk, batchID: batchID) }
            startMediaPreparation()
        } catch { self.error = error.localizedDescription }
    }
    func importFiles(_ urls: [URL], batchID: String) async {
        busy = true; defer { busy = false; progress = "" }
        do {
            for url in urls {
                let assets = try await media.externalAssets(url)
                for offset in stride(from: 0, to: assets.count, by: 40) { progress = "登记文件 \(min(offset + 40, assets.count))/\(assets.count)"; try register(Array(assets[offset..<min(offset + 40, assets.count)]), batchID: batchID); await Task.yield() }
            }
            startMediaPreparation()
        } catch { self.error = error.localizedDescription }
    }
    func reconnect(_ folder: URL, batchID: String) async {
        busy = true; defer { busy = false; progress = "" }
        do {
            let candidates = try await media.externalAssets(folder)
            let ids = Set(state.batches.first { $0.id == batchID }?.photos.map(\.assetID) ?? [])
            var matched = 0
            for old in state.assets where ids.contains(old.id) && old.source == .external && old.ownedPath == nil {
                guard let expected = old.digest, let candidate = candidates.first(where: { $0.sourceID == old.sourceID && $0.name == old.name }) else { continue }
                progress = "核验来源：\(old.name)"
                guard try await media.sourceDigest(candidate) == expected else { continue }
                try change { s in if let i = s.assets.firstIndex(where: { $0.id == old.id }) { s.assets[i].bookmark = candidate.bookmark } }; matched += 1
            }
            if matched == 0 { throw PhotoError.message("没有找到摘要匹配的文件，请选择原来的来源目录；尚无摘要的失败文件需重新导入") }
            startMediaPreparation(); await copySelected(Array(ids)); error = "已重新连接 \(matched) 张照片"
        } catch { self.error = error.localizedDescription }
    }
    private func register(_ assets: [LocalAsset], batchID: String) throws {
        try change { s in
            guard let b = s.batches.firstIndex(where: { $0.id == batchID }) else { return }
            for asset in assets {
            let existing = s.assets.first { $0.source == asset.source && $0.sourceID == asset.sourceID && ($0.source != .external || $0.bookmark == asset.bookmark) }
            let id = existing?.id ?? asset.id
            if existing == nil { s.assets.append(asset) }
            if !s.batches[b].photos.contains(where: { $0.assetID == id }) { s.batches[b].photos.append(BatchPhoto(id)) }
            }
        }
    }
    func startMediaPreparation() {
        guard mediaRunner == nil else { return }
        mediaRunner = Task { [weak self] in
            guard let self else { return }; defer { self.mediaRunner = nil; self.progress = "" }
            let expired = Set(self.state.cleanupCandidates(now: Date()))
            let pending = self.state.assets.filter { $0.previewPath == nil && !expired.contains($0.id) }
            for (index, asset) in pending.enumerated() {
                if Task.isCancelled { break }
                self.progress = "生成预览 \(index + 1)/\(pending.count)"
                do {
                    let prepared = try await self.media.prepare(asset, allowNetwork: self.allowCloudDownload)
                    try self.change { s in if let i = s.assets.firstIndex(where: { $0.id == asset.id }) { s.assets[i].previewPath = prepared.previewPath; s.assets[i].feature = prepared.feature; s.assets[i].perceptualHash = prepared.perceptualHash; s.assets[i].digest = prepared.digest; s.assets[i].focalLength = prepared.focalLength; s.assets[i].equivalentFocalLength = prepared.equivalentFocalLength; s.assets[i].camera = prepared.camera } }
                } catch { self.error = "\(asset.name)：\(error.localizedDescription)" }
            }
            self.groups = await self.media.groups(self.state.assets)
            self.runAnalysis()
        }
    }
    func decide(batchID: String, ids: [String], round: SelectionRound, decision: Decision, next: String?) -> Bool {
        do {
            try change { try $0.decide(batchID: batchID, ids: ids, round: round, decision: decision, focusID: focusedID) }
            focusedID = next; runAnalysis()
            if round == .fine && decision == .keep { Task { await self.copySelected(ids) } }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func undo() { perform { var focus: String?; try change { focus = try $0.undoDecision() }; focusedID = focus }; runAnalysis() }
    func copySelected(_ ids: [String], includePhotos: Bool = false) async {
        if includePhotos { offlinePhotoCopies.formUnion(ids) }
        for id in ids where !copyQueue.contains(id) { copyQueue.append(id) }
        guard !copying else { return }; copying = true; defer { copying = false }
        while !copyQueue.isEmpty {
            let id = copyQueue.removeFirst()
            defer { offlinePhotoCopies.remove(id) }
            guard let asset = state.assets.first(where: { $0.id == id }), asset.ownedPath == nil, asset.source == .external || offlinePhotoCopies.contains(id) else { continue }
            do {
                progress = "保存原片：\(asset.name)"
                let copied = try await media.copyOriginal(asset, allowNetwork: allowCloudDownload)
                try change { s in if let i = s.assets.firstIndex(where: { $0.id == id }) { s.assets[i].ownedPath = copied.ownedPath; s.assets[i].digest = copied.digest } }
            } catch { self.error = "原片尚未保存：\(error.localizedDescription)。请重新连接来源后重试。" }
        }
        progress = ""
    }
    func runAnalysis() {
        guard analysisRunner == nil else { return }
        analysisRunner = Task { [weak self] in
            guard let self else { return }; defer { self.analysisRunner = nil }
            while !Task.isCancelled {
                guard !ProcessInfo.processInfo.isLowPowerModeEnabled, ProcessInfo.processInfo.thermalState != .serious, ProcessInfo.processInfo.thermalState != .critical else { break }
                guard let task = self.state.tasks.first(where: { $0.status == .waiting }), let asset = self.state.assets.first(where: { $0.id == task.assetID }) else { break }
                let config = self.aiConfig; let key = Keychain.load()
                do {
                    try self.change { s in if let i = s.tasks.firstIndex(where: { $0.id == task.id }) { s.tasks[i].status = .running; s.tasks[i].model = config.remoteEnabled ? config.model : "Apple on-device" } }
                    let image = try await self.media.image(asset, maxSize: 1080, allowNetwork: self.allowCloudDownload)
                    let result = try await self.intelligence.analyze(image, tags: task.tags, config: config, key: key)
                    try self.change { try $0.finishAnalysis(result, assetID: asset.id, generation: task.generation) }
                } catch {
                    self.perform { try self.change { s in if let i = s.tasks.firstIndex(where: { $0.id == task.id }), s.tasks[i].generation == task.generation, s.tasks[i].status == .running { s.tasks[i].status = .paused; s.tasks[i].message = error.localizedDescription } } }
                    // Missing service/authorization pauses dispatch, rather than exhausting the library.
                    break
                }
                await Task.yield()
            }
        }
    }
    func setTasks(_ status: TaskStatus) {
        perform { try change { s in for i in s.tasks.indices where s.tasks[i].status != .complete {
            s.tasks[i].status = s.isAdmitted(s.tasks[i].assetID) ? status : .cancelled
            s.tasks[i].statusBeforeRemoval = nil
            s.tasks[i].generation = UUID().uuidString
        } } }
        if status == .waiting { runAnalysis() }
    }
    func cleanupExpired() async {
            for id in state.cleanupCandidates(now: Date()) {
                guard let asset = state.assets.first(where: { $0.id == id }) else { continue }
                do { try await media.removePreview(asset); try change { s in if let i = s.assets.firstIndex(where: { $0.id == id }) { s.assets[i].previewPath = nil } } } catch { self.error = error.localizedDescription }
            }
    }
    func resumed() {
        Task {
            await cleanupExpired()
            groups = await media.groups(state.assets); runAnalysis()
            await copySelected(state.assets.filter { state.isFinalist($0.id) && $0.source == .external && $0.ownedPath == nil }.map(\.id))
        }
    }
}
