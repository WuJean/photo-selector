import Foundation
import PhotoCore

enum StoreTests {
    static func testPersistsAndReplacesDocumentsAcrossConnections() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("test.sqlite")
        do {
            let store = try ProjectStore(url: url)
            try expect(store.load([String].self, id: "旅行") == nil)
            try store.save(["雪山", "人像"], id: "旅行")
            try store.save(["雪山", "近景", "远景"], id: "旅行")
            try store.save(["独立项目"], id: "other")
        }
        let reopened = try ProjectStore(url: url)
        try equal(try reopened.load([String].self, id: "旅行"), ["雪山", "近景", "远景"])
        try equal(try reopened.load([String].self, id: "other"), ["独立项目"])
    }
}
