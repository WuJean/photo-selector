import SwiftUI

/// Uses system division/occlusion regions on Duo; never guesses hinge angles.
struct DuoLayout<Primary: View, Secondary: View>: View {
    let primary: Primary
    let secondary: Secondary
    init(@ViewBuilder primary: () -> Primary, @ViewBuilder secondary: () -> Secondary) {
        self.primary = primary(); self.secondary = secondary()
    }
    var body: some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            ArrangementView {
                primary.splitArrangementLayoutSize(minWidth: 200, idealWidth: 600, minHeight: 180, idealHeight: 600)
            } secondary: {
                secondary.splitArrangementLayoutSize(minWidth: 220, idealWidth: 320, minHeight: 140, idealHeight: 260)
            }.arrangementViewStyle(.split)
        } else { fallback }
        #else
        fallback
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
