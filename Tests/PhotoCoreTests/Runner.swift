import Foundation
import PhotoCore

func expect(_ expression: @autoclosure () throws -> Bool, _ message: String = "期望条件成立", file: String = #fileID, line: Int = #line) throws {
    guard try expression() else { throw PhotoError.message("\(file):\(line): \(message)") }
}
func equal<T: Equatable>(_ a: T, _ b: T, file: String = #fileID, line: Int = #line) throws {
    try expect(a == b, "\(a) ≠ \(b)", file: file, line: line)
}
func throwsError(_ action: () throws -> Void) throws {
    do { try action() } catch { return }
    throw PhotoError.message("预期抛出错误")
}

@main struct TestRunner {
    static func main() async {
        let tests: [(String, () async throws -> Void)] = [
            ("SQLite 持久化、更新、项目隔离", { try StoreTests.testPersistsAndReplacesDocumentsAcrossConnections() })
        ]
        var failures = 0
        for (name, run) in tests {
            do { try await run(); print("PASS \(name)") }
            catch { failures += 1; print("FAIL \(name): \(error)") }
        }
        print("\(tests.count - failures)/\(tests.count) tests passed")
        if failures > 0 { exit(1) }
    }
}
