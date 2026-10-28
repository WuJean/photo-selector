import SwiftUI
import Photos
import UniformTypeIdentifiers
import PhotoCore

struct BatchListView: View {
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @State private var create = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                GlassSectionHeader(title: "从一次拍摄开始", subtitle: "导入相册或存储卡，留下值得珍藏的画面。", symbol: "camera.aperture")
                Button { create = true } label: {
                    Label("新建导入批次", systemImage: "plus").font(.headline).frame(maxWidth: .infinity, minHeight: 52)
                }.buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent).tint(PhotoPalette.accent)
                if model.state.batches.isEmpty {
                    GuidedEmptyState(title: "照片还在相册里？", message: "先为这次拍摄起个名字，再选择照片范围。你的原片会保留在原处。", symbol: "photo.stack")
                }
                ForEach(model.state.batches.reversed()) { batch in
                    NavigationLink { BatchView(batchID: batch.id) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "rectangle.stack").font(.title2).foregroundStyle(PhotoPalette.accent)
                                .frame(width: 52, height: 60).background(PhotoPalette.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                            VStack(alignment: .leading, spacing: 6) {
                                Text(batch.name).font(.headline).foregroundStyle(.primary)
                                Text("\(batch.photos.count) 张 · 已初筛 \(batch.photos.filter { $0.coarse != .unseen }.count) 张").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }.padding(16).photoGlass()
                    }.buttonStyle(.plain)
                }
            }.padding(20).frame(maxWidth: 760).frame(maxWidth: .infinity)
        }.photoBackdrop().navigationTitle("导入与选片")
            .alert("新建批次", isPresented: $create) { TextField("旅行名称", text: $name); Button("创建") { model.perform { _ = try model.createBatch(name); name = "" } }; Button("取消", role: .cancel) {} }
    }
}
struct BatchView: View {
    @EnvironmentObject var model: AppModel
    let batchID: String
    @State private var round = SelectionRound.coarse
    @State private var reviewed = false
    @State private var query = ""
    @State private var tags: Set<String> = []
    @State private var focalClasses: Set<String> = []
    @State private var orientations: Set<PhotoOrientation> = []
    @State private var any = false
    @State private var selected = Set<String>()
    @State private var multi = false
    @State private var immersive: LocalAsset?
    @State private var importSheet = false
    @State private var fileImporter = false
    @State private var reconnecting = false
    @State private var showFilters = false
    @State private var collapsed = true
    var batch: ImportBatch? { model.state.batches.first { $0.id == batchID } }
    private var stagePhotos: [LocalAsset] {
        let ids = Set((batch?.photos ?? []).filter { row in round == .coarse ? (reviewed ? row.coarse != .unseen : row.coarse == .unseen) : (row.admitted && (reviewed ? row.fine != .unseen : row.fine == .unseen)) }.map(\.assetID))
        return model.state.assets.filter { ids.contains($0.id) }
    }
    var photos: [LocalAsset] {
        SelectionFilters.filter(
            stagePhotos,
            mode: round == .coarse ? .coarse : .fine,
            query: query,
            selectedTags: tags,
            matchesAny: any,
            selectedFocalClasses: focalClasses,
            selectedOrientations: orientations
        ).sorted { ($0.takenAt ?? $0.importedAt) < ($1.takenAt ?? $1.importedAt) }
    }
    /// Similar photos are adjacent in the immersive queue even when their capture
    /// timestamps would otherwise interleave them with unrelated frames.
    private var immersiveIDs: [String] {
        SelectionPresentation.immersiveOrder(photos.map(\.id), groups: model.groups)
    }
    private var hasActiveFilters: Bool {
        round == .coarse ? (!focalClasses.isEmpty || !orientations.isEmpty) : (!query.isEmpty || !tags.isEmpty)
    }
    private var filterCount: Int {
        round == .coarse ? focalClasses.count + orientations.count : tags.count + (query.isEmpty ? 0 : 1)
    }
    private var emptyStateTitle: String {
        hasActiveFilters ? "没有匹配的照片" : "当前范围已完成"
    }
    private var emptyStateMessage: String {
        if hasActiveFilters { return "试试其他关键词，或清除筛选条件。" }
        return round == .coarse ? "切换到精筛继续挑选，或导入更多照片。" : "精筛保留的照片可以加入作品集。"
    }
    private var emptyStateSymbol: String {
        hasActiveFilters ? "magnifyingglass" : "checkmark.seal"
    }
    var displayed: [LocalAsset] {
        guard collapsed else { return photos }
        let ids = Set(photos.map(\.id)); let hidden = Set(model.groups.flatMap { $0.filter { ids.contains($0) }.dropFirst() })
        return photos.filter { !hidden.contains($0.id) }
    }
    var body: some View {
        mainContent
            .photoBackdrop()
            .navigationTitle(batch?.name ?? "选片")
            .toolbar { ToolbarItem(placement: .primaryAction) { batchMenu } }
            .onChange(of: query) { _, _ in selected.removeAll() }.onChange(of: round) { _, _ in selected.removeAll() }
            .onChange(of: tags) { _, _ in selected.removeAll() }.onChange(of: any) { _, _ in selected.removeAll() }
            .onChange(of: focalClasses) { _, _ in selected.removeAll() }.onChange(of: orientations) { _, _ in selected.removeAll() }
            .onChange(of: collapsed) { _, _ in selected.removeAll() }
            .sheet(isPresented: $importSheet) { NavigationStack { AlbumImportView(batchID: batchID) } }
            .sheet(isPresented: $showFilters) { selectionFilterSheet }
            .fileImporter(isPresented: $fileImporter, allowedContentTypes: [.folder, .jpeg, .png, .heic, .heif], allowsMultipleSelection: true) { result in
                handleFileImport(result)
            }
            .fullScreenCover(item: $immersive) { asset in
                ImmersiveView(ids: immersiveIDs, initialID: asset.id, batchID: batchID, round: round, reviewed: reviewed)
            }
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            phasePicker
            selectionToolbar
            ScrollView {
                importPrompt
                photoGrid
                filteredEmptyState
            }
            batchDecisionDock
        }
    }

    private var phasePicker: some View {
        Picker("阶段", selection: $round) {
            Text("粗筛").tag(SelectionRound.coarse)
            Text("精筛").tag(SelectionRound.fine)
        }
        .pickerStyle(.segmented)
        .padding()
    }

    private var selectionToolbar: some View {
        HStack {
            Button(reviewed ? "待处理" : "已处理") {
                reviewed.toggle()
                selected.removeAll()
            }
            Button(filterButtonTitle, systemImage: "line.3.horizontal.decrease") { showFilters = true }
                .accessibilityIdentifier("selection-filter-button")
            Spacer()
            Button(multi ? "完成选择" : "选择") {
                multi.toggle()
                selected.removeAll()
            }
        }
        .font(.subheadline.weight(.medium))
        .buttonStyle(.bordered)
        .tint(PhotoPalette.accent)
        .padding(.horizontal)
    }

    private var filterButtonTitle: String {
        filterCount == 0 ? "筛选" : "筛选 · \(filterCount)"
    }

    @ViewBuilder private var importPrompt: some View {
        if batch?.photos.isEmpty == true {
            VStack(spacing: 20) {
                GuidedEmptyState(title: "把照片带进来", message: "按时间读取相册，或从存储卡和文件夹导入。", symbol: "photo.badge.plus")
                Button { importSheet = true } label: {
                    Label("从相册读取", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(PhotoPalette.onAccent)
                Button {
                    reconnecting = false
                    fileImporter = true
                } label: {
                    Label("存储卡／文件夹", systemImage: "folder")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
            }
            .tint(PhotoPalette.accent)
            .padding(20)
        }
    }

    private var photoGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 8)], spacing: 10) {
            ForEach(displayed) { asset in
                SelectionPhotoCard(
                    asset: asset,
                    similarityLabel: groupLabel(for: asset),
                    isSelected: selected.contains(asset.id),
                    onTap: { handlePhotoTap(asset) },
                    onLongPress: { handlePhotoLongPress(asset) }
                )
            }
        }
        .padding()
    }

    @ViewBuilder private var filteredEmptyState: some View {
        if photos.isEmpty && batch?.photos.isEmpty == false {
            GuidedEmptyState(title: emptyStateTitle, message: emptyStateMessage, symbol: emptyStateSymbol)
                .padding()
        }
    }

    @ViewBuilder private var batchDecisionDock: some View {
        if !selected.isEmpty {
            DecisionButtons(round: round) { decision in
                if model.decide(batchID: batchID, ids: Array(selected), round: round, decision: decision, next: nil) {
                    selected.removeAll()
                }
            }
            .padding()
        }
    }

    private var batchMenu: some View {
        Menu {
            Button("从相册读取", systemImage: "photo.on.rectangle") { importSheet = true }
            Button("存储卡／文件夹", systemImage: "folder") { reconnecting = false; fileImporter = true }
            Button(collapsed ? "全部展开" : "全部叠放") { collapsed.toggle() }
            Button("撤销上次决定", systemImage: "arrow.uturn.backward") { model.undo() }
            Button("重新连接来源文件夹") { reconnecting = true; fileImporter = true }
            Button("保存当前范围的离线原片") { Task { await model.copySelected(photos.map(\.id), includePhotos: true) } }
            Button("重新生成缺失预览") { model.startMediaPreparation() }
            Button("继续复制入选原片") { Task { await model.copySelected((batch?.photos ?? []).filter(\.finalist).map(\.assetID)) } }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityIdentifier("selection-grid-menu")
    }

    private var selectionFilterSheet: some View {
        NavigationStack {
            ScrollView {
                SelectionFilterContent(
                    mode: round == .coarse ? .coarse : .fine,
                    assets: stagePhotos,
                    tagLibrary: model.state.tags,
                    query: query,
                    selectedTags: tags,
                    selectedFocalClasses: focalClasses,
                    selectedOrientations: orientations,
                    matchesAny: any,
                    onSearchChange: { query = $0 },
                    onTagsChange: { tags = $0 },
                    onFocalClassesChange: { focalClasses = $0 },
                    onOrientationsChange: { orientations = $0 },
                    onMatchesAnyChange: { any = $0 },
                    onRequestFocalMetadata: { ids in Task { await model.loadFocalMetadata(assetIDs: ids) } },
                    onRetryFocalMetadata: { ids in Task { await model.retryFocalMetadata(assetIDs: ids) } }
                )
            }
            .scrollIndicators(.hidden)
            .navigationTitle(round == .coarse ? "焦段与方向" : "搜索与标签")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showFilters = false } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func handlePhotoTap(_ asset: LocalAsset) {
        if multi {
            if !selected.insert(asset.id).inserted { selected.remove(asset.id) }
        } else {
            model.focusedID = asset.id
            immersive = asset
        }
    }

    private func handlePhotoLongPress(_ asset: LocalAsset) {
        multi = true
        selected.insert(asset.id)
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            Task {
                if reconnecting, let folder = urls.first {
                    await model.reconnect(folder, batchID: batchID)
                } else {
                    await model.importFiles(urls, batchID: batchID)
                }
            }
        case .failure(let error):
            model.error = error.localizedDescription
        }
    }

    private func groupLabel(for asset: LocalAsset) -> String? {
        SelectionPresentation.badge(for: asset.id, groups: model.groups, assets: model.state.assets)
    }
}

private struct SelectionPhotoCard: View {
    let asset: LocalAsset
    let similarityLabel: String?
    let isSelected: Bool
    let onTap: () -> Void
    let onLongPress: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            preview
            titleRow
            analysisLabels
        }
        .padding(10)
        .photoGlass(cornerRadius: 22)
        .overlay { groupOutline }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("photo-card-" + asset.id)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .onLongPressGesture(perform: onLongPress)
    }

    private var preview: some View {
        AssetImage(asset: asset, size: 480, fill: true, aspect: 1)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .topTrailing) { selectionMarker }
    }

    @ViewBuilder private var selectionMarker: some View {
        if isSelected {
            Image(systemName: "checkmark.circle.fill")
                .font(.title)
                .foregroundStyle(.orange)
                .padding(5)
        }
    }

    private var titleRow: some View {
        HStack {
            Text(asset.name).lineLimit(1).font(.caption)
            Spacer(minLength: 2)
            if let similarityLabel {
                Text(similarityLabel)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(PhotoPalette.peach)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityIdentifier("similarity-label-\(asset.id)")
            }
        }
    }

    @ViewBuilder private var analysisLabels: some View {
        if let analysis = asset.analysis {
            Text(analysis.labels.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var groupOutline: some View {
        if similarityLabel != nil {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(PhotoPalette.peach.opacity(0.48), lineWidth: 1.2)
                .allowsHitTesting(false)
        }
    }
}

struct AlbumImportView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let batchID: String
    @State private var start = Calendar.current.date(byAdding: .month, value: -1, to: Date())!
    @State private var end = Date()
    @State private var albums: [(String, String)] = []
    @State private var album = ""
    @State private var count = 0
    @State private var limited = false
    @State private var rangePicker = false
    @State private var rangePhotos: [LocalAsset] = []
    var body: some View {
        Form {
            Section("相册范围") {
                Picker("相册", selection: $album) { Text("全部已授权照片").tag(""); ForEach(albums, id: \.0) { Text($0.1).tag($0.0) } }
                DatePicker("开始日期", selection: $start, displayedComponents: .date)
                DatePicker("结束日期", selection: $end, in: start..., displayedComponents: .date)
                HStack { Button("最近一周") { start = Calendar.current.date(byAdding: .day, value: -7, to: Date())! }; Button("最近一个月") { start = Calendar.current.date(byAdding: .month, value: -1, to: Date())! } }
                Text("范围内 \(count) 张静态照片")
                if limited { Text("仅能读取系统授权的照片。可在系统设置中调整授权。").font(.caption); Button("打开系统设置") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) } }
            }
            Button("预览并选择范围内的照片") { loadRange(); rangePicker = true }.disabled(count == 0)
            Toggle("允许从 iCloud 下载原片", isOn: $model.allowCloudDownload)
            Section {
                Button("读取整个范围") { Task { await model.importPhotos(start: Calendar.current.startOfDay(for: start), end: endExclusive, albumID: album.isEmpty ? nil : album, batchID: batchID); dismiss() } }
                    .disabled(model.busy || count == 0)
            } footer: {
                Text("按拍摄时间读取范围内的全部照片；原片仍保留在系统相册。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.scrollContentBackground(.hidden).photoBackdrop().sheet(isPresented: $rangePicker) { NavigationStack { PhotoRangePicker(assets: rangePhotos) { ids in
            Task { await model.importPhotos(start: Calendar.current.startOfDay(for: start), end: endExclusive, albumID: album.isEmpty ? nil : album, batchID: batchID, selectedIDs: ids); rangePicker = false; dismiss() }
        } } }
        .navigationTitle("从相册读取").toolbar { Button("取消") { dismiss() } }
            .task { let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite); limited = status == .limited
                let fetched = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
                fetched.enumerateObjects { value, _, _ in albums.append((value.localIdentifier, value.localizedTitle ?? "相册")) }; updateCount()
            }.onChange(of: start) { _, _ in updateCount() }.onChange(of: end) { _, _ in updateCount() }.onChange(of: album) { _, _ in updateCount() }
    }
    var endExclusive: Date { Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: end))! }
    func loadRange() {
        let options = PHFetchOptions(); options.predicate = NSPredicate(format: "mediaType == %d AND creationDate >= %@ AND creationDate < %@", PHAssetMediaType.image.rawValue, Calendar.current.startOfDay(for: start) as NSDate, endExclusive as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let result: PHFetchResult<PHAsset>
        if let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [album], options: nil).firstObject { result = PHAsset.fetchAssets(in: collection, options: options) }
        else { result = PHAsset.fetchAssets(with: options) }
        rangePhotos = (0..<result.count).map { index in
            let photo = result.object(at: index); var item = LocalAsset(source: .photos, sourceID: photo.localIdentifier, name: "照片 \(index + 1)")
            item.id = photo.localIdentifier; item.takenAt = photo.creationDate; return item
        }
    }
    func updateCount() {
        let options = PHFetchOptions(); options.predicate = NSPredicate(format: "mediaType == %d AND creationDate >= %@ AND creationDate < %@", PHAssetMediaType.image.rawValue, Calendar.current.startOfDay(for: start) as NSDate, endExclusive as NSDate)
        if let collection = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [album], options: nil).firstObject { count = PHAsset.fetchAssets(in: collection, options: options).count }
        else { count = PHAsset.fetchAssets(with: options).count }
    }
}
/// Small, pure presentation rules for similar-photo selection. Keeping the
/// ordering and duplicate wording separate makes the multi-photo behavior
/// testable without launching a gallery or loading image data.
enum SelectionPresentation {
    static func activeGroup(for assetID: String, in photoIDs: [String], groups: [[String]]) -> [String] {
        guard let group = groups.first(where: { $0.contains(assetID) && $0.count > 1 }) else { return [] }
        return photoIDs.filter(group.contains)
    }

    static func immersiveOrder(_ photoIDs: [String], groups: [[String]]) -> [String] {
        var result: [String] = []
        var visited = Set<String>()
        for id in photoIDs where !visited.contains(id) {
            let members = activeGroup(for: id, in: photoIDs, groups: groups)
            if members.count > 1 {
                result.append(contentsOf: members)
                visited.formUnion(members)
            } else {
                result.append(id)
                visited.insert(id)
            }
        }
        return result
    }

    static func comparisonWindow(_ group: [String], currentID: String, limit: Int = 3) -> [String] {
        guard limit > 0, let currentIndex = group.firstIndex(of: currentID) else { return [] }
        let start = max(0, currentIndex - limit / 2)
        let end = min(group.count, start + limit)
        let adjustedStart = max(0, end - limit)
        return Array(group[adjustedStart..<end])
    }

    static func nextUnresolvedID(in photoIDs: [String], after currentID: String, unresolved: Set<String>) -> String? {
        guard photoIDs.count > 1, let currentIndex = photoIDs.firstIndex(of: currentID) else { return nil }
        for offset in 1..<photoIDs.count {
            let id = photoIDs[(currentIndex + offset) % photoIDs.count]
            if unresolved.contains(id) { return id }
        }
        return nil
    }

    static func nextUnvisitedID(in photoIDs: [String], after currentID: String, visited: Set<String>) -> String? {
        guard photoIDs.count > 1, let currentIndex = photoIDs.firstIndex(of: currentID) else { return nil }
        for offset in 1..<photoIDs.count {
            let id = photoIDs[(currentIndex + offset) % photoIDs.count]
            if !visited.contains(id) { return id }
        }
        return nil
    }

    static func badge(for assetID: String, groups: [[String]], assets: [LocalAsset]) -> String? {
        guard let group = groups.first(where: { $0.contains(assetID) && $0.count > 1 }),
              let asset = assets.first(where: { $0.id == assetID }) else { return nil }
        if let digest = asset.digest {
            let duplicateCount = group.filter { id in assets.first(where: { $0.id == id })?.digest == digest }.count
            if duplicateCount > 1 { return "重复 \(duplicateCount)" }
        }
        return "相似 \(group.count)"
    }

    static func notice(for assetID: String, in photoIDs: [String], groups: [[String]], assets: [LocalAsset]) -> String? {
        let members = activeGroup(for: assetID, in: photoIDs, groups: groups)
        guard members.count > 1 else { return nil }
        if let digest = assets.first(where: { $0.id == assetID })?.digest {
            let duplicateCount = members.filter { id in assets.first(where: { $0.id == id })?.digest == digest }.count
            if duplicateCount > 1 { return "完全重复 · \(duplicateCount) 张" }
        }
        return "相似照片 · \(members.count) 张"
    }
}

extension TagDomain {
    var title: String {
        switch self {
        case .subject: "主体"
        case .distance: "景别"
        case .environment: "环境"
        case .style: "风格"
        case .other: "其他"
        }
    }
}

/// Compatibility filter used by a portfolio detail view. The caller passes
/// only that portfolio's assets so labels from unrelated collections are not
/// suggested here.
struct TagFilterView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var assets: [LocalAsset]? = nil
    @Binding var selected: Set<String>
    @Binding var any: Bool

    init(assets: [LocalAsset]? = nil, selected: Binding<Set<String>>, any: Binding<Bool>) {
        self.assets = assets
        self._selected = selected
        self._any = any
    }

    private var availableTags: [LibraryTag] {
        let labels = Set((assets ?? model.state.assets).flatMap { $0.analysis?.labels ?? [] })
        let known = model.state.tags.filter { labels.contains($0.name) }
        let knownNames = Set(known.map(\.name))
        return known + labels.subtracting(knownNames).sorted().map { LibraryTag($0, .other) }
    }

    var body: some View {
        Form {
            Toggle("满足任一标签", isOn: $any)
            ForEach(TagDomain.allCases, id: \.self) { domain in
                let tags = availableTags.filter { $0.domain == domain }
                if !tags.isEmpty {
                    DisclosureGroup {
                        ForEach(tags) { tag in
                            Button {
                                if !selected.insert(tag.name).inserted { selected.remove(tag.name) }
                            } label: {
                                HStack {
                                    Text(tag.name)
                                    Spacer()
                                    if selected.contains(tag.name) {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(PhotoPalette.accent)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    } label: {
                        HStack {
                            Text(domain.title)
                            let count = tags.filter { selected.contains($0.name) }.count
                            if count > 0 { Text("\(count)").font(.caption).foregroundStyle(PhotoPalette.accent) }
                        }
                    }
                }
            }
            if availableTags.isEmpty {
                Text("当前作品集还没有 AI 标签").font(.caption).foregroundStyle(.secondary)
            }
            Button("清除已选标签") { selected.removeAll() }
        }
        .scrollContentBackground(.hidden)
        .photoBackdrop()
        .navigationTitle("标签筛选")
        .toolbar { Button("完成") { dismiss() } }
    }
}

struct DecisionButtons: View {
    let round: SelectionRound
    let action: (Decision) -> Void
    var body: some View {
        // Keep a single-row dock whenever it fits. A two-column fallback avoids
        // turning short folded or landscape layouts into a tall button stack.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { buttons }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) { buttons }
            VStack(spacing: 10) { buttons }
        }
    }
    @ViewBuilder private var buttons: some View {
        if round == .coarse { decision("待定", .pending, .yellow) }
        decision("保留", .keep, .green); decision("不要", .reject, .red)
    }
    func decision(_ name: String, _ value: Decision, _ color: Color) -> some View {
        Button { action(value) } label: {
            Label(name, systemImage: value == .keep ? "checkmark" : value == .reject ? "xmark" : "bookmark")
                .font(.headline.weight(.semibold))
                .foregroundStyle(color)
                .frame(minWidth: 76, maxWidth: .infinity, minHeight: 56)
                .background(color.opacity(0.16), in: Capsule())
                .overlay(Capsule().strokeBorder(color.opacity(0.26), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
    }
}
private struct ImmersiveControlLayer: View {
    let position: String
    let photoName: String
    let analysis: String
    let groupNotice: String?
    let round: SelectionRound?
    let finished: Bool
    let original: Bool
    let onClose: () -> Void
    let onUndo: () -> Void
    let onReturn: () -> Void
    let onToggleOriginal: () -> Void
    let onShare: () -> Void
    let onDecision: (Decision) -> Void

    var body: some View {
        GeometryReader { proxy in
            let region = controlRegion(in: proxy)
            let insets = reservedInsets(in: proxy, within: region)
            ZStack {
                Color.clear
                    .allowsHitTesting(false)
                    .frame(width: region.width, height: region.height)
                    .overlay(alignment: .top) {
                        photoHeading
                            .padding(.top, insets.top + 8)
                            .frame(maxWidth: min(620, max(0, region.width - 90)))
                            .frame(maxWidth: .infinity)
                    }
                    .overlay(alignment: .leading) {
                        sideRail
                            .padding(.leading, 10)
                    }
                    .overlay(alignment: .bottom) {
                        if finished || round != nil || !analysis.isEmpty {
                            VStack(spacing: 8) {
                                if let groupNotice {
                                    Label(groupNotice, systemImage: "square.stack.3d.up")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .photoGlass(cornerRadius: 18)
                                        .accessibilityIdentifier("immersive-group-notice")
                                }
                                if finished {
                                    VStack(spacing: 10) {
                                        Label("当前范围已完成", systemImage: "checkmark.circle")
                                        Button("返回", action: onReturn)
                                            .font(.headline)
                                            .frame(minWidth: 150, minHeight: 56)
                                            .background(PhotoPalette.accent.opacity(0.25), in: Capsule())
                                    }
                                    .padding(12).photoGlass(cornerRadius: 24)
                                } else {
                                    if !analysis.isEmpty {
                                        Text(analysis).font(.caption).lineLimit(1).padding(.horizontal, 6)
                                            .padding(.vertical, 5).photoGlass(cornerRadius: 14)
                                    }
                                    if let round {
                                        DecisionButtons(round: round, action: onDecision)
                                            .padding(8).photoGlass(cornerRadius: 28)
                                    }
                                }
                            }
                            .padding(.bottom, insets.bottom + 10)
                            .frame(maxWidth: min(480, max(0, region.width - 24)))
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .position(x: region.midX, y: region.midY)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }

    private var photoHeading: some View {
        VStack(spacing: 3) {
            Text(position).monospacedDigit().font(.caption.weight(.medium))
            Text(photoName).font(.caption).lineLimit(1).accessibilityIdentifier("current-photo")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .photoGlass(cornerRadius: 20)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var sideRail: some View {
        VStack(spacing: 8) {
            floatingAction("xmark", label: "关闭", action: onClose)
            if round != nil { floatingAction("arrow.uturn.backward", label: "撤销", action: onUndo) }
            Menu {
                Button(original ? "使用预览" : "查看原图", action: onToggleOriginal)
                Button("下载／分享原片", action: onShare)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 44, height: 48)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("更多照片操作")
        }
        .padding(5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.16), radius: 12, y: 4)
    }

    private func floatingAction(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 44, height: 48)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func controlRegion(in proxy: GeometryProxy) -> CGRect {
        let bounds = CGRect(origin: .zero, size: proxy.size)
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            guard let division = proxy.reservedRegions(kind: .division)
                .filter(\.isActive)
                .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return bounds }
            let fold = division.frame.intersection(bounds)
            guard !fold.isNull, !fold.isEmpty else { return bounds }

            if fold.width < fold.height {
                let leading = CGRect(x: bounds.minX, y: bounds.minY, width: max(0, fold.minX - bounds.minX), height: bounds.height)
                let trailing = CGRect(x: fold.maxX, y: bounds.minY, width: max(0, bounds.maxX - fold.maxX), height: bounds.height)
                return trailing.width >= leading.width ? trailing : leading
            }

            let upper = CGRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: max(0, fold.minY - bounds.minY))
            let lower = CGRect(x: bounds.minX, y: fold.maxY, width: bounds.width, height: max(0, bounds.maxY - fold.maxY))
            return lower.height >= upper.height ? lower : upper
        }
        #endif
        return bounds
    }

    private func reservedInsets(in proxy: GeometryProxy, within region: CGRect) -> (top: CGFloat, bottom: CGFloat) {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            let regions = proxy.reservedRegions(kind: .occlusion).filter(\.isActive)
            let topBand = CGRect(x: region.minX, y: region.minY, width: region.width, height: min(96, region.height))
            let bottomBand = CGRect(x: region.minX, y: max(region.minY, region.maxY - 96), width: region.width, height: min(96, region.height))
            let top = regions
                .filter { $0.frame.intersects(topBand) }
                .map { max(0, $0.frame.maxY - region.minY) + 8 }
                .max() ?? 0
            let bottom = regions
                .filter { $0.frame.intersects(bottomBand) }
                .map { max(0, region.maxY - $0.frame.minY) + 8 }
                .max() ?? 0
            return (top, bottom)
        }
        #endif
        return (0, 0)
    }
}
struct ImmersiveView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State private var ids: [String]
    let initialID: String
    let batchID: String?
    let round: SelectionRound
    @State private var index = 0
    @State private var scale: CGFloat = 1
    @State private var scaleBase: CGFloat = 1
    @State private var offset = CGSize.zero
    @State private var baseOffset = CGSize.zero
    @State private var original = false
    @State private var sharing: URL?
    @State private var finished = false
    @State private var visitedReviewIDs = Set<String>()
    let reviewed: Bool
    init(ids: [String], initialID: String, batchID: String?, round: SelectionRound, reviewed: Bool = false) {
        _ids = State(initialValue: ids)
        self.initialID = initialID; self.batchID = batchID; self.round = round; self.reviewed = reviewed
    }
    var current: LocalAsset? { ids.indices.contains(index) ? model.state.assets.first { $0.id == ids[index] } : nil }
    /// Share of the canvas reserved for the neighbouring photos.
    private let neighbourShare: CGFloat = 0.10
    private var hasPrevious: Bool { index > 0 }
    private var hasNext: Bool { index < ids.count - 1 }
    private var currentAspect: CGFloat { current.map { assetAspect($0) } ?? 1 }
    private var activeGroup: [String] {
        guard let id = current?.id else { return [] }
        return SelectionPresentation.activeGroup(for: id, in: ids, groups: model.groups)
    }
    private var groupNotice: String? {
        guard let id = current?.id else { return nil }
        return SelectionPresentation.notice(for: id, in: ids, groups: model.groups, assets: model.state.assets)
    }
    var body: some View {
        DuoLayout(hinge: model.hinge, style: .immersive) {
            ImmersiveControlLayer(
                position: "\(min(index + 1, ids.count))/\(ids.count)",
                photoName: current?.name ?? "",
                analysis: current?.analysis?.labels.joined(separator: " · ") ?? "",
                groupNotice: groupNotice,
                round: batchID == nil ? nil : round,
                finished: finished,
                original: original,
                onClose: { dismiss() },
                onUndo: {
                    model.undo()
                    if let focus = model.focusedID, let i = ids.firstIndex(of: focus) {
                        index = i
                        if reviewed { visitedReviewIDs.remove(focus) }
                    }
                    finished = false
                },
                onReturn: { dismiss() },
                onToggleOriginal: { original.toggle() },
                onShare: {
                    Task {
                        do {
                            if let asset = current { sharing = try await model.media.exportOriginal(asset, allowNetwork: model.allowCloudDownload) }
                        } catch { model.error = error.localizedDescription }
                    }
                },
                onDecision: { decision in
                    guard let batchID, let current, !finished else { return }
                    let next = nextPhoto(after: current.id)
                    if model.decide(batchID: batchID, ids: [current.id], round: round, decision: decision, next: next) {
                        if reviewed { visitedReviewIDs.insert(current.id) }
                        if let next { move(to: next) } else { finished = true }
                    }
                }
            )
        } secondary: {
            GeometryReader { geometry in
                canvas(size: geometry.size)
                    .accessibilityElement(children: .contain).accessibilityIdentifier("immersive-canvas")
                    .contentShape(Rectangle())
                    .gesture(MagnifyGesture().onChanged { scale = min(8, max(1, scaleBase * $0.magnification)) }.onEnded { _ in scaleBase = scale; if scale <= 1 { offset = .zero; baseOffset = .zero } })
                    .simultaneousGesture(DragGesture().onChanged { value in if scale > 1.05 { offset = CGSize(width: baseOffset.width + value.translation.width, height: baseOffset.height + value.translation.height) } }.onEnded { value in
                        if scale > 1.05 { baseOffset = offset }
                        else if abs(value.translation.width) > 70 && abs(value.translation.width) > abs(value.translation.height) * 1.5 { move(value.translation.width < 0 ? 1 : -1) }
                    })
                    .onTapGesture(count: 2) { scale = scale > 1 ? 1 : 2; scaleBase = scale; offset = .zero; baseOffset = .zero }
            }
        }
        .background(Color(white: 0.035).ignoresSafeArea())
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled()
        .onAppear {
            index = ids.firstIndex(of: initialID) ?? 0
            model.focusedID = initialID
            visitedReviewIDs.removeAll()
        }
        .sheet(isPresented: Binding(get: { sharing != nil }, set: { if !$0 { sharing = nil } })) { if let sharing { ShareSheet(items: [sharing]) } }
    }
    @ViewBuilder
    private func canvas(size: CGSize) -> some View {
        let landscapeOrExpanded = size.width > size.height || model.hinge.posture == .fullyOpen
        if activeGroup.count > 1 && landscapeOrExpanded {
            comparisonCanvas(size: size)
        } else {
            singlePhotoCanvas(size: size)
        }
    }

    /// In wide layouts, compare the selected image with at most one group
    /// member on either side. Tapping a comparison frame changes the active
    /// decision target; decisions are still saved for exactly one photo.
    private func comparisonCanvas(size: CGSize) -> some View {
        let visibleIDs = SelectionPresentation.comparisonWindow(activeGroup, currentID: current?.id ?? "")
        return ZStack {
            blurredBackdrop
            HStack(spacing: size.width > 900 ? 16 : 10) {
                ForEach(visibleIDs, id: \.self) { id in
                    if let asset = model.state.assets.first(where: { $0.id == id }) {
                        let selected = id == current?.id
                        if selected {
                            comparisonCard(asset, selected: true)
                                .accessibilityLabel(asset.name + ", 当前选择")
                                .accessibilityIdentifier("similar-comparison-photo-\(id)")
                                .allowsHitTesting(false)
                        } else {
                            Button {
                                if let nextIndex = ids.firstIndex(of: id) { index = nextIndex; resetZoom() }
                            } label: {
                                comparisonCard(asset, selected: false)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(asset.name + ", 相似照片")
                            .accessibilityIdentifier("similar-comparison-photo-\(id)")
                        }
                    }
                }
            }
            .padding(.horizontal, size.width > 900 ? 54 : 44)
            .padding(.vertical, 20)
        }
        .frame(width: size.width, height: size.height)
        .clipped()
    }

    private func comparisonCard(_ asset: LocalAsset, selected: Bool) -> some View {
        ZStack(alignment: .bottomLeading) {
            AssetImage(asset: asset, size: selected && original ? 6000 : 1600, original: selected && original)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(selected ? scale : 1)
                .offset(x: selected ? offset.width : 0, y: selected ? offset.height : 0)
                .allowsHitTesting(false)
            if selected {
                Text("正在选择")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(selected ? PhotoPalette.lightSky : Color.white.opacity(0.34), lineWidth: selected ? 3 : 1)
        }
        .shadow(color: selected ? PhotoPalette.lightSky.opacity(0.20) : .black.opacity(0.16), radius: selected ? 18 : 8, y: 5)
    }

    /// Single-frame mode preserves the whole photograph and uses a softened
    /// copy behind it so portrait images do not leave empty black side bands.
    private func singlePhotoCanvas(size: CGSize) -> some View {
        let strip = size.width * neighbourShare
        let band = size.width - (hasPrevious ? strip : 0) - (hasNext ? strip : 0)
        let bandCenter = (hasPrevious ? strip : 0) + band / 2
        var photoWidth = band
        var photoHeight = photoWidth / currentAspect
        if photoHeight > size.height { photoHeight = size.height; photoWidth = photoHeight * currentAspect }
        return ZStack {
            blurredBackdrop
            if hasPrevious { neighbour(delta: -1, width: strip, height: size.height).offset(x: strip / 2 - size.width / 2) }
            if hasNext { neighbour(delta: 1, width: strip, height: size.height).offset(x: size.width - strip / 2 - size.width / 2) }
            if let current {
                AssetImage(asset: current, size: original ? 6000 : 1600, original: original)
                    .frame(width: photoWidth, height: photoHeight)
                    .scaleEffect(scale)
                    .offset(x: bandCenter - size.width / 2 + offset.width, y: offset.height)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipped()
    }

    @ViewBuilder
    private var blurredBackdrop: some View {
        if let current {
            AssetImage(asset: current, size: 960, fill: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(1.12)
                .blur(radius: 30)
                .overlay(Color.black.opacity(0.28))
        } else {
            Color(white: 0.035)
        }
    }
    @ViewBuilder
    private func neighbour(delta: Int, width: CGFloat, height: CGFloat) -> some View {
        let position = index + delta
        if ids.indices.contains(position), let asset = model.state.assets.first(where: { $0.id == ids[position] }) {
            // Photos from the same group stay sharp, the rest stay blurred.
            let similar = model.groups.contains { $0.contains(ids[index]) && $0.contains(asset.id) }
            AssetImage(asset: asset, size: 480, fill: true)
                .frame(width: width, height: height)
                .clipped()
                .blur(radius: similar ? 0 : 10)
                .opacity(similar ? 1 : 0.6)
                .allowsHitTesting(false)
        } else {
            Color.clear.frame(width: width, height: height)
        }
    }
    private func nextPhoto(after currentID: String) -> String? {
        if reviewed {
            return SelectionPresentation.nextUnvisitedID(in: ids, after: currentID, visited: visitedReviewIDs)
        }
        guard let batchID,
              let batch = model.state.batches.first(where: { $0.id == batchID }) else { return nil }
        let unresolved = Set(batch.photos.compactMap { photo -> String? in
            let decision = round == .coarse ? photo.coarse : photo.fine
            return decision == .unseen && ids.contains(photo.assetID) ? photo.assetID : nil
        })
        return SelectionPresentation.nextUnresolvedID(in: ids, after: currentID, unresolved: unresolved)
    }
    private func move(to id: String) {
        guard let nextIndex = ids.firstIndex(of: id) else { return }
        index = nextIndex
        resetZoom()
    }
    func move(_ delta: Int) { index = min(max(0, index + delta), max(0, ids.count - 1)); resetZoom() }
    private func resetZoom() { scale = 1; scaleBase = 1; offset = .zero; baseOffset = .zero; original = false; model.focusedID = current?.id }
}
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct RangeFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue(), uniquingKeysWith: { _, new in new }) }
}
struct PhotoRangePicker: View {
    @Environment(\.dismiss) var dismiss
    let assets: [LocalAsset]
    let importSelection: (Set<String>) -> Void
    @State private var selected = Set<String>()
    @State private var selectingRange = false
    @State private var anchor: String?
    @State private var baseline = Set<String>()
    @State private var frames: [String: CGRect] = [:]
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))]) {
                ForEach(assets) { asset in
                    AssetImage(asset: asset, size: 320, fill: true, aspect: 1).overlay(alignment: .topTrailing) { Image(systemName: selected.contains(asset.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(selected.contains(asset.id) ? .orange : .white).padding(4) }
                        .background(GeometryReader { geometry in Color.clear.preference(key: RangeFrames.self, value: [asset.id: geometry.frame(in: .named("range"))]) })
                        .onTapGesture { if selectingRange { if anchor == nil { anchor = asset.id; baseline = selected }; selectThrough(asset.id) } else { toggle(asset.id) } }
                        .onLongPressGesture { selectingRange = true; anchor = asset.id; baseline = selected; if !selected.contains(asset.id) { toggle(asset.id) } }
                }
            }.padding(8)
        }.coordinateSpace(name: "range").onPreferenceChange(RangeFrames.self) { frames = $0 }
            .scrollDisabled(selectingRange)
            .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { value in
                guard selectingRange else { return }
                if anchor == nil, let first = frames.first(where: { $0.value.contains(value.startLocation) }) { anchor = first.key; baseline = selected }
                if let current = frames.first(where: { $0.value.contains(value.location) }) { selectThrough(current.key) }
            }.onEnded { _ in anchor = nil })
            .navigationTitle("已选 \(selected.count) 张")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("导入") { importSelection(selected) }.disabled(selected.isEmpty) }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("全选") { selected = Set(assets.map(\.id)) }
                    Button("清空") { selected = []; anchor = nil }
                    Button(selectingRange ? "完成范围选择" : "连续选择") { selectingRange.toggle(); anchor = nil; baseline = selected }
                }
            }
    }
    /// Toggles an individual photo without changing any other selected range.
    private func toggle(_ id: String) {
        if !selected.insert(id).inserted { selected.remove(id) }
    }
    func selectThrough(_ id: String) {
        guard let anchor, let start = assets.firstIndex(where: { $0.id == anchor }), let end = assets.firstIndex(where: { $0.id == id }) else { return }
        let range = assets[min(start, end)...max(start, end)].map(\.id)
        selected = baseline.union(range)
    }
}
