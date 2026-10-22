import SwiftUI
import PhotoCore
import LocalAuthentication

@main struct PhotoSelectorIOSApp: App {
    @StateObject private var bootstrap = Bootstrap()
    var body: some Scene {
        WindowGroup {
            if let model = bootstrap.model { RootView().environmentObject(model).preferredColorScheme(.dark) }
            else { ContentUnavailableView("照片库无法打开", systemImage: "externaldrive.badge.exclamationmark", description: Text(bootstrap.failure)) }
        }
    }
}
@MainActor final class Bootstrap: ObservableObject {
    let model: AppModel?
    let failure: String
    init() {
        do {
            var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PhotoSelectorMobile")
            #if DEBUG
            if let run = ProcessInfo.processInfo.environment["PHOTO_SELECTOR_UI_TEST"] { root = FileManager.default.temporaryDirectory.appendingPathComponent("ui-tests-" + run) }
            #endif
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            model = try AppModel(root: root); failure = ""
            #if DEBUG
            if ProcessInfo.processInfo.environment["PHOTO_SELECTOR_UI_TEST"] != nil, let model { try? UITestFixtures.seed(model) }
            #endif
        } catch { model = nil; failure = error.localizedDescription }
    }
}
struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) var phase
    @AppStorage("app.lock") var lockEnabled = false
    @State private var unlocked = false
    @State private var settings = false
    var body: some View {
        Group {
            if lockEnabled && !unlocked {
                Button("解锁照片库", systemImage: "lock.open") { unlock() }.buttonStyle(.borderedProminent)
            } else {
                TabView {
                    NavigationStack { TimelineView().toolbar { Button("设置", systemImage: "gearshape") { settings = true } } }.tabItem { Label("时间线", systemImage: "clock") }
                    NavigationStack { PortfolioListView().toolbar { Button("设置", systemImage: "gearshape") { settings = true } } }.tabItem { Label("作品集", systemImage: "rectangle.stack") }
                    NavigationStack { BatchListView() }.tabItem { Label("导入与选片", systemImage: "photo.badge.plus") }
                }
                .safeAreaInset(edge: .bottom) { TaskBar() }
            }
        }
        .tint(.orange)
        .sheet(isPresented: $settings) { NavigationStack { SettingsView() } }
        .alert("提示", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("知道了") { model.error = nil } } message: { Text(model.error ?? "") }
        .onChange(of: phase) { _, value in if value == .active { model.resumed(); if lockEnabled && !unlocked { unlock() } } else if value == .background { unlocked = false } }
        .task { model.resumed(); if lockEnabled { unlock() }; while !Task.isCancelled { do { try await Task.sleep(for: .seconds(60)); await model.cleanupExpired() } catch { break } } }
    }
    private func unlock() {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "访问你的私人照片库") { success, _ in Task { @MainActor in unlocked = success } }
    }
}
struct TaskBar: View {
    @EnvironmentObject var model: AppModel
    var active: [AnalysisTask] { model.state.tasks.filter { $0.status != .complete && $0.status != .cancelled } }
    var body: some View {
        if !model.progress.isEmpty || !active.isEmpty {
            HStack {
                if !model.progress.isEmpty { ProgressView(); Text(model.progress).font(.caption) }
                else { Text("分类 \(model.state.tasks.filter { $0.status == .complete }.count)/\(model.state.tasks.count)").font(.caption)
                    Spacer()
                    Menu {
                        Button("继续／重试") { model.setTasks(.waiting) }
                        Button("暂停") { model.setTasks(.paused) }
                        Button("取消", role: .destructive) { model.setTasks(.cancelled) }
                        if let message = active.first(where: { !$0.message.isEmpty })?.message { Text(message) }
                    } label: { Label(active.contains(where: { $0.status == .paused }) ? "已暂停" : "处理中", systemImage: "ellipsis.circle") }
                }
            }.padding(10).background(.ultraThinMaterial)
        }
    }
}
struct AssetImage: View {
    @EnvironmentObject var model: AppModel
    let asset: LocalAsset
    var size = 480
    var original = false
    @State private var image: UIImage?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if failed { Button { retry += 1 } label: { Label("离线 · 重试", systemImage: "arrow.clockwise") }.font(.caption).frame(maxWidth: .infinity, minHeight: 100) }
            else { ProgressView().frame(maxWidth: .infinity, minHeight: 100) }
        }.task(id: "\(asset.id)-\(asset.previewPath ?? "")-\(original)-\(retry)") {
            image = nil; failed = false
            do { image = try await model.media.image(asset, maxSize: size, original: original, allowNetwork: model.allowCloudDownload) } catch { failed = true }
        }
    }
}
struct TimelineView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 36) {
                ForEach(model.state.portfolios.sorted { $0.date < $1.date }) { p in
                    NavigationLink { GalleryView(collectionID: p.id) } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            if let asset = model.state.assets.first(where: { $0.id == (p.coverID ?? p.assetIDs.first) }) { AssetImage(asset: asset, size: 1080).clipShape(RoundedRectangle(cornerRadius: 12)) }
                            HStack { Text(p.date, style: .date).font(.caption); Spacer(); Text(p.location).font(.caption) }.foregroundStyle(.secondary)
                            Text(p.name).font(.title2).foregroundStyle(.primary)
                            if !p.poem.isEmpty { Text(p.poem).font(.headline).foregroundStyle(.primary) }
                            if !p.description.isEmpty { Text(p.description).foregroundStyle(.secondary) }
                        }
                    }.buttonStyle(.plain)
                }
                if model.state.portfolios.isEmpty { ContentUnavailableView("从一次旅行开始", systemImage: "photo", description: Text("在导入与选片中选择相册或存储卡照片")) }
            }.padding().frame(maxWidth: 900).frame(maxWidth: .infinity)
        }.navigationTitle("选片助手")
    }
}
struct GalleryView: View {
    @EnvironmentObject var model: AppModel
    let collectionID: String
    @State private var limit = 40
    @State private var selected: LocalAsset?
    var portfolio: Portfolio? { model.state.portfolios.first { $0.id == collectionID } }
    var photos: [LocalAsset] { (portfolio?.assetIDs ?? []).compactMap { id in model.state.assets.first { $0.id == id } } }
    var body: some View {
        ScrollView {
            if let p = portfolio { VStack(spacing: 8) { Text(p.poem).font(.title3); Text(p.description).foregroundStyle(.secondary); Text(p.location).font(.caption) }.padding() }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 6)], spacing: 6) {
                ForEach(Array(photos.prefix(limit))) { asset in
                    AssetImage(asset: asset).onTapGesture { selected = asset }.onAppear { if asset.id == photos.prefix(limit).last?.id { limit += 40 } }
                }
            }.padding(6)
        }.navigationTitle(portfolio?.name ?? "作品集")
            .fullScreenCover(item: $selected) { asset in ImmersiveView(ids: photos.map(\.id), initialID: asset.id, batchID: nil, round: .fine) }
    }
}
