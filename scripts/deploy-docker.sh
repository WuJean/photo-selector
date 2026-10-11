#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
action="${1:-deploy}"
for command in docker; do
  if ! command -v "$command" >/dev/null; then echo '请安装并启动 Docker Desktop，或 Docker Engine + Compose v2。' >&2; exit 1; fi
done
docker info >/dev/null 2>&1 || { echo 'Docker 尚未启动。' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo '需要 Docker Compose v2。' >&2; exit 1; }
# Read only deployment keys as literal data; never source executable shell text.
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^(PHOTO_SELECTOR_PORT|PHOTO_SELECTOR_BIND|PHOTO_SELECTOR_PUBLIC_URL|PHOTO_SELECTOR_ALLOWED_ORIGINS|PHOTO_SELECTOR_VOLUME|TZ)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
      if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
      if ! printenv "$key" >/dev/null; then export "$key=$value"; fi
    fi
  done < .env
fi
export PHOTO_SELECTOR_PORT="${PHOTO_SELECTOR_PORT:-4173}"
export PHOTO_SELECTOR_BIND="${PHOTO_SELECTOR_BIND:-0.0.0.0}"
ips=""
if [[ "$PHOTO_SELECTOR_BIND" != 127.0.0.1 && "$PHOTO_SELECTOR_BIND" != ::1 ]]; then
  if [[ "$(uname -s)" == Darwin ]]; then
    primary=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)
    for iface in "$primary" en0 en1; do
      [[ -z "$iface" ]] && continue
      address=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
      [[ "$address" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]] && ips="$ips $address"
    done
  else ips=$(hostname -I 2>/dev/null || true); fi
fi
origins="http://localhost:$PHOTO_SELECTOR_PORT,http://127.0.0.1:$PHOTO_SELECTOR_PORT,http://[::1]:$PHOTO_SELECTOR_PORT"
primary_ip=""
for address in $ips; do
  if [[ "$address" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
    [[ -n "$primary_ip" ]] || primary_ip="$address"
    origins="$origins,http://$address:$PHOTO_SELECTOR_PORT"
  fi
done
export PHOTO_SELECTOR_PUBLIC_URL="${PHOTO_SELECTOR_PUBLIC_URL:-http://${primary_ip:-localhost}:$PHOTO_SELECTOR_PORT}"
export PHOTO_SELECTOR_ALLOWED_ORIGINS="$origins${PHOTO_SELECTOR_ALLOWED_ORIGINS:+,$PHOTO_SELECTOR_ALLOWED_ORIGINS}"
case "$action" in
  deploy) docker compose up -d --build --wait --wait-timeout 120 ;;
  start) docker compose up -d --wait --wait-timeout 120 ;;
  stop) docker compose stop; exit ;;
  restart) docker compose restart; exit ;;
  status) docker compose ps; exit ;;
  logs) docker compose logs --tail=100 -f web; exit ;;
  *) echo '未知操作' >&2; exit 1 ;;
esac
echo "本机访问：http://localhost:$PHOTO_SELECTOR_PORT"
echo "分享地址：$PHOTO_SELECTOR_PUBLIC_URL"
echo '首次密码：passwd。首次登录必须改密；请改密后再分享访问地址。已有密码不变。'
echo '使用 ./deploy.sh --docker 更新；数据卷保持不变。'
