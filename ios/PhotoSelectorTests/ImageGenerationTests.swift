import XCTest
import UIKit
@testable import PhotoSelector

/// Serves canned replies so the image-generation request can be inspected
/// without a network or a key.
final class ImageEndpointStub: URLProtocol {
    struct Reply { var status = 200; var body = Data(); var headers: [String: String] = [:] }
    static var replies: [String: Reply] = [:]
    static var captured: [(url: String, method: String, body: Data, headers: [String: String])] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        Self.captured.append((path, request.httpMethod ?? "GET", Self.body(of: request), request.allHTTPHeaderFields ?? [:]))
        guard let reply = Self.replies[path] else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: 4096)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        stream.close()
        return data
    }

    static func reset() { replies = [:]; captured = [] }
}

/// Pins the wire format of the image-generation client.
final class ImageGenerationTests: XCTestCase {
    private func configuration() -> AIConfiguration {
        AIConfiguration(imageEnabled: true, imageBaseURL: "https://images.example.com/v1", imageModel: "image-model", imageSize: "1024x1024")
    }

    private func sampleBase64() -> String {
        // A fixed scale keeps the sample at 8 x 8 pixels, so the decoded size
        // can be asserted exactly.
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8), format: format).image { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        return image.pngData()!.base64EncodedString()
    }

    private func client() -> ImageGeneration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ImageEndpointStub.self]
        return ImageGeneration(configuration: configuration)
    }

    override func tearDown() { ImageEndpointStub.reset(); super.tearDown() }

    /// A generated image comes back as a real image and the request names the
    /// configured model.
    func testGenerationDecodesTheReturnedImage() async throws {
        let payload = #"{"data":[{"b64_json":"\#(sampleBase64())"}]}"#.data(using: .utf8)!
        ImageEndpointStub.replies["/v1/images/generations"] = ImageEndpointStub.Reply(status: 200, body: payload)
        let result = try await client().generate(prompt: "抽象渐变", reference: nil, size: "1024x1024", config: configuration(), key: "secret")
        XCTAssertEqual(result.image.size.width, 8)
        XCTAssertEqual(result.image.size.height, 8)
        let request = try XCTUnwrap(ImageEndpointStub.captured.first { $0.url == "/v1/images/generations" })
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.headers["Authorization"], "Bearer secret")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: Any])
        XCTAssertEqual(body["model"] as? String, "image-model")
        XCTAssertEqual(body["prompt"] as? String, "抽象渐变")
        XCTAssertEqual(body["n"] as? Int, 1, "一次只能请求一张图")
    }

    /// A service without an edit endpoint still works: the client falls back
    /// to plain generation instead of failing.
    func testMissingEditEndpointFallsBackToGeneration() async throws {
        ImageEndpointStub.replies["/v1/images/edits"] = ImageEndpointStub.Reply(status: 404, body: Data("no edits".utf8))
        let payload = #"{"data":[{"b64_json":"\#(sampleBase64())"}]}"#.data(using: .utf8)!
        ImageEndpointStub.replies["/v1/images/generations"] = ImageEndpointStub.Reply(status: 200, body: payload)
        let reference = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        let result = try await client().generate(prompt: "抽象渐变", reference: reference, size: "1024x1024", config: configuration(), key: "secret")
        XCTAssertEqual(result.image.size.width, 8)
        XCTAssertTrue(ImageEndpointStub.captured.contains { $0.url == "/v1/images/generations" })
    }

    /// An edit request carries the reference photograph so the artwork stays
    /// tied to that one picture.
    func testEditRequestCarriesTheReferenceImage() async throws {
        let payload = #"{"data":[{"b64_json":"\#(sampleBase64())"}]}"#.data(using: .utf8)!
        ImageEndpointStub.replies["/v1/images/edits"] = ImageEndpointStub.Reply(status: 200, body: payload)
        let reference = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        _ = try await client().generate(prompt: "抽象渐变", reference: reference, size: "1024x1024", config: configuration(), key: "secret")
        let request = try XCTUnwrap(ImageEndpointStub.captured.first { $0.url == "/v1/images/edits" })
        let body = String(decoding: request.body, as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"image\""), "编辑请求必须带上参考图")
        XCTAssertTrue(body.contains("name=\"model\""))
        XCTAssertTrue(body.contains("image-model"))
    }

    /// A rejected key is reported as such and never as a generic failure.
    func testUnauthorizedIsReportedSeparately() async throws {
        ImageEndpointStub.replies["/v1/images/generations"] = ImageEndpointStub.Reply(status: 401, body: Data())
        do {
            _ = try await client().generate(prompt: "抽象渐变", reference: nil, size: "1024x1024", config: configuration(), key: "secret")
            XCTFail("应当抛出鉴权失败")
        } catch let failure as ImageGeneration.Failure {
            guard case .unauthorized = failure else { return XCTFail("错误类型不对：\(failure)") }
        }
    }

    /// Rate limiting keeps the retry delay.
    func testThrottlingKeepsTheRetryDelay() async throws {
        ImageEndpointStub.replies["/v1/images/generations"] = ImageEndpointStub.Reply(status: 429, body: Data(), headers: ["Retry-After": "42"])
        do {
            _ = try await client().generate(prompt: "抽象渐变", reference: nil, size: "1024x1024", config: configuration(), key: "secret")
            XCTFail("应当抛出限流")
        } catch let failure as ImageGeneration.Failure {
            guard case .throttled(let seconds) = failure else { return XCTFail("错误类型不对：\(failure)") }
            XCTAssertEqual(seconds, 42)
        }
    }

    /// Without a configured model the client refuses instead of calling out.
    func testMissingConfigurationIsRefusedBeforeAnyRequest() async throws {
        var config = configuration()
        config.imageEnabled = false
        do {
            _ = try await client().generate(prompt: "抽象渐变", reference: nil, size: "1024x1024", config: config, key: "secret")
            XCTFail("应当拒绝未配置的服务")
        } catch let failure as ImageGeneration.Failure {
            guard case .notConfigured = failure else { return XCTFail("错误类型不对：\(failure)") }
        }
        XCTAssertTrue(ImageEndpointStub.captured.isEmpty, "未配置时不应发出任何请求")
    }
}
