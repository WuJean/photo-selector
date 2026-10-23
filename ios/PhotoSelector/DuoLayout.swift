import SwiftUI

/// Uses system division/occlusion regions on Duo; never guesses hinge angles.
///
/// When the device folds, the crease is covered by a soft gradient so the two
/// halves read as one continuous surface instead of a hard cut.
struct DuoLayout<Primary: View, Secondary: View>: View {
    let primary: Primary
    let secondary: Secondary
    /// Hinge state used for the crease gradient. When nil the layout renders
    /// without it, which keeps the view usable on devices without a hinge.
    var hinge: HingeState?

    /// `hinge` comes first so the call sites can keep using trailing closures.
    init(hinge: HingeState? = nil, @ViewBuilder primary: () -> Primary, @ViewBuilder secondary: () -> Secondary) {
        self.primary = primary(); self.secondary = secondary(); self.hinge = hinge
    }

    var body: some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            ArrangementView {
                primary.splitArrangementLayoutSize(minWidth: 200, idealWidth: 600, minHeight: 180, idealHeight: 600)
            } secondary: {
                secondary.splitArrangementLayoutSize(minWidth: 220, idealWidth: 320, minHeight: 140, idealHeight: 260)
            }.arrangementViewStyle(.split)
            .modifier(HingeObserver(state: hinge))
            .overlay { creaseGradient }
        } else { fallback }
        #else
        fallback
        #endif
    }

    @ViewBuilder
    private var creaseGradient: some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            GeometryReader { proxy in
                FoldGradientOverlay(
                    bands: proxy.reservedRegions(kind: .occlusion).filter(\.isActive).map(\.frame),
                    intensity: hinge?.posture.foldIntensity ?? 0
                )
            }
        }
        #endif
    }

    private var fallback: some View {
            GeometryReader { geometry in
                if geometry.size.width >= 700 {
                    HStack(spacing: 12) { primary.frame(maxWidth: .infinity, maxHeight: .infinity); secondary.frame(width: 300) }
                } else { VStack(spacing: 8) { primary; secondary } }
            }
    }
}
