import SwiftUI
import PhotoCore
import UIKit

/// Reveals a view through a soft gradient wipe instead of a hard cut.
struct GradientWipeMask: ViewModifier {
    var progress: Double
    var feather: Double = 0.28

    func body(content: Content) -> some View {
        let edge = progress * (1 + feather)
        content.mask(
            LinearGradient(stops: [
                .init(color: .black, location: 0),
                .init(color: .black, location: max(0, edge - feather)),
                .init(color: .clear, location: min(1, edge)),
                .init(color: .clear, location: 1),
            ], startPoint: .top, endPoint: .bottom)
        )
    }
}

/// The tent presentation flow: ask for a portfolio first, then play it.
struct TentModeFlow: View {
    @EnvironmentObject var model: AppModel
    let startWith: Portfolio?
    @State private var playing: Portfolio?
    @State private var picking = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let playing {
                TentSlideshowView(portfolio: playing)
            }
        }
        .onAppear {
            if let startWith {
                playing = startWith
            } else {
                picking = true
            }
        }
        .sheet(isPresented: $picking) {
            TentPortfolioPicker { portfolio in
                picking = false
                playing = portfolio
            }
        }
    }
}

/// Asks which portfolio the tent presentation should play.
struct TentPortfolioPicker: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let onPick: (Portfolio) -> Void

    var body: some View {
        NavigationStack {
            List {
                if model.state.portfolios.isEmpty {
                    ContentUnavailableView("还没有作品集", systemImage: "rectangle.stack", description: Text("先在作品集里新建一个，再回来开启帐篷模式。"))
                } else {
                    Section("选择要播放的作品集") {
                        ForEach(model.state.portfolios) { portfolio in
                            Button { onPick(portfolio) } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: "rectangle.stack")
                                        .font(.title3)
                                        .foregroundStyle(PhotoPalette.accent)
                                        .frame(width: 46, height: 52)
                                        .background(PhotoPalette.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(portfolio.name).font(.headline).foregroundStyle(.primary)
                                        Text("\(portfolio.assetIDs.count) 张照片").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityIdentifier("tent-portfolio-" + portfolio.id)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .photoBackdrop()
            .navigationTitle("帐篷模式")
            .toolbar { Button("取消") { dismiss() } }
        }
    }
}

/// The tent presentation: a portfolio plays as a slideshow and every
/// photograph dissolves into its own abstract artwork.
struct TentSlideshowView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    let portfolio: Portfolio

    @State private var index = 0
    @State private var phase: Double = 0
    @State private var photo: UIImage?
    @State private var artwork: UIImage?
    @State private var poster: UIImage?
    @State private var showPoster = false
    @State private var posterTask: Task<Void, Never>?
    @State private var slideTask: Task<Void, Never>?
    @State private var paused = false

    /// Seconds the dissolve takes.
    static let transitionDuration: Double = 4.2
    /// Seconds the finished artwork is held before the next photograph.
    static let holdDuration: Double = 2.6

    private var assets: [LocalAsset] {
        portfolio.assetIDs.compactMap { id in model.state.assets.first { $0.id == id } }
    }
    private var current: LocalAsset? { assets.indices.contains(index) ? assets[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            DuoLayout(hinge: model.hinge) {
                canvas
            } secondary: {
                rail
            }
            .modifier(HingeObserver(state: model.hinge))
        }
        .statusBarHidden(true)
        .onAppear { start() }
        .onDisappear { stop() }
        .sheet(isPresented: $showPoster) {
            NavigationStack { PosterSheet(image: poster, title: current?.name ?? "") }
        }
    }

    // MARK: - Canvas

    private var canvas: some View {
        GeometryReader { geometry in
            ZStack {
                if let photo {
                    Image(uiImage: photo).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
                if let artwork {
                    Image(uiImage: artwork).resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
                        .modifier(GradientWipeMask(progress: phase))
                }
                // A colour wash travels with the dissolve so the change reads as
                // a film transition rather than a slideshow cut.
                LinearGradient(colors: [.clear, .white.opacity(0.10 * phase), .clear], startPoint: .top, endPoint: .bottom)
                    .blendMode(.plusLighter)
                    .allowsHitTesting(false)
                FilmGrainOverlay(opacity: 0.07 + 0.05 * phase)
                VStack {
                    Spacer()
                    Text(current?.name ?? "")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 26)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("tent-canvas")
        }
    }

    private var rail: some View {
        VStack(spacing: 12) {
            Text("帐篷模式").font(.headline)
            Text(portfolio.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            Text("\(min(index + 1, assets.count)) / \(assets.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                .accessibilityIdentifier("tent-counter")
            Divider()
            Button(paused ? "继续播放" : "暂停", systemImage: paused ? "play.fill" : "pause.fill") {
                paused.toggle()
                if paused { slideTask?.cancel() } else { runSlide() }
            }
            .buttonStyle(.bordered)
            Button("查看本张海报", systemImage: "doc.richtext") { buildPoster() }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("tent-poster-button")
            Button("生成全部海报", systemImage: "square.stack.3d.up") {
                Task { await model.generatePosters(portfolioID: portfolio.id) }
            }
            .buttonStyle(.bordered)
            Button("关闭", systemImage: "xmark") { dismiss() }
                .buttonStyle(.bordered)
            Spacer()
        }
        .font(.subheadline)
        .tint(PhotoPalette.accent)
        .padding(12)
    }

    // MARK: - Playback

    private func start() {
        loadArtwork()
        runSlide()
    }

    private func stop() {
        slideTask?.cancel()
        posterTask?.cancel()
    }

    private func runSlide() {
        slideTask?.cancel()
        slideTask = Task {
            guard !Task.isCancelled else { return }
            withAnimation(.linear(duration: TentSlideshowView.transitionDuration)) { phase = 1 }
            try? await Task.sleep(for: .seconds(TentSlideshowView.holdDuration))
            guard !Task.isCancelled, !paused else { return }
            advance()
        }
    }

    private func advance() {
        guard assets.count > 1 else { return }
        index = (index + 1) % assets.count
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { phase = 0 }
        loadArtwork()
        runSlide()
    }

    private func loadArtwork() {
        guard let current else { return }
        artwork = nil
        photo = nil
        Task {
            let loadedImage = try? await model.media.image(current, maxSize: 1800, allowNetwork: model.allowCloudDownload)
            let generatedImage = await model.artwork(for: current, photo: loadedImage)
            guard !Task.isCancelled else { return }
            photo = loadedImage
            artwork = generatedImage
        }
    }

    private func buildPoster() {
        guard let current else { return }
        posterTask?.cancel()
        posterTask = Task {
            let rendered = await model.poster(for: current, portfolio: portfolio, index: index + 1, total: assets.count)
            guard !Task.isCancelled else { return }
            poster = rendered
            showPoster = true
        }
    }
}

/// Shows one finished poster.
struct PosterSheet: View {
    @Environment(\.dismiss) var dismiss
    let image: UIImage?
    let title: String

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                        .accessibilityIdentifier("poster-image")
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(title, image: Image(uiImage: image))) {
                        Label("分享海报", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                }
            }.padding(16)
        }
        .scrollContentBackground(.hidden)
        .photoBackdrop()
        .navigationTitle(title)
        .toolbar { Button("完成") { dismiss() } }
    }
}
