#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mode=auto
action=deploy
for arg in "$@"; do
  case "$arg" in
    --native) mode=native ;;
    --docker) mode=docker ;;
    start|stop|restart|status|logs) action="$arg" ;;
    --help|-h) echo '用法: ./deploy.sh [--native|--docker] [start|stop|restart|status|logs]'; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done
if [[ "$mode" == auto ]]; then
  if [[ "$(uname -s)" == Darwin ]]; then mode=native; else mode=docker; fi
fi
if [[ "$mode" == docker ]]; then exec bash scripts/deploy-docker.sh "$action"; fi
if [[ "$(uname -s)" != Darwin ]]; then echo '原生一键部署支持 macOS，请使用 ./deploy.sh --docker。' >&2; exit 1; fi
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  for node_dir in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
    if [[ -x "$node_dir/node" ]]; then export PATH="$node_dir:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  echo '需要 Node.js 24+。已有 Homebrew: brew install node@24；否则从 https://nodejs.org 下载 Node.js 24 安装包。' >&2; exit 1
fi
exec node scripts/deploy-native.mjs "$action"
