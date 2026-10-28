import SwiftUI
import PhotoCore

struct PortfolioListView: View {
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @State private var create = false
    @State private var selected = Set<String>()
    @State private var showAll = false
    @State private var selectedTab = 0
    @State private var tent = false

    var candidates: [LocalAsset] {
        model.state.assets.filter { asset in
            model.state.isFinalist(asset.id) && (showAll || !model.state.portfolios.contains { $0.assetIDs.contains(asset.id) })
        }
    }
    private var hasFinalists: Bool { model.state.assets.contains { model.state.isFinalist($0.id) } }

    private let portfolioColumns = [GridItem(.adaptive(minimum: 158, maximum: 340), spacing: 14)]
    private let photoColumns = [GridItem(.adaptive(minimum: 142), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("作品集分类", selection: $selectedTab) {
                    Text("我的作品").tag(0)
                    Text("待归集").tag(1)
                }
                .pickerStyle(.segmented)

                Button { tent = true } label: {
                    Label("帐篷模式", systemImage: "tent.2")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(PhotoPalette.accent)
                .accessibilityIdentifier("tent-mode-button")
                .disabled(model.state.portfolios.isEmpty)
                Text("帐篷模式会先让你选择一个作品集，然后自动播放其中的照片。")
                    .font(.caption).foregroundStyle(.secondary)

                if selectedTab == 0 {
                    if model.state.portfolios.isEmpty {
                        ContentUnavailableView {
                            Label("还没有作品集", systemImage: "rectangle.stack")
                        } description: {
                            Text("新建作品集来收纳精筛照片。")
                        } actions: {
                            Button("新建作品集", systemImage: "plus") { create = true }
                                .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                        }
                        .padding(.top, 24)
                    } else {
                        LazyVGrid(columns: portfolioColumns, spacing: 14) {
                            ForEach(model.state.portfolios) { portfolio in
                                PortfolioCoverCard(portfolio: portfolio)
                            }
                        }
                    }
                } else {
                    HStack {
                        Spacer()
                        Toggle("全部", isOn: $showAll)
                            .fixedSize()
                            .tint(PhotoPalette.accent)
                    }

                    if candidates.isEmpty {
                        ContentUnavailableView {
                            Label("暂无待归集照片", systemImage: "photo.stack")
                        } description: {
                            Text(!hasFinalists ? "先在导入与选片中完成精筛。" : showAll ? "目前没有精筛照片。" : "精筛照片都已归集；打开“全部”可再次查看。")
                        } actions: {
                            NavigationLink("前往导入与选片") { BatchListView() }
                                .buttonStyle(.bordered)
                        }
                        .padding(.top, 12)
                    } else {
                        LazyVGrid(columns: photoColumns, spacing: 10) {
                            ForEach(candidates) { asset in
                                SelectablePortfolioPhoto(asset: asset, selected: selected.contains(asset.id)) {
                                    toggleSelection(of: asset.id)
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: 980)
            .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
        .navigationTitle("作品集")
        .fullScreenCover(isPresented: $tent) { TentModeFlow(startWith: nil) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("新建", systemImage: "plus") { create = true }
                    .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
            }
        }
        .onChange(of: showAll) { _, _ in selected.removeAll() }
        .onChange(of: selectedTab) { _, _ in selected.removeAll() }
        .safeAreaInset(edge: .bottom) {
            if !selected.isEmpty {
                if model.state.portfolios.isEmpty {
                    Button("新建作品集", systemImage: "plus") { create = true }
                        .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity)
                        .background(.ultraThinMaterial)
                } else {
                    Menu("加入作品集 · \(selected.count) 张") {
                        ForEach(model.state.portfolios) { portfolio in
                            Button(portfolio.name) {
                                model.perform {
                                    try model.change { try $0.addToPortfolio(Array(selected), portfolioID: portfolio.id) }
                                    selected.removeAll()
                                }
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial)
                }
            }
        }
        .alert("新建作品集", isPresented: $create) {
            TextField("名称", text: $name)
            Button("创建") {
                model.perform {
                    let portfolio = Portfolio(name: name.isEmpty ? "新作品集" : name)
                    try model.change { $0.portfolios.append(portfolio) }
                    name = ""
                }
            }
            Button("取消", role: .cancel) {}
        }
    }

    private func toggleSelection(of id: String) {
        if !selected.insert(id).inserted { selected.remove(id) }
    }
}

private struct PortfolioCoverCard: View {
    @EnvironmentObject private var model: AppModel
    let portfolio: Portfolio

    private var cover: LocalAsset? {
        let coverID = portfolio.coverID ?? portfolio.assetIDs.first
        guard let coverID else { return nil }
        return model.state.assets.first { $0.id == coverID }
    }

    var body: some View {
        NavigationLink { PortfolioDetailView(collectionID: portfolio.id) } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    if let cover {
                        AssetImage(asset: cover, size: 1080, fill: true, aspect: 4.0 / 3.0)
                            .frame(maxWidth: .infinity)
                            .background(PhotoPalette.accent.opacity(0.14))
                    } else {
                        ZStack {
                            LinearGradient(colors: [PhotoPalette.accent.opacity(0.7), PhotoPalette.accent.opacity(0.22)], startPoint: .topLeading, endPoint: .bottomTrailing)
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.system(size: 34, weight: .light))
                                .foregroundStyle(.white.opacity(0.85))
                        }
                        .aspectRatio(4 / 3, contentMode: .fit)
                    }

                    LinearGradient(colors: [.clear, .black.opacity(0.38)], startPoint: .center, endPoint: .bottom)

                    VStack(alignment: .leading, spacing: 5) {
                        if !portfolio.location.isEmpty {
                            Label(portfolio.location, systemImage: "mappin.and.ellipse")
                                .lineLimit(1)
                                .font(.caption.weight(.medium))
                        }
                        Text(portfolio.date, style: .date)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.82))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(13)
                    .foregroundStyle(.white)

                    Label("\(portfolio.assetIDs.count) 张", systemImage: "photo")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(.ultraThinMaterial, in: Capsule())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .padding(10)
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text(portfolio.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
            }
            .photoGlass(cornerRadius: 24)
        }
        .buttonStyle(.plain)
    }
}

private struct SelectablePortfolioPhoto: View {
    let asset: LocalAsset
    let selected: Bool
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
        ZStack(alignment: .topTrailing) {
            AssetImage(asset: asset, size: 480, fill: true, aspect: 1)
                .frame(maxWidth: .infinity)
                .background(PhotoPalette.accent.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .symbolRenderingMode(.palette)
                .foregroundStyle(selected ? PhotoPalette.accent : .white, .black.opacity(selected ? 0.1 : 0.38))
                .padding(8)
        }
        if let analysis = asset.analysis, !analysis.labels.isEmpty {
            Text(analysis.labels.joined(separator: " · "))
                .font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10).padding(.bottom, 10)
        }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: action)
        .photoGlass(cornerRadius: 18)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(([asset.name] + (asset.analysis?.labels ?? [])).joined(separator: "，"))
        .accessibilityValue(selected ? "已选择" : "未选择")
        .accessibilityAddTraits(.isButton)
    }
}

private func portfolioImageAspectRatio(_ asset: LocalAsset) -> CGFloat { assetAspect(asset) }

struct PortfolioDetailView: View {
    @EnvironmentObject var model: AppModel
    let collectionID: String
    @State private var edit = false
    @State private var collage = false
    @State private var writing = false
    @State private var query = ""
    @State private var tags = Set<String>()
    @State private var any = false
    @State private var filters = false
    @State private var selected = Set<String>()
    @State private var sharing: [URL] = []
    @State private var textEdit: Creation?
    @State private var selectedDetailTab = 0
    @State private var showGallery = false
    @State private var tent = false

    var portfolio: Portfolio? { model.state.portfolios.first { $0.id == collectionID } }
    private var portfolioAssets: [LocalAsset] {
        (portfolio?.assetIDs ?? []).compactMap { id in model.state.assets.first { $0.id == id } }
    }
    var photos: [LocalAsset] {
        PhotoSearch.filter(portfolioAssets, keyword: query, tags: Array(tags), any: any)
    }
    private var creations: [Creation] { model.state.creations.filter { $0.collectionID == collectionID } }
    private let photoColumns = [GridItem(.adaptive(minimum: 142), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let portfolio {
                    portfolioMetadata(portfolio)

                    HStack(spacing: 8) {
                        Button("智能拼图", systemImage: "square.grid.2x2") { collage = true }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("智能拼图")
                            .frame(maxWidth: .infinity)
                        Button("生成文案", systemImage: "text.quote") { writing = true }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("生成文案")
                            .frame(maxWidth: .infinity)
                        Menu {
                            Button("标签筛选") { filters = true }
                            Button("查看照片墙", systemImage: "square.grid.2x2") { showGallery = true }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(width: 30, height: 34)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("更多")
                    }
                    .tint(PhotoPalette.accent)

                    HStack(spacing: 8) {
                        Button { tent = true } label: {
                            Label("帐篷模式", systemImage: "tent.2").frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("tent-mode-button")
                        Button { Task { await model.generatePosters(portfolioID: collectionID) } } label: {
                            Label("生成海报", systemImage: "doc.richtext").frame(maxWidth: .infinity, minHeight: 34)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("generate-posters-button")
                        .disabled(portfolio.assetIDs.isEmpty)
                    }
                    .tint(PhotoPalette.accent)
                    Text("每张照片都会单独生成一张海报，上下两半等高，不会拼贴。")
                        .font(.caption).foregroundStyle(.secondary)

                    Picker("作品集内容", selection: $selectedDetailTab) {
                        Text("照片").tag(0)
                        Text("创作").tag(1)
                    }
                    .pickerStyle(.segmented)

                    if selectedDetailTab == 0 {
                        if photos.isEmpty {
                            HStack(spacing: 10) {
                                Image(systemName: "photo")
                                    .foregroundStyle(PhotoPalette.accent)
                                Text(portfolio.assetIDs.isEmpty ? "作品集还没有照片" : "没有符合条件的照片")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Spacer(minLength: 0)
                                if portfolio.assetIDs.isEmpty {
                                    NavigationLink("前往导入与选片") { BatchListView() }
                                        .font(.subheadline)
                                }
                            }
                            .padding(.vertical, 12)
                        } else {
                            LazyVGrid(columns: photoColumns, spacing: 10) {
                                ForEach(photos) { asset in
                                    SelectablePortfolioPhoto(asset: asset, selected: selected.contains(asset.id)) {
                                        toggleSelection(of: asset.id)
                                    }
                                }
                            }
                        }

                        if !selected.isEmpty {
                            HStack(spacing: 10) {
                                Button("下载 \(selected.count) 张") { Task { await exportSelected() } }
                                    .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                                Button("移出作品集", role: .destructive) {
                                    model.perform {
                                        try model.change { state in
                                            if let index = state.portfolios.firstIndex(where: { $0.id == collectionID }) {
                                                state.portfolios[index].assetIDs.removeAll { selected.contains($0) }
                                                if let coverID = state.portfolios[index].coverID, selected.contains(coverID) {
                                                    state.portfolios[index].coverID = state.portfolios[index].assetIDs.first
                                                }
                                            }
                                        }
                                        selected.removeAll()
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    } else if creations.isEmpty {
                        HStack(spacing: 10) {
                            Image(systemName: "sparkles")
                                .foregroundStyle(PhotoPalette.accent)
                            Text("暂无创作")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 12)
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(creations) { creation in
                                creationCard(creation)
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("找不到作品集", systemImage: "rectangle.stack.badge.minus")
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
        .navigationTitle(portfolio?.name ?? "作品集")
        .searchable(text: $query, prompt: "名称、描述、标签")
        .onChange(of: query) { _, _ in selected.removeAll() }
        .onChange(of: tags) { _, _ in selected.removeAll() }
        .onChange(of: any) { _, _ in selected.removeAll() }
        .onChange(of: selectedDetailTab) { _, _ in selected.removeAll() }
        .toolbar { Button("编辑") { edit = true } }
        .navigationDestination(isPresented: $showGallery) { GalleryView(collectionID: collectionID) }
        .sheet(isPresented: $edit) {
            if let portfolio { NavigationStack { PortfolioEditor(portfolio: portfolio) } }
        }
        .sheet(isPresented: $collage) { NavigationStack { CollageEditor(collectionID: collectionID) } }
        .sheet(isPresented: $writing) { NavigationStack { WritingView(collectionID: collectionID) } }
        .fullScreenCover(isPresented: $tent) { TentModeFlow(startWith: portfolio) }
        .sheet(isPresented: $filters) { NavigationStack { TagFilterView(assets: portfolioAssets, selected: $tags, any: $any) } }
        .sheet(item: $textEdit) { creation in NavigationStack { TextCreationEditor(creation: creation) } }
        .sheet(isPresented: Binding(get: { !sharing.isEmpty }, set: { if !$0 { sharing = [] } })) { ShareSheet(items: sharing) }
    }

    @ViewBuilder
    private func portfolioMetadata(_ portfolio: Portfolio) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(portfolio.date, style: .date)
                if !portfolio.location.isEmpty {
                    Text("·")
                    Label(portfolio.location, systemImage: "mappin.and.ellipse")
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("\(portfolio.assetIDs.count) 张")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if !portfolio.poem.isEmpty {
                Text(portfolio.poem)
                    .font(.subheadline)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !portfolio.description.isEmpty {
                if portfolio.description.count > 80 {
                    DisclosureGroup("作品描述") {
                        Text(portfolio.description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 4)
                    }
                    .font(.caption)
                } else {
                    Text(portfolio.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func creationCard(_ creation: Creation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label(creation.title, systemImage: creation.kind == "text" ? "text.quote" : "square.grid.2x2")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(creation.createdAt, style: .date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let path = creation.path, let url = try? model.media.url(path), let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                ShareLink(item: url) { Label("分享", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.bordered)
            }

            if creation.kind == "text" {
                Text(creation.text)
                    .lineLimit(5)
                HStack(spacing: 10) {
                    Button("编辑") { textEdit = creation }
                        .buttonStyle(.bordered)
                    ShareLink(item: creation.text) { Label("分享", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.bordered)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .photoGlass(cornerRadius: 18)
    }

    private func toggleSelection(of id: String) {
        if !selected.insert(id).inserted { selected.remove(id) }
    }

    func exportSelected() async {
        do {
            var urls: [URL] = []
            for asset in photos where selected.contains(asset.id) {
                model.progress = "导出 \(urls.count + 1)/\(selected.count)"
                urls.append(try await model.media.exportOriginal(asset, allowNetwork: model.allowCloudDownload))
            }
            sharing = urls
        } catch {
            model.error = error.localizedDescription
        }
        model.progress = ""
    }
}

struct PortfolioEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State var portfolio: Portfolio
    @State private var discard = false

    var body: some View {
        Form {
            Section("作品信息") {
                TextField("名称", text: $portfolio.name)
                TextField("地点", text: $portfolio.location)
                DatePicker("时间", selection: $portfolio.date, displayedComponents: .date)
                TextField("一句诗", text: $portfolio.poem, axis: .vertical)
                TextField("描述", text: $portfolio.description, axis: .vertical)
            }
            Section("封面") {
                Picker("封面", selection: Binding(get: { portfolio.coverID ?? "" }, set: { portfolio.coverID = $0.isEmpty ? nil : $0 })) {
                    Text("第一张").tag("")
                    ForEach(portfolio.assetIDs, id: \.self) { id in
                        Text(model.state.assets.first { $0.id == id }?.name ?? id).tag(id)
                    }
                }
            }
            Section("照片顺序") {
                ForEach(portfolio.assetIDs, id: \.self) { id in
                    Text(model.state.assets.first { $0.id == id }?.name ?? id)
                }
                .onMove { from, to in portfolio.assetIDs.move(fromOffsets: from, toOffset: to) }
            }
        }
        .scrollContentBackground(.hidden)
        .photoBackdrop()
        .navigationTitle("编辑作品集")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
        .environment(\.editMode, .constant(.active))
        .interactiveDismissDisabled()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { discard = true } }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") {
                    model.perform {
                        try model.change { state in
                            if let index = state.portfolios.firstIndex(where: { $0.id == portfolio.id }) { state.portfolios[index] = portfolio }
                        }
                        dismiss()
                    }
                }
            }
        }
        .confirmationDialog("放弃未保存的修改？", isPresented: $discard) {
            Button("放弃修改", role: .destructive) { dismiss() }
        }
    }
}

struct TextCreationEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State var creation: Creation

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TextField("标题", text: $creation.title)
                    .font(.title3.weight(.semibold))
                    .padding(16)
                    .photoGlass(cornerRadius: 20)
                TextEditor(text: $creation.text)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .frame(minHeight: 260)
                    .photoGlass(cornerRadius: 20)
            }
            .padding(18)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
        .navigationTitle("编辑文案")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
        .toolbar {
            Button("保存") {
                model.perform {
                    try model.change { state in
                        if let index = state.creations.firstIndex(where: { $0.id == creation.id }) { state.creations[index] = creation }
                    }
                    dismiss()
                }
            }
        }
    }
}

struct WritingView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let collectionID: String
    @State private var running = false
    @State private var status = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "text.quote")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(PhotoPalette.accent)
                        .frame(width: 58, height: 58)
                        .background(PhotoPalette.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    Text("从整个作品集生成文案")
                        .font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text("复用照片描述；缺少描述时先补充分析。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .photoGlass(cornerRadius: 26)

                if running {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text(status)
                            .font(.subheadline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .photoGlass(cornerRadius: 20)
                }

                Button("生成并保存新版本") { Task { await generate() } }
                    .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .disabled(running)
            }
            .padding(18)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
        .navigationTitle("文案")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
        .toolbar { Button("关闭") { dismiss() } }
    }

    func generate() async {
        guard let portfolio = model.state.portfolios.first(where: { $0.id == collectionID }) else { return }
        running = true
        defer { running = false }
        do {
            let config = model.aiConfig; let key = Keychain.load(); var descriptions: [String] = []
            for (i, id) in portfolio.assetIDs.enumerated() {
                guard let asset = model.state.assets.first(where: { $0.id == id }) else { continue }
                status = "读取 \(i + 1)/\(portfolio.assetIDs.count)"
                var analysis = asset.analysis
                if analysis == nil {
                    let image = try await model.media.image(asset, maxSize: 1080, allowNetwork: model.allowCloudDownload)
                    analysis = try await model.intelligence.analyze(image, tags: model.state.tags, config: config, key: key)
                    let result = analysis
                    try model.change { state in if let index = state.assets.firstIndex(where: { $0.id == id }), state.assets[index].analysis == nil { state.assets[index].analysis = result } }
                }
                if let analysis { descriptions.append(analysis.description + " 标签：" + analysis.labels.joined(separator: "、")) }
            }
            guard !descriptions.isEmpty else { throw PhotoError.message("作品集没有可用照片") }
            var summaries: [String] = []
            for offset in stride(from: 0, to: descriptions.count, by: 20) {
                status = "汇总照片描述"
                summaries.append(try await model.intelligence.response(prompt: "将以下照片描述汇总为不超过300字的客观图集摘要，不遗漏主要场景，不推测经历。数据：\n" + descriptions[offset..<min(offset + 20, descriptions.count)].joined(separator: "\n"), images: [], config: config, key: key))
            }
            while summaries.count > 10 {
                var reduced: [String] = []
                for offset in stride(from: 0, to: summaries.count, by: 10) {
                    reduced.append(try await model.intelligence.response(prompt: "将这些图集摘要合并为300字，保留不同主题：\n" + summaries[offset..<min(offset + 10, summaries.count)].joined(separator: "\n"), images: [], config: config, key: key))
                }
                summaries = reduced
            }
            let text = try await model.intelligence.response(prompt: "根据以下图集摘要和用户说明，写中文标题及150至300字正文，不编造人物身份与经历。说明数据：\(portfolio.description)\n摘要数据：\(summaries.joined(separator: "\n"))", images: [], config: config, key: key)
            try model.change { $0.creations.append(Creation(collectionID: collectionID, kind: "text", title: "\(portfolio.name) · 文案", text: text, sourceIDs: portfolio.assetIDs)) }
            status = "已保存到作品集"
        } catch {
            model.error = error.localizedDescription
        }
    }
}
