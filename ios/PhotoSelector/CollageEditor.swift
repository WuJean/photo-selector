import SwiftUI
import PhotoCore

actor CollageRenderer {
    func render(draft: CollageDraft, assets: [LocalAsset], media: MediaStore, longEdge: Double, originals: Bool, allowNetwork: Bool = false) async throws -> UIImage {
        let width = draft.ratio >= 1 ? longEdge : longEdge * draft.ratio
        let height = draft.ratio >= 1 ? longEdge / draft.ratio : longEdge
        let frames = CollageInteractionGeometry.frames(draft: draft, size: CGSize(width: width, height: height))
        var images: [UIImage?] = []
        for cell in draft.cells {
            if let asset = assets.first(where: { $0.id == cell.assetID }) {
                images.append(try await media.image(asset, maxSize: Int(longEdge * 1.5), original: originals, allowNetwork: allowNetwork))
            } else { images.append(nil) }
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
    convenience init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x141414
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, alpha: 1)
    }
}

struct CollageEditor: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let collectionID: String

    @State private var draft: CollageDraft
    @State private var requirements = [CollageSlot(), CollageSlot(), CollageSlot()]
    @State private var preview: UIImage?
    @State private var activeCell = 0
    @State private var showTags = false
    @State private var showReplace = false
    @State private var showSettings = false
    @State private var showTemplateNamePrompt = false
    @State private var showShare = false
    @State private var shareImage: UIImage?
    @State private var sharing = false
    @State private var scopeAllFinalists = false
    @State private var templateName = ""
    @State private var saving = false
    @State private var status = ""
    @State private var undoStack: [CollageSnapshot] = []
    @State private var applyingUndo = false

    private let renderer = CollageRenderer()
    init(collectionID: String) {
        self.collectionID = collectionID
        _draft = State(initialValue: CollageDraft(collectionID: collectionID))
        _scopeAllFinalists = State(initialValue: UserDefaults.standard.bool(forKey: Self.scopeKey(collectionID)))
    }

    private static func scopeKey(_ id: String) -> String { "collage-all-finalists-\(id)" }
    private var portfolio: Portfolio? { model.state.portfolios.first { $0.id == collectionID } }
    private var portfolioAssets: [LocalAsset] {
        let ids = Set(portfolio?.assetIDs ?? [])
        return model.state.assets.filter { ids.contains($0.id) }
    }
    private var allFinalistAssets: [LocalAsset] {
        let ids = Set(model.state.batches.flatMap { $0.photos.filter(\.finalist).map(\.assetID) })
        return model.state.assets.filter { ids.contains($0.id) }
    }
    private var source: [LocalAsset] { scopeAllFinalists ? allFinalistAssets : portfolioAssets }
    /// The source is always resolved before keyword and tag filters are applied.
    private var tagSearchUniverse: [LocalAsset] { PhotoSearch.filter(source, keyword: draft.keyword, tags: []) }
    private var candidates: [LocalAsset] { PhotoSearch.filter(source, keyword: draft.keyword, tags: draft.tagNames, any: draft.matchAny) }
    private var replacementCandidates: [LocalAsset] {
        let slot = requirements.indices.contains(activeCell) ? requirements[activeCell] : CollageSlot()
        return candidates.filter { PhotoSearch.matches($0, slot) }
    }
    private var renderAssets: [LocalAsset] { model.state.assets }
    private var fingerprint: String { draftFingerprint(draft) }

    private func draftFingerprint(_ value: CollageDraft) -> String {
        (try? JSONEncoder().encode(value).base64EncodedString()) ?? ""
    }

    private func recommendationVersion(draft value: CollageDraft, scope: Bool, candidates assets: [LocalAsset], requirements slots: [CollageSlot], configuration: AIConfiguration) -> CollageRecommendationVersion {
        let assetFingerprint = assets.map { asset in
            [
                asset.id,
                asset.digest ?? "",
                asset.name,
                asset.analysis?.subject ?? "",
                asset.analysis?.distance ?? "",
                asset.analysis?.labels.joined(separator: "\u{1F}") ?? "",
                asset.analysis?.description ?? ""
            ].joined(separator: "\u{1F}")
        }.joined(separator: "\u{1E}")
        return CollageRecommendationVersion(
            draftFingerprint: draftFingerprint(value),
            allFinalists: scope,
            candidateFingerprint: assetFingerprint,
            requirements: slots,
            configuration: configuration
        )
    }

    private func recommendationSnapshotIsCurrent(_ request: CollageRecommendationSnapshot) -> Bool {
        let currentVersion = recommendationVersion(
            draft: draft,
            scope: scopeAllFinalists,
            candidates: candidates,
            requirements: requirements,
            configuration: model.aiConfig
        )
        return CollageRecommendationFreshness.canApply(started: request.version, current: currentVersion)
            && Keychain.load() == request.key
    }

    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            Group {
                if landscape { landscapeLayout(size: geometry.size) }
                else { portraitLayout(size: geometry.size) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .photoBackdrop()
        }
        .navigationTitle("拼图")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("拼图").font(.headline) } }
        .onAppear {
            if let existing = model.state.drafts.first(where: { $0.collectionID == collectionID }) { draft = existing }
            requirements = draft.requirements ?? Array(repeating: CollageSlot(), count: draft.cells.count)
            requirements = Array((requirements + Array(repeating: CollageSlot(), count: draft.cells.count)).prefix(draft.cells.count))
            draft.requirements = requirements
            activeCell = min(activeCell, max(0, draft.cells.count - 1))
        }
        .onChange(of: requirements) { _, value in
            draft.requirements = value
            persist()
        }
        .task(id: fingerprint) {
            do {
                try await Task.sleep(for: .milliseconds(180))
                try Task.checkCancellation()
                // Save the editable source before rendering so an offline or
                // temporarily inaccessible photo cannot discard the draft.
                persist()
                let renderDraft = draft
                let image = try await renderer.render(draft: renderDraft, assets: renderAssets, media: model.media, longEdge: 900, originals: false, allowNetwork: model.allowCloudDownload)
                try Task.checkCancellation(); preview = image; persist()
            } catch is CancellationError { }
            catch { status = error.localizedDescription }
        }
        .onDisappear { persist() }
        .sheet(isPresented: $showReplace) { replacementPicker }
        .sheet(isPresented: $showSettings) { settingsSheet }
        .sheet(isPresented: $showShare) {
            if let shareImage { ShareSheet(items: [shareImage]).presentationDetents([.medium]) }
        }
        .alert("保存快捷模板", isPresented: $showTemplateNamePrompt) {
            TextField("模板名称", text: $templateName)
            Button("取消", role: .cancel) { templateName = "" }
            Button("保存") { saveTemplate() }
                .disabled(templateName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("为当前布局和每格要求起一个名称。")
        }
    }

    @ViewBuilder private func landscapeLayout(size: CGSize) -> some View {
        HStack(spacing: 12) {
            canvas
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            ScrollView { editorControls }.frame(width: min(max(size.width * 0.30, 300), 390)).frame(maxHeight: .infinity)
            actionRail
        }
        .padding(12)
    }

    @ViewBuilder private func portraitLayout(size: CGSize) -> some View {
        VStack(spacing: 10) {
            canvas
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(8)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                .overlay(alignment: .trailing) { actionRail.padding(.trailing, 7) }
            portraitDock
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 8)
    }

    private var canvas: some View {
        VStack(spacing: 9) {
            if !draft.cells.isEmpty {
                CollageInteractiveCanvas(
                    draft: $draft,
                    activeCell: $activeCell,
                    assets: renderAssets,
                    onEditStarted: rememberUndo,
                    onEmptyCell: { index in activeCell = index; showReplace = true }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 7) {
                ForEach(draft.cells.indices, id: \.self) { index in
                    Button { activeCell = index } label: {
                        HStack(spacing: 5) {
                            Circle().fill(draft.cells[index].assetID == nil ? Color.secondary.opacity(0.5) : PhotoPalette.accent).frame(width: 6, height: 6)
                            Text("\(index + 1)").font(.caption.weight(.semibold))
                            if draft.cells[index].locked { Image(systemName: "lock.fill").font(.system(size: 9)) }
                        }
                        .padding(.horizontal, 11).padding(.vertical, 8)
                        .background(activeCell == index ? PhotoPalette.accent.opacity(0.18) : Color.primary.opacity(0.06), in: Capsule())
                    }.buttonStyle(.plain).accessibilityLabel("选择第 \(index + 1) 格")
                }
                Spacer(minLength: 0)
                Text(status).font(.caption).lineLimit(1).foregroundStyle(.secondary)
            }
        }
    }

    private var actionRail: some View {
        VStack(spacing: 10) {
            railButton("关闭", symbol: "xmark", disabled: false) { persist(); dismiss() }
            railButton("撤销", symbol: "arrow.uturn.backward", disabled: undoStack.isEmpty) { undo() }
            railButton(sharing ? "准备分享" : "分享", symbol: "square.and.arrow.up", disabled: preview == nil || sharing) { Task { await prepareShare() } }
            railButton(saving ? "保存中" : "保存", symbol: "square.and.arrow.down", disabled: saving || draft.cells.contains { $0.assetID == nil }) { Task { await save() } }
        }
        .padding(9)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.22), lineWidth: 0.7))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 5)
    }

    private func railButton(_ title: String, symbol: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).frame(width: 42, height: 42)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(disabled ? Color.secondary : Color.primary)
        .disabled(disabled)
        .accessibilityLabel(title)
    }

    private var portraitDock: some View {
        HStack(spacing: 4) {
            Menu {
                ForEach(model.state.templates) { template in
                    Button(template.name) { apply(template) }
                }
                Divider()
                Button("保存当前模板") { requestTemplateName() }
            } label: { dockItem("模板", symbol: "square.grid.2x2") }
            dockButton("随机", symbol: "shuffle", action: randomize)
            dockButton("AI 搭配", symbol: "sparkles", action: { Task { await recommend() } })
            dockButton("替换", symbol: "arrow.triangle.2.circlepath", action: { showReplace = true })
            dockButton("更多", symbol: "slider.horizontal.3", action: { showSettings = true })
        }
        .padding(6)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func dockButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { dockItem(title, symbol: symbol) }
            .buttonStyle(.plain)
            .disabled((title == "AI 搭配" && saving) || (title == "替换" && draft.cells.isEmpty))
    }

    private func dockItem(_ title: String, symbol: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: symbol).font(.system(size: 16, weight: .medium))
            Text(title).font(.system(size: 10, weight: .medium)).lineLimit(1)
        }
        .foregroundStyle(title == "AI 搭配" ? PhotoPalette.accent : Color.primary)
        .frame(maxWidth: .infinity, minHeight: 48)
        .contentShape(Rectangle())
    }

    private var editorControls: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("拼图设置").font(.title3.weight(.semibold))
                Spacer()
                Text("\(candidates.count) 张可选").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Button(action: randomize) { Label("随机组合", systemImage: "shuffle").frame(maxWidth: .infinity, minHeight: 44) }
                    .buttonStyle(.borderedProminent).tint(PhotoPalette.accent).foregroundStyle(PhotoPalette.onAccent)
                Button { Task { await recommend() } } label: { Label("AI 搭配", systemImage: "sparkles").frame(maxWidth: .infinity, minHeight: 44) }
                    .buttonStyle(.bordered).disabled(saving)
            }
            templateMenu
            Picker("布局", selection: Binding(get: { draft.layout }, set: setLayout)) {
                Text("三张横图").tag("rows"); Text("三张竖图").tag("columns"); Text("一大两小").tag("hero"); Text("四宫格").tag("grid")
            }.pickerStyle(.menu)
            Picker("画幅", selection: Binding(get: { draft.ratio }, set: setRatio)) {
                Text("3:4").tag(0.75); Text("1:1").tag(1.0); Text("4:3").tag(4.0 / 3); Text("9:16").tag(9.0 / 16)
            }.pickerStyle(.segmented)
            activeCellControls
            DisclosureGroup("细节设置") {
                VStack(alignment: .leading, spacing: 12) {
                    Slider(value: $draft.gap, in: 0...100, onEditingChanged: { if $0 { rememberUndo() } }) { Text("间距") }
                    Slider(value: $draft.frame, in: 0...200, onEditingChanged: { if $0 { rememberUndo() } }) { Text("留白") }
                    TextField("背景色 #141414", text: $draft.background).textFieldStyle(.roundedBorder)
                    TextField("文字水印", text: $draft.watermark).textFieldStyle(.roundedBorder)
                }.padding(.top, 8)
            }
            templateSaveRow
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .photoGlass(cornerRadius: 26)
        .padding(.vertical, 4)
    }

    private var templateMenu: some View {
        Menu {
            ForEach(model.state.templates) { template in Button(template.name) { apply(template) } }
            Divider()
            Button("保存当前模板") { requestTemplateName() }
        } label: {
            Label("选择模板", systemImage: "square.grid.2x2")
                .frame(maxWidth: .infinity, minHeight: 43)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain)
    }

    @ViewBuilder private var activeCellControls: some View {
        if requirements.indices.contains(activeCell), draft.cells.indices.contains(activeCell) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("第 \(activeCell + 1) 格").font(.headline)
                    Spacer()
                    Button("替换照片") { showReplace = true }.buttonStyle(.bordered).controlSize(.small)
                }
                Picker("主体", selection: Binding(get: { requirements[activeCell].subject }, set: { updateRequirement(subject: $0) })) {
                    Text("不限主体").tag("")
                    ForEach(model.state.tags.filter { $0.domain == .subject }) { Text($0.name).tag($0.name) }
                }.pickerStyle(.menu)
                Picker("景别", selection: Binding(get: { requirements[activeCell].distance }, set: { updateRequirement(distance: $0) })) {
                    Text("不限景别").tag("")
                    ForEach(model.state.tags.filter { $0.domain == .distance }) { Text($0.name).tag($0.name) }
                }.pickerStyle(.menu)
                Toggle("锁定照片", isOn: Binding(get: { draft.cells[activeCell].locked }, set: { value in rememberUndo(); draft.cells[activeCell].locked = value }))
                Toggle("完整显示", isOn: Binding(get: { draft.cells[activeCell].fit }, set: { value in rememberUndo(); draft.cells[activeCell].fit = value }))
                Slider(value: Binding(get: { draft.cells[activeCell].scale }, set: { draft.cells[activeCell].scale = CollageCropMath.scale(starting: 1, magnification: $0) }), in: 1...4, onEditingChanged: { if $0 { rememberUndo() } }) {
                    Text("缩放 \(draft.cells[activeCell].scale, specifier: "%.1f")×")
                }
                Text("也可以直接拖动画格调整构图，双指缩放。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(14)
            .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 18))
        }
    }

    private var templateSaveRow: some View {
        HStack(spacing: 8) {
            TextField("模板名称", text: $templateName).textFieldStyle(.roundedBorder)
            Button("保存") { saveTemplate() }.buttonStyle(.bordered).disabled(templateName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var replacementPicker: some View {
        NavigationStack {
            VStack(spacing: 10) {
                Picker("来源", selection: Binding(get: { scopeAllFinalists }, set: setSourceScope)) {
                    Text("本作品集").tag(false); Text("全部精筛").tag(true)
                }.pickerStyle(.segmented).padding(.horizontal)
                TextField("搜索名称、描述或标签", text: $draft.keyword)
                    .textFieldStyle(.roundedBorder).padding(.horizontal)
                HStack(spacing: 10) {
                    Button { showTags = true } label: {
                        Label(draft.tagNames.isEmpty ? "标签筛选" : "标签 · \(draft.tagNames.count)", systemImage: "line.3.horizontal.decrease.circle")
                    }.buttonStyle(.bordered)
                    Button("清除") { draft.keyword = ""; draft.tagNames = []; draft.matchAny = false }.buttonStyle(.plain).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(replacementCandidates.count) 张").font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal)
                if replacementCandidates.isEmpty {
                    ContentUnavailableView("没有符合条件的照片", systemImage: "photo.badge.magnifyingglass", description: Text("检查当前来源、标签或本格主体和景别要求。"))
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(replacementCandidates) { asset in
                                Button { replaceActiveCell(with: asset) } label: {
                                    HStack(spacing: 12) {
                                        AssetImage(asset: asset, size: 180, fill: true, aspect: 1)
                                            .frame(width: 68, height: 68).clipShape(RoundedRectangle(cornerRadius: 11))
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(asset.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                            Text(asset.analysis?.labels.joined(separator: " · ") ?? "尚无 AI 标签")
                                                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                        }
                                        Spacer()
                                        if draft.cells.indices.contains(activeCell), draft.cells[activeCell].assetID == asset.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(PhotoPalette.accent) }
                                    }
                                    .padding(8).background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 15))
                                }.buttonStyle(.plain).accessibilityIdentifier("collage-candidate-\(asset.id)")
                            }
                        }.padding(.horizontal).padding(.bottom, 18)
                    }
                }
            }
            .padding(.top, 12)
            .navigationTitle("替换第 \(activeCell + 1) 格")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showReplace = false } } }
        }
        .accessibilityIdentifier("collage-replacement-picker")
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .sheet(isPresented: $showTags) { tagPicker }
    }

    private var settingsSheet: some View {
        NavigationStack {
            ScrollView { editorControls.padding(.horizontal, 10) }
                .navigationTitle("拼图设置")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showSettings = false } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var tagPicker: some View {
        NavigationStack {
            CollageTagFilterView(assets: tagSearchUniverse, library: model.state.tags, selected: Binding(get: { Set(draft.tagNames) }, set: { draft.tagNames = Array($0) }), any: $draft.matchAny)
                .navigationTitle("标签筛选")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showTags = false } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func rememberUndo() {
        guard !applyingUndo else { return }
        undoStack.append(CollageSnapshot(draft: draft, requirements: requirements))
        if undoStack.count > 40 { undoStack.removeFirst(undoStack.count - 40) }
    }

    private func undo() {
        guard let snapshot = undoStack.popLast() else { return }
        applyingUndo = true
        draft = snapshot.draft
        requirements = snapshot.requirements
        activeCell = min(activeCell, max(0, draft.cells.count - 1))
        DispatchQueue.main.async { applyingUndo = false }
    }

    private func persist() {
        draft.requirements = requirements
        model.perform { try model.change { state in
            state.drafts.removeAll { $0.collectionID == collectionID }
            state.drafts.append(draft)
        } }
    }

    private func setLayout(_ value: String) {
        guard value != draft.layout else { return }
        rememberUndo()
        draft.layout = value
        let count = value == "grid" ? 4 : 3
        draft.cells = Array((draft.cells + Array(repeating: CollageCell(), count: count)).prefix(count))
        requirements = Array((requirements + Array(repeating: CollageSlot(), count: count)).prefix(count))
        activeCell = min(activeCell, count - 1)
    }

    private func setRatio(_ value: Double) { guard value != draft.ratio else { return }; rememberUndo(); draft.ratio = value }
    private func setSourceScope(_ value: Bool) {
        scopeAllFinalists = value
        UserDefaults.standard.set(value, forKey: Self.scopeKey(collectionID))
    }

    private func updateRequirement(subject: String? = nil, distance: String? = nil) {
        guard requirements.indices.contains(activeCell) else { return }
        rememberUndo()
        if let subject { requirements[activeCell].subject = subject }
        if let distance { requirements[activeCell].distance = distance }
    }

    private func apply(_ template: QuickTemplate) {
        rememberUndo()
        draft.layout = template.layout
        let count = template.layout == "grid" ? 4 : 3
        draft.cells = Array(repeating: CollageCell(), count: count)
        requirements = Array((template.slots + Array(repeating: CollageSlot(), count: count)).prefix(count))
        activeCell = 0
    }

    private func randomize() {
        do {
            let next = try PhotoSearch.randomCombination(candidates: candidates, requirements: requirements, cells: draft.cells)
            rememberUndo(); draft.cells = next
            status = "已按当前范围随机组合"
        } catch { status = error.localizedDescription }
    }

    private func replaceActiveCell(with asset: LocalAsset) {
        guard draft.cells.indices.contains(activeCell), !draft.cells[activeCell].locked else {
            status = "本格已锁定，请先解锁"; return
        }
        guard candidates.contains(where: { $0.id == asset.id }), PhotoSearch.matches(asset, requirements[activeCell]) else {
            status = "照片不符合当前来源或本格要求"; return
        }
        rememberUndo()
        draft.cells[activeCell] = CollageCell(asset.id)
        status = "已替换第 \(activeCell + 1) 格"
        showReplace = false
    }

    private func saveTemplate() {
        let name = templateName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let template = QuickTemplate(name: name, layout: draft.layout, slots: requirements)
        model.perform { try model.change { state in
            state.templates.removeAll { $0.name.caseInsensitiveCompare(name) == .orderedSame }
            state.templates.append(template)
        } }
        templateName = ""
        status = "模板已保存"
    }

    private func requestTemplateName() {
        templateName = ""
        showTemplateNamePrompt = true
    }

    private func prepareShare() async {
        sharing = true
        defer { sharing = false }
        do {
            shareImage = try await renderer.render(draft: draft, assets: renderAssets, media: model.media, longEdge: 3000, originals: true, allowNetwork: model.allowCloudDownload)
            showShare = true
        } catch { model.error = error.localizedDescription }
    }

    func save() async {
        saving = true; defer { saving = false }
        do {
            let image = try await renderer.render(draft: draft, assets: renderAssets, media: model.media, longEdge: 3000, originals: true, allowNetwork: model.allowCloudDownload)
            let path = "creations/\(UUID().uuidString).jpg"
            guard let data = image.jpegData(compressionQuality: 0.9) else { throw PhotoError.message("拼图导出失败") }
            try data.write(to: model.media.url(path), options: .atomic)
            try model.change { $0.creations.append(Creation(collectionID: collectionID, kind: "collage", title: "拼图", path: path, sourceIDs: draft.cells.compactMap(\.assetID))) }
            status = "已保存到作品集创作"
        } catch { model.error = error.localizedDescription }
    }

    func recommend() async {
        guard !saving else { return }
        let requestDraft = draft
        let requestRequirements = requirements
        let requestCandidates = candidates
        let requestConfiguration = model.aiConfig
        let requestKey = Keychain.load()
        let requestVersion = recommendationVersion(
            draft: requestDraft,
            scope: scopeAllFinalists,
            candidates: requestCandidates,
            requirements: requestRequirements,
            configuration: requestConfiguration
        )
        let request = CollageRecommendationSnapshot(
            draft: requestDraft,
            requirements: requestRequirements,
            candidates: requestCandidates,
            version: requestVersion,
            key: requestKey
        )
        saving = true; defer { saving = false }
        do {
            _ = try PhotoSearch.randomCombination(candidates: request.candidates, requirements: request.requirements, cells: request.draft.cells)
            var shortlist: [LocalAsset] = []
            for requirement in request.requirements {
                for asset in request.candidates.filter({ PhotoSearch.matches($0, requirement) }).shuffled().prefix(4) where !shortlist.contains(where: { $0.id == asset.id }) { shortlist.append(asset) }
            }
            for cell in request.draft.cells where cell.locked {
                if let asset = request.candidates.first(where: { $0.id == cell.assetID }), !shortlist.contains(where: { $0.id == asset.id }) { shortlist.append(asset) }
            }
            guard !shortlist.isEmpty else { throw PhotoError.message("当前筛选范围没有可用于 AI 搭配的照片") }
            var images: [UIImage] = []
            for asset in shortlist { images.append(try await model.media.image(asset, maxSize: 1080, allowNetwork: model.allowCloudDownload)) }
            guard recommendationSnapshotIsCurrent(request) else {
                status = "选图范围或条件已变化，已忽略过期搭配"
                return
            }
            let mapping = shortlist.enumerated().map { "图片\($0.offset + 1)：\($0.element.id)，\($0.element.analysis?.labels.joined(separator: "、") ?? "未分析")" }.joined(separator: "\n")
            let constraints = String(data: try JSONEncoder().encode(request.requirements), encoding: .utf8)!
            let locks = String(data: try JSONEncoder().encode(request.draft.cells), encoding: .utf8)!
            let result = try await model.intelligence.response(prompt: "实际观察这些候选图片的色彩、构图和人物朝向，选择协调且不重复的搭配。返回JSON {\"ids\":[按格子顺序的真实ID],\"reason\":\"中文理由\"}。只允许以下候选ID，必须符合每格主体景别和锁定。候选：\(mapping)\n每格要求数据：\(constraints)\n当前格子和锁定数据：\(locks)", images: images, config: request.version.configuration, key: request.key)
            struct Recommendation: Decodable { var ids: [String]; var reason: String }
            let recommendation = try JSONDecoder().decode(Recommendation.self, from: Intelligence.json(result))
            guard recommendationSnapshotIsCurrent(request) else {
                status = "选图范围或条件已变化，已忽略过期搭配"
                return
            }
            guard recommendation.ids.count == request.draft.cells.count, Set(recommendation.ids).count == recommendation.ids.count else { throw PhotoError.message("AI 搭配数量无效") }
            for index in recommendation.ids.indices {
                guard let asset = shortlist.first(where: { $0.id == recommendation.ids[index] }), PhotoSearch.matches(asset, request.requirements[index]), !request.draft.cells[index].locked || request.draft.cells[index].assetID == asset.id else { throw PhotoError.message("AI 搭配超出来源或不符合模板") }
            }
            rememberUndo()
            for index in recommendation.ids.indices where !request.draft.cells[index].locked { draft.cells[index] = CollageCell(recommendation.ids[index]) }
            status = recommendation.reason
        } catch { model.error = error.localizedDescription }
    }
}

private struct CollageSnapshot {
    var draft: CollageDraft
    var requirements: [CollageSlot]
}

private struct CollageRecommendationSnapshot {
    var draft: CollageDraft
    var requirements: [CollageSlot]
    var candidates: [LocalAsset]
    var version: CollageRecommendationVersion
    var key: String
}

private struct CollageInteractiveCanvas: View {
    @EnvironmentObject private var model: AppModel
    @Binding var draft: CollageDraft
    @Binding var activeCell: Int
    let assets: [LocalAsset]
    let onEditStarted: () -> Void
    let onEmptyCell: (Int) -> Void
    @State private var dragOrigin: CGPoint = .zero
    @State private var dragIndex: Int?
    @State private var pinchOrigin = 1.0
    @State private var pinchIndex: Int?

    private var lookup: [String: LocalAsset] { Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) }) }

    var body: some View {
        GeometryReader { geometry in
            let aspect = CGFloat(draft.ratio)
            let size = CollageInteractionGeometry.aspectFit(aspect: aspect, inside: geometry.size)
            let frames = CollageInteractionGeometry.frames(draft: draft, size: size)
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(hex: draft.background))
                ForEach(draft.cells.indices, id: \.self) { index in
                    let frame = frames.indices.contains(index) ? frames[index] : LayoutRect(x: 0, y: 0, width: size.width, height: size.height)
                    let rect = CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
                    cell(index, frame: rect)
                        .position(x: rect.midX, y: rect.midY)
                }
                if !draft.watermark.isEmpty {
                    let longEdge = Double(max(size.width, size.height))
                    Text(draft.watermark)
                        .font(.system(size: max(1, longEdge / 65)))
                        .foregroundStyle(.white)
                        .padding(2)
                        .background(.black.opacity(0.35))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(.trailing, 24 * longEdge / 3000)
                        .padding(.bottom, 24 * longEdge / 3000)
                        .allowsHitTesting(false)
                }
                RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.32), lineWidth: 1).allowsHitTesting(false)
            }
            .frame(width: size.width, height: size.height)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func cell(_ index: Int, frame: CGRect) -> some View {
        let value = draft.cells[index]
        ZStack {
            if let id = value.assetID, let asset = lookup[id] {
                AssetImage(asset: asset, size: 900, fill: !value.fit, aspect: nil)
                    .frame(width: frame.width, height: frame.height)
                    .scaleEffect(value.scale)
                    .offset(x: value.offsetX * frame.width, y: value.offsetY * frame.height)
                    .frame(width: frame.width, height: frame.height)
                    .clipped()
            } else {
                RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.08))
                    .overlay {
                        VStack(spacing: 6) {
                            Image(systemName: "plus").font(.title3.weight(.medium))
                            Text("点击后替换").font(.caption)
                        }.foregroundStyle(.secondary)
                    }
            }
            if activeCell == index {
                RoundedRectangle(cornerRadius: 5).strokeBorder(PhotoPalette.accent, lineWidth: 2.5)
            } else {
                RoundedRectangle(cornerRadius: 5).strokeBorder(.white.opacity(0.42), lineWidth: 1)
            }
        }
        .frame(width: frame.width, height: frame.height)
        .contentShape(Rectangle())
        .onTapGesture {
            activeCell = index
            if draft.cells[index].assetID == nil { onEmptyCell(index) }
        }
        .simultaneousGesture(dragGesture(index: index, frame: frame))
        .simultaneousGesture(magnificationGesture(index: index))
        .accessibilityElement()
        .accessibilityLabel("第 \(index + 1) 格\(value.assetID == nil ? "，空格" : "")")
        .accessibilityValue("\(value.offsetX),\(value.offsetY),\(value.scale)")
        .accessibilityAddTraits(.isButton)
    }

    private func dragGesture(index: Int, frame: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 5)
            .onChanged { value in
                guard draft.cells[index].assetID != nil, !draft.cells[index].locked else { return }
                if dragIndex != index {
                    onEditStarted(); dragIndex = index; activeCell = index
                    dragOrigin = CGPoint(x: draft.cells[index].offsetX, y: draft.cells[index].offsetY)
                }
                let offset = CollageCropMath.offset(
                    origin: dragOrigin,
                    translation: value.translation,
                    cellSize: frame.size
                )
                draft.cells[index].offsetX = offset.x
                draft.cells[index].offsetY = offset.y
            }
            .onEnded { _ in dragIndex = nil }
    }

    private func magnificationGesture(index: Int) -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                guard draft.cells[index].assetID != nil, !draft.cells[index].locked else { return }
                if pinchIndex != index {
                    onEditStarted(); pinchIndex = index; activeCell = index
                    pinchOrigin = draft.cells[index].scale
                }
                draft.cells[index].scale = CollageCropMath.scale(starting: pinchOrigin, magnification: value)
            }
            .onEnded { _ in pinchIndex = nil }
    }
}

private struct CollageTagFilterView: View {
    let assets: [LocalAsset]
    let library: [LibraryTag]
    @Binding var selected: Set<String>
    @Binding var any: Bool

    private var tags: [LibraryTag] {
        let labels = Set(assets.flatMap { $0.analysis?.labels ?? [] })
        let known = library.filter { labels.contains($0.name) }
        let knownNames = Set(known.map(\.name))
        return known + labels.subtracting(knownNames).sorted().map { LibraryTag($0, .other) }
    }

    var body: some View {
        Form {
            Toggle("满足任一标签", isOn: $any)
            ForEach(TagDomain.allCases, id: \.self) { domain in
                let domainTags = tags.filter { $0.domain == domain }
                if !domainTags.isEmpty {
                    DisclosureGroup {
                        ForEach(domainTags) { tag in
                            Button {
                                if !selected.insert(tag.name).inserted { selected.remove(tag.name) }
                            } label: {
                                HStack {
                                    Text(tag.name)
                                    Spacer()
                                    if selected.contains(tag.name) { Image(systemName: "checkmark.circle.fill").foregroundStyle(PhotoPalette.accent) }
                                }
                                .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                        }
                    } label: {
                        HStack {
                            Text(domain.title)
                            let count = domainTags.filter { selected.contains($0.name) }.count
                            if count > 0 { Text("\(count)").font(.caption).foregroundStyle(PhotoPalette.accent) }
                        }
                    }
                }
            }
            if selected.isEmpty { Text("当前范围还没有 AI 标签").font(.caption).foregroundStyle(.secondary) }
            Button("清除已选标签") { selected.removeAll() }
        }
        .scrollContentBackground(.hidden)
        .photoBackdrop()
    }
}

private extension Color {
    init(hex: String) { self.init(uiColor: UIColor(hex: hex)) }
}
