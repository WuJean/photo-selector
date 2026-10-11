# Docker 部署

这是网页版的部署方式，包含网页、接口、SQLite、照片处理和后台 AI 任务，不依赖微信云开发。适用于一人使用的照片库；同一数据卷只运行一个应用实例。

## 一键启动

先安装并启动 Docker：Mac／Windows 使用 Docker Desktop；Linux 使用 Docker Engine 和 Compose v2（需支持 `up --wait`）。首次构建需要联网下载镜像、依赖和中文字体，主机无需安装 Node.js、Swift 或数据库。

```sh
git clone git@github.com:WuJean/photo-selector.git
cd photo-selector
./deploy.sh
```

仓库为私有，克隆需要有访问权限的 GitHub 账号。Windows 在 WSL 中执行脚本，或在项目目录执行 `docker compose up -d --build --wait`。

成功后打开 **http://localhost:4173**，也支持 **http://127.0.0.1:4173**。先使用数据目录中的初始密码登录，再连接电脑文件夹或导入 JPEG。首页是照片墙，筛选在「导入与筛选」中进行。图片理解和图片生成在网页“设置”中分别配置，未配置 AI 也可选片、手动拼图和导出。

脚本会检查 Docker、构建镜像、启动服务并等待健康检查。反复执行会更新当前部署，数据卷保留。没有发布公共镜像，构建使用当前检出的源码。

### 已有服务占用 4173

```sh
cp .env.example .env
```

将 `.env` 中 `PHOTO_SELECTOR_PORT=4173` 改为 `PHOTO_SELECTOR_PORT=4180`，再执行 `./deploy.sh`，访问 http://localhost:4180。不要关闭或覆盖已有照片库来解决端口冲突。

## 配置

`.env` 可选，已被 Git 忽略；没有它时使用下表默认值。不要把 API Key 写进镜像、Compose 文件或 `.env`，在网页设置中保存即可。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `PHOTO_SELECTOR_PORT` | `4173` | 主机访问端口，容器内部固定 4173 |
| `PHOTO_SELECTOR_BIND` | `127.0.0.1` | 主机绑定地址，默认仅本机可访问 |
| `PHOTO_SELECTOR_PUBLIC_URL` | `http://localhost:<访问端口>` | 浏览器实际访问的完整地址，不带子路径；本机地址自动允许 localhost／127.0.0.1／IPv6 回环别名 |
| `PHOTO_SELECTOR_VOLUME` | `photo-selector-data` | 持久化数据卷名；改名相当于切换到另一个照片库 |
| `TZ` | `Asia/Shanghai` | 容器时区 |

网页和 API 使用同一域名，不需要额外 CORS 配置。容器用普通用户运行，程序目录只读；照片及数据库写入 `/data`，临时系统文件使用 `/tmp`。

### Linux 和 Mac 的差异

- Docker 内运行 Linux，使用感知哈希、时间和精确摘要进行本地分组，并提供清晰度与曝光提示；不调用 Apple Vision，也不提供其人脸定位能力。AI 标签、搭配和创作仍可调用已配置的服务。
- Mac 原生运行且构建 VisionWorker 时使用钥匙串；Docker 使用 AES-256-GCM 加密的本地凭据。密钥与加密文件分别保存在数据卷 `secrets/` 中，文件权限 600、目录 700。它防止凭据以明文进入数据库，并不能抵御能够读取整个数据卷的管理员。备份必须按敏感数据保管。
- Docker 不会自动读取主机 `.local/` 照片库或 macOS 钥匙串。默认创建一个独立的空照片库。
- 镜像包含中文字体，文字水印与拍摄参数相框可在 Linux 渲染。

### 连接主机上的本地模型

容器里的 `localhost` 指容器本身。访问主机的兼容图片理解服务时，在设置中填写例如：

```text
http://host.docker.internal:11434/v1
```

Compose 已配置该主机名，Linux 也会映射到主机网关。模型服务本身需允许 Docker 网络访问；只监听主机回环地址的服务在部分 Linux 配置下不可达。云服务继续使用 HTTPS 地址。不会把现有 Mac 钥匙串密钥自动传入容器。

## 部署到远程服务器

应用有单管理员登录；管理接口和私有图片均需会话。个人远程使用可保留默认回环监听，并通过 SSH 隧道访问：

```sh
ssh -N -L 4173:127.0.0.1:4173 your-user@your-server
```

然后在本机打开 http://localhost:4173。若本机端口不同，服务器的 `PHOTO_SELECTOR_PUBLIC_URL` 也应改为对应的本机访问地址。

需要域名访问时，使用 HTTPS 反向代理，并设置：

```dotenv
PHOTO_SELECTOR_PUBLIC_URL=https://photos.example.com
```

主机上的反向代理转发至 `127.0.0.1:4173`，保留原始 `Host` 和 `Origin`；不要把浏览器地址改写成容器地址。上传请求最大一次 20 张、单张 100 MB，代理请求体上限和超时需容纳实际批次；文案和 AI 搭配请求应允许等待至少 3 分钟。容器部署的反向代理需另行配置共享网络。

分享给他人时，需要可访问的 HTTPS 域名，并设置同一个 `PHOTO_SELECTOR_PUBLIC_URL`；文件夹 API 在普通远程 HTTP 下不可用。代理保留管理登录和分享页面各自的权限边界。默认仍只绑定回环地址。

## 日常管理

```sh
# 查看状态／日志
docker compose ps
docker compose logs --tail=100 -f web

# 停止、恢复；数据保留
docker compose stop
docker compose start

# 更新：先按下文备份，再拉取代码重新部署
git pull --ff-only
./deploy.sh

# 移除运行容器和网络，保留照片库
docker compose down
```

不要对正在使用的照片库执行 `docker compose down -v` 或删除数据卷。健康检查只验证服务可用，不会调用付费模型。未完成 AI 任务重启后显示为暂停，在界面继续即可，已完成结果不会重新提交。

### 备份

在项目目录执行。先停止服务，保证数据库和照片处于一致状态；备份整个 `/data`，不要只复制 SQLite 主文件。

```sh
mkdir -p backups
docker compose stop web
docker compose run --rm --no-deps -T --entrypoint tar web -C /data -czf - . > "backups/photos-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose start web
```

检查中间命令是否成功；即使备份失败也可执行最后一行恢复服务。备份包含原片、预览、数据库、作品和加密凭据及其主密钥，不要分享或提交到 Git。

### 恢复到新数据卷

先确认备份完整，使用一个**未使用过的卷名**；不要把归档解压到现有照片库。

```sh
PHOTO_SELECTOR_VOLUME=photo-selector-restored docker compose run --rm --no-deps -T --entrypoint tar web -C /data -xzf - < backups/your-backup.tar.gz
```

把 `.env` 中 `PHOTO_SELECTOR_VOLUME` 改为 `photo-selector-restored`，再执行 `./deploy.sh`。原数据卷仍保留，可切回。备份恢复必须同时包含 `secrets/master.key` 和 `secrets/credentials.enc`；损坏或缺失时服务会报错，不会默默覆盖凭据。

### 本轮升级：显式清空旧业务数据

本轮不迁移旧项目、照片或作品集。使用新版镜像后，仅对当前部署运行一次下列操作；它保留服务设置、管理员、会话、保存的模板及凭据，不删除电脑源文件，也不触碰微信数据。**这是不可撤销的清理，先确认当前数据卷就是要重置的部署。**

```sh
docker compose build web
docker compose stop web
docker compose run --rm --no-deps -T web node server/reset-library.mjs --confirm
docker compose up -d --wait
```

本机 Node 运行时，先停止进程，再用其相同 `PHOTO_SELECTOR_DATA_DIR` 执行 `node server/reset-library.mjs --confirm`。脚本不会在每次启动时执行，不读取数据库中的外部源路径，不跟随照片目录符号链接。若进程中断留下 `.reset-in-progress`，确认没有重置进程后移除这个标记，再重试。

### 登录和本地目录

初次启动生成随机管理员密码，以 600 权限存放；数据库只存密码哈希。读取：

```sh
docker compose exec -T web cat /data/admin-initial-password
```

在网页设置修改密码后该初始文件会删除，旧会话全部失效。HTTPS 配置下 Cookie 为 Secure，所有会话为 HttpOnly、SameSite=Strict。

电脑文件夹授权属于浏览器和访问地址。`localhost` 与 `127.0.0.1` 的 IndexedDB 不共享；更换地址后点「重新连接文件夹」。支持桌面 Chrome／Edge 的目录访问 API，服务端无法读取你的电脑路径。服务器备份包含照片资料、上传照片和分享副本，**不包含电脑文件夹原片与浏览器授权**；电脑照片请自行备份。

普通上传会在服务器保留原片；网络导入先中转到服务器，保存电脑并校验通过后回收中转。分享在线副本保留到撤销或过期。清理不会删正在被引用的照片。

## 故障处理

| 现象 | 检查 |
| --- | --- |
| Docker 未启动 | 启动 Docker Desktop 或 Linux Docker 服务，重试脚本 |
| 端口占用 | 修改 `.env` 的 `PHOTO_SELECTOR_PORT`；无需更改容器内部端口 |
| 403「访问地址未配置」／「不允许跨站请求」 | 确认 `PHOTO_SELECTOR_PUBLIC_URL` 与浏览器协议、域名、端口完全一致，重新部署；检查反向代理 Host |
| 本地照片离线 | 使用同一浏览器和地址，点「重新连接文件夹」重新授权或定位，按摘要匹配 |
| 忘记首次密码 | 查看 `/data/admin-initial-password`；已修改后使用自己保存的新密码 |
| 初次下载失败 | 检查 Docker Hub、npm 和 Debian 软件源的网络访问，恢复后重跑脚本 |
| 重启后出现空库 | 检查 `PHOTO_SELECTOR_VOLUME` 是否改名或切换了 Docker context，避免删除原卷 |
| 不能连接本地 AI | 使用 `host.docker.internal`，检查本地服务监听与图片输入能力 |
| 不健康或无响应 | `docker compose logs --tail=100 web` 查看错误；确认卷可写和磁盘空间充足 |

## 验证

开发者可执行 `npm ci && npm run test:docker`。测试需要 Node.js 24、Docker 和 Chrome；CI 使用 Playwright Chromium。它创建随机端口、独立容器及一次性测试卷，验证导入、图片解码、本地 CV、两轮状态、中文水印导出、重建后的数据及密钥恢复、模拟多模态调用和浏览器刷新，完成后删除自身测试卷。

Docker 内的 AI 验证使用模拟服务，不会读取个人密钥或产生真实模型费用。Linux amd64 由 GitHub Actions 构建和验收，Apple Silicon 本地验证 Linux arm64。详细结果见 [测试记录](TESTING.md)。
