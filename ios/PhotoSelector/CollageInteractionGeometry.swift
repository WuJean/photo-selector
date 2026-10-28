import Foundation
import SwiftUI
import PhotoCore

/// Keeps the interactive crop surface and the final renderer on the same
/// layout and normalized crop coordinate system.
enum CollageInteractionGeometry {
    static func aspectFit(aspect: CGFloat, inside available: CGSize) -> CGSize {
        let safeAspect = max(0.1, aspect)
        guard available.width > 0, available.height > 0 else { return .zero }
        if available.width / available.height > safeAspect {
            return CGSize(width: available.height * safeAspect, height: available.height)
        }
        return CGSize(width: available.width, height: available.width / safeAspect)
    }

    static func frames(draft: CollageDraft, size: CGSize) -> [LayoutRect] {
        let longEdge = max(size.width, size.height)
        return CollageLayout.frames(
            layout: draft.layout,
            width: size.width,
            height: size.height,
            gap: draft.gap * Double(longEdge) / 3000,
            frame: draft.frame * Double(longEdge) / 3000
        )
    }
}

enum CollageCropMath {
    static let minimumScale = 1.0
    static let maximumScale = 4.0
    static let minimumOffset = -2.0
    static let maximumOffset = 2.0

    static func scale(starting: Double, magnification: Double) -> Double {
        min(maximumScale, max(minimumScale, starting * magnification))
    }

    /// Offsets are normalized to each cell's own dimensions, matching the
    /// coordinates consumed by CollageRenderer regardless of screen size.
    static func offset(origin: CGPoint, translation: CGSize, cellSize: CGSize) -> CGPoint {
        let width = max(1, cellSize.width)
        let height = max(1, cellSize.height)
        return CGPoint(
            x: min(maximumOffset, max(minimumOffset, origin.x + translation.width / width)),
            y: min(maximumOffset, max(minimumOffset, origin.y + translation.height / height))
        )
    }
}

struct CollageRecommendationVersion: Equatable {
    var draftFingerprint: String
    var allFinalists: Bool
    var candidateFingerprint: String
    var requirements: [CollageSlot]
    var configuration: AIConfiguration
}

enum CollageRecommendationFreshness {
    static func canApply(started: CollageRecommendationVersion, current: CollageRecommendationVersion) -> Bool {
        started == current
    }
}
