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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showCreateBatch = false
    @State private var batchName = ""
    @State private var destinationBatchID: String?
    @State private var guidePage = 0

    private var portfolios: [Portfolio] {
        model.state.portfolios.sorted { $0.date < $1.date }
    }

    private var mostRecentBatch: ImportBatch? {
        model.state.batches.max { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        GeometryReader { geometry in
            let expanded = geometry.size.width >= 700 && geometry.size.height >= 400

            Group {
                if !portfolios.isEmpty {
                    if expanded {
                        expandedTimeline(in: geometry.size)
                    } else {
                        compactTimeline
                    }
                } else if let batch = mostRecentBatch {
                    if expanded {
                        returningExpandedHome(for: batch, availableHeight: geometry.size.height)
                    } else {
                        returningCompactHome(for: batch, availableHeight: geometry.size.height)
                    }
                } else if expanded {
                    firstRunExpandedOnboarding(availableHeight: geometry.size.height)
                } else {
                    firstRunCompactOnboarding(availableHeight: geometry.size.height)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    private var compactTimeline: some View {
        ScrollView {
            portfolioTimelineEntries
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 28)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("timeline-compact")
    }

    private var portfolioTimelineEntries: some View {
        LazyVStack(alignment: .leading, spacing: 20) {
            GlassSectionHeader(title: "一路收藏的故事", subtitle: "从照片里，重新遇见那些时刻。", symbol: "sparkles")
                .padding(.bottom, 2)

            ForEach(portfolios) { portfolio in
                NavigationLink { GalleryView(collectionID: portfolio.id) } label: {
                    PortfolioTimelineCard(portfolio: portfolio)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(portfolio.name)，\(portfolio.assetIDs.count) 张照片，打开照片墙")
            }
        }
    }

    private func expandedTimeline(in size: CGSize) -> some View {
        HStack(alignment: .top, spacing: 18) {
            ScrollView {
                portfolioTimelineEntries
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
            }
            .frame(width: min(max(size.width * 0.45, 292), 448), alignment: .top)

            if let latest = portfolios.last {
                FeaturedPortfolioPreview(portfolio: latest)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: 1480, maxHeight: .infinity)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-expanded")
    }

    private func firstRunCompactOnboarding(availableHeight: CGFloat) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibleOnboardingGuide
            } else {
                ViewThatFits(in: .vertical) {
                    firstRunCompactCard(
                        illustrationHeight: min(max(availableHeight * 0.16, 82), 132),
                        showsSubtitle: true,
                        showsDetails: true,
                        shortTitle: false
                    )
                    .fixedSize(horizontal: false, vertical: true)

                    firstRunCompactCard(
                        illustrationHeight: min(max(availableHeight * 0.13, 56), 86),
                        showsSubtitle: false,
                        showsDetails: false,
                        shortTitle: false
                    )
                    .fixedSize(horizontal: false, vertical: true)

                    firstRunLandscapeCard
                        .fixedSize(horizontal: false, vertical: true)

                    firstRunCompactCard(
                        illustrationHeight: 0,
                        showsSubtitle: false,
                        showsDetails: false,
                        shortTitle: true
                    )
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: 560, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-onboarding")
    }

    private var firstRunLandscapeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("从照片开始，留下一段故事")
                .font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 8) {
                onboardingTile(number: "01", symbol: "photo.on.rectangle.angled", title: "选择照片来源")
                onboardingTile(number: "02", symbol: "heart.text.square", title: "完成粗选与精挑")
                onboardingTile(number: "03", symbol: "rectangle.stack", title: "整理成作品集")
            }
            startOrganizingButton
        }
        .padding(14)
        .photoGlass(cornerRadius: 26)
    }

    private func onboardingTile(number: String, symbol: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(number)
                    .font(.caption2.weight(.bold).monospacedDigit())
                    .foregroundStyle(PhotoPalette.accent)
                    .accessibilityHidden(true)
                Image(systemName: symbol)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(PhotoPalette.accent)
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .padding(10)
        .photoGlass(cornerRadius: 18)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("timeline-guide-step-\(Int(number) ?? 0)")
    }

    private var accessibleOnboardingGuide: some View {
        GeometryReader { geometry in
            VStack(spacing: 8) {
                if geometry.size.height > 350 {
                    Text("照片整理指南")
                        .font(.title3.weight(.semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Text(["选择照片来源", "完成粗选与精挑", "整理成作品集"][guidePage])
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("timeline-guide-step-\(guidePage + 1)")
                HStack {
                    Button { guidePage = max(0, guidePage - 1) } label: {
                        Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("上一步指引").disabled(guidePage == 0)
                    Spacer(minLength: 8)
                    Text("\(guidePage + 1) / 3").font(.caption).accessibilityLabel("第 \(guidePage + 1) 步，共 3 步")
                    Spacer(minLength: 8)
                    Button { guidePage = min(2, guidePage + 1) } label: {
                        Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("下一步指引").disabled(guidePage == 2)
                }
                startOrganizingButton
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .photoGlass(cornerRadius: 26)
        }.frame(maxWidth: 560, maxHeight: .infinity)
    }

    private func firstRunCompactCard(
        illustrationHeight: CGFloat,
        showsSubtitle: Bool,
        showsDetails: Bool,
        shortTitle: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: showsDetails ? 12 : 8) {
            VStack(alignment: .leading, spacing: 5) {
                Text(shortTitle ? "从照片开始，留下一段故事" : "把喜欢的照片，留成一段故事")
                    .font(.system(size: shortTitle ? 25 : 29, weight: .semibold, design: .rounded))
                    .tracking(-0.5)
                    .fixedSize(horizontal: false, vertical: true)
                if showsSubtitle {
                    Text("从一组照片开始，慢慢选出值得珍藏的瞬间。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if illustrationHeight > 0 {
                PhotoStoryIllustration(height: illustrationHeight)
                    .padding(.horizontal, 4)
            }

            onboardingSteps(showsDetails: showsDetails)

            startOrganizingButton
        }
        .padding(showsDetails ? 18 : 14)
        .photoGlass(cornerRadius: 28)
    }

    private func firstRunExpandedOnboarding(availableHeight: CGFloat) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibleOnboardingGuide
            } else {
                ViewThatFits(in: .vertical) {
                    firstRunExpandedCard(illustrationHeight: min(max(availableHeight * 0.34, 112), 180), showsDetails: true)
                        .fixedSize(horizontal: false, vertical: true)
                    firstRunExpandedCard(illustrationHeight: min(max(availableHeight * 0.22, 76), 112), showsDetails: false)
                        .fixedSize(horizontal: false, vertical: true)
                    firstRunLandscapeCard
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: 1100, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-onboarding")
    }

    private func firstRunExpandedCard(illustrationHeight: CGFloat, showsDetails: Bool) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("把喜欢的照片，\n留成一段故事")
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                Text("从一组照片开始，慢慢选出值得珍藏的瞬间。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                PhotoStoryIllustration(height: illustrationHeight)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .photoGlass(cornerRadius: 28)

            VStack(alignment: .leading, spacing: 10) {
                onboardingSteps(showsDetails: showsDetails)
                startOrganizingButton
            }
            .padding(18)
            .photoGlass(cornerRadius: 28)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func onboardingSteps(showsDetails: Bool) -> some View {
        VStack(spacing: 0) {
            onboardingStep(number: "01", symbol: "photo.on.rectangle.angled", title: "选择照片来源", detail: "从系统相册或存储卡导入", showsDetail: showsDetails)
            onboardingDivider
            onboardingStep(number: "02", symbol: "heart.text.square", title: "完成粗选与精挑", detail: "一步步留下最喜欢的照片", showsDetail: showsDetails)
            onboardingDivider
            onboardingStep(number: "03", symbol: "rectangle.stack", title: "整理成作品集", detail: "添加地点、诗句，再看照片墙", showsDetail: showsDetails)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .photoGlass(cornerRadius: 24)
    }

    private var onboardingDivider: some View {
        Rectangle()
            .fill(PhotoPalette.glassStroke)
            .frame(height: 1)
            .padding(.leading, 42)
    }

    private func onboardingStep(number: String, symbol: String, title: String, detail: String, showsDetail: Bool) -> some View {
        HStack(spacing: 13) {
            Text(number)
                .font(.caption2.weight(.bold).monospacedDigit())
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 27, height: 27)
                .background(PhotoPalette.accent.opacity(0.11), in: Circle())
                .accessibilityHidden(true)
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(PhotoPalette.accent)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold))
                if showsDetail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, showsDetail ? 10 : 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("timeline-guide-step-\(Int(number) ?? 0)")
    }

    private var startOrganizingButton: some View {
        Button { showCreateBatch = true } label: {
            HStack(spacing: 10) {
                Text("开始整理照片")
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 50)
        }
        .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
        .controlSize(.large)
        .accessibilityHint("先创建一个批次，再选择相册或存储卡中的照片")
    }

    private func returningCompactHome(for batch: ImportBatch, availableHeight: CGFloat) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                returningMinimalCard(for: batch)
            } else {
                ViewThatFits(in: .vertical) {
                    returningCompactCard(for: batch, illustrationHeight: min(max(availableHeight * 0.14, 64), 104), compact: false)
                        .fixedSize(horizontal: false, vertical: true)
                    returningCompactCard(for: batch, illustrationHeight: 0, compact: true)
                        .fixedSize(horizontal: false, vertical: true)
                    returningMinimalCard(for: batch)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: 560, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-onboarding")
    }

    private func returningCompactCard(for batch: ImportBatch, illustrationHeight: CGFloat, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 14) {
            if compact {
                Text("继续你的故事")
                    .font(.title3.weight(.semibold))
            } else {
                GlassSectionHeader(title: "继续你的故事", subtitle: "已经有一段整理中的照片批次。", symbol: "bookmark")
            }

            if illustrationHeight > 0 {
                PhotoStoryIllustration(height: illustrationHeight)
            }

            batchSummary(batch, compact: compact)
            continueBatchButton(batch)
            newBatchButton
        }
        .padding(compact ? 16 : 20)
        .photoGlass(cornerRadius: 28)
    }

    private func returningExpandedHome(for batch: ImportBatch, availableHeight: CGFloat) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                returningMinimalCard(for: batch)
            } else {
                ViewThatFits(in: .vertical) {
                    returningExpandedCard(for: batch, illustrationHeight: min(max(availableHeight * 0.34, 108), 180), compact: false)
                        .fixedSize(horizontal: false, vertical: true)
                    returningExpandedCard(for: batch, illustrationHeight: min(max(availableHeight * 0.20, 68), 104), compact: true)
                        .fixedSize(horizontal: false, vertical: true)
                    returningMinimalCard(for: batch)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: 1050, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-onboarding")
    }

    private func returningExpandedCard(for batch: ImportBatch, illustrationHeight: CGFloat, compact: Bool) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("继续你的故事")
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                if !compact {
                    Text("已经有一段整理中的照片批次。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                PhotoStoryIllustration(height: illustrationHeight)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .photoGlass(cornerRadius: 28)

            VStack(alignment: .leading, spacing: 12) {
                batchSummary(batch, compact: compact)
                continueBatchButton(batch)
                newBatchButton
            }
            .padding(20)
            .photoGlass(cornerRadius: 28)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func returningMinimalCard(for batch: ImportBatch) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            batchSummary(batch, compact: true)
            continueBatchButton(batch)
            newBatchButton
        }
        .padding(14)
        .photoGlass(cornerRadius: 26)
    }

    private func batchSummary(_ batch: ImportBatch, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(batch.name)
                .font(compact ? .headline : .title3.weight(.semibold))
                .lineLimit(2)
            Text("\(batch.photos.count) 张照片 · 创建于 \(batch.createdAt.formatted(date: .abbreviated, time: .omitted))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func continueBatchButton(_ batch: ImportBatch) -> some View {
        Button { destinationBatchID = batch.id } label: {
            Label("继续选片", systemImage: "arrow.right")
                .frame(maxWidth: .infinity)
                .frame(minHeight: 50)
        }
        .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
    }

    private var newBatchButton: some View {
        Button("新建导入批次") { showCreateBatch = true }
            .font(.subheadline.weight(.medium))
            .frame(maxWidth: .infinity)
    }
}

private struct FeaturedPortfolioPreview: View {
    @EnvironmentObject private var model: AppModel
    let portfolio: Portfolio

    private var previewPhotos: [LocalAsset] {
        Array(portfolio.assetIDs.prefix(4)).compactMap { id in model.state.assets.first { $0.id == id } }
    }

    private let photoColumns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        VStack(spacing: 12) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("最近收藏")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PhotoPalette.accent)
                    Spacer()
                    Text(portfolio.date.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(portfolio.name)
                    .font(.title2.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(2)

                if !portfolio.location.isEmpty {
                    Label(portfolio.location, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if !portfolio.poem.isEmpty {
                    Text(portfolio.poem)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(PhotoPalette.accent)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineLimit(2)
                }

                if !portfolio.description.isEmpty {
                    Text(portfolio.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineLimit(2)
                }

                if !previewPhotos.isEmpty {
                    LazyVGrid(columns: photoColumns, spacing: 8) {
                        ForEach(previewPhotos) { asset in
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .overlay {
                                    GeometryReader { geometry in
                                        AssetImage(asset: asset, size: 480, fill: true)
                                            .frame(width: geometry.size.width, height: geometry.size.height)
                                            .clipped()
                                    }
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                    .accessibilityLabel("\(previewPhotos.count) 张精选照片预览")
                } else {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(LinearGradient(colors: [PhotoPalette.softTeal, PhotoPalette.peach], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(height: 116)
                        .overlay {
                            Image(systemName: "photo.stack")
                                .font(.system(size: 34, weight: .light))
                                .foregroundStyle(.white.opacity(0.9))
                                .accessibilityHidden(true)
                        }
                }
            }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            NavigationLink { GalleryView(collectionID: portfolio.id) } label: {
                Label("查看全部照片", systemImage: "photo.on.rectangle.angled")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 50)
            }
            .buttonStyle(.borderedProminent).foregroundStyle(PhotoPalette.onAccent)
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .photoGlass(cornerRadius: 28)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timeline-featured")
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
