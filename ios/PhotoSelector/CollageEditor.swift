import SwiftUI
import PhotoCore

actor CollageRenderer {
    func render(draft: CollageDraft, assets: [LocalAsset], media: MediaStore, longEdge: Double, originals: Bool) async throws -> UIImage {
        let width = draft.ratio >= 1 ? longEdge : longEdge * draft.ratio, height = draft.ratio >= 1 ? longEdge / draft.ratio : longEdge
        let frames = CollageLayout.frames(layout: draft.layout, width: width, height: height, gap: draft.gap * longEdge / 3000, frame: draft.frame * longEdge / 3000)
        var images: [UIImage?] = []
        for cell in draft.cells {
            if let asset = assets.first(where: { $0.id == cell.assetID }) { images.append(try await media.image(asset, maxSize: Int(longEdge * 1.5), original: originals)) }
            else { images.append(nil) }
        }
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor(hex: draft.background).setFill(); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            for i in frames.indices where images.indices.contains(i) && draft.cells.indices.contains(i) {
                guard let image = images[i] else { continue }
                let f = frames[i], cell = draft.cells[i], rect = CGRect(x: f.x, y: f.y, width: f.width, height: f.height)
                let base = cell.fit ? min(rect.width / image.size.width, rect.height / image.size.height) : max(rect.width / image.size.width, rect.height / image.size.height)
                let size = CGSize(width: image.size.width * base * cell.scale, height: image.size.height * base * cell.scale)
                let draw = CGRect(x: rect.midX - size.width / 2 + cell.offsetX * rect.width, y: rect.midY - size.height / 2 + cell.offsetY * rect.height, width: size.width, height: size.height)
                context.cgContext.saveGState(); context.cgContext.clip(to: rect); image.draw(in: draw); context.cgContext.restoreGState()
            }
            if !draft.watermark.isEmpty {
                let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: longEdge / 65), .foregroundColor: UIColor.white, .backgroundColor: UIColor.black.withAlphaComponent(0.35)]
                let text = draft.watermark as NSString, size = text.size(withAttributes: attributes)
                text.draw(at: CGPoint(x: width - size.width - 24 * longEdge / 3000, y: height - size.height - 24 * longEdge / 3000), withAttributes: attributes)
            }
        }
    }
}
extension UIColor {
    convenience init(hex: String) { let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x141414; self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, alpha: 1) }
}
struct CollageEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let collectionID: String
    @State private var draft: CollageDraft
    @State private var requirements = [CollageSlot(), CollageSlot(), CollageSlot()]
    @State private var preview: UIImage?
    @State private var activeCell = 0
    @State private var showTags = false
    @State private var templateName = ""
    @State private var saving = false
    @State private var status = ""
    @State private var limit = 40
    private let renderer = CollageRenderer()
    init(collectionID: String) { self.collectionID = collectionID; _draft = State(initialValue: CollageDraft(collectionID: collectionID)) }
    var source: [LocalAsset] { let ids = Set(model.state.portfolios.first { $0.id == collectionID }?.assetIDs ?? []); return model.state.assets.filter { ids.contains($0.id) } }
    var candidates: [LocalAsset] { PhotoSearch.filter(source, keyword: draft.keyword, tags: draft.tagNames, any: draft.matchAny) }
    var fingerprint: String { (try? JSONEncoder().encode(draft).base64EncodedString()) ?? "" }
    var body: some View {
        DuoLayout {
            canvas
        } secondary: {
            ScrollView { controls }
        }.navigationTitle("拼图")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { persist(); dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("保存") { Task { await save() } }.disabled(saving || draft.cells.contains { $0.assetID == nil }) } }
            .onAppear {
                if let existing = model.state.drafts.first(where: { $0.collectionID == collectionID }) { draft = existing }
                requirements = draft.requirements ?? Array(repeating: CollageSlot(), count: draft.cells.count)
                draft.requirements = requirements
            }
            .onChange(of: requirements) { _, value in
                draft.requirements = value
                persist()
            }
            .task(id: fingerprint) { do { try await Task.sleep(for: .milliseconds(180)); let image = try await renderer.render(draft: draft, assets: source, media: model.media, longEdge: 900, originals: false); try Task.checkCancellation(); preview = image; persist() } catch is CancellationError {} catch { status = error.localizedDescription } }
            .sheet(isPresented: $showTags) { NavigationStack { TagFilterView(selected: Binding(get: { Set(draft.tagNames) }, set: { draft.tagNames = Array($0) }), any: $draft.matchAny) } }
    }
    var canvas: some View {
        VStack {
            if let preview { Image(uiImage: preview).resizable().scaledToFit().padding(8) }
            else { Rectangle().fill(.quaternary).aspectRatio(draft.ratio, contentMode: .fit).overlay(Text("选择照片开始拼图")) }
            Text(status).font(.caption).foregroundStyle(.secondary)
            HStack { ForEach(draft.cells.indices, id: \.self) { i in Button("第 \(i + 1) 格") { activeCell = i }.buttonStyle(.bordered).tint(activeCell == i ? .orange : .gray) } }
        }
    }
    var controls: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("布局", selection: $draft.layout) { Text("横图三拼").tag("rows"); Text("竖图三拼").tag("columns"); Text("一大两小").tag("hero"); Text("四宫格").tag("grid") }.onChange(of: draft.layout) { _, value in
                let count = value == "grid" ? 4 : 3; draft.cells = Array((draft.cells + Array(repeating: CollageCell(), count: count)).prefix(count)); requirements = Array((requirements + Array(repeating: CollageSlot(), count: count)).prefix(count)); activeCell = min(activeCell, count - 1)
            }
            Picker("比例", selection: $draft.ratio) { Text("3:4").tag(0.75); Text("1:1").tag(1.0); Text("4:3").tag(4.0/3); Text("9:16").tag(9.0/16) }
            Menu("使用快捷模板") { ForEach(model.state.templates) { template in Button(template.name) { draft.layout = template.layout; draft.cells = Array(repeating: CollageCell(), count: template.slots.count); requirements = template.slots; activeCell = 0 } } }
            if requirements.indices.contains(activeCell), draft.cells.indices.contains(activeCell) {
                Picker("本格主体", selection: $requirements[activeCell].subject) { Text("不限").tag(""); ForEach(model.state.tags.filter { $0.domain == .subject }) { Text($0.name).tag($0.name) } }
                Picker("本格景别", selection: $requirements[activeCell].distance) { Text("不限").tag(""); ForEach(model.state.tags.filter { $0.domain == .distance }) { Text($0.name).tag($0.name) } }
                Toggle("锁定本格", isOn: $draft.cells[activeCell].locked)
                Toggle("适应画面", isOn: $draft.cells[activeCell].fit)
                Text("缩放"); Slider(value: $draft.cells[activeCell].scale, in: 1...4)
                Text("水平位置"); Slider(value: $draft.cells[activeCell].offsetX, in: -1...1)
                Text("垂直位置"); Slider(value: $draft.cells[activeCell].offsetY, in: -1...1)
            }
            HStack { TextField("自定义模板名称", text: $templateName); Button("保存模板") { model.perform { let template = QuickTemplate(name: templateName, layout: draft.layout, slots: requirements); try model.change { $0.templates.append(template) }; templateName = "" } }.disabled(templateName.isEmpty) }
            HStack {
                Button("随机组合", systemImage: "shuffle") { model.perform { draft.cells = try PhotoSearch.randomCombination(candidates: candidates, requirements: requirements, cells: draft.cells) } }
                Button("AI 搭配", systemImage: "sparkles") { Task { await recommend() } }.disabled(saving)
            }.buttonStyle(.borderedProminent)
            DisclosureGroup("间距、相框与水印") {
                Slider(value: $draft.gap, in: 0...100) { Text("间距") }; Slider(value: $draft.frame, in: 0...200) { Text("相框") }
                TextField("背景色 #141414", text: $draft.background); TextField("文字水印", text: $draft.watermark)
            }
            TextField("搜索名称、描述或标签", text: $draft.keyword).textFieldStyle(.roundedBorder)
            HStack { Button("标签筛选") { showTags = true }; Text("\(candidates.count) 张").foregroundStyle(.secondary); Button("清除") { draft.keyword = ""; draft.tagNames = [] } }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))]) {
                ForEach(Array(candidates.prefix(limit))) { asset in AssetImage(asset: asset).onTapGesture { if !draft.cells[activeCell].locked { draft.cells[activeCell] = CollageCell(asset.id) } }.onAppear { if asset.id == candidates.prefix(limit).last?.id { limit += 40 } } }
            }
        }.padding()
    }
    func persist() {
        draft.requirements = requirements
        model.perform { try model.change { s in s.drafts.removeAll { $0.collectionID == collectionID }; s.drafts.append(draft) } }
    }
    func save() async {
        saving = true; defer { saving = false }
        do {
            let image = try await renderer.render(draft: draft, assets: source, media: model.media, longEdge: 3000, originals: true)
            let path = "creations/\(UUID().uuidString).jpg"
            guard let data = image.jpegData(compressionQuality: 0.9) else { throw PhotoError.message("拼图导出失败") }
            try data.write(to: model.media.url(path), options: .atomic)
            try model.change { $0.creations.append(Creation(collectionID: collectionID, kind: "collage", title: "拼图", path: path, sourceIDs: draft.cells.compactMap(\.assetID))) }
            status = "已保存到作品集创作"
        } catch { model.error = error.localizedDescription }
    }
    func recommend() async {
        saving = true; defer { saving = false }
        do {
            // Validate scope, locked cells and feasibility before any image is sent.
            _ = try PhotoSearch.randomCombination(candidates: candidates, requirements: requirements, cells: draft.cells)
            var shortlist: [LocalAsset] = []
            for requirement in requirements { for asset in candidates.filter({ PhotoSearch.matches($0, requirement) }).shuffled().prefix(4) where !shortlist.contains(where: { $0.id == asset.id }) { shortlist.append(asset) } }
            for cell in draft.cells where cell.locked { if let a = candidates.first(where: { $0.id == cell.assetID }), !shortlist.contains(where: { $0.id == a.id }) { shortlist.append(a) } }
            var images: [UIImage] = []
            for asset in shortlist { images.append(try await model.media.image(asset, maxSize: 1080)) }
            let mapping = shortlist.enumerated().map { "图片\($0.offset + 1)：\($0.element.id)，\($0.element.analysis?.labels.joined(separator: "、") ?? "未分析")" }.joined(separator: "\n")
            let constraints = String(data: try JSONEncoder().encode(requirements), encoding: .utf8)!
            let locks = String(data: try JSONEncoder().encode(draft.cells), encoding: .utf8)!
            let result = try await model.intelligence.response(prompt: "实际观察这些候选图片的色彩、构图和人物朝向，选择协调且不重复的搭配。返回JSON {\"ids\":[按格子顺序的真实ID],\"reason\":\"中文理由\"}。只允许以下候选ID，必须符合每格主体景别和锁定。候选：\(mapping)\n每格要求数据：\(constraints)\n当前格子和锁定数据：\(locks)", images: images, config: model.aiConfig, key: Keychain.load())
            struct Recommendation: Decodable { var ids: [String]; var reason: String }
            let recommendation = try JSONDecoder().decode(Recommendation.self, from: Intelligence.json(result))
            guard recommendation.ids.count == draft.cells.count, Set(recommendation.ids).count == recommendation.ids.count else { throw PhotoError.message("AI 搭配数量无效") }
            for i in recommendation.ids.indices {
                guard let asset = shortlist.first(where: { $0.id == recommendation.ids[i] }), PhotoSearch.matches(asset, requirements[i]), !draft.cells[i].locked || draft.cells[i].assetID == asset.id else { throw PhotoError.message("AI 搭配超出来源或不符合模板") }
            }
            for i in recommendation.ids.indices where !draft.cells[i].locked { draft.cells[i] = CollageCell(recommendation.ids[i]) }; status = recommendation.reason
        } catch { model.error = error.localizedDescription }
    }
}
