# 选片助手

中文 Mac 本地选片工作台。SwiftUI + Vision + SQLite；macOS 14 或更新版本。

## 运行

安装 Apple Command Line Tools 后：

```sh
bash scripts/test.sh
bash scripts/build-app.sh
open dist/选片助手.app
```

项目数据位于 `~/Library/Application Support/PhotoSelector/`。开发与测试可用 `PHOTO_SELECTOR_DATA_DIR` 指定独立数据目录。

原片、API 密钥和个人项目数据库不提交到仓库。功能进度与验证见 [测试记录](docs/TESTING.md)。
