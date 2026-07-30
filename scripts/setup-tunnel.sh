#!/usr/bin/env bash
# 여백을 Cloudflare Tunnel 로 HTTPS 공개한다. 포트는 열지 않는다 (아웃바운드 전용).
#
#   1) cloudflared tunnel login      ← 브라우저 로그인, 먼저 직접 실행해야 한다
#   2) ./scripts/setup-tunnel.sh yeobaek.example.com
#
# 인자로 준 호스트명의 도메인이 Cloudflare 에 등록돼 있어야 한다.
set -euo pipefail

HOST="${1:-}"
NAME="${2:-yeobaek}"
PORT="${PORT:-8787}"

if [ -z "$HOST" ]; then
  echo "사용법: $0 <호스트명> [터널이름]" >&2
  echo "  예:   $0 yeobaek.example.com" >&2
  exit 1
fi

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "✗ 로그인이 안 돼 있습니다. 먼저 실행하세요:" >&2
  echo "    cloudflared tunnel login" >&2
  exit 1
fi

# 같은 이름의 터널이 있으면 재사용한다
if cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$NAME"; then
  echo "· 기존 터널 '$NAME' 을 재사용합니다"
else
  echo "· 터널 '$NAME' 생성"
  cloudflared tunnel create "$NAME"
fi

UUID=$(cloudflared tunnel list --output json | python3 -c \
  "import sys,json;print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$NAME'))")
echo "· 터널 UUID: $UUID"

sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/$UUID.json" /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: $UUID
credentials-file: /etc/cloudflared/$UUID.json
originRequest:
  # SSE 스트리밍이 끊기지 않도록 여유를 둔다 (서버 상한은 90초)
  connectTimeout: 30s
  noTLSVerify: false
ingress:
  - hostname: $HOST
    service: http://localhost:$PORT
  - service: http_status:404
EOF

echo "· DNS 레코드 연결: $HOST"
cloudflared tunnel route dns "$NAME" "$HOST"

echo "· systemd 서비스 설치"
sudo cloudflared --config /etc/cloudflared/config.yml service install || true
sudo systemctl enable --now cloudflared
sleep 3
systemctl is-active cloudflared

echo
echo "✓ 완료 → https://$HOST"
echo "  로그: sudo journalctl -u cloudflared -f"
