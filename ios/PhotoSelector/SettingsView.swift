import SwiftUI
import UniformTypeIdentifiers
import PhotoCore

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    @AppStorage("app.lock") var lock = false
    @State private var config = AIConfiguration()
    @State private var key = ""
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
                Toggle("使用远程 AI（发送压缩预览）", isOn: $config.remoteEnabled)
                if config.remoteEnabled {
                    TextField("HTTPS Base URL，例如 /v1", text: $config.baseURL).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("模型名称", text: $config.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("你的 API Key", text: $key)
                    Text("仅将所分析照片的去 EXIF 压缩预览发送给你配置的服务，可能产生费用。").font(.caption).foregroundStyle(.secondary)
                } else { Text("优先 Apple 端侧模型；设备、系统或语言不支持时，基础选片仍可离线使用。不会自动上传到云端。").font(.caption) }
                Button("保存配置") { model.perform { try model.saveConfig(config, key: key) } }
                Button(testing ? "正在测试" : "测试连接") { Task {
                    testing = true; defer { testing = false }
                    do { _ = try await model.intelligence.response(prompt: "只回复连接成功", images: [], config: config, key: key); model.error = "文字连接成功；图片理解会在实际分类时验证" } catch { model.error = error.localizedDescription }
                } }.disabled(testing)
                Button("清除密钥", role: .destructive) { model.perform { try Keychain.save(""); key = "" } }
            }
            Section("分类标签") {
                ForEach(TagDomain.allCases, id: \.self) { group in
                    DisclosureGroup(group.title) {
                        ForEach(model.state.tags.filter { $0.domain == group }) { tag in HStack { VStack(alignment: .leading) { Text(tag.name); if !tag.definition.isEmpty { Text(tag.definition).font(.caption).foregroundStyle(.secondary) } }; Spacer(); Button(role: .destructive) { model.perform { try model.change { $0.tags.removeAll { $0.id == tag.id } } } } label: { Image(systemName: "minus.circle") } } }
                    }
                }
                Picker("领域", selection: $domain) { ForEach(TagDomain.allCases, id: \.self) { Text($0.title).tag($0) } }
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
            .onAppear { config = model.aiConfig; key = Keychain.load() }
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
}
