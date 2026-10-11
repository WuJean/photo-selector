import Foundation
import CSQLite

public enum PhotoError: LocalizedError {
    case message(String)
    public var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

/// All mutations are atomic SQLite transactions. This connection is serialized by a lock.
public final class ProjectStore {
    private var db: OpaquePointer?
    private let lock = NSLock()
    public init(url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw PhotoError.message("无法打开项目数据库") }
        sqlite3_busy_timeout(db, 5000)
        try execute("PRAGMA journal_mode=WAL;")
        try execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body BLOB NOT NULL, updated REAL NOT NULL);")
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw error() }
    }
    private func error() -> PhotoError { .message(String(cString: sqlite3_errmsg(db))) }
    public func save<T: Encodable>(_ value: T, id: String) throws {
        let data = try JSONEncoder().encode(value)
        lock.lock(); defer { lock.unlock() }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT INTO documents VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated=excluded.updated", -1, &statement, nil) == SQLITE_OK else { throw error() }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, id, -1, transient)
        _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), transient) }
        sqlite3_bind_double(statement, 3, Date().timeIntervalSince1970)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw error() }
    }
    public func load<T: Decodable>(_ type: T.Type, id: String) throws -> T? {
        lock.lock(); defer { lock.unlock() }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT body FROM documents WHERE id=?", -1, &statement, nil) == SQLITE_OK else { throw error() }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, id, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        let result = sqlite3_step(statement)
        if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw error() }
        let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
        return try JSONDecoder().decode(type, from: data)
    }
}

public enum AppPaths {
    public static var root: URL {
        if let override = ProcessInfo.processInfo.environment["PHOTO_SELECTOR_DATA_DIR"] { return URL(fileURLWithPath: override) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PhotoSelector", isDirectory: true)
    }
}
