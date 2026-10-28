import SwiftUI
import PhotoCore

enum SelectionFilterMode: Equatable {
    case coarse
    case fine
}

enum PhotoOrientation: String, CaseIterable, Identifiable, Hashable {
    case landscape
    case portrait
    case square
    case unknown

    var id: String { rawValue }

    var title: String {
        switch self {
        case .landscape: "横图"
        case .portrait: "竖图"
        case .square: "方图"
        case .unknown: "未知方向"
        }
    }

    static func classify(width: Int, height: Int) -> PhotoOrientation {
        guard width > 0, height > 0 else { return .unknown }
        let difference = abs(Double(width - height)) / Double(max(width, height))
        if difference <= 0.05 { return .square }
        return width > height ? .landscape : .portrait
    }
}

enum SelectionFilters {
    static let focalClasses = ["超广角", "广角", "标准", "中焦", "长焦", "未知焦段"]

    static func filter(
        _ assets: [LocalAsset],
        mode: SelectionFilterMode,
        query: String = "",
        selectedTags: Set<String> = [],
        matchesAny: Bool = false,
        selectedFocalClasses: Set<String> = [],
        selectedOrientations: Set<PhotoOrientation> = []
    ) -> [LocalAsset] {
        switch mode {
        case .coarse:
            return assets.filter { asset in
                (selectedFocalClasses.isEmpty || selectedFocalClasses.contains(asset.focalClass))
                    && (selectedOrientations.isEmpty || selectedOrientations.contains(PhotoOrientation.classify(width: asset.width, height: asset.height)))
            }
        case .fine:
            return PhotoSearch.filter(assets, keyword: query, tags: Array(selectedTags), any: matchesAny)
        }
    }
}

/// Compact, stage-specific filters for the selection grid. Coarse filtering
/// intentionally has no text or label controls; fine filtering only offers
/// labels already emitted by AI for the current candidate photos.
struct SelectionFilterContent: View {
    let mode: SelectionFilterMode
    let assets: [LocalAsset]
    let tagLibrary: [LibraryTag]
    let query: String
    let selectedTags: Set<String>
    let selectedFocalClasses: Set<String>
    let selectedOrientations: Set<PhotoOrientation>
    let matchesAny: Bool
    let onSearchChange: (String) -> Void
    let onTagsChange: (Set<String>) -> Void
    let onFocalClassesChange: (Set<String>) -> Void
    let onOrientationsChange: (Set<PhotoOrientation>) -> Void
    let onMatchesAnyChange: (Bool) -> Void
    let onRequestFocalMetadata: ([String]) -> Void
    var onRetryFocalMetadata: ([String]) -> Void = { _ in }

    @State private var focalExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if mode == .coarse {
                focalFilters
                orientationFilters
            } else {
                fineFilters
            }
        }
        .padding(16)
    }

    private var focalFilters: some View {
        DisclosureGroup("焦段", isExpanded: $focalExpanded) {
            chipGrid(SelectionFilters.focalClasses, selected: selectedFocalClasses) { value in
                var updated = selectedFocalClasses
                if !updated.insert(value).inserted { updated.remove(value) }
                onFocalClassesChange(updated)
            }
            .padding(.top, 8)
            let unknown = assets.filter { $0.equivalentFocalLength == nil }.map(\.id)
            if !unknown.isEmpty {
                Button("重试未知焦段") { onRetryFocalMetadata(unknown) }
                    .font(.caption)
                    .padding(.top, 4)
            }
        }
        .onChange(of: focalExpanded) { _, expanded in
            guard expanded else { return }
            let unknown = assets.filter { $0.equivalentFocalLength == nil }.map(\.id)
            if !unknown.isEmpty { onRequestFocalMetadata(unknown) }
        }
    }

    private var orientationFilters: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("方向").font(.subheadline.weight(.semibold))
            chipGrid(PhotoOrientation.allCases.map(\.title), selected: Set(selectedOrientations.map(\.title))) { title in
                guard let orientation = PhotoOrientation.allCases.first(where: { $0.title == title }) else { return }
                var updated = selectedOrientations
                if !updated.insert(orientation).inserted { updated.remove(orientation) }
                onOrientationsChange(updated)
            }
        }
    }

    private var fineFilters: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("名称、标签或描述", text: Binding(get: { query }, set: onSearchChange))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { onSearchChange("") } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                }
            }
            .padding(11)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

            HStack {
                Text("AI 标签").font(.subheadline.weight(.semibold))
                Spacer()
                if !selectedTags.isEmpty {
                    Button("清除") { onTagsChange([]) }.font(.caption)
                }
                Picker("匹配", selection: Binding(get: { matchesAny }, set: onMatchesAnyChange)) {
                    Text("全部").tag(false)
                    Text("任一").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 116)
            }

            ForEach(TagDomain.allCases, id: \.self) { domain in
                let labels = availableLabels(in: domain)
                if !labels.isEmpty {
                    DisclosureGroup {
                        chipGrid(labels, selected: selectedTags) { name in
                            var updated = selectedTags
                            if !updated.insert(name).inserted { updated.remove(name) }
                            onTagsChange(updated)
                        }
                        .padding(.top, 8)
                    } label: {
                        HStack {
                            Text(domainLabel(domain))
                            Spacer()
                            let count = labels.filter(selectedTags.contains).count
                            if count > 0 { Text("已选 \(count)").font(.caption).foregroundStyle(.tint) }
                        }
                    }
                }
            }
        }
    }

    private func availableLabels(in domain: TagDomain) -> [String] {
        let present = Set(assets.flatMap { $0.analysis?.labels ?? [] })
        let domains = Dictionary(tagLibrary.map { ($0.name, $0.domain) }, uniquingKeysWith: { first, _ in first })
        return present.filter { (domains[$0] ?? .other) == domain }.sorted()
    }

    private func domainLabel(_ domain: TagDomain) -> String {
        switch domain {
        case .subject: "主体"
        case .distance: "景别"
        case .environment: "环境"
        case .style: "风格"
        case .other: "其他"
        }
    }

    private func chipGrid(_ values: [String], selected: Set<String>, action: @escaping (String) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(values, id: \.self) { value in
                let isSelected = selected.contains(value)
                Button { action(value) } label: {
                    HStack(spacing: 5) {
                        if isSelected { Image(systemName: "checkmark").font(.caption2.weight(.bold)) }
                        Text(value).font(.caption.weight(isSelected ? .semibold : .regular)).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .padding(.horizontal, 8)
                    .background(isSelected ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.08), in: Capsule())
                    .overlay(Capsule().strokeBorder(isSelected ? Color.accentColor.opacity(0.55) : Color.secondary.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }
}
