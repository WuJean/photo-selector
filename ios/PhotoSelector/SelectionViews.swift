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
            }.font(.subheadline.weight(.medium)).buttonStyle(.bordered).tint(PhotoPalette.accent).padding(.horizontal)
            ScrollView {
                if batch?.photos.isEmpty == true {
                    VStack(spacing: 20) {
                        GuidedEmptyState(title: "把照片带进来", message: "按时间读取相册，或从存储卡和文件夹导入。", symbol: "photo.badge.plus")
                        Button { importSheet = true } label: { Label("从相册读取", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity, minHeight: 52) }.buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                        Button { reconnecting = false; fileImporter = true } label: { Label("存储卡／文件夹", systemImage: "folder").frame(maxWidth: .infinity, minHeight: 48) }.buttonStyle(.bordered)
                    }.tint(PhotoPalette.accent).padding(20)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 8)], spacing: 10) {
                    ForEach(displayed) { asset in
                        VStack(alignment: .leading, spacing: 6) {
                            AssetImage(asset: asset, size: 480, fill: true, aspect: 1).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(alignment: .topTrailing) { if selected.contains(asset.id) { Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(.orange).padding(5) } }
                            HStack {
                                Text(asset.name).lineLimit(1).font(.caption)
                                if let group = model.groups.first(where: { $0.contains(asset.id) }), group.count > 1 { Text("相似 \(group.count)").font(.caption2).foregroundStyle(.orange) }
                            }
                            if let analysis = asset.analysis { Text(analysis.labels.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                        }.padding(10).photoGlass(cornerRadius: 22).accessibilityElement(children: .combine).accessibilityAddTraits(.isButton).accessibilityIdentifier("photo-card-" + asset.id).contentShape(Rectangle()).onTapGesture {
                            if multi { if !selected.insert(asset.id).inserted { selected.remove(asset.id) } }
                            else { model.focusedID = asset.id; immersive = asset }
                        }.onLongPressGesture { multi = true; selected.insert(asset.id) }
                    }
                }.padding()
                if photos.isEmpty && batch?.photos.isEmpty == false {
                    GuidedEmptyState(title: query.isEmpty && tags.isEmpty ? "当前范围已完成" : "没有匹配的照片", message: query.isEmpty && tags.isEmpty ? (round == .coarse ? "切换到精筛继续挑选，或导入更多照片。" : "精筛保留的照片可以加入作品集。") : "试试其他关键词，或清除标签筛选。", symbol: query.isEmpty && tags.isEmpty ? "checkmark.seal" : "magnifyingglass").padding()
                }
            }
            if !selected.isEmpty { DecisionButtons(round: round) { decision in
                if model.decide(batchID: batchID, ids: Array(selected), round: round, decision: decision, next: nil) { selected.removeAll() }
            }.padding() }
        }.photoBackdrop().navigationTitle(batch?.name ?? "选片")
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
                if count > ImportPolicy.maxPhotosPerImport {
                    Label("\(ImportPolicy.limitDescription)，超出部分需要再导入一次。", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if limited { Text("仅能读取系统授权的照片。可在系统设置中调整授权。").font(.caption); Button("打开系统设置") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) } }
            }
            Button("预览并选择范围内的照片") { loadRange(); rangePicker = true }.disabled(count == 0)
            Toggle("允许从 iCloud 下载原片", isOn: $model.allowCloudDownload)
            Section {
                Button(importButtonTitle) { Task { await model.importPhotos(start: Calendar.current.startOfDay(for: start), end: endExclusive, albumID: album.isEmpty ? nil : album, batchID: batchID); dismiss() } }
                    .disabled(model.busy || count == 0)
            } footer: {
                Text(count > ImportPolicy.maxPhotosPerImport ? "将按拍摄时间读取最早的 \(ImportPolicy.maxPhotosPerImport) 张。" : ImportPolicy.limitDescription + "，剩下的照片留在相册里随时再导入。")
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
    private var importButtonTitle: String {
        count > ImportPolicy.maxPhotosPerImport ? "读取最早的 \(ImportPolicy.maxPhotosPerImport) 张" : "读取整个范围"
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
        }.scrollContentBackground(.hidden).photoBackdrop().navigationTitle("标签筛选").toolbar { Button("完成") { dismiss() } }
    }
}
extension TagDomain { var title: String { switch self { case .subject: return "主体"; case .distance: return "景别"; case .environment: return "环境"; case .style: return "风格"; case .other: return "其他" } } }
struct DecisionButtons: View {
    let round: SelectionRound
    let action: (Decision) -> Void
    var body: some View {
        // The bar sits at the bottom on a phone and inside a narrow side rail
        // on a Duo, so it falls back to stacked buttons when it cannot fit.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { buttons }
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
                .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
        }.buttonStyle(.bordered).tint(color).accessibilityLabel(name)
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
    /// Share of the canvas reserved for the neighbouring photos.
    private let neighbourShare: CGFloat = 0.10
    private var hasPrevious: Bool { index > 0 }
    private var hasNext: Bool { index < ids.count - 1 }
    private var currentAspect: CGFloat { current.map { assetAspect($0) } ?? 1 }
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
            }.padding(12).photoGlass(cornerRadius: 22).padding(.horizontal, 12).padding(.top, 4)
            if finished { ContentUnavailableView("当前范围已完成", systemImage: "checkmark.circle"); Button("返回") { dismiss() }.buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent); Spacer() }
            else {
                DuoLayout {
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
                } secondary: {
                VStack(spacing: 6) {
                if let analysis = current?.analysis { Text(analysis.labels.joined(separator: " · ")).font(.caption).padding(.horizontal) }
                if let batchID, let current {
                    DecisionButtons(round: round) { decision in
                        let next = index + 1 < ids.count ? ids[index + 1] : nil
                        if model.decide(batchID: batchID, ids: [current.id], round: round, decision: decision, next: next) { if next == nil { finished = true } else { move(1) } }
                    }.padding(12).photoGlass(cornerRadius: 24).padding(.horizontal, 12).padding(.bottom, 12)
                }
                }
                }
            }
        }.background(Color(white: 0.035)).preferredColorScheme(.dark).onAppear { index = ids.firstIndex(of: initialID) ?? 0; model.focusedID = initialID }
            .sheet(isPresented: Binding(get: { sharing != nil }, set: { if !$0 { sharing = nil } })) { if let sharing { ShareSheet(items: [sharing]) } }
    }
    /// Lays the photo out between the two neighbour strips.
    ///
    /// The neighbours used to sit behind the photo at an offset that pushed
    /// them off screen, so the surrounding photos were never actually visible.
    private func canvas(size: CGSize) -> some View {
        let strip = size.width * neighbourShare
        let band = size.width - (hasPrevious ? strip : 0) - (hasNext ? strip : 0)
        let bandCenter = (hasPrevious ? strip : 0) + band / 2
        var photoWidth = band
        var photoHeight = photoWidth / currentAspect
        if photoHeight > size.height { photoHeight = size.height; photoWidth = photoHeight * currentAspect }
        return ZStack {
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
    @State private var reachedLimit = false
    private var limit: Int { ImportPolicy.maxPhotosPerImport }
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
            .navigationTitle("已选 \(selected.count) / \(limit)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("导入") { importSelection(selected) }.disabled(selected.isEmpty) }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("全选") { selected = Set(assets.prefix(limit).map(\.id)); reachedLimit = assets.count > limit }
                    Button("清空") { selected = []; anchor = nil; reachedLimit = false }
                    Button(selectingRange ? "完成范围选择" : "连续选择") { selectingRange.toggle(); anchor = nil; baseline = selected }
                }
            }
            .overlay(alignment: .bottom) { if reachedLimit { Label("已选满\(ImportPolicy.limitDescription)，其余照片可以再导入一次。", systemImage: "info.circle").font(.caption).padding(10).photoGlass(cornerRadius: 18).padding(.horizontal, 14).padding(.bottom, 64) } }
    }
    /// Adds or removes a photo while respecting the per import cap.
    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id); reachedLimit = false }
        else if selected.count < limit { selected.insert(id) }
        else { reachedLimit = true }
    }
    func selectThrough(_ id: String) {
        guard let anchor, let start = assets.firstIndex(where: { $0.id == anchor }), let end = assets.firstIndex(where: { $0.id == id }) else { return }
        let range = assets[min(start, end)...max(start, end)].map(\.id)
        let merged = baseline.union(range)
        selected = Set(merged.prefix(limit))
        reachedLimit = merged.count > limit
    }
}
