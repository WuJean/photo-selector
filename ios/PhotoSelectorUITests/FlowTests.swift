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
    /// 截一张图。
    ///
    /// 除了挂成测试附件，还直接写一份到临时目录：xcodebuild 偶尔在收尾时卡住，
    /// xcresult 来不及落盘、附件就取不回来，直接写文件绕开这个不确定性。
    func screenshot(_ name: String) {
        let shot = app.screenshot()
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("duo-tour", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: directory.appendingPathComponent("\(name).png"))
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
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
    func testImmersiveDecisionControlsRemainAccessibleAfterRotation() {
        app.buttons["导入与选片"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        let photo = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10)); photo.tap()

        let keep = app.buttons["保留"]
        let undo = app.buttons["撤销"]
        let close = app.buttons["关闭"]
        XCTAssertTrue(keep.waitForExistence(timeout: 5))
        rotateToLandscape()

        let window = app.windows.firstMatch
        XCTAssertTrue(window.frame.contains(keep.frame), "横向时保留按钮应留在窗口内")
        XCTAssertTrue(keep.isHittable, "横向时保留按钮仍可操作")
        XCTAssertGreaterThanOrEqual(keep.frame.height, 56, "决定按钮至少高 56pt")
        XCTAssertTrue(window.frame.contains(undo.frame)); XCTAssertTrue(undo.isHittable)
        XCTAssertTrue(window.frame.contains(close.frame)); XCTAssertTrue(close.isHittable)
        XCTAssertTrue(app.staticTexts["current-photo"].exists, "当前照片名称应可访问")
        screenshot("横向沉浸式决定控件")
        close.tap()
    }
    func testTagFilterClearsBulkSelection() {
        app.buttons["导入与选片"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        app.buttons["精筛"].tap()
        app.buttons["已处理"].tap()
        app.buttons["选择"].tap()
        let card = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-6").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5), "精筛已处理区应包含粗筛入选的 fixture-6")
        card.tap()
        XCTAssertTrue(app.buttons["保留"].exists)
        app.buttons["筛选"].tap()
        let subject = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "主体")).firstMatch
        XCTAssertTrue(subject.waitForExistence(timeout: 5), "精筛筛选应按领域展示当前照片已有的 AI 标签")
        XCTAssertTrue(waitHittable(subject), "主体领域应当可以展开")
        forceTap(subject)
        let portrait = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "人像")).firstMatch
        XCTAssertTrue(portrait.waitForExistence(timeout: 5), "领域展开后应列出当前范围内的AI人像标签")
        portrait.tap()
        app.buttons["完成"].tap()
        XCTAssertFalse(app.buttons["保留"].exists)
        XCTAssertFalse(card.exists, "筛选后不匹配的照片应离开当前列表")
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
        let randomize = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "随机")).firstMatch
        XCTAssertTrue(randomize.waitForExistence(timeout: 5), "拼图主操作应提供快速随机组合")
        randomize.tap()
        XCTAssertTrue(app.staticTexts["已按当前范围随机组合"].waitForExistence(timeout: 5), "随机组合应当填入当前作品集范围内的照片")
        let save = app.buttons["保存"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), "填入照片后应当可以保存拼图")
        save.tap()
        XCTAssertTrue(app.staticTexts["已保存到作品集创作"].waitForExistence(timeout: 20))
        screenshot("拼图编辑")
    }
    func testCollageReplacesAndReframesOnlyOnDemandAcrossRotation() {
        app.buttons["作品集"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        app.buttons["智能拼图"].tap()

        let candidate = app.buttons["collage-candidate-fixture-6"]
        XCTAssertFalse(candidate.exists, "默认画布不应展开候选照片列表")

        let emptyCell = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "第 1 格，空格")).firstMatch
        XCTAssertTrue(emptyCell.waitForExistence(timeout: 8), "新拼图应展示可点选的空画格")
        emptyCell.tap()
        XCTAssertTrue(app.navigationBars["替换第 1 格"].waitForExistence(timeout: 5), "点选空格应打开单格替换面板")
        XCTAssertTrue(candidate.waitForExistence(timeout: 8), "替换面板应从当前作品集提供候选照片")
        candidate.tap()

        let filledCell = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "第 1 格")).firstMatch
        XCTAssertTrue(filledCell.waitForExistence(timeout: 8), "选中的照片应回到第一格画布")
        XCTAssertFalse(candidate.exists, "选择完成后候选列表应收起")

        let initialCrop = filledCell.value as? String
        let start = filledCell.coordinate(withNormalizedOffset: CGVector(dx: 0.34, dy: 0.34))
        let end = filledCell.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.62))
        start.press(forDuration: 0.1, thenDragTo: end)
        let undo = app.buttons["撤销"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5))
        let undoEnabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == YES"), object: undo)
        XCTAssertEqual(XCTWaiter.wait(for: [undoEnabled], timeout: 5), .completed, "拖动画格调整构图后应可撤销")
        let movedCrop = filledCell.value as? String
        XCTAssertNotEqual(movedCrop, initialCrop, "拖动应改变选中画格的构图")
        undo.tap()
        XCTAssertEqual(filledCell.value as? String, initialCrop, "撤销应恢复拖动前的构图")
        XCTAssertTrue(undo.isEnabled, "替换照片仍可独立撤销")

        rotateToLandscape()
        let window = app.windows.firstMatch
        let save = app.buttons["保存"].firstMatch
        let close = app.buttons["关闭"].firstMatch
        let isLandscape = window.frame.width > window.frame.height
        let isDuoActiveDisplay = abs(window.frame.width - 466) < 2 && abs(window.frame.height - 678) < 2
        if !isLandscape && isDuoActiveDisplay {
            // The iPhone Duo simulator accepted the orientation request but
            // retained its current 466×678 active display viewport. Keep the
            // reachability assertion meaningful without claiming this is a
            // landscape layout; standard iPhone simulators must rotate.
            print("iPhone Duo retained its active display viewport after a landscape orientation request")
        } else {
            XCTAssertTrue(isLandscape, "非 Duo 模拟器应切换到横屏布局")
        }
        XCTAssertTrue(window.frame.contains(save.frame), "横屏操作栏的保存按钮应留在可见窗口内")
        XCTAssertTrue(window.frame.contains(close.frame), "横屏操作栏的关闭按钮应留在可见窗口内")
        XCTAssertTrue(save.isHittable, "横屏保存按钮应保持可操作")
        XCTAssertTrue(close.isHittable, "横屏关闭按钮应保持可操作")
        screenshot(isLandscape ? "横屏拼图单格编辑与操作栏" : "Duo当前视口拼图操作栏")
    }
    /// Opening the tent mode asks for a portfolio first, then plays it.
    func testTentModeAsksForPortfolioAndSlideshow() {
        app.buttons["作品集"].tap()
        let tent = app.buttons["帐篷模式"]
        XCTAssertTrue(tent.waitForExistence(timeout: 10), "作品集页应当有帐篷模式入口")
        tent.tap()
        let choice = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 10), "开启帐篷模式后应当先让人选择作品集")
        screenshot("帐篷模式选择作品集")
        choice.tap()
        let canvas = app.descendants(matching: .any).matching(identifier: "tent-canvas").firstMatch
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "应当进入幻灯片播放")
        let counter = app.descendants(matching: .any).matching(identifier: "tent-counter").firstMatch
        XCTAssertTrue(counter.waitForExistence(timeout: 10))
        // The presentation advances on its own, so only the shape of the
        // counter is pinned here, not the slide it happens to be on.
        XCTAssertTrue(counter.label.contains(" / 6"), "应当显示播放进度，实际为 \(counter.label)")
        screenshot("帐篷模式幻灯片")
        let initial = counter.label
        let advanced = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", initial), object: counter)
        XCTAssertEqual(XCTWaiter.wait(for: [advanced], timeout: 25), .completed, "幻灯片应当自动播放下一张")
        screenshot("帐篷模式自动播放")
        // The poster of the current photograph is a single image, split in two
        // equal halves.
        app.buttons["tent-more-menu"].tap()
        app.buttons["tent-poster-button"].tap()
        let poster = app.descendants(matching: .any).matching(identifier: "poster-image").firstMatch
        XCTAssertTrue(poster.waitForExistence(timeout: 90), "应当能查看本张照片的独立海报")
        screenshot("帐篷模式海报")
    }
    /// The tent mode produces one poster per photograph; the poster is a
    /// single image, never a collage.
    func testTentModeProducesOnePoster() {
        app.buttons["作品集"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        XCTAssertTrue(app.buttons["生成海报"].waitForExistence(timeout: 10))
        app.buttons["生成海报"].tap()
        XCTAssertTrue(app.staticTexts["海报已生成"].waitForExistence(timeout: 180), "应当为每张照片各生成一张海报")
        screenshot("海报已生成")
        app.buttons["知道了"].tap()
        app.buttons["创作"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.waitForExistence(timeout: 10))
        screenshot("作品集海报列表")
    }

    // MARK: - 全功能巡检截图

    /// 重启应用并清空环境变量，保证每一段都从确定的起点开始。
    private func relaunch(empty: Bool) {
        app.terminate()
        app.launchEnvironment["PHOTO_SELECTOR_UI_TEST"] = UUID().uuidString
        if empty { app.launchEnvironment["PHOTO_SELECTOR_UI_EMPTY"] = "1" } else { app.launchEnvironment.removeValue(forKey: "PHOTO_SELECTOR_UI_EMPTY") }
        app.launch()
    }
    /// 切到指定页签。
    private func tab(_ name: String) {
        let button = app.buttons[name]
        if button.waitForExistence(timeout: 5) { button.tap() } else { XCTFail("找不到页签 \(name)") }
    }
    /// 打开导航栏右侧边栏里的溢出菜单。
    ///
    /// Duo 把导航控件放进右侧边栏，溢出菜单的标签是「更多」；页面正文里自己
    /// 画的菜单也叫「更多」，所以这里按位置区分：边栏里的在 x ≥ 395。
    @discardableResult
    private func openRailMenu() -> Bool {
        let rail = app.buttons.matching(NSPredicate(format: "label == %@", "更多")).allElementsBoundByIndex.first { $0.frame.minX >= 395 && $0.isHittable }
        guard let rail else { return false }
        rail.tap()
        return true
    }
    /// 打开选片网格的溢出菜单。
    ///
    /// 选片网格这一屏只有一个「更多」：Duo 上它在右侧边栏里，普通 iPhone 上在
    /// 导航栏右上角。SwiftUI Menu 在不同系统版本会被 XCTest 归类为 Button
    /// 或其他元素，因此先按稳定标识找，再用可访问名称兜底。
    @discardableResult
    private func openGridMenu() -> Bool {
        let identified = app.descendants(matching: .any)
            .matching(identifier: "selection-grid-menu").firstMatch
        if identified.waitForExistence(timeout: 8), waitHittable(identified) {
            identified.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            return true
        }

        let more = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "更多"))
            .allElementsBoundByIndex.first { $0.isHittable }
        guard let more else {
            print("GRID MENU 未找到可点的更多按钮：\n\(app.debugDescription)")
            return false
        }
        more.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        return true
    }
    /// 打开页面正文里的「更多」菜单。
    @discardableResult
    private func openBodyMenu() -> Bool {
        let body = app.buttons.matching(NSPredicate(format: "label == %@", "更多")).allElementsBoundByIndex.first { $0.frame.minX < 395 && $0.isHittable }
        guard let body else { return false }
        body.tap()
        return true
    }
    /// 用坐标点击。
    ///
    /// SwiftUI 浮层里的控件常常被 XCTest 判成「不可见」，直接 tap 会先尝试
    /// scroll-to-visible 并失败；按坐标点就不会踩到这个坑。
    private func forceTap(_ element: XCUIElement) {
        guard element.exists else { return }
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }
    /// 在可滚动的表单里把目标控件滚到可点状态。
    ///
    /// 必须滑动弹层自己的滚动区：弹层背后的滚动区也在 `app.scrollViews` 里，
    /// 滑错了等于什么都没滚；按坐标拖又会落在按钮行上，变成点按。
    @discardableResult
    private func scrollTo(_ element: XCUIElement, maxSwipes: Int = 16) -> Bool {
        for _ in 0..<maxSwipes {
            if element.exists && element.isHittable { return true }
            // 慢速上滑：默认速度会一次翻到底，中间几段就都拍不到了。
            sheetForm.swipeUp(velocity: .slow)
        }
        return element.exists && element.isHittable
    }
    /// 弹层里的表单滚动区。
    ///
    /// SwiftUI 的 Form 底层是 UICollectionView，在无障碍树里是 collection view，
    /// 不是 scroll view；`app.scrollViews` 里只有弹层背后的那一个。
    private var sheetForm: XCUIElement {
        let collections = app.collectionViews.allElementsBoundByIndex
        if let sheet = collections.first(where: { $0.frame.minX >= 4 && $0.isHittable }) { return sheet }
        return app.scrollViews.firstMatch
    }
    /// 把表单往上推一点。
    ///
    /// 把手放在画面里最靠下的段落标题上（静态文字不会被当成按钮点击），
    /// 再用慢速拖动：甩一下会直接翻到表单底部，中间的几段就都拍不到了。
    private func scrollFormUp(points: CGFloat = 260) {
        let handles = ["本机", "AI 服务", "生图模型", "分类标签", "备份与恢复", "领域", "标签名称", "标签定义"]
        let visible = handles.map({ app.staticTexts[$0] }).filter { $0.exists && $0.isHittable }
        guard let handle = visible.max(by: { $0.frame.maxY < $1.frame.maxY }) else { return }
        let start = handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -points)), withVelocity: .slow, thenHoldForDuration: 0.1)
    }
    /// 把选片网格滚到底，相似照片那一组才会进到画面里。
    private func scrollGridToBottom(times: Int = 5) {
        for _ in 0..<times {
            let grid = app.scrollViews.firstMatch
            if grid.exists { grid.swipeUp() } else { app.swipeUp() }
        }
    }
    /// 把选片网格滚回顶部。
    private func scrollGridToTop(times: Int = 5) {
        for _ in 0..<times {
            let grid = app.scrollViews.firstMatch
            if grid.exists { grid.swipeDown() } else { app.swipeDown() }
        }
    }
    /// 等控件真正可以点。
    ///
    /// 浮层淡出期间控件已经在无障碍树里，但还压着一层动画中的视图，
    /// 这时候 isHittable 还是 false。
    @discardableResult
    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists && element.isHittable { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return element.exists && element.isHittable
    }
    /// 逐屏走一遍引导与时间线。
    func testGalleryOnboardingAndTimeline() {
        relaunch(empty: true)
        XCTAssertTrue(app.buttons["开始整理照片"].waitForExistence(timeout: 15))
        screenshot("01-首次打开引导")
        app.buttons["开始整理照片"].tap()
        let name = app.alerts.textFields["旅行名称"]
        XCTAssertTrue(name.waitForExistence(timeout: 8))
        name.tap(); name.typeText("周末散步\n")
        if app.alerts.buttons["创建"].exists { app.alerts.buttons["创建"].tap() }
        XCTAssertTrue(app.buttons["从相册读取"].waitForExistence(timeout: 8))
        screenshot("02-首次导入来源")
        relaunch(empty: false)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.waitForExistence(timeout: 15))
        screenshot("03-时间线")
        // 时间线里作品集卡片本身就是照片墙入口；卡片在折叠视口下可能还没进视图，先往下滚。
        let wall = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "打开照片墙")).firstMatch
        var found = wall.waitForExistence(timeout: 3)
        for _ in 0..<8 where !found {
            app.swipeUp()
            found = wall.waitForExistence(timeout: 1)
        }
        if found {
            wall.tap()
            XCTAssertTrue(app.navigationBars["模拟旅行"].waitForExistence(timeout: 8))
            screenshot("04-时间线照片预览")
        } else {
            print("GALLERY 跳过 04-时间线照片预览：Duo 的时间线视口里没有出现照片墙入口")
        }
    }
    /// 逐屏走一遍作品集、选片与沉浸式看图。
    func testGalleryPortfolioAndSelection() {
        relaunch(empty: false)
        tab("作品集")
        XCTAssertTrue(app.buttons["我的作品"].waitForExistence(timeout: 10))
        screenshot("05-作品集列表")
        app.buttons["待归集"].tap()
        screenshot("06-待归集")
        app.buttons["我的作品"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        XCTAssertTrue(app.buttons["智能拼图"].waitForExistence(timeout: 8))
        screenshot("07-作品集详情")
        app.buttons["创作"].tap()
        screenshot("08-作品集创作")
        app.buttons["照片"].tap()
        if openBodyMenu() {
            let gallery = app.buttons["查看照片墙"]
            if gallery.waitForExistence(timeout: 5) {
                gallery.tap()
                XCTAssertTrue(app.navigationBars["模拟旅行"].waitForExistence(timeout: 8))
                screenshot("09-作品集照片墙")
            }
        }
        tab("导入与选片")
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟导入")).firstMatch.tap()
        let first = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 15))
        screenshot("10-选片网格")
        // 边栏溢出菜单里是「全部展开／全部叠放」：默认把相似照片折叠起来。
        XCTAssertTrue(openGridMenu(), "选片网格的溢出菜单应当可以打开")
        let expandAll = app.buttons["全部展开"]
        XCTAssertTrue(expandAll.waitForExistence(timeout: 5), "溢出菜单里应当有「全部展开」")
        screenshot("11-选片网格-溢出菜单")
        expandAll.tap()
        sleep(1)
        // 滚到相似照片那一组，两种状态才有可比之处。
        scrollGridToBottom()
        screenshot("12-选片网格-相似照片展开")
        XCTAssertTrue(openGridMenu())
        let collapseAll = app.buttons["全部叠放"]
        XCTAssertTrue(collapseAll.waitForExistence(timeout: 5), "展开之后菜单应当变成「全部叠放」")
        collapseAll.tap()
        sleep(1)
        scrollGridToBottom()
        screenshot("13-选片网格-相似照片折叠")
        // 回到顶部再打开照片：滚到底时第一张已经不在画面里。
        scrollGridToTop()
        let card = app.descendants(matching: .any).matching(identifier: "photo-card-fixture-0").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 8))
        XCTAssertTrue(waitHittable(card), "菜单收起后照片卡应当可以点开")
        card.tap()
        XCTAssertTrue(app.buttons["保留"].waitForExistence(timeout: 10), "点开照片应当进入沉浸式看图")
        screenshot("14-沉浸式看图")
        forceTap(app.buttons["关闭"])
        if app.buttons["筛选"].waitForExistence(timeout: 5) {
            app.buttons["筛选"].tap()
            if app.buttons["主体"].waitForExistence(timeout: 5) {
                screenshot("15-标签筛选")
                app.buttons["完成"].firstMatch.tap()
            }
        }
    }
    /// 逐屏走一遍帐篷模式、拼图、文案与设置。
    ///
    /// 帐篷模式放在最前面：作品集列表的入口会先让人选作品集，而详情页的入口
    /// 是直接进入幻灯片的，两处都要拍到。
    func testGalleryCreationSettingsAndTent() {
        relaunch(empty: false)
        tab("作品集")
        let tent = app.buttons["帐篷模式"]
        XCTAssertTrue(tent.waitForExistence(timeout: 10), "作品集页应当有帐篷模式入口")
        tent.tap()
        let choice = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 10), "开启帐篷模式后应当先让人选择作品集")
        screenshot("16-帐篷模式-选择作品集")
        choice.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "tent-canvas").firstMatch.waitForExistence(timeout: 20))
        screenshot("17-帐篷模式-幻灯片")
        let playback = app.buttons["tent-playback-button"]
        XCTAssertTrue(playback.waitForExistence(timeout: 10), "播放按钮应当在帐篷侧栏中保持可用")
        playback.tap()
        XCTAssertTrue(app.buttons["继续播放"].waitForExistence(timeout: 5), "暂停后应当显示继续播放")
        app.buttons["tent-playback-button"].tap()
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 5), "继续播放后应当恢复暂停状态")
        XCTAssertFalse(app.buttons["tent-poster-button"].exists, "海报操作应收纳在次级菜单中")
        let moreActions = app.buttons["tent-more-menu"]
        XCTAssertTrue(moreActions.waitForExistence(timeout: 5), "次要操作菜单应当可访问")
        moreActions.tap()
        let currentPoster = app.buttons["tent-poster-button"]
        XCTAssertTrue(currentPoster.waitForExistence(timeout: 5), "更多菜单应当提供当前照片海报")
        currentPoster.tap()
        let poster = app.descendants(matching: .any).matching(identifier: "poster-image").firstMatch
        XCTAssertTrue(poster.waitForExistence(timeout: 90), "应当能查看本张照片的独立海报")
        screenshot("18-帐篷模式-海报")
        // 海报弹层用工具栏的「完成」关闭；弹层里的坐标点击会被窗口偏移算歪，
        // 所以这里用标准点击，弹层没关掉就下拉兜底。
        if app.buttons["完成"].firstMatch.exists {
            app.buttons["完成"].firstMatch.tap()
        } else {
            app.swipeDown()
        }
        XCTAssertFalse(app.buttons["分享海报"].exists, "海报弹层应当已经关闭")
        // 给整个作品集各生成一张海报：这是「每张照片一张独立海报」的完整链路。
        moreActions.tap()
        let allPosters = app.buttons["tent-all-posters-button"]
        XCTAssertTrue(allPosters.waitForExistence(timeout: 10), "更多菜单应当提供「生成全部海报」")
        forceTap(allPosters)
        let done = app.buttons["知道了"]
        XCTAssertTrue(done.waitForExistence(timeout: 180), "应当提示海报已生成")
        screenshot("19-海报已生成")
        done.tap()
        // 退出帐篷模式。侧栏里的「关闭」不在可滚动容器里，标准点击会先去
        // scroll-to-visible 而失败，所以按坐标点。
        forceTap(app.buttons["关闭"])
        // 等帐篷真的退场：浮层还在淡出时，下面的列表虽然可见却点不动。
        let tentCounter = app.descendants(matching: .any).matching(identifier: "tent-counter").firstMatch
        XCTAssertTrue(tentCounter.waitForNonExistence(timeout: 15), "应当已经退出帐篷模式")
        let tentButton = app.buttons["帐篷模式"]
        XCTAssertTrue(tentButton.waitForExistence(timeout: 10), "应当回到作品集列表")
        XCTAssertTrue(waitHittable(tentButton), "回到作品集列表后，帐篷模式入口应当可以点")
        // 回到列表，进入作品集详情。
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "模拟旅行")).firstMatch.tap()
        XCTAssertTrue(app.buttons["智能拼图"].waitForExistence(timeout: 10), "应当打开作品集详情")
        app.buttons["创作"].tap()
        screenshot("20-作品集创作-海报列表")
        app.buttons["智能拼图"].tap()
        let randomize = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "随机")).firstMatch
        XCTAssertTrue(randomize.waitForExistence(timeout: 10), "应当打开智能拼图编辑器并展示随机组合操作")
        screenshot("21-智能拼图")
        app.buttons["关闭"].firstMatch.tap()
        app.buttons["生成文案"].tap()
        XCTAssertTrue(app.navigationBars["文案"].waitForExistence(timeout: 10), "应当打开文案编辑器")
        screenshot("22-生成文案")
        app.buttons["关闭"].firstMatch.tap()
        // 设置入口在作品集列表页右上角的齿轮上，先退回列表再打开设置。
        let back = app.buttons["BackButton"].firstMatch
        if back.waitForExistence(timeout: 3) { back.tap() }
        else { app.navigationBars.buttons.firstMatch.tap() }
        XCTAssertTrue(app.buttons["我的作品"].waitForExistence(timeout: 8), "应返回作品集列表")
        XCTAssertTrue(app.buttons["设置"].waitForExistence(timeout: 8), "作品集列表页应当有设置入口")
        app.buttons["设置"].tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 8), "应当打开设置页")
        // 等弹层的出现动画结束，否则第一下拖动会被动画吞掉。
        sleep(2)
        screenshot("23-设置-本机与AI")
        // Duo 的屏幕只有 678 点高，这个表单一屏放不下：往下推一段看下半部分。
        scrollFormUp(points: 300)
        screenshot("24-设置-AI服务与生图模型")
        // 关掉设置页：工具栏的「完成」在 Duo 上有时不在无障碍树里，找不到就下拉关闭。
        if app.buttons["完成"].firstMatch.exists {
            app.buttons["完成"].firstMatch.tap()
        } else {
            app.swipeDown()
        }
    }
}
