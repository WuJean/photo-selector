import SwiftUI
import PhotoCore

struct PortfolioListView: View {
    @EnvironmentObject var model: AppModel
    @State private var name = ""
    @State private var create = false
    @State private var selected = Set<String>()
    @State private var showAll = false
    var candidates: [LocalAsset] { model.state.assets.filter { a in model.state.isFinalist(a.id) && (showAll || !model.state.portfolios.contains { $0.assetIDs.contains(a.id) }) } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack { Text("作品集").font(.title2); Spacer(); Button("新建", systemImage: "plus") { create = true } }
                ForEach(model.state.portfolios) { p in NavigationLink { PortfolioDetailView(collectionID: p.id) } label: { HStack { Image(systemName: "rectangle.stack"); Text(p.name); Spacer(); Text("\(p.assetIDs.count) 张"); Image(systemName: "chevron.right") }.padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12)) } }
                HStack { Text("精筛候选").font(.title2); Spacer(); Toggle("全部", isOn: $showAll).fixedSize() }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))]) {
                    ForEach(candidates) { asset in
                        AssetImage(asset: asset).overlay(alignment: .topTrailing) { if selected.contains(asset.id) { Image(systemName: "checkmark.circle.fill").font(.title).foregroundStyle(.orange) } }.onTapGesture { if !selected.insert(asset.id).inserted { selected.remove(asset.id) } }
                    }
                }
            }.padding()
        }.navigationTitle("作品集")
            .safeAreaInset(edge: .bottom) { if !selected.isEmpty { Menu("加入作品集 · \(selected.count) 张") { ForEach(model.state.portfolios) { p in Button(p.name) { model.perform { try model.change { try $0.addToPortfolio(Array(selected), portfolioID: p.id) }; selected.removeAll() } } } }.buttonStyle(.borderedProminent).padding().frame(maxWidth: .infinity).background(.ultraThinMaterial) } }
            .alert("新建作品集", isPresented: $create) { TextField("名称", text: $name); Button("创建") { model.perform { let p = Portfolio(name: name.isEmpty ? "新作品集" : name); try model.change { $0.portfolios.append(p) }; name = "" } }; Button("取消", role: .cancel) {} }
    }
}
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
    var portfolio: Portfolio? { model.state.portfolios.first { $0.id == collectionID } }
    var photos: [LocalAsset] { PhotoSearch.filter((portfolio?.assetIDs ?? []).compactMap { id in model.state.assets.first { $0.id == id } }, keyword: query, tags: Array(tags), any: any) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button { collage = true } label: { Label("智能拼图", systemImage: "square.grid.2x2").frame(maxWidth: .infinity, minHeight: 52) }
                    Button { writing = true } label: { Label("生成文案", systemImage: "text.quote").frame(maxWidth: .infinity, minHeight: 52) }
                }.buttonStyle(.borderedProminent)
                HStack { Button("标签筛选") { filters = true }; Spacer(); NavigationLink("查看照片墙") { GalleryView(collectionID: collectionID) } }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150))]) {
                    ForEach(photos) { asset in
                        VStack(alignment: .leading) { AssetImage(asset: asset).overlay(alignment: .topTrailing) { if selected.contains(asset.id) { Image(systemName: "checkmark.circle.fill").foregroundStyle(.orange).font(.title) } }; if let a = asset.analysis { Text(a.labels.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary) } }
                            .onTapGesture { if !selected.insert(asset.id).inserted { selected.remove(asset.id) } }
                    }
                }
                if !selected.isEmpty {
                    HStack {
                        Button("下载 \(selected.count) 张") { Task { await exportSelected() } }
                        Button("移出作品集", role: .destructive) { model.perform { try model.change { s in if let i = s.portfolios.firstIndex(where: { $0.id == collectionID }) { s.portfolios[i].assetIDs.removeAll { selected.contains($0) }; if let cover = s.portfolios[i].coverID, selected.contains(cover) { s.portfolios[i].coverID = s.portfolios[i].assetIDs.first } } }; selected.removeAll() } }
                    }.buttonStyle(.bordered)
                }
                Text("创作").font(.title2)
                ForEach(model.state.creations.filter { $0.collectionID == collectionID }) { creation in
                    VStack(alignment: .leading) {
                        Label(creation.title, systemImage: creation.kind == "text" ? "text.quote" : "square.grid.2x2")
                        if let path = creation.path, let url = try? model.media.url(path), let image = UIImage(contentsOfFile: url.path) { Image(uiImage: image).resizable().scaledToFit(); ShareLink(item: url) { Label("分享", systemImage: "square.and.arrow.up") } }
                        if creation.kind == "text" { Text(creation.text); HStack { Button("编辑") { textEdit = creation }; ShareLink(item: creation.text) } }
                    }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding()
        }.navigationTitle(portfolio?.name ?? "作品集").searchable(text: $query, prompt: "名称、描述、标签")
            .onChange(of: query) { _, _ in selected.removeAll() }
            .toolbar { Button("编辑") { edit = true } }
            .sheet(isPresented: $edit) { if let portfolio { NavigationStack { PortfolioEditor(portfolio: portfolio) } } }
            .sheet(isPresented: $collage) { NavigationStack { CollageEditor(collectionID: collectionID) } }
            .sheet(isPresented: $writing) { NavigationStack { WritingView(collectionID: collectionID) } }
            .sheet(isPresented: $filters) { NavigationStack { TagFilterView(selected: $tags, any: $any) } }
            .sheet(item: $textEdit) { creation in NavigationStack { TextCreationEditor(creation: creation) } }
            .sheet(isPresented: Binding(get: { !sharing.isEmpty }, set: { if !$0 { sharing = [] } })) { ShareSheet(items: sharing) }
    }
    func exportSelected() async {
        do { var urls: [URL] = []; for asset in photos where selected.contains(asset.id) { model.progress = "导出 \(urls.count + 1)/\(selected.count)"; urls.append(try await model.media.exportOriginal(asset, allowNetwork: model.allowCloudDownload)) }; sharing = urls }
        catch { model.error = error.localizedDescription }; model.progress = ""
    }
}
struct PortfolioEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State var portfolio: Portfolio
    @State private var discard = false
    var body: some View {
        Form {
            TextField("名称", text: $portfolio.name)
            TextField("地点", text: $portfolio.location)
            DatePicker("时间", selection: $portfolio.date, displayedComponents: .date)
            TextField("一句诗", text: $portfolio.poem, axis: .vertical)
            TextField("描述", text: $portfolio.description, axis: .vertical)
            Picker("封面", selection: Binding(get: { portfolio.coverID ?? "" }, set: { portfolio.coverID = $0.isEmpty ? nil : $0 })) {
                Text("第一张").tag(""); ForEach(portfolio.assetIDs, id: \.self) { id in Text(model.state.assets.first { $0.id == id }?.name ?? id).tag(id) }
            }
            Section("照片顺序") { ForEach(portfolio.assetIDs, id: \.self) { id in Text(model.state.assets.first { $0.id == id }?.name ?? id) }.onMove { from, to in portfolio.assetIDs.move(fromOffsets: from, toOffset: to) } }
        }.navigationTitle("编辑作品集").environment(\.editMode, .constant(.active)).interactiveDismissDisabled()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { discard = true } }; ToolbarItem(placement: .confirmationAction) { Button("保存") { model.perform { try model.change { s in if let i = s.portfolios.firstIndex(where: { $0.id == portfolio.id }) { s.portfolios[i] = portfolio } }; dismiss() } } } }
            .confirmationDialog("放弃未保存的修改？", isPresented: $discard) { Button("放弃修改", role: .destructive) { dismiss() } }
    }
}
struct TextCreationEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @State var creation: Creation
    var body: some View { Form { TextField("标题", text: $creation.title); TextEditor(text: $creation.text).frame(minHeight: 250) }.navigationTitle("编辑文案").toolbar { Button("保存") { model.perform { try model.change { s in if let i = s.creations.firstIndex(where: { $0.id == creation.id }) { s.creations[i] = creation } }; dismiss() } } } }
}
struct WritingView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let collectionID: String
    @State private var running = false
    @State private var status = ""
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "text.quote").font(.system(size: 50)).foregroundStyle(.orange)
            Text("从整个作品集生成文案").font(.title2)
            Text("复用照片描述；缺少描述时先补充分析。").foregroundStyle(.secondary)
            if running { ProgressView(status) }
            Button("生成并保存新版本") { Task { await generate() } }.buttonStyle(.borderedProminent).disabled(running)
            Spacer()
        }.padding().navigationTitle("文案").toolbar { Button("关闭") { dismiss() } }
    }
    func generate() async {
        guard let portfolio = model.state.portfolios.first(where: { $0.id == collectionID }) else { return }
        running = true; defer { running = false }
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
                    try model.change { s in if let index = s.assets.firstIndex(where: { $0.id == id }), s.assets[index].analysis == nil { s.assets[index].analysis = result } }
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
                for offset in stride(from: 0, to: summaries.count, by: 10) { reduced.append(try await model.intelligence.response(prompt: "将这些图集摘要合并为300字，保留不同主题：\n" + summaries[offset..<min(offset + 10, summaries.count)].joined(separator: "\n"), images: [], config: config, key: key)) }; summaries = reduced
            }
            let text = try await model.intelligence.response(prompt: "根据以下图集摘要和用户说明，写中文标题及150至300字正文，不编造人物身份与经历。说明数据：\(portfolio.description)\n摘要数据：\(summaries.joined(separator: "\n"))", images: [], config: config, key: key)
            try model.change { $0.creations.append(Creation(collectionID: collectionID, kind: "text", title: "\(portfolio.name) · 文案", text: text, sourceIDs: portfolio.assetIDs)) }
            status = "已保存到作品集"
        } catch { model.error = error.localizedDescription }
    }
}
