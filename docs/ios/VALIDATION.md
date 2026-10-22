# iOS 验收记录

日期：2026-10-22。此版本是开发构建，当前只做免费本地真机调试，不进行 TestFlight 发布。

## 已执行

环境：Apple Silicon Mac（arm64），macOS 27.0.1，Xcode 27.1（27A9275）。Xcode 和 iOS 模拟器组件来自 Apple；已完成用户授权的许可确认。

| 检查 | 结果 |
| --- | --- |
| `swift run PhotoCoreTests` | 9 组通过：两轮状态、整批事务回滚、撤销、引用保护、三小时边界、AI 迟到结果、模板约束、全量检索、草稿兼容及备份恢复任务合并 |
| iOS Simulator 构建与测试构建 | 通过 |
| iOS 设备 Release 构建（未签名） | 通过；不等于真机安装或 App Store 验证 |
| iPhone Duo / iOS 27.1 原生测试 | 18 项通过：原片复制与摘要、导出时来源变化保护、备份往返、恢复失败回滚、符号链接拒绝、拼图尺寸、模拟 AI 校验、取消迟到请求、暂停恢复、持续追加预览及 3000 JPEG 分页读取 |
| iPhone 18 Pro / iOS 27.0 原生测试 | 同样 18 项原生测试及 4 项界面测试通过；不等于实机验收 |
| 网页回归 `npm run check` | 96 项测试通过，生产构建通过；未重启或修改网页服务配置 |
| 脚本语法及生成工程 | 通过；工程可由标准库 Python 脚本重新生成 |

核心 3000 条记录测试（建库、100 次决定、重开）本次约 0.60 秒。另创建 3000 个合成 JPEG（4000×3000），从首、中、尾各取 40 张生成缩略图，本次 120 张耗时约 0.57 秒。该测试不是全库真实滚动测试，不代表真机峰值内存、SD 卡速度或真实照片识别速度。

测试仅使用合成图片、隔离临时目录和模拟 HTTP 服务。未上传个人照片，未使用生产 AI 密钥。模拟器跳过 Vision 图像特征，使用感知哈希；设备构建保留 Vision 实现。

## 本轮交互修复与截图

- 固定一次沉浸会话的照片顺序，避免决定后列表更新导致跳过照片；连续六张筛选、自动前进、撤销和精筛二选均有交互断言。
- 切换标签、交并集、分组叠放或候选范围后清空多选，避免批量决定隐藏照片。
- 测试覆盖左右滑动、双指放大后拖动不切图、双击复位、拼图随机组合保存、作品集查看和横屏。
- Device Hub 中实际切换 Duo 折叠／半开／完全展开，沉浸照片与决定控件均可见，无裁切遮挡；截图在 `.local/ios-evidence/duo-{closed,partial,open}.png`。这是模拟器视觉检查，不是折叠真机验收。

## 尚未验证

- 系统相册实际授权和连续范围导入、文件选择器及存储卡导入仍需实机端到端验证。自动化照片库使用应用内合成素材，不替代系统照片权限验收。
- 真机相册有限授权、iCloud 下载、存储卡拔插及重新授权、低电量和热状态、长时间运行与峰值内存。
- Apple 端侧多模态模型的实际可用性、耗时与分类质量；远程 AI 仅模拟测试通过，尚无 iOS 真机服务联调。
- 免费真机安装：当前设备列表只有模拟器，没有连接的真实 iPhone；Xcode Apple Account 登录曾提示“无法验证你的身份，请检查网络连接后重试”，尚未取得可用 Personal Team。需要手机连接并完成免费账号登录后才能实际签名安装。用户已明确取消 TestFlight／付费会员方向，未进行付费或上传。

## 继续验收

```bash
# 无界面核心测试
swift run PhotoCoreTests

# 完整构建与 UI 测试：保持 Mac 解锁
IOS_TEST_DEVICE=<simulator-uuid> ./scripts/test-ios.sh

# 仅执行原生测试（CI 现已包含界面测试）
xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
  -destination 'platform=iOS Simulator,id=<simulator-uuid>' \
  CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO \
  -only-testing:PhotoSelectorTests test
```

测试结果 `.xcresult` 和构建日志保存在本机 `.local/`，不提交仓库；CI 上传原生及界面测试结果。CI 通过不替代以上待验收项。
