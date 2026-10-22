import SwiftUI
import Photos
import UniformTypeIdentifiers
import PhotoCore

struct BatchListView: View {
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @State private var create = false
    var body: some View {
        List {
            Button("新建导入批次", systemImage: "plus") { create = true }
            ForEach(model.state.batches.reversed()) { batch in
                NavigationLink { BatchView(batchID: batch.id) } label: { VStack(alignment: .leading) { Text(batch.name); Text("\(batch.photos.count) 张").font(.caption).foregroundStyle(.secondary) } }
            }
        }.navigationTitle("导入与选片")
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
    var photos: [LocalAsset] {
        let ids = Set((batch?.photos ?? []).filter { row in round == .coarse ? (reviewed ? row.coarse != .unseen : row.coarse == .unseen) : (row.admitted && (reviewed ? row.fine != .unseen : row.fine == .unseen)) }.map(\.assetID))
        return PhotoSearch.filter(model.state.assets.filter { ids.contains($0.id) }, keyword: query, tags: Array(tags), any: any).sorted { ($0.takenAt ?? $0.importedAt) < ($1.takenAt ?? $1.importedAt) }
    }
    var displayed: [LocalAsset] {
        guard collapsed else { return photos }
        let ids = Set(photos.map(\.id)); let hidden = Set(model.groups.flatMap { $0.filter { ids.contains($0) }.dropFirst() })
        return photos.filter { !hidden.contains($0.id) }
    }
    var body: some View {
        VStack(spacing: 0) {
            Picker("阶段", selection: $round) { Text("粗筛").tag(SelectionRound.coarse); Text("精筛").tag(SelectionRound.fine) }.pickerStyle(.segmented).padding()
            HStack {
                Button(reviewed ? "待处理" : "已处理") { reviewed.toggle(); selected.removeAll() }
                Button("筛选", systemImage: "line.3.horizontal.decrease") { showFilters = true }
                Spacer()
                Button(multi ? "完成选择" : "选择") { multi.toggle(); selected.removeAll() }
            }.font(.subheadline).padding(.horizontal)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 8)], spacing: 10) {
                    ForEach(displayed) { asset in
                        VStack(alignment: .leading, spacing: 6) {
                            AssetImage(asset: asset).overlay(alignment: .topTrailing) { if selected.contains(asset.id) { Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(.orange).padding(5) } }
                            HStack {
                                Text(asset.name).lineLimit(1).font(.caption)
                                if let group = model.groups.first(where: { $0.contains(asset.id) }), group.count > 1 { Text("相似 \(group.count)").font(.caption2).foregroundStyle(.orange) }
                            }
                            if let analysis = asset.analysis { Text(analysis.labels.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                        }.accessibilityElement(children: .combine).accessibilityAddTraits(.isButton).accessibilityIdentifier("photo-card-" + asset.id).contentShape(Rectangle()).onTapGesture {
                            if multi { if !selected.insert(asset.id).inserted { selected.remove(asset.id) } }
                            else { model.focusedID = asset.id; immersive = asset }
                        }.onLongPressGesture { multi = true; selected.insert(asset.id) }
                    }
                }.padding()
                if photos.isEmpty { ContentUnavailableView("当前范围已完成", systemImage: "checkmark.circle", description: Text(round == .coarse ? "切换到精筛继续挑选，或导入更多照片" : "精筛保留照片可在作品集中归集")) }
            }
            if !selected.isEmpty { DecisionButtons(round: round) { decision in
                if model.decide(batchID: batchID, ids: Array(selected), round: round, decision: decision, next: nil) { selected.removeAll() }
            }.padding() }
        }.navigationTitle(batch?.name ?? "选片")
            .toolbar {
                Menu {
                    Button("从相册读取", systemImage: "photo.on.rectangle") { importSheet = true }
                    Button("存储卡／文件夹", systemImage: "folder") { reconnecting = false; fileImporter = true }
                    Button(collapsed ? "全部展开" : "全部叠放") { collapsed.toggle() }
                    Button("撤销上次决定", systemImage: "arrow.uturn.backward") { model.undo() }
                    Button("重新连接来源文件夹") { reconnecting = true; fileImporter = true }
                    Button("保存当前范围的离线原片") { Task { await model.copySelected(photos.map(\.id), includePhotos: true) } }
                    Button("重新生成缺失预览") { model.startMediaPreparation() }
                    Button("继续复制入选原片") { Task { await model.copySelected((batch?.photos ?? []).filter(\.finalist).map(\.assetID)) } }
                } label: { Image(systemName: "ellipsis.circle") }
            }
            .searchable(text: $query, prompt: "名称、标签或描述")
            .onChange(of: query) { _, _ in selected.removeAll() }.onChange(of: round) { _, _ in selected.removeAll() }
            .onChange(of: tags) { _, _ in selected.removeAll() }.onChange(of: any) { _, _ in selected.removeAll() }
            .onChange(of: collapsed) { _, _ in selected.removeAll() }
            .sheet(isPresented: $importSheet) { NavigationStack { AlbumImportView(batchID: batchID) } }
            .sheet(isPresented: $showFilters) { NavigationStack { TagFilterView(selected: $tags, any: $any) } }
            .fileImporter(isPresented: $fileImporter, allowedContentTypes: [.folder, .jpeg, .png, .heic, .heif], allowsMultipleSelection: true) { result in
                switch result { case .success(let urls): Task { if reconnecting, let folder = urls.first { await model.reconnect(folder, batchID: batchID) } else { await model.importFiles(urls, batchID: batchID) } }; case .failure(let error): model.error = error.localizedDescription }
            }
            .fullScreenCover(item: $immersive) { asset in ImmersiveView(ids: photos.map(\.id), initialID: asset.id, batchID: batchID, round: round) }
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
            Section { Button("读取整个范围") { Task { await model.importPhotos(start: Calendar.current.startOfDay(for: start), end: endExclusive, albumID: album.isEmpty ? nil : album, batchID: batchID); dismiss() } }.disabled(model.busy || count == 0) }
        }.sheet(isPresented: $rangePicker) { NavigationStack { PhotoRangePicker(assets: rangePhotos) { ids in
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
struct TagFilterView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @Binding var selected: Set<String>
    @Binding var any: Bool
    var body: some View {
        Form {
            Toggle("满足任一标签", isOn: $any)
            ForEach(TagDomain.allCases, id: \.self) { domain in
                DisclosureGroup(domain.title) {
                    ForEach(model.state.tags.filter { $0.domain == domain }) { tag in
                        Button { if !selected.insert(tag.name).inserted { selected.remove(tag.name) } } label: { HStack { Text(tag.name); Spacer(); if selected.contains(tag.name) { Image(systemName: "checkmark") } } }
                    }
                }
            }
            Button("清除筛选") { selected.removeAll() }
        }.navigationTitle("标签筛选").toolbar { Button("完成") { dismiss() } }
    }
}
extension TagDomain { var title: String { switch self { case .subject: return "主体"; case .distance: return "景别"; case .environment: return "环境"; case .style: return "风格"; case .other: return "其他" } } }
struct DecisionButtons: View {
    let round: SelectionRound
    let action: (Decision) -> Void
    var body: some View {
        HStack(spacing: 12) {
            if round == .coarse { decision("待定", .pending, .yellow) }
            decision("保留", .keep, .green); decision("不要", .reject, .red)
        }
    }
    func decision(_ name: String, _ value: Decision, _ color: Color) -> some View {
        Button { action(value) } label: { Text(name).font(.headline).frame(maxWidth: .infinity, minHeight: 56) }.buttonStyle(.bordered).tint(color)
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
    init(ids: [String], initialID: String, batchID: String?, round: SelectionRound) {
        _ids = State(initialValue: ids)
        self.initialID = initialID; self.batchID = batchID; self.round = round
    }
    var current: LocalAsset? { ids.indices.contains(index) ? model.state.assets.first { $0.id == ids[index] } : nil }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("关闭", systemImage: "xmark") { dismiss() }
                Spacer(); VStack { Text("\(min(index + 1, ids.count))/\(ids.count)").monospacedDigit(); Text(current?.name ?? "").font(.caption).accessibilityIdentifier("current-photo") }
                if batchID != nil { Button("撤销", systemImage: "arrow.uturn.backward") { model.undo(); if let focus = model.focusedID, let i = ids.firstIndex(of: focus) { index = i; finished = false } } }
                Menu {
                    Button(original ? "使用预览" : "查看原图") { original.toggle() }
                    Button("下载／分享原片") { Task { do { if let asset = current { sharing = try await model.media.exportOriginal(asset, allowNetwork: model.allowCloudDownload) } } catch { model.error = error.localizedDescription } } }
                } label: { Image(systemName: "ellipsis.circle") }
            }.padding()
            if finished { ContentUnavailableView("当前范围已完成", systemImage: "checkmark.circle"); Button("返回") { dismiss() }.buttonStyle(.borderedProminent); Spacer() }
            else {
                DuoLayout {
                GeometryReader { geometry in
                    ZStack {
                        ForEach(Array([-1, 0, 1]), id: \.self) { delta in
                            let position = index + delta
                            if ids.indices.contains(position), let asset = model.state.assets.first(where: { $0.id == ids[position] }) {
                                let similar = model.groups.contains { $0.contains(ids[index]) && $0.contains(asset.id) }
                                AssetImage(asset: asset, size: delta == 0 ? (original ? 6000 : 1600) : 480, original: delta == 0 && original)
                                    .frame(width: geometry.size.width * (delta == 0 ? 0.86 : 0.55), height: geometry.size.height)
                                    .blur(radius: delta == 0 || similar ? 0 : 8)
                                    .scaleEffect(delta == 0 ? scale : 0.8)
                                    .offset(x: delta == 0 ? offset.width : CGFloat(delta) * geometry.size.width * 0.78, y: delta == 0 ? offset.height : 0)
                                    .opacity(delta == 0 ? 1 : 0.5)
                                    .allowsHitTesting(delta == 0)
                            }
                        }
                    }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
                        .accessibilityElement(children: .contain).accessibilityIdentifier("immersive-canvas")
                        .contentShape(Rectangle())
                        .gesture(MagnifyGesture().onChanged { scale = min(8, max(1, scaleBase * $0.magnification)) }.onEnded { _ in scaleBase = scale; if scale <= 1 { offset = .zero; baseOffset = .zero } })
                        .simultaneousGesture(DragGesture().onChanged { value in if scale > 1.05 { offset = CGSize(width: baseOffset.width + value.translation.width, height: baseOffset.height + value.translation.height) } }.onEnded { value in
                            if scale > 1.05 { baseOffset = offset }
                            else if abs(value.translation.width) > 70 && abs(value.translation.width) > abs(value.translation.height) * 1.5 { move(value.translation.width < 0 ? 1 : -1) }
                        })
                        .onTapGesture(count: 2) { scale = scale > 1 ? 1 : 2; scaleBase = scale; offset = .zero; baseOffset = .zero }
                }
                } secondary: {
                VStack(spacing: 4) {
                if let analysis = current?.analysis { Text(analysis.labels.joined(separator: " · ")).font(.caption).padding(.horizontal) }
                HStack { Button("上一张", systemImage: "chevron.left") { move(-1) }; Spacer(); Button("下一张", systemImage: "chevron.right") { move(1) } }.padding()
                if let batchID, let current {
                    DecisionButtons(round: round) { decision in
                        let next = index + 1 < ids.count ? ids[index + 1] : nil
                        if model.decide(batchID: batchID, ids: [current.id], round: round, decision: decision, next: next) { if next == nil { finished = true } else { move(1) } }
                    }.padding(.horizontal).padding(.bottom, 12)
                }
                }
                }
            }
        }.background(Color.black).onAppear { index = ids.firstIndex(of: initialID) ?? 0; model.focusedID = initialID }
            .sheet(isPresented: Binding(get: { sharing != nil }, set: { if !$0 { sharing = nil } })) { if let sharing { ShareSheet(items: [sharing]) } }
    }
    func move(_ delta: Int) { index = min(max(0, index + delta), max(0, ids.count - 1)); scale = 1; scaleBase = 1; offset = .zero; baseOffset = .zero; original = false; model.focusedID = current?.id }
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
                    AssetImage(asset: asset).frame(minHeight: 100).overlay(alignment: .topTrailing) { Image(systemName: selected.contains(asset.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(selected.contains(asset.id) ? .orange : .white).padding(4) }
                        .background(GeometryReader { geometry in Color.clear.preference(key: RangeFrames.self, value: [asset.id: geometry.frame(in: .named("range"))]) })
                        .onTapGesture { if selectingRange { if anchor == nil { anchor = asset.id; baseline = selected }; selectThrough(asset.id) } else if !selected.insert(asset.id).inserted { selected.remove(asset.id) } }
                        .onLongPressGesture { selectingRange = true; anchor = asset.id; baseline = selected; selected.insert(asset.id) }
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
                    Button("全选") { selected = Set(assets.map(\.id)) }; Button("清空") { selected = []; anchor = nil }
                    Button(selectingRange ? "完成范围选择" : "连续选择") { selectingRange.toggle(); anchor = nil; baseline = selected }
                }
            }
    }
    func selectThrough(_ id: String) {
        guard let anchor, let start = assets.firstIndex(where: { $0.id == anchor }), let end = assets.firstIndex(where: { $0.id == id }) else { return }
        selected = baseline.union(assets[min(start, end)...max(start, end)].map(\.id))
    }
}
