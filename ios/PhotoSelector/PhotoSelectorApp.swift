import SwiftUI
import PhotoCore
import LocalAuthentication

@main struct PhotoSelectorIOSApp: App {
    @StateObject private var bootstrap = Bootstrap()
    var body: some Scene {
        WindowGroup {
            if let model = bootstrap.model { RootView().environmentObject(model) }
            else { ContentUnavailableView("照片库无法打开", systemImage: "externaldrive.badge.exclamationmark", description: Text(bootstrap.failure)).photoBackdrop() }
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
            let environment = ProcessInfo.processInfo.environment
            if environment["PHOTO_SELECTOR_UI_TEST"] != nil,
               environment["PHOTO_SELECTOR_UI_EMPTY"] != "1",
               let model {
                try? UITestFixtures.seed(model)
            }
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
                LockGateView(action: unlock)
            } else {
                TabView {
                    NavigationStack { TimelineView().toolbar { Button("设置", systemImage: "gearshape") { settings = true } } }.tabItem { Label("时间线", systemImage: "clock") }
                    NavigationStack { PortfolioListView().toolbar { Button("设置", systemImage: "gearshape") { settings = true } } }.tabItem { Label("作品集", systemImage: "rectangle.stack") }
                    NavigationStack { BatchListView() }.tabItem { Label("导入与选片", systemImage: "photo.badge.plus") }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) { TaskBar() }
                .toolbarBackground(.ultraThinMaterial, for: .tabBar)
                .toolbarBackground(.visible, for: .tabBar)
                .photoBackdrop()
            }
        }
        .tint(PhotoPalette.accent)
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
private struct LockGateView: View {
    let action: () -> Void

    var body: some View {
        ScrollView {
        VStack(spacing: 20) {
            PhotoStoryIllustration()
            VStack(spacing: 8) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 31, weight: .medium))
                    .foregroundStyle(PhotoPalette.accent)
                    .accessibilityHidden(true)
                Text("你的照片库已锁定")
                    .font(.title2.weight(.semibold))
                Text("使用设备密码或生物识别继续访问。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button(action: action) {
                Label("解锁照片库", systemImage: "lock.open")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
            .controlSize(.large)
        }
        .padding(24)
        .frame(maxWidth: 460)
        .photoGlass(cornerRadius: 32)
        .padding(22)
        .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
    }
}
struct TaskBar: View {
    @EnvironmentObject var model: AppModel
    var active: [AnalysisTask] { model.state.tasks.filter { $0.status != .complete && $0.status != .cancelled } }
    var body: some View {
        if !model.progress.isEmpty || !active.isEmpty {
            HStack(spacing: 12) {
                if !model.progress.isEmpty {
                    ProgressView().tint(PhotoPalette.accent)
                    Text(model.progress)
                        .font(.subheadline)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Image(systemName: active.contains(where: { $0.status == .paused }) ? "pause.circle.fill" : "sparkles")
                        .foregroundStyle(PhotoPalette.accent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(active.contains(where: { $0.status == .paused }) ? "整理已暂停" : "正在整理照片")
                            .font(.subheadline.weight(.medium))
                        Text("分类 \(model.state.tasks.filter { $0.status == .complete }.count)/\(model.state.tasks.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Menu {
                        Button("继续／重试") { model.setTasks(.waiting) }
                        Button("暂停") { model.setTasks(.paused) }
                        Button("取消", role: .destructive) { model.setTasks(.cancelled) }
                        if let message = active.first(where: { !$0.message.isEmpty })?.message { Text(message) }
                    } label: {
                        Label(active.contains(where: { $0.status == .paused }) ? "已暂停" : "处理中", systemImage: "ellipsis.circle")
                            .labelStyle(.iconOnly)
                            .font(.title3)
                            .frame(width: 38, height: 38)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(active.contains(where: { $0.status == .paused }) ? "已暂停" : "处理中")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .photoGlass(cornerRadius: 22)
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
    }
}
struct AssetImage: View {
    @EnvironmentObject var model: AppModel
    let asset: LocalAsset
    var size = 480
    var original = false
    var fill = false
    @State private var image: UIImage?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().aspectRatio(contentMode: fill ? .fill : .fit) }
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
    @State private var showCreateBatch = false
    @State private var batchName = ""
    @State private var destinationBatchID: String?

    private var portfolios: [Portfolio] {
        model.state.portfolios.sorted { $0.date < $1.date }
    }

    private var mostRecentBatch: ImportBatch? {
        model.state.batches.max { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if !portfolios.isEmpty {
                    GlassSectionHeader(title: "一路收藏的故事", subtitle: "从照片里，重新遇见那些时刻。", symbol: "sparkles")
                        .padding(.bottom, 2)

                    ForEach(portfolios) { portfolio in
                        NavigationLink { GalleryView(collectionID: portfolio.id) } label: {
                            PortfolioTimelineCard(portfolio: portfolio)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(portfolio.name)，\(portfolio.assetIDs.count) 张照片，打开照片墙")
                    }
                } else if let batch = mostRecentBatch {
                    returningHome(for: batch)
                } else {
                    firstRunOnboarding
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 28)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .photoBackdrop()
        .navigationTitle("时间线")
        .navigationDestination(item: $destinationBatchID) { BatchView(batchID: $0) }
        .alert("给这段故事起个名字", isPresented: $showCreateBatch) {
            TextField("旅行名称", text: $batchName)
            Button("创建") {
                let name = batchName.trimmingCharacters(in: .whitespacesAndNewlines)
                model.perform {
                    destinationBatchID = try model.createBatch(name)
                    batchName = ""
                }
            }
            Button("取消", role: .cancel) { batchName = "" }
        } message: {
            Text("先创建一个空批次。照片只会在你选择相册或文件夹后读取。")
        }
    }

    private var firstRunOnboarding: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text("把喜欢的照片，\n留成一段故事")
                    .font(.system(size: 31, weight: .semibold, design: .rounded))
                    .tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                Text("从一组照片开始，慢慢选出值得珍藏的瞬间。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 8)

            PhotoStoryIllustration()
                .padding(.horizontal, 4)

            Button { showCreateBatch = true } label: {
                HStack(spacing: 10) {
                    Text("开始整理照片")
                    Image(systemName: "arrow.right")
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 56)
            }
            .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
            .controlSize(.large)
            .accessibilityHint("先创建一个批次，再选择相册或存储卡中的照片")


            VStack(spacing: 0) {
                onboardingStep(number: "01", symbol: "photo.on.rectangle.angled", title: "选择照片来源", detail: "从系统相册或存储卡导入")
                onboardingDivider
                onboardingStep(number: "02", symbol: "heart.text.square", title: "完成粗选与精挑", detail: "一步步留下最喜欢的照片")
                onboardingDivider
                onboardingStep(number: "03", symbol: "rectangle.stack", title: "整理成作品集", detail: "添加地点、诗句，再看照片墙")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
            .photoGlass(cornerRadius: 26)


            Text("由你选择照片来源和导入范围。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
        .padding(22)
        .photoGlass(cornerRadius: 32)
    }

    private var onboardingDivider: some View {
        Rectangle()
            .fill(PhotoPalette.glassStroke)
            .frame(height: 1)
            .padding(.leading, 48)
    }

    private func onboardingStep(number: String, symbol: String, title: String, detail: String) -> some View {
        HStack(spacing: 13) {
            Text(number)
                .font(.caption2.weight(.bold).monospacedDigit())
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 29, height: 29)
                .background(PhotoPalette.accent.opacity(0.11), in: Circle())
                .accessibilityHidden(true)
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 13)
        .accessibilityElement(children: .combine)
    }

    private func returningHome(for batch: ImportBatch) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            GlassSectionHeader(
                title: "继续你的故事",
                subtitle: "已经有一段整理中的照片批次。",
                symbol: "bookmark"
            )

            VStack(alignment: .leading, spacing: 18) {
                PhotoStoryIllustration()
                    .frame(height: 164)

                VStack(alignment: .leading, spacing: 5) {
                    Text(batch.name)
                        .font(.title3.weight(.semibold))
                    Text("\(batch.photos.count) 张照片 · 创建于 \(batch.createdAt.formatted(date: .abbreviated, time: .omitted))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Button { destinationBatchID = batch.id } label: {
                    Label("继续选片", systemImage: "arrow.right")
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                }
                .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)

                Button("新建导入批次") { showCreateBatch = true }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
            .photoGlass(cornerRadius: 30)
        }
    }
}

private struct PortfolioTimelineCard: View {
    @EnvironmentObject private var model: AppModel
    let portfolio: Portfolio

    private var cover: LocalAsset? {
        let coverID = portfolio.coverID ?? portfolio.assetIDs.first
        guard let coverID else { return nil }
        return model.state.assets.first { $0.id == coverID }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                if let cover {
                    AssetImage(asset: cover, size: 1280, fill: true)
                        .frame(maxWidth: .infinity)
                        .frame(height: 250)
                        .background(Color.primary.opacity(0.08))
                        .clipped()
                } else {
                    LinearGradient(
                        colors: [PhotoPalette.softTeal, PhotoPalette.peach],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .frame(height: 250)
                    .overlay {
                        Image(systemName: "photo.stack")
                            .font(.system(size: 42, weight: .light))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                }

                LinearGradient(
                    colors: [.clear, .black.opacity(0.68)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 7) {
                        Text(portfolio.date.formatted(date: .abbreviated, time: .omitted))
                        if !portfolio.location.isEmpty {
                            Text("·")
                            Text(portfolio.location).lineLimit(1)
                        }
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.86))

                    Text(portfolio.name)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)

                    if !portfolio.poem.isEmpty {
                        Text(portfolio.poem)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white.opacity(0.94))
                            .lineLimit(2)
                    }
                }
                .padding(19)
            }
            .frame(height: 250)
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))

            HStack(spacing: 8) {
                Label("\(portfolio.assetIDs.count) 张照片", systemImage: "photo")
                Spacer(minLength: 10)
                if !portfolio.location.isEmpty {
                    Label(portfolio.location, systemImage: "mappin.and.ellipse")
                        .lineLimit(1)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 17)
            .padding(.top, 13)
            .padding(.bottom, portfolio.description.isEmpty ? 16 : 8)

            if !portfolio.description.isEmpty {
                Text(portfolio.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.horizontal, 17)
                    .padding(.bottom, 17)
            }
        }
        .photoGlass(cornerRadius: 28)
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
            if let p = portfolio, !p.poem.isEmpty || !p.description.isEmpty || !p.location.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    if !p.poem.isEmpty { Text(p.poem).font(.title3.weight(.medium)) }
                    if !p.description.isEmpty { Text(p.description).font(.subheadline).foregroundStyle(.secondary) }
                    HStack {
                        if !p.location.isEmpty { Label(p.location, systemImage: "mappin.and.ellipse") }
                        Spacer()
                        Text(p.date.formatted(date: .abbreviated, time: .omitted))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .photoGlass(cornerRadius: 24)
                .padding(.horizontal, 12)
                .padding(.top, 12)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 8)], spacing: 8) {
                ForEach(Array(photos.prefix(limit))) { asset in
                    AssetImage(asset: asset)
                        .frame(maxWidth: .infinity, minHeight: 150)
                        .background(Color.primary.opacity(0.045))
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .contentShape(Rectangle())
                        .onTapGesture { selected = asset }
                        .onAppear { if asset.id == photos.prefix(limit).last?.id { limit += 40 } }
                }
            }
            .padding(10)
        }
        .navigationTitle(portfolio?.name ?? "作品集")
        .photoBackdrop()
        .fullScreenCover(item: $selected) { asset in ImmersiveView(ids: photos.map(\.id), initialID: asset.id, batchID: nil, round: .fine) }
    }
}
