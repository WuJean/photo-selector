# 部署、访问与备份

首推 Mac 原生部署；Docker 适合已有容器环境的用户。两种方式都运行生产构建，默认监听 `0.0.0.0:4173`，均保留管理员登录和作品集分享权限。

## Mac 原生部署

需要 macOS 14+、Node.js 24+（含 npm）。Swift 6 可选，用于构建 Apple VisionWorker；缺少工具链时使用传统 CV。可以运行 `xcode-select --install` 安装 Command Line Tools，再通过软件更新升级过旧的工具链。

```sh
git clone https://github.com/WuJean/photo-selector.git
cd photo-selector
./deploy.sh
```

脚本检查依赖、执行 `npm ci`、构建网页和可用的 VisionWorker，再启动后台服务。依赖缺失会给出安装说明，不自动安装 Homebrew。原生模式不自动设置开机启动。

首次密码 **`passwd`**，首次登录必须改为至少 12 位的个人密码。默认对网络监听，先在本机完成改密，再分享访问地址。已有个人密码不会因部署、更新或重启被重置。

| 操作 | 命令 |
| --- | --- |
| 构建并部署／更新 | `./deploy.sh` |
| 启动已有构建 | `./deploy.sh start` |
| 停止 | `./deploy.sh stop` |
| 重启已有构建 | `./deploy.sh restart` |
| 状态 | `./deploy.sh status` |
| 日志 | `./deploy.sh logs`，Ctrl-C 仅退出日志查看 |

默认业务目录 `.local/`，运行记录与日志在 `.local/run/`。更新先构建，构建成功后重启脚本管理的进程。退出时只停止带有匹配运行标识的进程组；未知进程、其他项目和其他照片库不会被停止。

原生服务可使用 macOS 钥匙串。已有加密凭据库在启用 Vision 后仍继续使用，避免隐藏此前保存的密钥。未启用钥匙串时使用数据目录中的 AES-256-GCM 凭据；密钥和加密内容都需要备份。

## Docker 部署

Mac／Windows 安装 Docker Desktop，Linux 安装 Docker Engine 和 Compose v2；Windows 在 WSL 中运行脚本。无需主机 Node.js 或 Swift。

```sh
./deploy.sh --docker
./deploy.sh --docker status
./deploy.sh --docker logs
./deploy.sh --docker stop
./deploy.sh --docker start
```

Mac 默认原生，必须显式加 `--docker` 使用 Docker。非 Mac 默认 Docker。镜像从当前检出的源码构建，不依赖公共预构建镜像。

Docker 使用 Linux CV，不调用 Apple Vision 或 macOS 钥匙串；密钥以加密文件保存在持久卷中。它不会自动读取 Mac `.local/` 或钥匙串。两种方式的数据不会自动合并。

日常更新：

```sh
# 先按下文备份
git pull --ff-only
./deploy.sh --docker
```

`--docker restart` 重启现有容器；更改配置后运行 `./deploy.sh --docker` 重新应用配置。`docker compose down` 保留数据卷；不要使用 `down -v` 删除在用照片库。

## 配置优先级

命令环境变量 > 项目 `.env` > 默认值。`.env` 已被忽略，不要放 API Key；在网页设置中填写。

```sh
cp .env.example .env
```

| 配置 | 默认／用途 |
| --- | --- |
| `PHOTO_SELECTOR_PORT` | `4173`，原生端口或 Docker 主机映射端口 |
| `PHOTO_SELECTOR_BIND` | `0.0.0.0`；只供本机访问时改为 `127.0.0.1` |
| `PHOTO_SELECTOR_PUBLIC_URL` | 脚本自动选择局域网地址，无可用地址时使用 localhost；也可设为自己的 HTTPS 域名 |
| `PHOTO_SELECTOR_ALLOWED_ORIGINS` | 额外允许的完整访问地址，逗号分隔；不能使用通配符 |
| `PHOTO_SELECTOR_DATA_DIR` | 原生业务目录，默认 `.local`；相对项目根目录解析 |
| `PHOTO_SELECTOR_VOLUME` | Docker 卷名，默认 `photo-selector-data`；改名会切换照片库 |
| `TZ` | 默认 `Asia/Shanghai` |

原生模式也接受 `PORT` 和 `HOST` 别名。Docker 配置请使用 `PHOTO_SELECTOR_` 名称。手写 `.env` 使用普通 `KEY=value` 或带引号的字面值，不使用 shell 命令或变量插值。

已有显式端口、绑定地址、数据目录等配置不会被脚本覆盖。例如已有 `127.0.0.1` 时，需自行改为 `0.0.0.0` 后重新部署才能接受局域网请求。

## 本机、局域网与公网

- **本机管理**：优先打开 `http://localhost:4173`，Chrome／Edge 可授权电脑文件夹。
- **局域网访问**：打开启动输出中的 `http://局域网IP:端口`。HTTP 地址不能使用浏览器文件夹授权，可普通上传。手机和 Mac 需要在可互通的网络中，系统防火墙需允许服务。
- **公网分享**：需要公网可达的服务、域名与 HTTPS 反向代理。`0.0.0.0` 不会自动穿透路由器，本项目不会修改路由器或安装隧道。

管理者通过 localhost 使用文件夹时，分享链接仍由 `PHOTO_SELECTOR_PUBLIC_URL` 生成，避免发出访客无法访问的 localhost 地址。局域网 IP 变化后重新部署，并重新复制分享链接；已有分享令牌保留。

公网配置示例：

```dotenv
PHOTO_SELECTOR_PUBLIC_URL=https://photos.example.com
```

代理转发到实际端口，保留原始 `Host` 和 `Origin`，使用同一个公开域名访问网页和 API。不要把浏览器地址改写成容器地址，也无需开放任意 CORS。上传一次最多 20 张、每张 100 MB；代理请求体限制需容纳实际批次，AI 搭配请求超时建议不少于 3 分钟。

一个域名的 Nginx 转发片段（放在已配置 TLS 证书的 server 内）：

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $http_host;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 300s;
    client_max_body_size 2100m;
}
```

配置 HTTPS 公开地址后会话 Cookie 带 Secure，始终使用 HttpOnly 和 SameSite=Strict。管理接口、私有图片及分享访问权限不会因监听全部网卡而取消。

直接 `docker compose up` 也能启动，但不会执行脚本的主机局域网地址检测；此时应显式填写公开地址与额外允许地址。容器里的 localhost 指容器本身；访问 Mac 上的本地模型可以使用 `http://host.docker.internal:端口/v1`。

## 原生备份与恢复

停止服务后备份整个业务目录；自定义目录时替换下面的 `.local`。

```sh
./deploy.sh stop
mkdir -p backups
tar -czf "backups/photos-$(date +%Y%m%d-%H%M%S).tar.gz" .local
./deploy.sh start
```

备份可能包含照片、描述、分享副本、数据库和加密凭据，请作为敏感文件保管。恢复时先停止服务，解压到独立目录并设置 `PHOTO_SELECTOR_DATA_DIR`，不要覆盖正在使用的照片库。运行记录不用于恢复进程，服务会校验进程身份。

钥匙串中的密钥不在业务目录备份内，需要保留系统钥匙串或重新配置 AI Key。浏览器文件夹原片及目录授权也不在服务器备份中；电脑源照片需另行备份。

## Docker 备份与恢复

停止服务，备份整个 `/data`：

```sh
mkdir -p backups
docker compose stop web
docker compose run --rm --no-deps -T --entrypoint tar web -C /data -czf - . > "backups/photos-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose start web
```

恢复到一个**未使用过的卷名**：

```sh
PHOTO_SELECTOR_VOLUME=photo-selector-restored docker compose run --rm --no-deps -T --entrypoint tar web -C /data -xzf - < backups/your-backup.tar.gz
```

在 `.env` 中将 `PHOTO_SELECTOR_VOLUME` 改为该卷名，再运行 `./deploy.sh --docker`。原卷仍保留。加密凭据恢复必须包含 `secrets/master.key` 和 `secrets/credentials.enc`；缺失或损坏会报错，不会默默覆盖。

## 故障处理

| 问题 | 处理 |
| --- | --- |
| 端口被占用 | 设置 `PHOTO_SELECTOR_PORT`，不需要关闭其他照片库 |
| 原生依赖缺失 | 安装 Node.js 24+；需要 Vision 时安装 Swift 6 工具链；重新部署 |
| 原生部署锁遗留 | 确认没有部署进程，再移除错误信息指向的 `deploy.lock`，不要删除业务库 |
| 403 访问地址未配置 | 检查浏览器域名、协议和端口；填写 `PUBLIC_URL` 或 `ALLOWED_ORIGINS` 后重新部署 |
| 本地照片离线 | 使用原浏览器和访问地址，在作品集中重新连接文件夹 |
| 更新后显示空库 | 检查数据目录或 Docker 卷名，先切回原配置，不要清库 |
| Docker 无法连接本地模型 | 使用 `host.docker.internal`，确认模型允许 Docker 网络访问 |
| 原生服务不健康 | 查看 `.local/run/native.log`；检查端口、目录权限和磁盘空间 |

## 验证与显式重置

```sh
npm run check
npm run test:browser
npm run test:native   # Mac，独立测试库
npm run test:docker   # 独立容器和一次性测试卷
```

CI 在 Mac 和 Linux 分别验证原生及 Docker 流程。部署验收不会调用付费模型。详见 [测试记录](TESTING.md)。

日常升级不需要重置。`server/reset-library.mjs --confirm` 是显式、不可撤销的业务清理工具，仅供确实需要清空指定照片库时使用，绝不加入自动启动流程。

## 手机上传、后台分类与三小时清理

升级保留照片、AI 配置、密码和分享。新增 `source-files/` 保存上传的 PNG／HEIC 原文件，`originals/` 保留供浏览器和拼图使用的 JPEG 副本；备份请包含整个数据目录。HEIC 解码使用随 npm 安装的 libheif-js，在独立 Worker 中串行执行，不要求额外安装系统解码器，Mac 与 Docker 使用同一实现。

初筛保留／待定会自动排队 AI 分类，包括升级后已有入选照片的缺失结果。服务配置可在设置里调整，完整结果不因换模型自动重跑；已有暂停或取消的任务保留其状态。已有旧版 AI 队列仍可继续或取消。手机关闭后服务器照片的分类继续；仅保存在电脑目录的照片需原浏览器在线准备去 EXIF 的预览。

初筛淘汰照片从决定成功起保留三小时；每分钟检查到期任务，重启补执行。升级前仍未删除的旧淘汰记录给予新的三小时宽限期，并在数据目录创建迁移备份。清理前检查引用，不删除电脑源文件。运行中、失败或仍被引用的文件可能晚于截止时间清理；网页不再要求手动点击删除。

浏览照片墙每页读取 40 张元数据，进入照片墙不轮询整个管理库。手机普通 HTTP 可相册上传；电脑文件夹授权仍需要 localhost 或 HTTPS。API、登录和分享访问校验继续生效，不需要放开任意跨域。
