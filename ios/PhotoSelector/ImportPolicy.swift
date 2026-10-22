import Foundation

/// Limits that keep a single import predictable on a phone.
///
/// Importing hundreds of photos at once used to register everything and then
/// generate every preview one by one, which felt frozen for minutes. The cap
/// keeps one batch small enough to finish quickly; the remainder stays in the
/// system library and can be imported in a second batch.
enum ImportPolicy {
    /// Maximum number of photos registered by one import action.
    static let maxPhotosPerImport = 200

    /// How many previews are compressed at the same time.
    ///
    /// Vision feature prints and JPEG encoding are CPU bound, so a small
    /// window still gives real parallelism while leaving the main thread and
    /// the thermal budget alone.
    static let previewConcurrency = 4

    /// How many prepared photos are written back to the library at once.
    ///
    /// The library is stored as one encoded document, so every write rewrites
    /// everything. Batching turns one rewrite per photo into one rewrite per
    /// batch.
    static let previewWriteBatch = 25

    /// Human readable description of the cap, reused by the import screens.
    static var limitDescription: String { "单次最多导入 \(maxPhotosPerImport) 张" }
}
