import Foundation
import PhotoCore

enum LocalLibraryTests {
    static func fixture() -> (LocalLibraryState, String, String) {
        var s = LocalLibraryState(); let a = LocalAsset(source: .external, sourceID: "test", name: "雪山.jpg")
        var b = ImportBatch(name: "旅行"); b.photos = [BatchPhoto(a.id)]; s.assets = [a]; s.batches = [b]
        return (s, a.id, b.id)
    }
    static func decisions() throws {
        var (s, id, batch) = fixture(); let now = Date(timeIntervalSince1970: 100)
        try throwsError { try s.decide(batchID: batch, ids: [id], round: .fine, decision: .keep, focusID: id) }
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .pending, focusID: id)
        try expect(s.isAdmitted(id)); try equal(s.tasks.count, 1)
        try throwsError { try s.decide(batchID: batch, ids: [id], round: .fine, decision: .pending, focusID: id) }
        try s.decide(batchID: batch, ids: [id], round: .fine, decision: .keep, focusID: id)
        try expect(s.isFinalist(id))
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .reject, focusID: id, now: now)
        try expect(!s.isFinalist(id)); try equal(s.tasks[0].status, .cancelled)
        try expect(s.cleanupCandidates(now: now.addingTimeInterval(10799)).isEmpty)
        try equal(s.cleanupCandidates(now: now.addingTimeInterval(10800)), [id])
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .reject, focusID: id, now: now.addingTimeInterval(60))
        try equal(s.batches[0].photos[0].cleanupAt, now.addingTimeInterval(10800))
        _ = try s.undoDecision(); _ = try s.undoDecision(); try expect(s.isFinalist(id)); try expect(s.cleanupCandidates(now: .distantFuture).isEmpty)
    }
    static func references() throws {
        var (s, id, batch) = fixture(); var other = ImportBatch(name: "其他"); other.photos = [BatchPhoto(id)]; s.batches.append(other)
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .reject, focusID: id, now: .distantPast)
        try expect(s.cleanupCandidates(now: Date()).isEmpty)
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .keep, focusID: id)
        try s.decide(batchID: batch, ids: [id], round: .fine, decision: .keep, focusID: id)
        let p = Portfolio(name: "A"); let p2 = Portfolio(name: "B"); s.portfolios = [p, p2]
        try s.addToPortfolio([id, id], portfolioID: p.id); try s.addToPortfolio([id], portfolioID: p2.id)
        try equal(s.portfolios[0].assetIDs.count, 1); try equal(s.portfolios[1].assetIDs, [id])
    }
    static func analysis() throws {
        var (s, id, batch) = fixture(); let valid = PhotoAnalysis(subject: "风景", distance: "远景", extras: ["雪山"], description: "雪山位于画面中央。", model: "mock")
        try valid.validate(library: s.tags)
        try throwsError { try PhotoAnalysis(subject: "未知标签", distance: "远景", extras: [], description: "x", model: "mock").validate(library: s.tags) }
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .keep, focusID: id)
        s.tasks[0].status = .running; let generation = s.tasks[0].generation
        try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .reject, focusID: id)
        try s.finishAnalysis(valid, assetID: id, generation: generation); try expect(s.assets[0].analysis == nil)
        _ = try s.undoDecision()
        try equal(s.tasks[0].status, .waiting)
        try expect(s.tasks[0].generation != generation)
        try s.finishAnalysis(valid, assetID: id, generation: generation); try expect(s.assets[0].analysis == nil)
        for status in [TaskStatus.paused, .cancelled] {
            s.tasks[0].status = status
            try s.decide(batchID: batch, ids: [id], round: .coarse, decision: .reject, focusID: id)
            _ = try s.undoDecision()
            try equal(s.tasks[0].status, status)
        }
    }
    static func transaction() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let lib = try LocalLibrary(url: url); let (s, id, batch) = fixture()
        try lib.transaction { $0 = s }
        try throwsError { try lib.transaction { next in next.assets.removeAll(); throw PhotoError.message("rollback") } }
        try equal(lib.state.assets.count, 1)
        try lib.transaction { try $0.decide(batchID: batch, ids: [id], round: .coarse, decision: .keep, focusID: id) }
        let reopened = try LocalLibrary(url: url); try expect(reopened.state.isAdmitted(id)); try equal(reopened.state.undo.count, 1)
        try throwsError { try lib.transaction { try $0.decide(batchID: batch, ids: [id, "missing"], round: .coarse, decision: .reject, focusID: id) } }
        try expect(lib.state.isAdmitted(id))
    }
    static func collageDraftPersistence() throws {
        var draft = CollageDraft(collectionID: "portfolio")
        draft.layout = "grid"
        draft.cells = [.init("a"), .init("b"), .init("c"), .init("d")]
        draft.requirements = [
            .init(subject: "人像", distance: "近景"),
            .init(subject: "风景", distance: "远景"),
            .init(),
            .init(subject: "建筑")
        ]

        let currentData = try JSONEncoder().encode(draft)
        let currentRoundTrip = try JSONDecoder().decode(CollageDraft.self, from: currentData)
        try equal(currentRoundTrip.requirements, draft.requirements)

        var legacyObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(CollageDraft(collectionID: "legacy"))) as! [String: Any]
        legacyObject.removeValue(forKey: "requirements")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)
        let legacyDraft = try JSONDecoder().decode(CollageDraft.self, from: legacyData)
        try expect(legacyDraft.requirements == nil, "旧草稿应能解码并标记为没有已保存约束")
    }
    static func restoredMerge() throws {
        var current = LocalLibraryState()
        let pausedAsset = LocalAsset(source: .owned, sourceID: "paused", name: "paused.jpg")
        let cancelledAsset = LocalAsset(source: .owned, sourceID: "cancelled", name: "cancelled.jpg")
        var currentBatch = ImportBatch(name: "本机批次")
        currentBatch.photos = [BatchPhoto(pausedAsset.id), BatchPhoto(cancelledAsset.id)]
        current.assets = [pausedAsset, cancelledAsset]
        current.batches = [currentBatch]
        try current.decide(batchID: currentBatch.id, ids: [pausedAsset.id, cancelledAsset.id], round: .coarse, decision: .keep, focusID: nil)
        for i in current.tasks.indices {
            current.tasks[i].status = current.tasks[i].assetID == pausedAsset.id ? .paused : .cancelled
        }

        var restored = LocalLibraryState()
        let restoredAsset = LocalAsset(source: .owned, sourceID: "restored", name: "restored.jpg")
        var restoredBatch = ImportBatch(name: "备份批次")
        restoredBatch.photos = [BatchPhoto(restoredAsset.id)]
        restoredBatch.photos[0].coarse = .pending
        restored.assets = [restoredAsset]
        restored.batches = [restoredBatch]
        let existingDefinition = current.templates[0]
        restored.templates = [
            QuickTemplate(name: existingDefinition.name, layout: existingDefinition.layout, slots: existingDefinition.slots),
            QuickTemplate(name: "夜景双拼", layout: "rows", slots: [.init(subject: "风景"), .init(subject: "建筑")])
        ]

        let templateCount = current.templates.count
        current.mergeRestoredBackup(restored)

        try equal(current.assets.count, 3)
        try equal(current.tasks.first(where: { $0.assetID == restoredAsset.id })?.status, .waiting)
        try equal(current.tasks.first(where: { $0.assetID == pausedAsset.id })?.status, .paused)
        try equal(current.tasks.first(where: { $0.assetID == cancelledAsset.id })?.status, .cancelled)
        try equal(current.templates.count, templateCount + 1)
        try expect(current.templates.contains(where: { $0.name == "夜景双拼" && $0.slots.count == 2 }))
    }
    static func searchAndTemplates() throws {
        var assets = (0..<350).map { LocalAsset(source: .photos, sourceID: "\($0)", name: "\($0).jpg") }
        assets[349].analysis = PhotoAnalysis(subject: "风景", distance: "远景", extras: ["雪山"], description: "清晨雪山", model: "mock")
        try equal(PhotoSearch.filter(assets, keyword: "清晨 雪山", tags: ["风景", "远景"]).count, 1)
        try equal(PhotoSearch.filter(assets, keyword: "", tags: ["人像", "雪山"], any: true).count, 1)
        let result = try PhotoSearch.randomCombination(candidates: assets, requirements: [.init(), .init(subject: "风景")], cells: [.init(), .init()])
        try equal(result[1].assetID, assets[349].id); try expect(result[0].assetID != result[1].assetID)
        var locked = CollageCell("not-in-scope"); locked.locked = true
        try throwsError { _ = try PhotoSearch.randomCombination(candidates: assets, requirements: [.init()], cells: [locked]) }
    }
    static func collageGeometryAndLargeLibrary() throws {
        for layout in ["rows", "columns", "hero", "grid"] {
            let frames = CollageLayout.frames(layout: layout, width: 2250, height: 3000, gap: 24, frame: 60)
            try equal(frames.count, layout == "grid" ? 4 : 3)
            for rect in frames { try expect(rect.width > 0 && rect.height > 0 && rect.x >= 60 && rect.y >= 60 && rect.x + rect.width <= 2190.001 && rect.y + rect.height <= 2940.001) }
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let lib = try LocalLibrary(url: url); let start = Date()
        try lib.transaction { s in
            var batch = ImportBatch(name: "3000 synthetic records")
            for i in 0..<3000 { var a = LocalAsset(source: .photos, sourceID: "synthetic-\(i)", name: "\(i).jpg"); a.width = 4000; a.height = 3000; a.feature = Data(repeating: 1, count: 512); s.assets.append(a); batch.photos.append(BatchPhoto(a.id)) }; s.batches = [batch]
        }
        let batch = lib.state.batches[0], ids = Array(batch.photos.prefix(100).map(\.assetID))
        try lib.transaction { try $0.decide(batchID: batch.id, ids: ids, round: .coarse, decision: .keep, focusID: ids.first) }
        let reopened = try LocalLibrary(url: url); try equal(reopened.state.assets.count, 3000); try equal(reopened.state.tasks.count, 100)
        print("3000-record SQLite creation + 100 decisions + reopen: \(String(format: "%.3f", Date().timeIntervalSince(start)))s")
    }

}
