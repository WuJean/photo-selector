import Foundation
import PhotoCore
import UIKit

/// Client for OpenAI-compatible image generation endpoints.
///
/// Two shapes are supported:
/// * `images/edits` (multipart) when a reference photograph is available, so the
///   abstract artwork stays tied to that one photograph;
/// * `images/generations` (JSON) as the fallback for services that only expose
///   text-to-image.
///
/// Either endpoint may answer with a base64 payload or with a URL; both are
/// accepted. Every response is handled for one image only — the caller never
/// receives a grid, so a poster can never be built from several photographs.
actor ImageGeneration {
    private let configuration: URLSessionConfiguration
    init(configuration: URLSessionConfiguration = .ephemeral) { self.configuration = configuration }

    enum Failure: LocalizedError {
        case notConfigured
        case unauthorized
        case throttled(Int)
        case unsupported(String)
        case server(Int, String)

        var errorDescription: String? {
            switch self {
            case .notConfigured: return "尚未配置生图模型"
            case .unauthorized: return "生图服务认证失败，请检查密钥"
            case .throttled(let seconds): return "生图服务限流，请在 \(seconds) 秒后重试"
            case .unsupported(let detail): return "生图服务不支持该请求：\(detail)"
            case .server(let code, let body): return "生图服务返回 HTTP \(code)：\(body)"
            }
        }
    }

    struct Result: Sendable {
        var image: UIImage
        var endpoint: String
    }

    /// True when an image model and its key are both configured.
    static func isConfigured(config: AIConfiguration, key: String) -> Bool {
        guard config.imageEnabled, !config.imageModel.isEmpty, !key.isEmpty else { return false }
        guard let base = resolvedBase(config), base.scheme == "https", base.host != nil else { return false }
        return true
    }

    /// The prompt used for the artwork band of a poster.
    ///
    /// It describes one photograph and asks for a single abstract image, so the
    /// service never returns a grid or a collage of several photographs.
    static func posterPrompt(for asset: LocalAsset) -> String {
        let labels = asset.analysis?.labels.joined(separator: ", ") ?? ""
        let description = asset.analysis?.description ?? ""
        let detail = description.isEmpty ? labels : "\(description). \(labels)"
        return "Abstract editorial artwork for the lower half of a fine-art publication cover, derived from exactly one photograph. Photographic subject: \(detail). "
            + "Compose a single non-representational image: soft layered gradients, painterly washes and film grain in the palette of that photograph. "
            + "No text, no letters, no numbers, no faces, no recognisable objects, no borders, no collage, no grid of images, one image only."
    }

    static func resolvedBase(_ config: AIConfiguration) -> URL? {
        let raw = config.imageBaseURL.isEmpty ? config.baseURL : config.imageBaseURL
        return raw.isEmpty ? nil : URL(string: raw)
    }

    /// Generates one abstract artwork, optionally derived from a reference photo.
    func generate(prompt: String, reference: UIImage?, size: String, config: AIConfiguration, key: String) async throws -> Result {
        guard Self.isConfigured(config: config, key: key) else { throw Failure.notConfigured }
        guard let base = Self.resolvedBase(config) else { throw Failure.notConfigured }
        let endpoint = base.appendingPathComponent("images/generations")

        if let reference {
            let editEndpoint = base.appendingPathComponent("images/edits")
            do {
                return try await edit(reference: reference, prompt: prompt, size: size, endpoint: editEndpoint, config: config, key: key)
            } catch let failure as Failure {
                switch failure {
                case .unsupported:
                    break // The service has no edit endpoint; fall back to text-to-image.
                case .server(let code, _) where code == 404 || code == 405 || code == 501:
                    break
                default:
                    throw failure
                }
            }
        }
        return try await create(prompt: prompt, size: size, endpoint: endpoint, config: config, key: key)
    }

    // MARK: - Endpoints

    private func create(prompt: String, size: String, endpoint: URL, config: AIConfiguration, key: String) async throws -> Result {
        let body: [String: Any] = [
            "model": config.imageModel,
            "prompt": prompt,
            "size": size,
            "n": 1,
            "response_format": "b64_json",
        ]
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await perform(request)
        let payload = try Self.decode(data)
        let image = try await Self.image(from: payload, session: session)
        return Result(image: image, endpoint: endpoint.absoluteString)
    }

    private func edit(reference: UIImage, prompt: String, size: String, endpoint: URL, config: AIConfiguration, key: String) async throws -> Result {
        guard let data = reference.jpegData(compressionQuality: 0.92) else { throw Failure.unsupported("参考图编码失败") }
        let boundary = "poster-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        request.httpBody = multipart(boundary: boundary, fields: [
            "model": config.imageModel,
            "prompt": prompt,
            "size": size,
            "n": "1",
        ], fileField: "image", fileName: "reference.jpg", fileData: data)
        let (body, _) = try await perform(request)
        let payload = try Self.decode(body)
        let image = try await Self.image(from: payload, session: session)
        return Result(image: image, endpoint: endpoint.absoluteString)
    }

    // MARK: - Plumbing

    private var session: URLSession { URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil) }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let session = self.session
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw Failure.server(-1, "响应无效") }
        if http.statusCode == 401 || http.statusCode == 403 { throw Failure.unauthorized }
        if http.statusCode == 429 { throw Failure.throttled(Int(http.value(forHTTPHeaderField: "Retry-After") ?? "30") ?? 30) }
        guard (200..<300).contains(http.statusCode) else {
            let snippet = String(data: data.prefix(240), encoding: .utf8) ?? ""
            throw Failure.server(http.statusCode, snippet)
        }
        return (data, http)
    }

    struct Payload: Decodable {
        struct Item: Decodable {
            var b64_json: String?
            var url: String?
        }
        var data: [Item]?
    }

    static func decode(_ data: Data) throws -> Payload {
        do { return try JSONDecoder().decode(Payload.self, from: data) }
        catch { throw Failure.unsupported("返回格式无法解析") }
    }

    static func image(from payload: Payload, session: URLSession) async throws -> UIImage {
        guard let item = payload.data?.first else { throw Failure.unsupported("返回内容为空") }
        if let base64 = item.b64_json, let decoded = Data(base64Encoded: base64), let image = UIImage(data: decoded) { return image }
        if let remote = item.url, let url = URL(string: remote) {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let image = UIImage(data: data) else { throw Failure.unsupported("图片下载失败") }
            return image
        }
        throw Failure.unsupported("返回内容缺少图片")
    }

    func multipart(boundary: String, fields: [String: String], fileField: String, fileName: String, fileData: Data) -> Data {
        var body = Data()
        let newline = "\r\n"
        for (name, value) in fields {
            body.append("--\(boundary)\(newline)".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\(newline)\(newline)".data(using: .utf8)!)
            body.append("\(value)\(newline)".data(using: .utf8)!)
        }
        body.append("--\(boundary)\(newline)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(fileName)\"\(newline)".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\(newline)\(newline)".data(using: .utf8)!)
        body.append(fileData)
        body.append(newline.data(using: .utf8)!)
        body.append("--\(boundary)--\(newline)".data(using: .utf8)!)
        return body
    }
}
