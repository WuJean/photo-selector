import SwiftUI
import PhotoCore

/// The photo's own width to height ratio.
///
/// It is used to reserve the space a photo needs before the preview arrives,
/// so a wall never jumps while the images stream in.
func assetAspect(_ asset: LocalAsset) -> CGFloat {
    CGFloat(max(asset.width, 1)) / CGFloat(max(asset.height, 1))
}

/// A waterfall layout that keeps every photo's own proportions while the
/// column count follows the available width.
///
/// The photo wall used a regular grid whose rows were as tall as their
/// tallest photo, which left large holes between mixed portrait and
/// landscape shots. A waterfall keeps the wall dense on every screen size.
struct WaterfallLayout: Layout {
    var minimumColumnWidth: CGFloat
    var maximumColumns: Int = 8
    var spacing: CGFloat = 8

    init(minimumColumnWidth: CGFloat, maximumColumns: Int = 8, spacing: CGFloat = 8) {
        self.minimumColumnWidth = minimumColumnWidth; self.maximumColumns = maximumColumns; self.spacing = spacing
    }

    /// The column count follows the width, so a phone, a tablet and a Duo all
    /// get a wall that fills the space instead of stretching two columns.
    private func columns(for width: CGFloat) -> Int {
        guard width > 0 else { return 1 }
        let count = Int((width + spacing) / (minimumColumnWidth + spacing))
        return max(1, min(maximumColumns, count))
    }

    private func columnWidth(for width: CGFloat, columns: Int) -> CGFloat {
        max(0, (width - spacing * CGFloat(max(0, columns - 1))) / CGFloat(columns))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        let count = columns(for: width)
        let columnWidth = columnWidth(for: width, columns: count)
        var heights = Array(repeating: CGFloat.zero, count: count)
        for subview in subviews {
            let index = shortest(of: heights)
            let size = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
            heights[index] += size.height + spacing
        }
        return CGSize(width: width, height: max(0, (heights.max() ?? 0) - spacing))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let count = columns(for: bounds.width)
        let columnWidth = columnWidth(for: bounds.width, columns: count)
        var heights = Array(repeating: CGFloat.zero, count: count)
        for subview in subviews {
            let index = shortest(of: heights)
            let size = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
            subview.place(
                at: CGPoint(x: bounds.minX + CGFloat(index) * (columnWidth + spacing), y: bounds.minY + heights[index]),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: columnWidth, height: size.height)
            )
            heights[index] += size.height + spacing
        }
    }

    private func shortest(of heights: [CGFloat]) -> Int {
        var best = 0
        for index in heights.indices where heights[index] < heights[best] { best = index }
        return best
    }
}

/// Reserves the room a photo needs before it finishes loading.
///
/// Without a reserved box a grid cell grows as soon as its image arrives, so
/// the wall jumps around while the previews stream in. The box is built from
/// an empty colour on purpose: a resizable photo carries the pixel size of
/// the original file as its ideal size, and that ideal size would widen the
/// grid cell beyond its column.
private struct PhotoAspectModifier: ViewModifier {
    let aspect: CGFloat?

    func body(content: Content) -> some View {
        if let aspect {
            Color.clear
                .aspectRatio(aspect, contentMode: .fit)
                .overlay { content.frame(maxWidth: .infinity, maxHeight: .infinity) }
                .clipped()
        } else {
            content
        }
    }
}

extension View {
    /// Keeps the layout stable while the photo loads.
    func photoAspect(_ aspect: CGFloat?) -> some View {
        modifier(PhotoAspectModifier(aspect: aspect))
    }
}
