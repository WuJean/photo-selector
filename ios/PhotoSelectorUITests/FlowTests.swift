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
    /// Rotates and waits until the window really is landscape.
    ///
    /// The framebuffer keeps the old size for a moment after the rotation, so
    /// a picture taken right away shows the portrait layout turned sideways.
    private func rotateToLandscape() {
        XCUIDevice.shared.orientation = .landscapeLeft
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            let frame = app.windows.firstMatch.frame
            if frame.width > frame.height { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        // Let the last layout pass and the framebuffer update finish before
        // the picture is taken.
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
    }
    func testEmptyOnboardingCreatesBatchAndOffersSources() {
        app.terminate()
        app.launchEnvironment["PHOTO_SELECTOR_UI_TEST"] = UUID().uuidString
        app.launchEnvironment["PHOTO_SELECTOR_UI_EMPTY"] = "1"
        app.launch()
        let start = app.buttons["开始整理照片"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        screenshot("首次打开引导")
        XCTAssertTrue(start.isHittable, "首次打开无需寻找隐藏的开始入口")
        assertGuideFitsWithoutScrolling()
        start.tap()
        let name = app.alerts.textFields["旅行名称"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap(); name.typeText("周末散步\n")
        // Depending on the keyboard, Return either commits marked text or submits the alert.
        if app.alerts.buttons["创建"].exists { app.alerts.buttons["创建"].tap() }
        XCTAssertTrue(app.navigationBars["周末散步"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["从相册读取"].isHittable)
        XCTAssertTrue(app.buttons["存储卡／文件夹"].isHittable)
        screenshot("首次导入来源")
        // Duo places navigation controls in a side rail outside NavigationBar.
        let sideBack = app.buttons["BackButton"]
        if sideBack.exists { sideBack.tap() } else { app.navigationBars.buttons.firstMatch.tap() }
        XCTAssertTrue(app.buttons["继续选片"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["开始整理照片"].exists)
        let resume = app.buttons["继续选片"]
        XCTAssertTrue(resume.isHittable)
        let resumeY = resume.frame.midY
        app.swipeUp()
        XCTAssertEqual(resume.frame.midY, resumeY, accuracy: 2, "已有批次的空时间线也不应滚动")
    }
    private func assertGuideFitsWithoutScrolling(file: StaticString = #filePath, line: UInt = #line) {
        let start = app.buttons["开始整理照片"]
        for number in 1...3 {
            let step = app.descendants(matching: .any).matching(identifier: "timeline-guide-step-\(number)").firstMatch
            XCTAssertTrue(step.exists, file: file, line: line)
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate { [self] _, _ in
                step.isHittable && app.windows.firstMatch.frame.contains(step.frame)
            }, object: step)
            XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed, "三步引导都在首屏", file: file, line: line)
        }
        XCTAssertTrue(app.windows.firstMatch.frame.contains(start.frame), file: file, line: line)
        let originalY = start.frame.midY
        app.swipeUp()
        XCTAssertEqual(start.frame.midY, originalY, accuracy: 2, "空状态无垂直滚动", file: file, line: line)
    }
    func testEmptyGuideFitsAfterRotation() {
        app.terminate()
        app.launchEnvironment["PHOTO_SELECTOR_UI_TEST"] = UUID().uuidString
        app.launchEnvironment["PHOTO_SELECTOR_UI_EMPTY"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["开始整理照片"].waitForExistence(timeout: 10))
        assertGuideFitsWithoutScrolling()
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["开始整理照片"].waitForExistence(timeout: 5))
        assertGuideFitsWithoutScrolling()
        rotateToLandscape()
        screenshot("横向一屏引导")
        app.buttons["开始整理照片"].tap()
        XCTAssertTrue(app.alerts.textFields["旅行名称"].waitForExistence(timeout: 5))
        app.alerts.buttons["取消"].tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForNonExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        assertGuideFitsWithoutScrolling()
    }
    func testExpandedTimelineOffersPhotoPreview() throws {
        let expanded = app.descendants(matching: .any).matching(identifier: "timeline-expanded").firstMatch
        guard expanded.waitForExistence(timeout: 5) else {
            throw XCTSkip("本次运行是紧凑视口；在 Duo 展开模式单独验收双栏。")
        }
        let featured = app.descendants(matching: .any).matching(identifier: "timeline-featured").firstMatch
        XCTAssertTrue(featured.exists)
        let gallery = app.buttons["查看全部照片"]
        XCTAssertTrue(gallery.isHittable)
        screenshot("Duo展开时间线与照片预览")
        gallery.tap()
        XCTAssertTrue(app.navigationBars["模拟旅行"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["智能拼图"].exists, "时间线仍然直达只读照片墙")
    }
    func testLargeTextGuideUsesButtonsWithoutScrolling() {
        app.terminate()
        app.launchEnvironment["PHOTO_SELECTOR_UI_TEST"] = UUID().uuidString
        app.launchEnvironment["PHOTO_SELECTOR_UI_EMPTY"] = "1"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["开始整理照片"].waitForExistence(timeout: 10))
        rotateToLandscape()
        let start = app.buttons["开始整理照片"]
        XCTAssertTrue(start.isHittable)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(start.frame))
        for number in 1...3 {
            let step = app.descendants(matching: .any).matching(identifier: "timeline-guide-step-\(number)").firstMatch
            XCTAssertTrue(step.isHittable)
            XCTAssertTrue(app.windows.firstMatch.frame.contains(step.frame))
            if number < 3 { app.buttons["下一步指引"].tap() }
        }
        let startY = start.frame.midY
        app.swipeUp()
        XCTAssertEqual(start.frame.midY, startY, accuracy: 2)
        screenshot("大字号横向一屏引导")
        start.tap()
        XCTAssertTrue(app.alerts.buttons["创建"].waitForExistence(timeout: 5))
        app.alerts.buttons["创建"].tap()
        XCTAssertTrue(app.buttons["从相册读取"].waitForExistence(timeout: 5))
        let sideBack = app.buttons["BackButton"]
        if sideBack.exists { sideBack.tap() } else { app.navigationBars.buttons.firstMatch.tap() }
        let resume = app.buttons["继续选片"]
        XCTAssertTrue(resume.waitForExistence(timeout: 5))
        XCTAssertTrue(app.windows.firstMatch.frame.contains(resume.frame))
        XCTAssertTrue(resume.isHittable)
    }
    func testTimelineGalleryAndRotation() {
        let trip = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch
        XCTAssertTrue(trip.waitForExistence(timeout: 10)); trip.tap()
        XCTAssertTrue(app.navigationBars["模拟旅行"].waitForExistence(timeout: 5)); screenshot("作品集照片墙")
        rotateToLandscape(); screenshot("展开横向照片墙")
    }
    func testCoarseDecisionUndoAndFine() {
        app.buttons["导入与选片"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        let photo = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()
        XCTAssertTrue(app.buttons["保留"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["上一张"].exists)
        XCTAssertFalse(app.buttons["下一张"].exists)
        let canvas = app.otherElements["immersive-canvas"]
        XCTAssertTrue(canvas.exists)
        canvas.pinch(withScale: 2, velocity: 1)
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).press(forDuration: 0.15, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)))
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片0.jpg", "放大后拖动只平移照片")
        canvas.doubleTap()
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).press(forDuration: 0.15, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)))
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片1.jpg")
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).press(forDuration: 0.15, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片0.jpg")
        app.buttons["保留"].tap()
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片1.jpg")
        app.buttons["撤销"].tap()
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片0.jpg")
        app.buttons["保留"].tap()
        for index in 1...5 {
            XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片\(index).jpg")
            app.buttons["待定"].tap()
        }
        XCTAssertTrue(app.staticTexts["当前范围已完成"].exists)
        app.buttons["撤销"].tap()
        XCTAssertEqual(app.staticTexts["current-photo"].label, "测试照片5.jpg")
        app.buttons["关闭"].tap()
        app.buttons["精筛"].tap(); app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch.tap()
        XCTAssertFalse(app.buttons["待定"].exists); XCTAssertTrue(app.buttons["保留"].exists)
        XCTAssertFalse(app.buttons["上一张"].exists)
        XCTAssertFalse(app.buttons["下一张"].exists)
        screenshot("精筛二选")
    }
    func testTagFilterClearsBulkSelection() {
        app.buttons["导入与选片"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        app.buttons["选择"].tap()
        app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch.tap()
        XCTAssertTrue(app.buttons["保留"].exists)
        app.buttons["筛选"].tap()
        app.buttons["主体"].tap(); app.buttons["人像"].tap(); app.buttons["完成"].tap()
        XCTAssertFalse(app.buttons["保留"].exists)
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch.exists)
    }
    func testPortfolioUsesCompactTabsAndKeepsCandidateSelection() {
        app.buttons["作品集"].tap()
        XCTAssertTrue(app.buttons["我的作品"].exists)
        XCTAssertTrue(app.buttons["待归集"].exists)
        XCTAssertFalse(app.staticTexts["把照片编成故事"].exists)
        screenshot("简洁作品集")
        app.buttons["待归集"].tap()
        app.switches["全部"].tap()
        let candidate = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "测试照片6.jpg")).firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 5)); candidate.tap()
        let add = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "加入作品集")).firstMatch
        XCTAssertTrue(add.exists)
        app.buttons["我的作品"].tap()
        XCTAssertFalse(add.exists, "切换页签清空批量选择")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        XCTAssertTrue(app.buttons["智能拼图"].exists)
        XCTAssertTrue(app.buttons["生成文案"].exists)
        screenshot("简洁作品详情")
        app.buttons["创作"].tap()
        XCTAssertTrue(app.staticTexts["暂无创作"].exists)
        app.buttons["照片"].tap()
        XCTAssertTrue(candidate.exists)
        app.buttons["更多"].tap()
        app.buttons["查看照片墙"].tap()
        XCTAssertFalse(app.buttons["智能拼图"].exists)
    }
    func testCollageAndSettings() {
        app.buttons["作品集"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        app.buttons["智能拼图"].tap()
        XCTAssertTrue(app.buttons["随机组合"].waitForExistence(timeout: 5))
        app.buttons["随机组合"].tap()
        app.buttons["保存"].tap()
        XCTAssertTrue(app.staticTexts["已保存到作品集创作"].waitForExistence(timeout: 20))
        screenshot("拼图编辑")
    }
}
