#!/usr/bin/env bash
#
# 내부 서버 배포 스크립트
# - 로컬(내 PC)의 SSH 키로 접속해 소스를 rsync 하고, 서버에서 docker compose 로
#   네이티브 빌드·기동합니다. (서버가 amd64 여도 크로스 빌드 불필요)
#
# 사용:
#   1) cp .env.prod.example .env.prod  → API 키/DB 비밀번호 채우기
#   2) ./deploy.sh                      (기본값으로 배포)
#   환경변수로 덮어쓰기:
#   SSH_USER=root SSH_HOST=192.168.20.92 SSH_KEY=~/.ssh/hyperinfo-rocky8 ./deploy.sh
#
# 대상 서버: Rocky Linux 9.7 (x86_64) — amd64 네이티브 빌드.
set -euo pipefail

# ===== 설정 (환경변수로 덮어쓰기 가능) =====
SSH_HOST="${SSH_HOST:-192.168.20.92}"
SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/hyperinfo-rocky8}"   # 로컬 PC의 SSH 개인키
REMOTE_DIR="${REMOTE_DIR:-/data/AIProject}"
COMPOSE_FILE="docker-compose.prod.yml"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 키 파일이 있으면 -i 옵션 사용, 없으면 기본 에이전트/설정에 위임
SSH_OPTS=(-p "${SSH_PORT}")
RSYNC_SSH="ssh -p ${SSH_PORT}"
if [[ -f "${SSH_KEY}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
  RSYNC_SSH="ssh -p ${SSH_PORT} -i ${SSH_KEY}"
else
  echo "ℹ SSH 키 '${SSH_KEY}' 가 없어 기본 SSH 설정으로 시도합니다."
fi

SSH_TARGET="${SSH_USER}@${SSH_HOST}"
SSH_CMD=(ssh "${SSH_OPTS[@]}" "${SSH_TARGET}")

echo "▶ 배포 대상 : ${SSH_TARGET}:${REMOTE_DIR}  (port ${SSH_PORT})"

# ----- 0) 사전 점검 -----
if [[ ! -f .env.prod ]]; then
  echo "✗ .env.prod 가 없습니다. 'cp .env.prod.example .env.prod' 후 값을 채우세요." >&2
  exit 1
fi
if ! command -v rsync >/dev/null 2>&1; then
  echo "✗ 로컬에 rsync 가 필요합니다." >&2
  exit 1
fi

echo "▶ SSH 연결 확인..."
"${SSH_CMD[@]}" "command -v docker >/dev/null 2>&1 || { echo '✗ 서버에 docker 가 없습니다.'; exit 1; }"
"${SSH_CMD[@]}" "docker compose version >/dev/null 2>&1 || { echo '✗ 서버에 docker compose v2 가 없습니다.'; exit 1; }"

# ----- 1) 원격 디렉터리 준비 -----
"${SSH_CMD[@]}" "mkdir -p '${REMOTE_DIR}'"

# ----- 2) 소스 동기화 (빌드 산출물·시크릿·git 제외) -----
echo "▶ 소스 rsync..."
rsync -az --delete \
  -e "${RSYNC_SSH}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.prod' \
  --exclude 'server/.env' \
  --exclude 'server-py/.env' \
  --exclude 'client/.env' \
  --exclude '*.log' \
  ./ "${SSH_TARGET}:${REMOTE_DIR}/"

# ----- 3) 시크릿(.env) 전송 → compose 가 읽음 -----
echo "▶ .env 전송..."
SCP_OPTS=(-P "${SSH_PORT}")
[[ -f "${SSH_KEY}" ]] && SCP_OPTS+=(-i "${SSH_KEY}")
scp "${SCP_OPTS[@]}" .env.prod "${SSH_TARGET}:${REMOTE_DIR}/.env"

# ----- 4) 원격 빌드 & 기동 -----
echo "▶ 원격 빌드 & 기동 (docker compose up -d --build)..."
"${SSH_CMD[@]}" "cd '${REMOTE_DIR}' && docker compose -f ${COMPOSE_FILE} up -d --build --remove-orphans"

# ----- 5) 상태 확인 -----
echo "▶ 컨테이너 상태:"
"${SSH_CMD[@]}" "cd '${REMOTE_DIR}' && docker compose -f ${COMPOSE_FILE} ps"

WEB_PORT_LOCAL="$(grep -E '^WEB_PORT=' .env.prod | cut -d= -f2 || true)"
WEB_PORT_LOCAL="${WEB_PORT_LOCAL:-8080}"
echo ""
echo "✔ 배포 완료 → http://${SSH_HOST}:${WEB_PORT_LOCAL}"
echo "  헬스체크   → http://${SSH_HOST}:${WEB_PORT_LOCAL}/api/health"
echo "  로그 보기  → ssh ${SSH_OPTS[*]} ${SSH_TARGET} 'cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} logs -f server'"
