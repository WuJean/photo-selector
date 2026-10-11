import SwiftUI
import PhotoCore

@main
struct PhotoSelectorApp: App {
    var body: some Scene {
        WindowGroup("选片助手") {
            VStack(spacing: 18) {
                Image(systemName: "square.stack.3d.up.fill").font(.system(size: 56)).foregroundStyle(.mint)
                Text("选片助手").font(.largeTitle.bold())
                Text("让旅行里的好照片，走到一起。").foregroundStyle(.secondary)
            }.frame(minWidth: 1080, minHeight: 720).preferredColorScheme(.dark)
        }
    }
}
