import SwiftUI
import UniformTypeIdentifiers
import PhotoCore

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @AppStorage("app.lock") var lock = false
    @State private var config = AIConfiguration()
    @State private var key = ""
    @State private var imageKey = ""
    @State private var hasChatKey = false
    @State private var hasImageKey = false
    @State private var name = ""
    @State private var definition = ""
    @State private var domain = TagDomain.environment
    @State private var backupPicker = false
    @State private var restoring = false
    @State private var backupStatus = ""
    @State private var rerun = false
    @State private var testing = false
    var body: some View {
        Form {
            Section("本机") {
                Toggle("使用设备密码保护照片库", isOn: $lock)
                Toggle("允许 iCloud 原片下载", isOn: $model.allowCloudDownload)
                Text("照片和选片记录保存在本机。不会删除系统相册或存储卡原片。").font(.caption).foregroundStyle(.secondary)
            }
            Section("AI 服务") {
                TextField("多模态服务 Base URL", text: $config.baseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                Picker("常用模型", selection: multimodalPreset) {
                    Text("Qwen 3.8 Omni Flash").tag("qwen3.8-omni-flash")
                    Text("Qwen VL Plus").tag("qwen-vl-plus")
                    Text("自定义模型").tag("custom")
                }
                TextField("模型名称", text: $config.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(hasChatKey ? "输入新 API Key（留空保留已保存密钥）" : "多模态 API Key", text: $key)
                if hasChatKey { Text("已保存密钥；不会显示或写入普通配置文件。").font(.caption).foregroundStyle(.secondary) }
                Text("AI 使用你配置的服务，不调用端侧模型。分析时仅发送压缩预览，可能产生服务费用；未配置时任务会等待。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("保存配置") {
                    model.perform {
                        try model.saveConfig(config, key: key.isEmpty ? nil : key,
                                             imageKey: !config.imageUsesChatKey && !imageKey.isEmpty ? imageKey : nil)
                        hasChatKey = !Keychain.load().isEmpty
                        hasImageKey = !Keychain.loadStoredImage().isEmpty
                        key = ""; imageKey = ""
                    }
                }
                Button(testing ? "正在测试" : "测试连接") { Task {
                    testing = true; defer { testing = false }
                    do { _ = try await model.intelligence.response(prompt: "只回复连接成功", images: [], config: config, key: key.isEmpty ? Keychain.load() : key); model.error = "文字连接成功；图片理解会在实际分类时验证" } catch { model.error = error.localizedDescription }
                } }.disabled(testing)
                Button("清除多模态密钥", role: .destructive) { model.perform { try Keychain.save(""); key = ""; hasChatKey = false } }
            }
            Section("生图模型") {
                Toggle("启用生图模型", isOn: $config.imageEnabled)
                if config.imageEnabled {
                    TextField("生图服务 Base URL（留空则复用上面的地址）", text: $config.imageBaseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Picker("常用模型", selection: imagePreset) {
                        Text("Wan 2.7 Image").tag("wan2.7-image")
                        Text("自定义模型").tag("custom")
                    }
                    TextField("生图模型名称", text: $config.imageModel).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Picker("生成尺寸", selection: $config.imageSize) {
                        Text("1024 × 1024").tag("1024x1024")
                        Text("1024 × 1536").tag("1024x1536")
                        Text("1536 × 1024").tag("1536x1024")
                    }
                    Toggle("复用多模态 API Key", isOn: $config.imageUsesChatKey)
                    if !config.imageUsesChatKey {
                        SecureField(hasImageKey ? "输入新生图 Key（留空保留已保存密钥）" : "生图 API Key", text: $imageKey)
                        if hasImageKey { Text("已保存单独的生图密钥。").font(.caption).foregroundStyle(.secondary) }
                    }
                    Text("开启后，帐篷模式播放时会默认调用生图模型，为每张照片生成独立的抽象图，再合成成海报。每张照片单独处理，不会拼贴；远程生图可能产生费用。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("测试生图连接") { Task {
                        testing = true; defer { testing = false }
                        do {
                            let savedKey = config.imageUsesChatKey ? Keychain.load() : Keychain.loadStoredImage()
                            let providedKey = config.imageUsesChatKey ? (key.isEmpty ? savedKey : key) : (imageKey.isEmpty ? savedKey : imageKey)
                            let result = try await model.imageGeneration.generate(prompt: "一个抽象的渐变色场，不要文字。", reference: nil, size: config.imageSize, config: config, key: providedKey)
                            model.error = "生图连接成功，返回 \(result.image.size.width) × \(result.image.size.height) px"
                        } catch { model.error = error.localizedDescription }
                    } }.disabled(testing)
                    if !config.imageUsesChatKey { Button("清除生图密钥", role: .destructive) { model.perform { try Keychain.saveImage(""); imageKey = ""; hasImageKey = false } } }
                } else {
                    Text("未开启生图模型时，海报下半区由本机依据照片自身色彩生成抽象图，不会联网。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("分类标签") {
                ForEach(TagDomain.allCases, id: \.self) { group in
                    DisclosureGroup(tagDomainName(group)) {
                        ForEach(model.state.tags.filter { $0.domain == group }) { tag in HStack { VStack(alignment: .leading) { Text(tag.name); if !tag.definition.isEmpty { Text(tag.definition).font(.caption).foregroundStyle(.secondary) } }; Spacer(); Button(role: .destructive) { model.perform { try model.change { $0.tags.removeAll { $0.id == tag.id } } } } label: { Image(systemName: "minus.circle") } } }
                    }
                }
                Picker("领域", selection: $domain) { ForEach(TagDomain.allCases, id: \.self) { Text(tagDomainName($0)).tag($0) } }
                TextField("标签名称", text: $name); TextField("标签定义", text: $definition)
                Button("添加／更新标签") { model.perform { let tag = LibraryTag(name.trimmingCharacters(in: .whitespacesAndNewlines), domain, definition: definition); guard !tag.name.isEmpty else { return }; try model.change { s in s.tags.removeAll { $0.name == tag.name }; s.tags.append(tag) }; name = ""; definition = "" } }
                Button("按当前标签重新分类", role: .destructive) { rerun = true }
                Text("修改只影响新任务；已有标签保留。重新分类会重新计算，远程服务可能收费。").font(.caption)
            }
            Section("备份与恢复") {
                Button("导出完整照片库到文件夹") { restoring = false; backupPicker = true }
                Button("从备份文件夹恢复") { restoring = true; backupPicker = true }
                Text(backupStatus).font(.caption)
                Text("备份包含可访问的原片、创作和记录，不包含密钥。请先连接来源；卸载应用会删除本机私有库。").font(.caption).foregroundStyle(.secondary)
            }
        }.scrollContentBackground(.hidden).photoBackdrop().navigationTitle("设置").toolbar { Button("完成") { dismiss() } }
            .onAppear {
                config = model.aiConfig
                config.remoteEnabled = true
                if config.imageModel.isEmpty { config.imageModel = "wan2.7-image" }
                hasChatKey = !Keychain.load().isEmpty
                hasImageKey = !Keychain.loadStoredImage().isEmpty
                key = ""; imageKey = ""
            }
            .confirmationDialog("重新分析所有粗筛入选照片？", isPresented: $rerun) {
                Button("重新分类") { model.perform { try model.change { s in
                    for i in s.assets.indices where s.isAdmitted(s.assets[i].id) { s.assets[i].analysis = nil }
                    s.tasks = []; s.reconcileTasks()
                } }; model.runAnalysis() }
            }
            .fileImporter(isPresented: $backupPicker, allowedContentTypes: [.folder]) { result in
                switch result {
                case .failure(let error): model.error = error.localizedDescription
                case .success(let folder): Task {
                    backupStatus = "正在处理，请保持应用打开"
                    do {
                        let service = BackupService()
                        if restoring {
                            let restored = try await service.restore(folder: folder, media: model.media)
                            try model.change { $0.mergeRestoredBackup(restored) }
                            model.startMediaPreparation(); backupStatus = "已恢复为新的批次和作品集"
                        } else { let path = try await service.export(state: model.state, media: model.media, destination: folder, allowNetwork: model.allowCloudDownload); backupStatus = "备份完成：\(path.lastPathComponent)" }
                    } catch { backupStatus = "未完成：\(error.localizedDescription)" }
                }
                }
            }
    }

    private var multimodalPreset: Binding<String> {
        Binding(get: {
            ["qwen3.8-omni-flash", "qwen-vl-plus"].contains(config.model) ? config.model : "custom"
        }, set: { value in if value != "custom" { config.model = value } })
    }

    private var imagePreset: Binding<String> {
        Binding(get: { config.imageModel == "wan2.7-image" ? config.imageModel : "custom" },
                set: { value in if value != "custom" { config.imageModel = value } })
    }

    private func tagDomainName(_ domain: TagDomain) -> String {
        switch domain {
        case .subject: "主体"
        case .distance: "景别"
        case .environment: "环境"
        case .style: "风格"
        case .other: "其他"
        }
    }
}
