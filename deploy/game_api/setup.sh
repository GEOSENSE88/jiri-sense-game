#!/usr/bin/env bash
# 지리SENSE GAME 명예의 전당 API 설치/갱신 스크립트 (서버에서 sudo로 실행)
set -euo pipefail

APP=/var/www/game_api
SRC=/tmp/game_api

echo "[1/6] 앱 디렉터리 준비"
sudo mkdir -p "$APP"
sudo cp "$SRC/app.py" "$SRC/requirements.txt" "$APP/"

echo "[2/6] python venv"
if [ ! -x "$APP/venv/bin/python" ]; then
  sudo python3 -m venv "$APP/venv"
fi
sudo "$APP/venv/bin/pip" install --upgrade pip -q
sudo "$APP/venv/bin/pip" install -q -r "$APP/requirements.txt"

echo "[3/6] 권한 (www-data 가 DB 기록)"
sudo chown -R www-data:www-data "$APP"

echo "[4/6] systemd 유닛"
sudo cp "$SRC/game_api.service" /etc/systemd/system/game_api.service
sudo systemctl daemon-reload
sudo systemctl enable game_api >/dev/null 2>&1 || true
sudo systemctl restart game_api

echo "[5/6] 기동 확인"
sleep 2
sudo systemctl --no-pager status game_api | head -6 || true

echo "[6/6] 소켓 헬스체크"
curl -s --unix-socket /run/game_api/gunicorn.sock http://x/api/health || echo "  (헬스체크 실패)"
echo
echo "완료."
