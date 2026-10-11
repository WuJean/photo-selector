#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v docker >/dev/null 2>&1; then
  echo '请先安装 Docker Desktop（Mac/Windows）或 Docker Engine + Compose v2（Linux）。' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Docker 尚未启动，请启动 Docker 后重新执行 ./deploy.sh。' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo '需要 Docker Compose v2，请更新 Docker。' >&2
  exit 1
fi
docker compose up -d --build --wait --wait-timeout 120
echo '选片助手已启动。访问地址：'
docker compose exec -T web node -e 'console.log(process.env.PHOTO_SELECTOR_PUBLIC_URL)'
echo '首次密码：docker compose exec -T web cat /data/admin-initial-password'
echo '本地原片留在电脑，上传文件、分享副本和设置保存在数据卷。更新时重新运行 ./deploy.sh。'
