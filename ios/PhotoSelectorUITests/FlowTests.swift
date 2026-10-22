import XCTest

final class FlowTests: XCTestCase {
    var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication(); app.launchEnvironment["PHOTO_SELECTOR_UI_TEST"] = UUID().uuidString
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
    }
    override func tearDown() { XCUIDevice.shared.orientation = .portrait; app.terminate() }
    func screenshot(_ name: String) { let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
    func testTimelineGalleryAndRotation() {
        let trip = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch
        XCTAssertTrue(trip.waitForExistence(timeout: 10)); trip.tap()
        XCTAssertTrue(app.navigationBars["模拟旅行"].waitForExistence(timeout: 5)); screenshot("作品集照片墙")
        XCUIDevice.shared.orientation = .landscapeLeft; screenshot("展开横向照片墙")
    }
    func testCoarseDecisionUndoAndFine() {
        app.buttons["导入与选片"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        let photo = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        XCTAssertTrue(app.buttons["保留"].waitForExistence(timeout: 5))
        app.buttons["保留"].tap()
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片1.jpg")
        app.buttons["撤销"].tap()
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片0.jpg")
        app.buttons["保留"].tap(); app.buttons["关闭"].tap()
        app.buttons["精筛"].tap(); app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch.tap()
        XCTAssertFalse(app.buttons["待定"].exists); XCTAssertTrue(app.buttons["保留"].exists)
        screenshot("精筛二选")
    }
    func testCollageAndSettings() {
        app.buttons["作品集"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        app.buttons["智能拼图"].tap()
        XCTAssertTrue(app.buttons["随机组合"].waitForExistence(timeout: 5))
        app.buttons["随机组合"].tap(); screenshot("拼图编辑")
        app.buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["已保存到作品集创作"].waitForExistence(timeout: 20))
    }
}
