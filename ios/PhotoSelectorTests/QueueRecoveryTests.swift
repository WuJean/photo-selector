import XCTest
import UIKit
import PhotoCore
@testable import PhotoSelector

@MainActor
final class QueueRecoveryTests: XCTestCase {
    func testPauseAndResumeDuringImageLoadKeepsReplacementRunner() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let imageGate = AsyncGate()
        let analysisGate = AsyncGate()
        let probe = Probe()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.orange.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        let result = PhotoAnalysis(subject: "风景", distance: "远景", extras: [], description: "照片", model: "test")
        let model = try AppModel(root: root, loadImage: { _, _, _ in
            probe.loadCount += 1
            if probe.loadCount == 1 {
                await imageGate.suspend()
                probe.firstLoadReturned = true
            }
            return image
        }, analyzeImage: { _, _, _, _ in
            probe.analysisCount += 1
            if probe.analysisCount == 1 { await analysisGate.suspend() }
            return result
        }, analysisReadiness: { _, _ in true })
        model.aiConfig = AIConfiguration(remoteEnabled: true, baseURL: "https://mock.invalid/v1", model: "injected-test")
        let asset = LocalAsset(source: .owned, sourceID: "race", name: "race.jpg")
        try seed(model, assets: [asset])

        model.runAnalysis()
        await imageGate.waitUntilEntered()
        model.setTasks(.paused)
        model.setTasks(.waiting)
        await analysisGate.waitUntilEntered()

        imageGate.release()
        let oldLoadReturned = await eventually { probe.firstLoadReturned }
        XCTAssertTrue(oldLoadReturned)
        // Let the cancelled runner resume and run its defer while the replacement
        // is still suspended inside analysis.
        try await Task.sleep(for: .milliseconds(20))
        model.runAnalysis()
        await Task.yield()
        XCTAssertEqual(probe.analysisCount, 1, "the paused runner must not dispatch AI or clear its replacement")

        analysisGate.release()
        let analysisCompleted = await eventually { model.state.assets.first?.analysis != nil }
        XCTAssertTrue(analysisCompleted)
        XCTAssertEqual(model.state.tasks.first?.status, .complete)
        XCTAssertEqual(probe.loadCount, 2)
    }

    func testLateAIResponseCannotCompleteCancelledTask() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let analysisGate = AsyncGate()
        let probe = Probe()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        let result = PhotoAnalysis(subject: "风景", distance: "远景", extras: [], description: "迟到的结果", model: "test")
        let model = try AppModel(root: root, loadImage: { _, _, _ in image }, analyzeImage: { _, _, _, _ in
            probe.analysisCount += 1
            await analysisGate.suspend()
            probe.analysisReturned = true
            return result
        }, analysisReadiness: { _, _ in true })
        model.aiConfig = AIConfiguration(remoteEnabled: true, baseURL: "https://mock.invalid/v1", model: "injected-test")
        let asset = LocalAsset(source: .owned, sourceID: "late", name: "late.jpg")
        try seed(model, assets: [asset])

        model.runAnalysis()
        await analysisGate.waitUntilEntered()
        model.setTasks(.cancelled)
        analysisGate.release()

        let analysisReturned = await eventually { probe.analysisReturned }
        XCTAssertTrue(analysisReturned)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(model.state.tasks.first?.status, .cancelled)
        XCTAssertNil(model.state.assets.first?.analysis)
    }

    func testMediaPreparationDrainsNewAssetsAndDoesNotRetryFailureForever() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let firstGate = AsyncGate()
        let probe = Probe()
        let first = LocalAsset(source: .owned, sourceID: "fails", name: "fails.jpg")
        let second = LocalAsset(source: .owned, sourceID: "arrives-later", name: "later.jpg")
        let model = try AppModel(root: root, prepareAsset: { asset, _ in
            probe.prepareCount[asset.id, default: 0] += 1
            if asset.id == first.id {
                await firstGate.suspend()
                throw ExpectedFailure.failed
            }
            var prepared = asset
            prepared.previewPath = "previews/\(asset.id).jpg"
            return prepared
        })
        let batchID = try model.createBatch("测试")
        try model.register([first], batchID: batchID)
        model.startMediaPreparation()
        await firstGate.waitUntilEntered()

        try model.register([second], batchID: batchID)
        model.startMediaPreparation()
        firstGate.release()

        let newAssetStarted = await eventually(timeout: 5) { probe.prepareCount[second.id] == 1 }
        XCTAssertTrue(newAssetStarted, "the active preparation runner should pick up an asset registered while it was suspended")
        let newAssetPrepared = await eventually(timeout: 5) { model.state.assets.first(where: { $0.id == second.id })?.previewPath != nil }
        XCTAssertTrue(newAssetPrepared)
        let drainFinished = await eventually(timeout: 5) { model.progress.isEmpty }
        XCTAssertTrue(drainFinished, "the preparation runner should clear progress after draining queued work")
        XCTAssertEqual(probe.prepareCount[first.id], 1, "a failed item is attempted only once in this drain")
        XCTAssertEqual(probe.prepareCount[second.id], 1, "assets appended during preparation are drained")
        XCTAssertNil(model.state.assets.first(where: { $0.id == first.id })?.previewPath)
    }

    func testLaunchResumesMissingPreviewsWithoutResumingPausedAnalysis() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try LocalLibrary(url: root.appendingPathComponent("library.sqlite"))
        let asset = LocalAsset(source: .owned, sourceID: "missing-preview", name: "missing.jpg")
        let batch = ImportBatch(name: "测试")
        var photo = BatchPhoto(asset.id); photo.coarse = .keep
        var seededBatch = batch; seededBatch.photos = [photo]
        var task = AnalysisTask(asset.id, tags: LibraryTag.defaults); task.status = .paused
        try library.transaction { state in state.assets = [asset]; state.batches = [seededBatch]; state.tasks = [task] }

        let probe = Probe()
        let model = try AppModel(root: root, prepareAsset: { input, _ in
            probe.prepareCount[input.id, default: 0] += 1
            var prepared = input
            prepared.previewPath = "previews/\(input.id).jpg"
            return prepared
        })
        model.resumed()

        let previewResumed = await eventually { model.state.assets.first?.previewPath != nil && model.progress.isEmpty }
        XCTAssertTrue(previewResumed)
        XCTAssertEqual(probe.prepareCount[asset.id], 1)
        XCTAssertEqual(model.state.tasks.first?.status, .paused, "launch must preserve an explicitly paused task")
    }

    func testRegisterReusesReferencesWithoutDuplicatingBatchEntries() throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = try AppModel(root: root)
        let firstBatch = try model.createBatch("一")
        let secondBatch = try model.createBatch("二")
        let original = LocalAsset(source: .photos, sourceID: "stable-id", name: "a.heic")
        let same = LocalAsset(source: .photos, sourceID: "stable-id", name: "a.heic")
        try model.register([original, same], batchID: firstBatch)
        try model.register([same], batchID: secondBatch)
        XCTAssertEqual(model.state.assets.count, 1)
        XCTAssertEqual(model.state.batches.map { $0.photos.map(\.assetID) }, [[original.id], [original.id]])
    }

    func testPhotoReferencesPrepareWithoutPreviewAndDoNotRepeatAfterRestart() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let probe = Probe()
        let photo = LocalAsset(source: .photos, sourceID: "local-photo", name: "photo.heic")
        let cloud = LocalAsset(source: .photos, sourceID: "cloud-photo", name: "cloud.heic")
        let model = try AppModel(root: root, prepareAsset: { input, network in
            XCTAssertFalse(network, "background grouping never downloads iCloud originals")
            probe.prepareCount[input.id, default: 0] += 1
            if input.id == cloud.id { throw ExpectedFailure.failed }
            var result = input; result.perceptualHash = 42
            return result
        })
        model.allowCloudDownload = true
        let batch = try model.createBatch("图库引用")
        try model.register([photo, cloud], batchID: batch)
        XCTAssertEqual(model.state.assets.count, 2)
        XCTAssertTrue(probe.prepareCount.isEmpty, "registration does no decoding/compression")
        model.startMediaPreparation()
        let completed = await eventually { probe.prepareCount[cloud.id] == 1 && !model.groups.isEmpty }
        XCTAssertTrue(completed)
        XCTAssertNil(model.error, "missing cloud cache must not become an import error")
        XCTAssertNil(model.state.assets.first?.previewPath)
        XCTAssertNil(model.state.assets.first?.ownedPath)
        let reloaded = try AppModel(root: root)
        XCTAssertFalse(AppModel.needsMediaPreparation(try XCTUnwrap(reloaded.state.assets.first)))
        XCTAssertTrue(AppModel.needsMediaPreparation(try XCTUnwrap(reloaded.state.assets.last)))
        XCTAssertEqual(probe.prepareCount[photo.id], 1)
    }

    private func seed(_ model: AppModel, assets: [LocalAsset]) throws {
        try model.change { state in
            state.assets = assets
            var batch = ImportBatch(name: "测试")
            batch.photos = assets.map { asset in
                var photo = BatchPhoto(asset.id); photo.coarse = .keep
                return photo
            }
            state.batches = [batch]
            state.reconcileTasks()
        }
    }

    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func eventually(timeout: TimeInterval = 1, _ condition: @MainActor () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }
}

@MainActor
private final class AsyncGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var isEntered = false
    private var releaseRequested = false

    func suspend() async {
        isEntered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation in
            if releaseRequested { continuation.resume() }
            else { self.continuation = continuation }
        }
    }

    func waitUntilEntered() async {
        if isEntered { return }
        await withCheckedContinuation { enteredContinuation = $0 }
    }

    func release() {
        releaseRequested = true
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class Probe {
    var loadCount = 0
    var firstLoadReturned = false
    var analysisCount = 0
    var analysisReturned = false
    var prepareCount: [String: Int] = [:]
}

private enum ExpectedFailure: Error { case failed }
