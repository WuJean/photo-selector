import XCTest
@testable import PhotoSelector

final class MediaPathTests: XCTestCase {
    func testOriginalAndPreviewPathsUnderTrailingSlashRoot() throws {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: parent) }

        let root = URL(
            fileURLWithPath: parent.appendingPathComponent("library", isDirectory: true).path + "/",
            isDirectory: true
        )
        let media = try MediaStore(root: root)
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
        let aliasMedia = try MediaStore(root: canonicalRoot)

        let missingOriginal = try media.url("originals/missing.jpg")
        let preview = try media.url("previews/sample.jpg")
        XCTAssertEqual(missingOriginal.deletingLastPathComponent().lastPathComponent, "originals")
        XCTAssertEqual(missingOriginal.lastPathComponent, "missing.jpg")
        XCTAssertEqual(preview.lastPathComponent, "sample.jpg")
        XCTAssertEqual(preview.deletingLastPathComponent().lastPathComponent, "previews")

        let originalBytes = Data("missing original bytes".utf8)
        let previewBytes = Data("preview bytes".utf8)
        try originalBytes.write(to: missingOriginal)
        try previewBytes.write(to: preview)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("originals/missing.jpg")), originalBytes)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("previews/sample.jpg")), previewBytes)
        XCTAssertEqual(try Data(contentsOf: aliasMedia.url("originals/missing.jpg")), originalBytes)
        XCTAssertEqual(try Data(contentsOf: aliasMedia.url("previews/sample.jpg")), previewBytes)

        let existingPath = root.appendingPathComponent("originals/existing.jpg")
        let existingBytes = Data("existing".utf8)
        try existingBytes.write(to: existingPath)
        let existingOriginal = try media.url("originals/existing.jpg")
        XCTAssertEqual(try Data(contentsOf: existingOriginal), existingBytes)
        XCTAssertEqual(try Data(contentsOf: aliasMedia.url("originals/existing.jpg")), existingBytes)
    }

    func testParentAndSiblingTraversalAreRejected() throws {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        let media = try MediaStore(root: parent.appendingPathComponent("library", isDirectory: true))

        XCTAssertThrowsError(try media.url("../secret.jpg"))
        XCTAssertThrowsError(try media.url("../library-sibling/secret.jpg"))
        XCTAssertThrowsError(try media.url("originals/../../library-sibling/secret.jpg"))
    }

    func testSymlinkToOutsideLibraryIsRejected() throws {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        let root = parent.appendingPathComponent("library", isDirectory: true)
        let outside = parent.appendingPathComponent("library-sibling", isDirectory: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("outside".utf8).write(to: outside.appendingPathComponent("secret.jpg"))
        let media = try MediaStore(root: root)

        let directoryLink = root.appendingPathComponent("originals/escape", isDirectory: true)
        try FileManager.default.createSymbolicLink(atPath: directoryLink.path, withDestinationPath: outside.path)
        XCTAssertThrowsError(try media.url("originals/escape/new.jpg"))

        let fileLink = root.appendingPathComponent("originals/escape.jpg")
        try FileManager.default.createSymbolicLink(
            atPath: fileLink.path,
            withDestinationPath: outside.appendingPathComponent("secret.jpg").path
        )
        XCTAssertThrowsError(try media.url("originals/escape.jpg"))

        let danglingLink = root.appendingPathComponent("originals/dangling", isDirectory: true)
        try FileManager.default.createSymbolicLink(
            atPath: danglingLink.path,
            withDestinationPath: outside.appendingPathComponent("missing-directory").path
        )
        XCTAssertThrowsError(try media.url("originals/dangling/new.jpg"))
    }
}
