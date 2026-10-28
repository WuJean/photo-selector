import SwiftUI
import Photos
import PhotoCore

@MainActor final class AppModel: ObservableObject {
    typealias MediaPreparer = @MainActor (LocalAsset, Bool) async throws -> LocalAsset
    typealias ImageLoader = @MainActor (LocalAsset, Int, Bool) async throws -> UIImage
    typealias ImageAnalyzer = @MainActor (UIImage, [LibraryTag], AIConfiguration, String) async throws -> PhotoAnalysis

    @Published private(set) var state: LocalLibraryState
    @Published var error: String? {
        didSet { if oldValue != error { alertTitle = "提示" } }
    }
    @Published var alertTitle = "提示"
    @Published var progress = ""
    @Published var busy = false
    @Published var focusedID: String?
    @Published var aiConfig: AIConfiguration
    @Published var allowCloudDownload = false
    @Published var groups: [[String]] = []
    let library: LocalLibrary
    let media: MediaStore
    let intelligence: Intelligence
    let imageGeneration: ImageGeneration
    /// Shared hinge posture so every screen reacts to the same fold.
    let hinge = HingeState()
    /// Generated artwork, cached per photograph.
    var artworkCache: [String: UIImage] = [:]
    /// Rendered posters, cached per photograph and portfolio.
    var posterCache: [String: UIImage] = [:]
    private let prepareAsset: MediaPreparer
    private let loadImage: ImageLoader
    private let analyzeImage: ImageAnalyzer
    private var analysisRunner: Task<Void, Never>?
    private var analysisRunnerID: UUID?
    private var copying = false
    private var copyQueue: [String] = []
    private var offlinePhotoCopies = Set<String>()
    private var mediaRunner: Task<Void, Never>?
    let root: URL
    init(root: URL, prepareAsset: MediaPreparer? = nil, loadImage: ImageLoader? = nil, analyzeImage: ImageAnalyzer? = nil) throws {
        self.root = root
        let library = try LocalLibrary(url: root.appendingPathComponent("library.sqlite"))
        let media = try MediaStore(root: root)
        let intelligence = Intelligence()
        let imageGeneration = ImageGeneration()
        self.library = library; state = library.state; self.media = media; self.intelligence = intelligence; self.imageGeneration = imageGeneration
        aiConfig = UserDefaults.standard.data(forKey: "ai.config").flatMap { try? JSONDecoder().decode(AIConfiguration.self, from: $0) } ?? AIConfiguration()
        self.prepareAsset = prepareAsset ?? { asset, allowNetwork in try await media.prepare(asset, allowNetwork: allowNetwork) }
        self.loadImage = loadImage ?? { asset, maxSize, allowNetwork in try await media.image(asset, maxSize: maxSize, allowNetwork: allowNetwork) }
        self.analyzeImage = analyzeImage ?? { image, tags, config, key in try await intelligence.analyze(image, tags: tags, config: config, key: key) }
    }
    func change(_ action: (inout LocalLibraryState) throws -> Void) throws {
        try library.transaction(action); state = library.state
    }
    func perform(_ action: () throws -> Void) { do { try action() } catch { self.error = error.localizedDescription } }
    /// Reports an outcome the user should read but that must not look like a failure.
    func notify(_ message: String, title: String = "提示") { error = message; alertTitle = title }
    func createBatch(_ name: String) throws -> String {
        let batch = ImportBatch(name: name.isEmpty ? "新导入" : name); try change { $0.batches.append(batch) }; return batch.id
    }
    func saveConfig(_ config: AIConfiguration, key: String, imageKey: String? = nil) throws {
        try Keychain.save(key)
        if let imageKey { try Keychain.saveImage(imageKey) }
        UserDefaults.standard.set(try JSONEncoder().encode(config), forKey: "ai.config"); aiConfig = config
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
            var imported = 0
            for i in 0..<fetch.count {
                try Task.checkCancellation()
                let photo = fetch.object(at: i)
                if let selectedIDs, !selectedIDs.contains(photo.localIdentifier) { continue }
                progress = "读取相册 \(i + 1)/\(fetch.count)"
                var asset = LocalAsset(source: .photos, sourceID: photo.localIdentifier, name: PHAssetResource.assetResources(for: photo).first?.originalFilename ?? "照片.heic")
                asset.takenAt = photo.creationDate; asset.width = photo.pixelWidth; asset.height = photo.pixelHeight
                chunk.append(asset); imported += 1
                if chunk.count == 50 { try register(chunk, batchID: batchID); chunk = []; await Task.yield() }
            }
            if !chunk.isEmpty { try register(chunk, batchID: batchID) }
            if imported == 0 { throw PhotoError.message("这个范围内没有可导入的照片") }
            startMediaPreparation()
        } catch { self.error = error.localizedDescription }
    }
    func importFiles(_ urls: [URL], batchID: String) async {
        busy = true; defer { busy = false; progress = "" }
        do {
            var imported = 0, skipped = 0
            for url in urls {
                let assets = try await media.externalAssets(url)
                for offset in stride(from: 0, to: assets.count, by: 50) {
                    let slice = Array(assets[offset..<min(offset + 50, assets.count)])
                    let room = ImportPolicy.maxPhotosPerImport - imported
                    guard room > 0 else { skipped += slice.count; continue }
                    let take = Array(slice.prefix(room))
                    skipped += slice.count - take.count
                    imported += take.count
                    progress = "登记文件 \(imported)/\(imported + skipped)"
                    try register(take, batchID: batchID); await Task.yield()
                }
            }
            if imported == 0 { throw PhotoError.message("没有找到可导入的照片") }
            if skipped > 0 { notify("已导入 \(imported) 张，另有 \(skipped) 张超出本次上限，可以再导入一次。", title: "已按上限导入") }
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
            startMediaPreparation(); await copySelected(Array(ids.filter { state.isFinalist($0) })); error = "已重新连接 \(matched) 张照片"
        } catch { self.error = error.localizedDescription }
    }
    func register(_ assets: [LocalAsset], batchID: String) throws {
        try change { s in
            guard let b = s.batches.firstIndex(where: { $0.id == batchID }) else { return }
            func key(_ asset: LocalAsset) -> AssetSourceKey {
                AssetSourceKey(kind: asset.source.rawValue, identifier: asset.sourceID,
                               bookmark: asset.source == .external ? asset.bookmark : nil)
            }
            var sources: [AssetSourceKey: String] = [:]
            for existing in s.assets where sources[key(existing)] == nil { sources[key(existing)] = existing.id }
            var included = Set(s.batches[b].photos.map(\.assetID))
            for asset in assets {
                let sourceKey = key(asset)
                let id: String
                if let existing = sources[sourceKey] { id = existing }
                else { id = asset.id; sources[sourceKey] = id; s.assets.append(asset) }
                if included.insert(id).inserted { s.batches[b].photos.append(BatchPhoto(id)) }
            }
        }
    }
    static func needsMediaPreparation(_ asset: LocalAsset) -> Bool {
        // PhotoKit owns the display cache. A hash, not an app-owned JPEG, marks
        // completed lightweight similarity enrichment across launches.
        asset.source == .photos ? asset.perceptualHash == nil : asset.previewPath == nil
    }
    func startMediaPreparation() {
        guard mediaRunner == nil else { return }
        mediaRunner = Task(priority: .utility) { [weak self] in
            guard let self else { return }; defer { self.mediaRunner = nil; self.progress = "" }
            var attempted = Set<String>()
            var pending: [String: LocalAsset] = [:]
            var sinceGrouping = 0
            // Recomputing the expired set walks the whole library. It only
            // changes when the library changes, so it is refreshed on demand
            // instead of once per photo.
            var expired = Set(self.state.cleanupCandidates(now: Date()))
            var knownAssetCount = self.state.assets.count
            while !Task.isCancelled {
                if self.state.assets.count != knownAssetCount {
                    expired = Set(self.state.cleanupCandidates(now: Date()))
                    knownAssetCount = self.state.assets.count
                }
                let candidates = self.state.assets.filter { Self.needsMediaPreparation($0) && !expired.contains($0.id) && !attempted.contains($0.id) }
                guard !candidates.isEmpty else {
                    pending = self.flushPrepared(pending)
                    self.groups = await self.groupSnapshot()
                    if Task.isCancelled { break }
                    // Imports can arrive while grouping is suspended. Re-scan before
                    // exiting so the importing caller cannot miss this runner.
                    if self.state.assets.count != knownAssetCount {
                        expired = Set(self.state.cleanupCandidates(now: Date()))
                        knownAssetCount = self.state.assets.count
                    }
                    if self.state.assets.contains(where: { Self.needsMediaPreparation($0) && !expired.contains($0.id) && !attempted.contains($0.id) }) { continue }
                    break
                }
                let window = Array(candidates.prefix(ImportPolicy.previewConcurrency))
                for asset in window { attempted.insert(asset.id) }
                if window.contains(where: { $0.source != .photos }) { self.progress = "生成预览 \(attempted.count)" }
                await withTaskGroup(of: (LocalAsset?, String?).self) { group in
                    for asset in window {
                        group.addTask { [weak self] in
                            guard let self else { return (nil, nil) }
                            do {
                                let prepared = try await self.prepareAsset(asset, asset.source == .photos ? false : self.allowCloudDownload)
                                return (prepared, nil)
                            } catch is CancellationError {
                                return (nil, nil)
                            } catch {
                                return (nil, asset.source == .photos ? nil : "\(asset.name)：\(error.localizedDescription)")
                            }
                        }
                    }
                    for await (prepared, failure) in group {
                        if let prepared { pending[prepared.id] = prepared }
                        if let failure { self.error = failure }
                    }
                }
                if pending.count >= ImportPolicy.previewWriteBatch {
                    sinceGrouping += pending.count
                    pending = self.flushPrepared(pending)
                    if sinceGrouping >= max(100, self.state.assets.count / 10) {
                        self.groups = await self.groupSnapshot()
                        sinceGrouping = 0
                    }
                }
                await Task.yield()
            }
            pending = self.flushPrepared(pending)
            if !Task.isCancelled { self.runAnalysis() }
        }
    }
    private func groupSnapshot() async -> [[String]] {
        let assets = state.assets
        let media = self.media
        return await Task.detached(priority: .utility) { media.groups(assets) }.value
    }
    /// Writes prepared previews back to the library.
    ///
    /// The library is one encoded document, so writing after every photo
    /// rewrites the whole library again and again. Prepared photos are
    /// collected and flushed in batches instead.
    private func flushPrepared(_ pending: [String: LocalAsset]) -> [String: LocalAsset] {
        guard !pending.isEmpty else { return pending }
        try? change { s in
            for (id, prepared) in pending {
                guard let i = s.assets.firstIndex(where: { $0.id == id }) else { continue }
                s.assets[i].previewPath = prepared.previewPath
                s.assets[i].feature = prepared.feature
                s.assets[i].perceptualHash = prepared.perceptualHash
                s.assets[i].digest = prepared.digest
                s.assets[i].focalLength = prepared.focalLength
                s.assets[i].equivalentFocalLength = prepared.equivalentFocalLength
                s.assets[i].camera = prepared.camera
                s.assets[i].width = prepared.width
                s.assets[i].height = prepared.height
            }
        }
        return [:]
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
        let runnerID = UUID()
        analysisRunnerID = runnerID
        analysisRunner = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.analysisRunnerID == runnerID {
                    self.analysisRunner = nil
                    self.analysisRunnerID = nil
                }
            }
            while !Task.isCancelled {
                guard !ProcessInfo.processInfo.isLowPowerModeEnabled, ProcessInfo.processInfo.thermalState != .serious, ProcessInfo.processInfo.thermalState != .critical else { break }
                guard let task = self.state.tasks.first(where: { $0.status == .waiting }), let asset = self.state.assets.first(where: { $0.id == task.assetID }) else { break }
                let config = self.aiConfig; let key = Keychain.load()
                do {
                    try self.change { s in if let i = s.tasks.firstIndex(where: { $0.id == task.id }) { s.tasks[i].status = .running; s.tasks[i].model = config.remoteEnabled ? config.model : "Apple on-device" } }
                    try Task.checkCancellation()
                    guard self.isCurrentAnalysisTask(task, runnerID: runnerID) else { continue }
                    let image = try await self.loadImage(asset, 1080, self.allowCloudDownload)
                    try Task.checkCancellation()
                    // Photo loading may suspend while the user pauses/cancels the queue
                    // or changes this task's generation. Never dispatch stale work to AI.
                    guard self.isCurrentAnalysisTask(task, runnerID: runnerID) else { continue }
                    let result = try await self.analyzeImage(image, task.tags, config, key)
                    try Task.checkCancellation()
                    guard self.isCurrentAnalysisTask(task, runnerID: runnerID) else { continue }
                    try self.change { try $0.finishAnalysis(result, assetID: asset.id, generation: task.generation) }
                } catch {
                    guard !Task.isCancelled, self.analysisRunnerID == runnerID else { break }
                    guard self.isCurrentAnalysisTask(task, runnerID: runnerID) else { continue }
                    self.perform { try self.change { s in if let i = s.tasks.firstIndex(where: { $0.id == task.id }), s.tasks[i].generation == task.generation, s.tasks[i].status == .running { s.tasks[i].status = .paused; s.tasks[i].message = error.localizedDescription } } }
                    // Missing service/authorization pauses dispatch, rather than exhausting the library.
                    break
                }
                await Task.yield()
            }
        }
    }
    private func isCurrentAnalysisTask(_ task: AnalysisTask, runnerID: UUID) -> Bool {
        guard analysisRunnerID == runnerID,
              let current = state.tasks.first(where: { $0.id == task.id }) else { return false }
        return current.generation == task.generation && current.status == .running && state.isAdmitted(task.assetID)
    }
    private func cancelAnalysisRunner() {
        analysisRunner?.cancel()
        analysisRunner = nil
        analysisRunnerID = nil
    }
    func setTasks(_ status: TaskStatus) {
        do {
            try change { s in for i in s.tasks.indices where s.tasks[i].status != .complete {
                s.tasks[i].status = s.isAdmitted(s.tasks[i].assetID) ? status : .cancelled
                s.tasks[i].statusBeforeRemoval = nil
                s.tasks[i].generation = UUID().uuidString
            } }
            cancelAnalysisRunner()
            if status == .waiting { runAnalysis() }
        } catch { self.error = error.localizedDescription }
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
            startMediaPreparation()
            groups = await groupSnapshot(); runAnalysis()
            await copySelected(state.assets.filter { state.isFinalist($0.id) && $0.source == .external && $0.ownedPath == nil }.map(\.id))
        }
    }
}

private struct AssetSourceKey: Hashable {
    let kind: String
    let identifier: String
    let bookmark: Data?
}
