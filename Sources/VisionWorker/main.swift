import Foundation
import Vision
import Security

func respond(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
}
func process(_ request: [String: Any]) throws -> [String: Any] {
    let operation = request["op"] as? String ?? "feature"
    if operation.hasPrefix("key-") {
        let account = request["account"] as? String ?? "default"
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.wujean.photo-selector.web",kSecAttrAccount as String:account]
        if operation == "key-set" {
            guard let key = request["key"] as? String, !key.isEmpty else { throw NSError(domain:"Keychain",code:1,userInfo:[NSLocalizedDescriptionKey:"密钥不能为空"]) }
            let data = Data(key.utf8)
            var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String:data] as CFDictionary)
            if status == errSecItemNotFound { var item=query;item[kSecValueData as String]=data;status=SecItemAdd(item as CFDictionary,nil) }
            guard status == errSecSuccess else { throw NSError(domain:"Keychain",code:Int(status)) }
            return ["saved":true]
        }
        if operation == "key-delete" { let status=SecItemDelete(query as CFDictionary);guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain:"Keychain",code:Int(status)) };return ["deleted":true] }
        var item=query;item[kSecReturnData as String]=true;item[kSecMatchLimit as String]=kSecMatchLimitOne
        var result:CFTypeRef?;let status=SecItemCopyMatching(item as CFDictionary,&result)
        if status == errSecItemNotFound { return ["key":NSNull()] }
        guard status == errSecSuccess, let data=result as? Data else { throw NSError(domain:"Keychain",code:Int(status)) }
        return ["key":String(data:data,encoding:.utf8) ?? ""]
    }
    guard let source=request["path"] as? String else { throw NSError(domain:"Vision",code:1) }
    let feature=VNGenerateImageFeaturePrintRequest();feature.revision=VNGenerateImageFeaturePrintRequestRevision2
    let faces=VNDetectFaceRectanglesRequest()
    try VNImageRequestHandler(url:URL(fileURLWithPath:source),options:[:]).perform([feature,faces])
    guard let observation=feature.results?.first else { throw NSError(domain:"Vision",code:2) }
    let vector:[Float]=observation.data.withUnsafeBytes { bytes in
        (0..<observation.elementCount).map { bytes.loadUnaligned(fromByteOffset:$0*MemoryLayout<Float>.size,as:Float.self) }
    }
    let boxes=(faces.results ?? []).map { face -> [String: Double] in let b=face.boundingBox;return ["x":b.minX,"y":1-b.maxY,"width":b.width,"height":b.height] }
    return ["embedding":vector,"faces":boxes,"model":"Apple Vision · revision 2"]
}
while let line=readLine() {
    autoreleasepool {
        var id=""
        do {
            guard let data=line.data(using:.utf8),let request=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw NSError(domain:"Request",code:1) }
            id=request["id"] as? String ?? ""
            var output=try process(request);output["id"]=id;respond(output)
        } catch { respond(["id":id,"error":error.localizedDescription]) }
    }
}
