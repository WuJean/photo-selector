import Foundation

public enum Decision: String, Codable, CaseIterable, Sendable { case unseen, pending, keep, reject }
public enum SelectionRound: String, Codable, Sendable { case coarse, fine }
public enum SourceKind: String, Codable, Sendable { case photos, external, owned }
public enum TaskStatus: String, Codable, Sendable { case waiting, running, paused, failed, complete, cancelled }
public enum TagDomain: String, Codable, CaseIterable, Sendable { case subject, distance, environment, style, other }
public struct LibraryTag: Codable, Identifiable, Equatable, Sendable {
    public var id: String { domain.rawValue + ":" + name }
    public var name: String
    public var domain: TagDomain
    public var definition: String
    public init(_ name: String, _ domain: TagDomain, definition: String = "") { self.name = name; self.domain = domain; self.definition = definition }
    public static let defaults: [LibraryTag] = [
        "人像", "多人合照", "风景", "宠物", "建筑", "美食", "其他"
    ].map { LibraryTag($0, .subject) } + ["特写", "近景", "中景", "远景", "全景", "不确定"].map { LibraryTag($0, .distance) } + ["雪山", "森林", "海边", "城市", "室内", "夜景"].map { LibraryTag($0, .environment) } + ["清冷", "暖调", "自然", "纪实", "极简"].map { LibraryTag($0, .style) }
}
public struct PhotoAnalysis: Codable, Equatable, Sendable {
    public var subject: String
    public var distance: String
    public var extras: [String]
    public var description: String
    public var model: String
    public var date: Date
    public init(subject: String, distance: String, extras: [String], description: String, model: String, date: Date = Date()) {
        self.subject = subject; self.distance = distance; self.extras = extras; self.description = description; self.model = model; self.date = date
    }
    public var labels: [String] { [subject, distance] + extras }
    public func validate(library: [LibraryTag]) throws {
        guard library.contains(where: { $0.domain == .subject && $0.name == subject }),
              library.contains(where: { $0.domain == .distance && $0.name == distance }),
              extras.count <= 5, Set(extras).count == extras.count,
              extras.allSatisfy({ name in library.contains { $0.name == name && $0.domain != .subject && $0.domain != .distance } }),
              !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PhotoError.message("AI 返回了无效标签或空描述") }
    }
}
public struct LocalAsset: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID().uuidString
    public var source: SourceKind
    public var sourceID: String
    public var bookmark: Data?
    public var name: String
    public var importedAt = Date()
    public var takenAt: Date?
    public var width = 0
    public var height = 0
    public var focalLength: Double?
    public var equivalentFocalLength: Double?
    public var camera: String?
    public var digest: String?
    public var ownedPath: String?
    public var previewPath: String?
    public var feature: Data?
    public var perceptualHash: UInt64?
    public var analysis: PhotoAnalysis?
    public init(source: SourceKind, sourceID: String, name: String, bookmark: Data? = nil) {
        self.source = source; self.sourceID = sourceID; self.name = name; self.bookmark = bookmark
    }
    public var focalClass: String {
        guard let f = equivalentFocalLength else { return "未知焦段" }
        switch f { case ..<24: return "超广角"; case ..<35: return "广角"; case ..<70: return "标准"; case ..<135: return "中焦"; default: return "长焦" }
    }
}
public struct BatchPhoto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { assetID }
    public var assetID: String
    public var coarse: Decision = .unseen
    public var fine: Decision = .unseen
    public var cleanupAt: Date?
    public init(_ id: String) { assetID = id }
    public var admitted: Bool { coarse == .keep || coarse == .pending }
    public var finalist: Bool { admitted && fine == .keep }
}
public struct ImportBatch: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID().uuidString
    public var name: String
    public var createdAt = Date()
    public var photos: [BatchPhoto] = []
    public init(name: String) { self.name = name }
}
public struct Portfolio: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID().uuidString
    public var name: String
    public var location = ""
    public var date = Date()
    public var poem = ""
    public var description = ""
    public var coverID: String?
    public var assetIDs: [String] = []
    public init(name: String) { self.name = name }
}
public struct AnalysisTask: Codable, Identifiable, Equatable, Sendable {
    public var id: String { assetID }
    public var assetID: String
    public var status: TaskStatus = .waiting
    public var message = ""
    public var tags: [LibraryTag]
    public var model: String?
    public var generation = UUID().uuidString
    public var statusBeforeRemoval: TaskStatus?
    public init(_ assetID: String, tags: [LibraryTag]) { self.assetID = assetID; self.tags = tags }
}
public struct DecisionUndo: Codable, Sendable {
    public var batchID: String
    public var photos: [BatchPhoto]
    public var focusID: String?
}
public struct CollageSlot: Codable, Equatable, Sendable {
    public var subject: String = ""
    public var distance: String = ""
    public init(subject: String = "", distance: String = "") { self.subject = subject; self.distance = distance }
}
public struct QuickTemplate: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID().uuidString
    public var name: String
    public var layout: String
    public var slots: [CollageSlot]
    public init(name: String, layout: String, slots: [CollageSlot]) { self.name = name; self.layout = layout; self.slots = slots }
    public static var defaults: [QuickTemplate] { [QuickTemplate(name: "人像与旅行", layout: "rows", slots: [.init(subject: "人像", distance: "近景"), .init(subject: "风景", distance: "远景"), .init(subject: "人像", distance: "远景")])] }
}
public struct CollageCell: Codable, Equatable, Sendable {
    public var assetID: String?
    public var scale: Double = 1
    public var offsetX: Double = 0
    public var offsetY: Double = 0
    public var locked = false
    public var fit = false
    public init(_ id: String? = nil) { assetID = id }
}
public struct CollageDraft: Codable, Sendable {
    public var collectionID: String
    public var layout = "rows"
    public var ratio: Double = 0.75
    public var gap: Double = 12
    public var background = "#141414"
    public var watermark = ""
    public var frame: Double = 0
    public var keyword = ""
    public var tagNames: [String] = []
    public var matchAny = false
    public var cells: [CollageCell] = [.init(), .init(), .init()]
    // Optional so drafts written before slot constraints were persisted still decode.
    public var requirements: [CollageSlot]?
    public init(collectionID: String) { self.collectionID = collectionID }
}
public struct Creation: Codable, Identifiable, Sendable {
    public var id = UUID().uuidString
    public var collectionID: String
    public var kind: String
    public var title: String
    public var text: String
    public var path: String?
    public var sourceIDs: [String]
    public var createdAt = Date()
    public init(collectionID: String, kind: String, title: String, text: String = "", path: String? = nil, sourceIDs: [String]) {
        self.collectionID = collectionID; self.kind = kind; self.title = title; self.text = text; self.path = path; self.sourceIDs = sourceIDs
    }
}
public struct LocalLibraryState: Codable, Sendable {
    public var version = 1
    public var assets: [LocalAsset] = []
    public var batches: [ImportBatch] = []
    public var portfolios: [Portfolio] = []
    public var tags = LibraryTag.defaults
    public var tasks: [AnalysisTask] = []
    public var undo: [DecisionUndo] = []
    public var templates = QuickTemplate.defaults
    public var drafts: [CollageDraft] = []
    public var creations: [Creation] = []
    public init() {}
    public func isAdmitted(_ id: String) -> Bool { batches.contains { $0.photos.contains { $0.assetID == id && $0.admitted } } }
    public func isFinalist(_ id: String) -> Bool { batches.contains { $0.photos.contains { $0.assetID == id && $0.finalist } } }
    public func isReferenced(_ id: String) -> Bool {
        isAdmitted(id) || portfolios.contains { $0.assetIDs.contains(id) } || tasks.contains { $0.assetID == id && $0.status == .running }
    }
    public mutating func reconcileTasks() {
        for asset in assets where isAdmitted(asset.id) && asset.analysis == nil {
            if !tasks.contains(where: { $0.assetID == asset.id }) { tasks.append(AnalysisTask(asset.id, tags: tags)) }
            else if let i = tasks.firstIndex(where: { $0.assetID == asset.id }), let previous = tasks[i].statusBeforeRemoval {
                tasks[i].status = previous == .running ? .waiting : previous
                tasks[i].statusBeforeRemoval = nil
                tasks[i].generation = UUID().uuidString
            }
        }
        for i in tasks.indices where !isAdmitted(tasks[i].assetID) && tasks[i].status != .complete && tasks[i].status != .cancelled {
            tasks[i].statusBeforeRemoval = tasks[i].status
            tasks[i].status = .cancelled; tasks[i].generation = UUID().uuidString
        }
    }
    /// Merges a validated backup snapshot while keeping local task decisions intact.
    /// Analysis tasks are transient in backups, so recreate only those required by
    /// restored admitted assets that still have no analysis.
    public mutating func mergeRestoredBackup(_ restored: LocalLibraryState) {
        assets.append(contentsOf: restored.assets)
        batches.append(contentsOf: restored.batches)
        portfolios.append(contentsOf: restored.portfolios)
        creations.append(contentsOf: restored.creations)

        var tagIDs = Set(tags.map(\.id))
        for tag in restored.tags where tagIDs.insert(tag.id).inserted { tags.append(tag) }

        for template in restored.templates where !templates.contains(where: {
            $0.name == template.name && $0.layout == template.layout && $0.slots == template.slots
        }) {
            templates.append(template)
        }

        reconcileTasks()
    }
    public mutating func decide(batchID: String, ids: [String], round: SelectionRound, decision: Decision, focusID: String?, now: Date = Date()) throws {
        guard let index = batches.firstIndex(where: { $0.id == batchID }), !ids.isEmpty,
              Set(ids).isSubset(of: Set(batches[index].photos.map(\.assetID))),
              round != .fine || decision != .pending else { throw PhotoError.message("无效的选片操作") }
        if round == .fine && batches[index].photos.contains(where: { ids.contains($0.assetID) && !$0.admitted }) { throw PhotoError.message("请先完成粗筛") }
        let old = batches[index].photos.filter { ids.contains($0.assetID) }
        for i in batches[index].photos.indices where ids.contains(batches[index].photos[i].assetID) {
            if round == .coarse {
                let previous = batches[index].photos[i].coarse
                batches[index].photos[i].coarse = decision
                if decision == .reject { if previous != .reject { batches[index].photos[i].cleanupAt = now.addingTimeInterval(10800) } }
                else { batches[index].photos[i].cleanupAt = nil }
            } else { batches[index].photos[i].fine = decision }
        }
        undo.append(.init(batchID: batchID, photos: old, focusID: focusID)); undo = Array(undo.suffix(50))
        reconcileTasks()
    }
    public mutating func undoDecision() throws -> String? {
        guard let action = undo.popLast(), let index = batches.firstIndex(where: { $0.id == action.batchID }) else { throw PhotoError.message("没有可撤销的操作") }
        for photo in action.photos { if let i = batches[index].photos.firstIndex(where: { $0.assetID == photo.assetID }) { batches[index].photos[i] = photo } }
        reconcileTasks(); return action.focusID
    }
    public mutating func addToPortfolio(_ ids: [String], portfolioID: String) throws {
        guard let index = portfolios.firstIndex(where: { $0.id == portfolioID }), ids.allSatisfy({ isFinalist($0) }) else { throw PhotoError.message("只能加入精筛保留的照片") }
        for id in ids where !portfolios[index].assetIDs.contains(id) { portfolios[index].assetIDs.append(id) }
        if portfolios[index].coverID == nil { portfolios[index].coverID = portfolios[index].assetIDs.first }
    }
    public mutating func finishAnalysis(_ result: PhotoAnalysis, assetID: String, generation: String) throws {
        guard let task = tasks.firstIndex(where: { $0.assetID == assetID }), tasks[task].generation == generation,
              tasks[task].status == .running, isAdmitted(assetID), let i = assets.firstIndex(where: { $0.id == assetID }) else { return }
        try result.validate(library: tasks[task].tags)
        assets[i].analysis = result; tasks[task].status = .complete; tasks[task].message = ""
    }
    public func cleanupCandidates(now: Date) -> [String] {
        assets.filter { asset in
            !isReferenced(asset.id) && batches.contains { batch in batch.photos.contains { $0.assetID == asset.id && $0.coarse == .reject && ($0.cleanupAt.map { $0 <= now } ?? false) } }
            && !batches.contains { batch in batch.photos.contains { $0.assetID == asset.id && $0.coarse != .reject } }
        }.map(\.id)
    }
}

/// A failed write never publishes a partially changed state to the caller.
public final class LocalLibrary {
    private let store: ProjectStore
    public private(set) var state: LocalLibraryState
    public init(url: URL) throws {
        store = try ProjectStore(url: url)
        state = try store.load(LocalLibraryState.self, id: "ios-library-v1") ?? LocalLibraryState()
        guard state.version == 1 else { throw PhotoError.message("照片库版本不兼容") }
        for i in state.tasks.indices where state.tasks[i].status == .running { state.tasks[i].status = .waiting }
    }
    public func transaction<T>(_ action: (inout LocalLibraryState) throws -> T) throws -> T {
        var next = state
        let result = try action(&next)
        try store.save(next, id: "ios-library-v1")
        state = next
        return result
    }
}

public enum PhotoSearch {
    public static func filter(_ assets: [LocalAsset], keyword: String, tags: [String], any: Bool = false) -> [LocalAsset] {
        let words = keyword.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        return assets.filter { asset in
            let labels = asset.analysis?.labels ?? []
            let text = ([asset.name, asset.analysis?.description ?? ""] + labels).joined(separator: " ").lowercased()
            return words.allSatisfy { text.contains($0) } && (tags.isEmpty || (any ? tags.contains { labels.contains($0) } : tags.allSatisfy { labels.contains($0) }))
        }
    }
    public static func randomCombination(candidates: [LocalAsset], requirements: [CollageSlot], cells: [CollageCell]) throws -> [CollageCell] {
        guard requirements.count == cells.count else { throw PhotoError.message("模板格数不一致") }
        var result = cells
        var used = Set<String>()
        for i in cells.indices where cells[i].locked {
            guard let id = cells[i].assetID, let asset = candidates.first(where: { $0.id == id }), matches(asset, requirements[i]), !used.contains(id) else { throw PhotoError.message("锁定照片不符合当前筛选或模板，请调整条件或解锁") }
            used.insert(id)
        }
        // Backtracking prevents a flexible first slot from starving a constrained later slot.
        func fill(_ index: Int) -> Bool {
            if index == cells.count { return true }
            if cells[index].locked { return fill(index + 1) }
            for asset in candidates.shuffled() where !used.contains(asset.id) && matches(asset, requirements[index]) {
                used.insert(asset.id); result[index] = CollageCell(asset.id)
                if fill(index + 1) { return true }; used.remove(asset.id)
            }
            return false
        }
        guard fill(0) else { throw PhotoError.message("当前范围无法满足模板各格的主体／景别，请补充照片或调整模板") }
        return result
    }
    public static func matches(_ asset: LocalAsset, _ requirement: CollageSlot) -> Bool {
        (requirement.subject.isEmpty || asset.analysis?.subject == requirement.subject) && (requirement.distance.isEmpty || asset.analysis?.distance == requirement.distance)
    }
}
