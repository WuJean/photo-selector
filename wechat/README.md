# 选片助手 · 微信小程序

手机相册直接上传，云端保存原片、缩略图、预览与创作；不需要电脑在线，不包含电脑配对或同步。源码位于 `wechat/`。这是独立于网页版的实现，不随网页版部署自动发布，也不与网页版同步数据。

## 使用

1. 创建旅行项目，导入手机照片（系统选择器每批最多 9 张，可继续添加）。
2. 粗筛：待定／保留／不要。入选照片进入精筛。点击图片进入沉浸浏览，滑动切图、双指缩放；作出决定后自动下一张，支持撤销。
3. 精筛：平铺照片、按领域和元数据筛选；可直接 AI 分类，或先细化标签库。标签不是精筛门槛，精筛只有保留／不要。
4. 作品集：精筛保留照片进入候选池，可重复加入多个作品集。照片和拼图／文案／AI 图片分别展示。
5. 拼图：使用快捷模板、自定义每格的主体和景别，随机组合；也可让 AI 实际看候选图来搭配。裁剪、缩放、相框和水印共用成品布局。
6. 作品集中点击生成文案／封面。后台遍历全部入选照片、分批汇总。生成完成后任务条隐藏，结果保存在“创作”。

长按列表照片查看参数；多选后的“更多操作”可以手工修正相似组、标记喜欢。标签由 AI 生成，标签库的补充不等于手工给照片打标。列表每页 60 张，沉浸模式的范围仍包含筛选结果的全部照片。

## 云端配置

- 使用自己的 AppID 和 CloudBase 环境；仓库不提供共享云服务。
- `photoApiV2`：Node.js 20.19，512 MB，60 秒；负责鉴权、图片处理、业务接口。
- `photoWorker`：Node.js 20.19，1024 MB，900 秒；异步任务执行，签名触发和每两分钟定时恢复。
- `photo_selector` 集合：客户端全部禁止，云函数按 OPENID 隔离；已建立项目、任务、作品集等五个复合索引。
- 云存储：仅创建者和管理员读写；受控云函数为派生图签发短期链接。
- 图片理解模型：当前使用既有配置 `qwen3.8-flash`；生图 `wan2.7-image`。密钥仅在云函数环境变量及本机私有部署文件中，不下发小程序。

云端相似度采用文件摘要、感知哈希、曝光/清晰度、时间和代表图约束；这里不运行 macOS Apple Vision，也不声称具有其语义特征能力。首版优先 JPEG/PNG，HEIC 真机兼容性尚待验证。原片不改写；AI 仅接收去除 EXIF 的预览图。

## 开发、测试、部署

复制 `wechat/config.example.json` 为被忽略的 `wechat/config.local.json`，填写自己的 `appId`、`envId` 和可选的 `projectDir`。也可以用 `WECHAT_APP_ID`、`WECHAT_ENV_ID`、`WECHAT_PROJECT_DIR` 覆盖。未配置时仅生成游客模式示例，不连接任何云环境。

```sh
npm run test:wechat
npm run build:wechat       # 生成 dist/wechat，可在开发者工具中导入
npm run sync:wechat        # 仅在设置 projectDir 后同步到指定目录
```

`sync:wechat` 生成并同步项目；首次 QuickStart 备份保存在被忽略的 `.local/wechat-quickstart-backup`。不要直接修改同步目标的业务代码。

首次准备云端部署依赖：

```sh
npm run package:wechat
npm exec --yes --package @cloudbase/cli@3.8.6 -- tcb login
node scripts/provision-wechat.mjs
```

打包会明确加入 Linux x64 的 Sharp 二进制依赖，部署时 `installDependency=false`。云端自动安装曾导致 Sharp 缺失，不能上传 macOS 原生依赖代替 Linux 依赖。已有函数运行时无法原地改为新版本，因此接口函数使用 `photoApiV2`。

旧版辅助迁移脚本（当前管理服务启用登录后不可直接使用；通常应在自己的私有云部署文件中配置模型环境变量）：

```sh
node scripts/prepare-wechat-cloud.mjs
```

该脚本要求本机已有服务在 4173 端口运行，并将私有配置写入 `~/.codex/private/photo-selector-cloudbaserc.json`，文件权限 0600。以后部署直接使用该文件，小程序运行不依赖本机服务。`PHOTO_ADMIN_OPENID` 可指定允许生图的管理员；必须填写实际小程序登录者。不要用开发工具的占位 OPENID。

```sh
npm exec --yes --package @cloudbase/cli@3.8.6 -- tcb fn deploy --all --force \
  --install-dependency false \
  --config-file "$HOME/.codex/private/photo-selector-cloudbaserc.json" --json
```

私有文件中的 `AI_BASE_URL / AI_MODEL / AI_API_KEY` 与 `IMAGE_ENDPOINT / IMAGE_MODEL / IMAGE_API_KEY` 可分别配置；未设生图密钥时共用理解密钥。`WORKER_SECRET` 用于服务内签名，不得填入前端。自定义变量使用 `PHOTO_` 前缀，避免平台禁止的 `SCF_` 前缀。默认每天每用户最多预留 5000 个 AI 工作项，可通过 `AI_DAILY_LIMIT` 调整；它是任务数量限制，不是精确费用估算。

开发者工具 MCP 辅助脚本 `scripts/wechat-tool.mjs` 从 `~/.codex/private/wechat-mcp-token` 读取已授权令牌，不包含令牌本身。普通运行和部署不需要这个脚本。

## 验证与尚待完成的验收

详见 [验证记录](verification/RESULTS.md)。云端导入、两轮决定、实际 AI 分类／看图搭配／文案／万相生图／成品下载已经联调通过；已生成可扫码的开发预览；没有公开发布或上传体验版。

还需在真实手机上验证相册权限、缩放手势、保存相册、弱网和切到后台后的恢复，以及 3000 张真实 JPEG 的端到端耗时。模拟器和 3000 条记录的自动化测试不能代替这些验收。上线所需的小程序隐私声明、备案和发布审核由账号持有人在微信公众平台完成。
