// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhotoSelector",
    platforms: [.macOS(.v14), .iOS(.v18)],
    products: [.library(name: "PhotoCore", type: .static, targets: ["PhotoCore"]), .executable(name: "PhotoSelector", targets: ["PhotoSelector"])],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "PhotoCore", dependencies: ["CSQLite"]),
        .executableTarget(name: "PhotoSelector", dependencies: ["PhotoCore"]),
        .executableTarget(name: "VisionWorker"),
        .executableTarget(name: "PhotoCoreTests", dependencies: ["PhotoCore"], path: "Tests/PhotoCoreTests")
    ],
    swiftLanguageModes: [.v5]
)
