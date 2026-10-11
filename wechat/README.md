# 选片助手 · 微信小程序

源码保存在现有私有仓库的 `wechat/`，`npm run sync:wechat` 构建并同步到本机 `/Users/wujean/WeChatProjects/photo-selector`。同步前首次备份 QuickStart 到被忽略的 `.local/wechat-quickstart-backup`，不覆盖开发者工具的私人设置。不要在同步目标直接编辑业务文件。

- AppID：`wxee3c352a685b21c5`
- 云环境：`cloud1-d4gpza9qcc9ead069`
- 仅手机相册导入；没有电脑配对和同步入口。
- 原片、预览和缩略图放云存储；数据放 `photo_selector` 集合。
- 客户端数据库权限设为全部禁止，业务读写全部经 `photoApi` 验证 OPENID。存储采用仅创建者可读写；派生图由鉴权云函数签发临时链接。

## 开发与部署

```sh
npm run test:wechat
npm run sync:wechat
```

在微信开发者工具打开目标目录，选择上述云环境，右键 `cloudfunctions/photoApi`，选择“上传并部署：云端安装依赖”。图片处理依赖 Sharp，使用 Node.js 18.17+ 运行时，内存至少 512 MB。不能把本地 macOS 的 node_modules 上传到 Linux 云函数。

## 验证记录

第一阶段：项目/文件归属、文件大小、重复完成上传、事务回滚的本地模拟测试通过；小程序构建成功。尚未部署云端、未完成真机照片导入，不等同于云端验收通过。
