#if DEBUG
import Foundation
import UIKit
import PhotoCore

@MainActor enum UITestFixtures {
    static func seed(_ model: AppModel) throws {
        guard model.state.assets.isEmpty else { return }
        var state = LocalLibraryState(), batch = ImportBatch(name: "模拟导入"), portfolio = Portfolio(name: "模拟旅行")
        portfolio.location = "合成测试素材"; portfolio.poem = "把光留在路上"; portfolio.description = "用于离线功能测试，不含个人照片。"
        for i in 0..<12 {
            // 第 4 张与第 3 张拍成同一组相似照片：拍在同一分钟内、感知哈希一致，
            // 这样「相似折叠」在粗筛网格里真的能看出差别，而不是两个一模一样的画面。
            // 这两张要落在粗筛（coarse 未处理）的那一批里，否则折叠根本轮不到它们。
            let twin = (i == 4)
            let format = UIGraphicsImageRendererFormat(); format.scale = 1
            let image = UIGraphicsImageRenderer(size: CGSize(width: i % 2 == 0 ? 900 : 600, height: i % 2 == 0 ? 600 : 900), format: format).image { context in
                UIColor(hue: CGFloat(twin ? 3 : i) / 12, saturation: 0.45, brightness: 0.6, alpha: 1).setFill(); context.fill(CGRect(x: 0, y: 0, width: 900, height: 900))
                UIColor.orange.setFill(); context.cgContext.fillEllipse(in: CGRect(x: 350, y: 80, width: 120, height: 120))
                UIColor.darkGray.setFill(); let path = UIBezierPath(); path.move(to: CGPoint(x: 0, y: 600)); path.addLine(to: CGPoint(x: 300, y: 200)); path.addLine(to: CGPoint(x: 900, y: 600)); path.close(); path.fill()
            }
            var asset = LocalAsset(source: .owned, sourceID: "fixture-\(i)", name: "测试照片\(i).jpg"); asset.id = "fixture-\(i)"; asset.ownedPath = "originals/fixture-\(i).jpg"; asset.previewPath = asset.ownedPath
            try image.jpegData(compressionQuality: 0.8)!.write(to: model.media.url(asset.ownedPath!))
            asset.width = Int(image.size.width); asset.height = Int(image.size.height); asset.takenAt = Date(timeIntervalSince1970: twin ? 3 * 86400 + 30 : Double(i) * 86400)
            if i == 3 || twin { asset.perceptualHash = 0xA5A5_5A5A_A5A5_A5A5 }
            asset.analysis = PhotoAnalysis(subject: i % 2 == 0 ? "风景" : "人像", distance: i % 3 == 0 ? "近景" : "远景", extras: ["自然"], description: "合成测试图，有暖色天空与几何山峰。", model: "fixture")
            state.assets.append(asset); var row = BatchPhoto(asset.id)
            if i >= 6 { row.coarse = .keep; row.fine = .keep; portfolio.assetIDs.append(asset.id) }
            batch.photos.append(row)
        }
        portfolio.coverID = portfolio.assetIDs.first; state.batches = [batch]; state.portfolios = [portfolio]
        try model.change { $0 = state }
    }
}
#endif
