import XCTest
import UIKit
import PhotoCore
@testable import PhotoSelector

final class ExportIntegrityTests: XCTestCase {
    func testChangedExternalOriginalIsRejectedByExportAndBackup() async throws {
        let fixture = try await Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }

        let expectedDigest = try XCTUnwrap(fixture.asset.digest)
        let changed = Self.jpeg(.blue)
        try changed.write(to: fixture.original)
        let temporaryExportsBefore = Self.temporaryExports()

        do {
            _ = try await fixture.media.exportOriginal(fixture.asset)
            XCTFail("Changed external source must not be exported")
        } catch {}
        XCTAssertEqual(try Data(contentsOf: fixture.original), changed, "Export must not modify the source")
        XCTAssertEqual(Self.temporaryExports(), temporaryExportsBefore, "Failed export must remove its temporary copy")

        var state = LocalLibraryState(); state.assets = [fixture.asset]
        do {
            _ = try await BackupService().export(state: state, media: fixture.media, destination: fixture.output, allowNetwork: false)
            XCTFail("Changed external source must not be backed up")
        } catch {}
        XCTAssertEqual(try Data(contentsOf: fixture.original), changed, "Backup must not modify the source")
        XCTAssertEqual(Self.temporaryExports(), temporaryExportsBefore, "Failed backup must remove temporary exports")
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.output.path).isEmpty, "Failed backup must remove its partial folder")
        XCTAssertNotEqual(try MediaStore.digest(fixture.original), expectedDigest)
    }

    func testOwnedOriginalWithChangedDigestCannotBeExported() async throws {
        let fixture = try await Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let owned = try await fixture.media.copyOriginal(fixture.asset)
        let ownedFile = try fixture.media.url(XCTUnwrap(owned.ownedPath))
        try Self.jpeg(.green).write(to: ownedFile, options: .atomic)

        do {
            _ = try await fixture.media.exportOriginal(owned)
            XCTFail("Changed owned original must not be exported")
        } catch {}

        var state = LocalLibraryState(); state.assets = [owned]
        do {
            _ = try await BackupService().export(state: state, media: fixture.media, destination: fixture.output, allowNetwork: false)
            XCTFail("Changed owned original must not be backed up")
        } catch {}
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.output.path).isEmpty)
    }

    func testHealthyExportPreservesExternalOriginalAndBackupDigest() async throws {
        let fixture = try await Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let expectedDigest = try XCTUnwrap(fixture.asset.digest)
        let temporaryExportsBefore = Self.temporaryExports()

        let exported = try await fixture.media.exportOriginal(fixture.asset)
        XCTAssertEqual(try MediaStore.digest(exported), expectedDigest)
        XCTAssertEqual(try MediaStore.digest(fixture.original), expectedDigest)
        try FileManager.default.removeItem(at: exported)

        var state = LocalLibraryState(); state.assets = [fixture.asset]
        let backup = try await BackupService().export(state: state, media: fixture.media, destination: fixture.output, allowNetwork: false)
        defer { try? FileManager.default.removeItem(at: backup) }
        let archivePath = "originals/\(fixture.asset.id).jpg"
        let archivedOriginal = backup.appendingPathComponent(archivePath)
        let manifestData = try Data(contentsOf: backup.appendingPathComponent("manifest.json"))
        let manifest = try JSONDecoder().decode(BackupService.Manifest.self, from: manifestData)

        XCTAssertEqual(try MediaStore.digest(fixture.original), expectedDigest)
        XCTAssertEqual(try MediaStore.digest(archivedOriginal), expectedDigest)
        XCTAssertEqual(manifest.checksums[archivePath], expectedDigest)
        XCTAssertEqual(manifest.state.assets.first?.digest, expectedDigest)
        XCTAssertEqual(Self.temporaryExports(), temporaryExportsBefore, "Backup must remove its temporary export after copying it")
    }

    func testRestoreRejectsInvalidPortfolioCoverWithoutChangingLibraryFiles() async throws {
        let fixture = try RestoreFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var state = LocalLibraryState()
        let asset = try fixture.addBackupAsset("asset-cover")
        state.assets = [asset]
        var portfolio = Portfolio(name: "测试")
        portfolio.assetIDs = [asset.id]
        portfolio.coverID = "missing-cover"
        state.portfolios = [portfolio]
        try fixture.writeManifest(state)

        try await assertRestoreRejectedWithoutChangingFiles(fixture, reason: "Invalid portfolio cover reference must fail")
    }

    func testRestoreRejectsInvalidCreationSourceWithoutChangingLibraryFiles() async throws {
        let fixture = try RestoreFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var state = LocalLibraryState()
        let asset = try fixture.addBackupAsset("asset-source")
        state.assets = [asset]
        let portfolio = Portfolio(name: "测试")
        state.portfolios = [portfolio]
        state.creations = [Creation(collectionID: portfolio.id, kind: "collage", title: "作品", sourceIDs: ["missing-source"])]
        try fixture.writeManifest(state)

        try await assertRestoreRejectedWithoutChangingFiles(fixture, reason: "Invalid creation source reference must fail")
    }

    func testRestoreRejectsSymlinkManifestWithoutChangingLibraryFiles() async throws {
        let fixture = try RestoreFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var state = LocalLibraryState()
        let asset = try fixture.addBackupAsset("asset-manifest")
        state.assets = [asset]
        let externalManifest = fixture.root.appendingPathComponent("outside-manifest.json")
        try fixture.writeManifest(state, to: externalManifest)
        try FileManager.default.createSymbolicLink(
            at: fixture.backup.appendingPathComponent("manifest.json"),
            withDestinationURL: externalManifest
        )

        try await assertRestoreRejectedWithoutChangingFiles(fixture, reason: "Symlink manifest must fail")
    }

    func testRestoreRejectsStoredDigestMismatchWithoutChangingLibraryFiles() async throws {
        let fixture = try RestoreFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var state = LocalLibraryState()
        var asset = try fixture.addBackupAsset("asset-digest")
        asset.digest = "incorrect-digest"
        state.assets = [asset]
        try fixture.writeManifest(state)

        try await assertRestoreRejectedWithoutChangingFiles(fixture, reason: "Stored asset digest mismatch must fail")
    }

    func testRestoreRollsBackFilesCopiedBeforeLaterDigestMismatch() async throws {
        let fixture = try RestoreFixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        var state = LocalLibraryState()
        let firstAsset = try fixture.addBackupAsset("asset-first")
        var secondAsset = try fixture.addBackupAsset("asset-second")
        secondAsset.digest = "incorrect-digest"
        state.assets = [firstAsset, secondAsset]
        try fixture.writeManifest(state)

        try await assertRestoreRejectedWithoutChangingFiles(fixture, reason: "Later digest mismatch must fail")
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: fixture.libraryRoot.appendingPathComponent("staging").path).isEmpty, "Failed restore must remove its staging directory")
    }

    private func assertRestoreRejectedWithoutChangingFiles(_ fixture: RestoreFixture, reason: String) async throws {
        let before = try fixture.libraryFiles()
        do {
            _ = try await BackupService().restore(folder: fixture.backup, media: fixture.media)
            XCTFail(reason)
        } catch {}
        XCTAssertEqual(try fixture.libraryFiles(), before, "Rejected restore must preserve existing library files")
    }

    private struct Fixture {
        let root: URL
        let original: URL
        let output: URL
        let media: MediaStore
        let asset: LocalAsset

        init() async throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let input = root.appendingPathComponent("card", isDirectory: true)
            output = root.appendingPathComponent("backups", isDirectory: true)
            try FileManager.default.createDirectory(at: input, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            original = input.appendingPathComponent("sample.jpg")
            try ExportIntegrityTests.jpeg(.orange).write(to: original)
            media = try MediaStore(root: root.appendingPathComponent("library", isDirectory: true))
            let found = try await media.externalAssets(input)
            asset = try await media.prepare(XCTUnwrap(found.first))
        }
    }

    private struct RestoreFixture {
        let root: URL
        let backup: URL
        let libraryRoot: URL
        let media: MediaStore

        init() throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            backup = root.appendingPathComponent("backup", isDirectory: true)
            libraryRoot = root.appendingPathComponent("library", isDirectory: true)
            try FileManager.default.createDirectory(at: backup, withIntermediateDirectories: true)
            media = try MediaStore(root: libraryRoot)
            try Data("existing library file".utf8).write(to: libraryRoot.appendingPathComponent("originals/existing.marker"))
        }

        func addBackupAsset(_ id: String) throws -> LocalAsset {
            var asset = LocalAsset(source: .owned, sourceID: id, name: "\(id).jpg")
            asset.id = id
            let path = "originals/\(id).jpg"
            asset.ownedPath = path
            let file = backup.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("backup original: \(id)".utf8).write(to: file)
            asset.digest = try MediaStore.digest(file)
            return asset
        }

        func writeManifest(_ state: LocalLibraryState, to url: URL? = nil) throws {
            let checksums = Dictionary(uniqueKeysWithValues: try state.assets.map { asset in
                let path = try XCTUnwrap(asset.ownedPath)
                return (path, try MediaStore.digest(backup.appendingPathComponent(path)))
            })
            let manifest = BackupService.Manifest(state: state, checksums: checksums)
            try JSONEncoder().encode(manifest).write(to: url ?? backup.appendingPathComponent("manifest.json"), options: .atomic)
        }

        func libraryFiles() throws -> [String: String] {
            let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: libraryRoot, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]))
            var result: [String: String] = [:]
            for case let file as URL in enumerator {
                let values = try file.resourceValues(forKeys: [.isRegularFileKey])
                guard values.isRegularFile == true else { continue }
                let relative = String(file.path.dropFirst(libraryRoot.path.count + 1))
                result[relative] = try MediaStore.digest(file)
            }
            return result
        }
    }

    fileprivate static func jpeg(_ color: UIColor) -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 80, height: 80)).jpegData(withCompressionQuality: 0.9) { context in
            color.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 80, height: 80))
        }
    }

    private static func temporaryExports() -> Set<String> {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: FileManager.default.temporaryDirectory.path)) ?? []
        return Set(names.filter { $0.hasPrefix("PhotoSelector-export-") })
    }
}
