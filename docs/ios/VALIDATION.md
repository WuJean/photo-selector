# iOS 验收记录

日期：2026-10-22。此版本是开发构建，尚未发布 TestFlight。

## 已执行

环境：Apple Silicon Mac（arm64），macOS 27.0.1，Xcode 27.1（27A9275）。Xcode 和 iOS 模拟器组件来自 Apple；已完成用户授权的许可确认。

| 检查 | 结果 |
| --- | --- |
| `swift run PhotoCoreTests` | 7 组通过：两轮状态、整批事务回滚、撤销、引用保护、三小时边界、AI 迟到结果、模板约束和全量检索 |
| iOS Simulator 构建与测试构建 | 通过 |
| iOS 设备 Release 构建（未签名） | 通过；不等于真机安装或 App Store 验证 |
| iPhone Duo / iOS 27.1 原生测试 | 6 项通过：原片复制与摘要、来源文件变化保护、备份往返、损坏备份拒绝、拼图输出尺寸、模拟 AI 校验及 3000 JPEG 分页读取（同一测试包含多个断言） |
| iPhone 18 Pro / iOS 27.0 原生测试 | 同样 6 项通过；不含界面交互和实机验收 |
| 网页回归 `npm run check` | 96 项测试通过，生产构建通过；未重启或修改网页服务配置 |
| 脚本语法及生成工程 | 通过；工程可由标准库 Python 脚本重新生成 |

核心 3000 条记录测试（建库、100 次决定、重开）本次约 0.60 秒。另创建 3000 个合成 JPEG（4000×3000），从首、中、尾各取 40 张生成缩略图，本次 120 张耗时约 0.57 秒。该测试不是全库真实滚动测试，不代表真机峰值内存、SD 卡速度或真实照片识别速度。

测试仅使用合成图片、隔离临时目录和模拟 HTTP 服务。未上传个人照片，未使用生产 AI 密钥。模拟器跳过 Vision 图像特征，使用感知哈希；设备构建保留 Vision 实现。

## 尚未验证

- 自动化界面测试已编写且构建成功，但本机锁屏阻断了交互验收。用户目前不在家，已要求先完成无需解锁的工作。因此点击、滑动、缩放、Duo 折叠／半开／展开及横竖屏视觉效果均不标记通过。
- 真机相册有限授权、iCloud 下载、存储卡拔插及重新授权、低电量和热状态、长时间运行与峰值内存。
- Apple 端侧多模态模型的实际可用性、耗时与分类质量；远程 AI 仅模拟测试通过，尚无 iOS 真机服务联调。
- TestFlight：缺少已启用的 Apple Developer 团队及签名／App Store Connect 发布验证。未生成可安装的分发 IPA，未上传任何构建。

## 继续验收

```bash
# 无界面核心测试
swift run PhotoCoreTests

# 完整构建与 UI 测试：Mac 解锁后执行
IOS_TEST_DEVICE=<simulator-uuid> ./scripts/test-ios.sh

# 只执行原生测试（CI 默认范围）
xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
  -destination 'platform=iOS Simulator,id=<simulator-uuid>' \
  CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO \
  -only-testing:PhotoSelectorTests test
```

测试结果 `.xcresult` 和构建日志保存在本机 `.local/`，不提交仓库；CI 上传原生测试结果。CI 通过不替代以上待验收项。
