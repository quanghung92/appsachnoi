#!/bin/bash
# -*- coding: utf-8 -*-
# AudioVerse Control Panel - Menu điều khiển batch worker & streaming server
# Đặt trong thư mục audioverse_batch, chạy: bash control.sh

BATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PY="/home/hungnq/audioverse-venv/bin/python"
WORKER="/home/hungnq/only_me/local_batch.py"
STREAM_LOG="$BATCH_DIR/server.log"
# --- Hàm kiểm tra ---
is_stream_running() { pgrep -f "server_streaming.py" > /dev/null; }
is_tunnel_running() { pgrep -f "cloudflared tunnel" > /dev/null; }
is_cron_enabled() { crontab -l 2>/dev/null | grep -q "^[^#].*local_batch"; }

show_status() {
    echo "========== TRẠNG THÁI =========="
    is_stream_running && echo "  [●] Streaming server : ĐANG CHẠY" || echo "  [○] Streaming server : DỪNG"
    is_tunnel_running && echo "  [●] Cloudflare tunnel: ĐANG CHẠY" || echo "  [○] Cloudflare tunnel: DỪNG"
    is_cron_enabled && echo "  [●] Batch cron        : BẬT" || echo "  [○] Batch cron        : TẮT"
    echo "================================"
    echo ""
}

# --- Hành động ---
start_stream() {
    if is_stream_running; then echo "Server đang chạy rồi."; return; fi
    cd "$BATCH_DIR" || exit 1
    nohup "$VENV_PY" server_streaming.py > "$STREAM_LOG" 2>&1 &
    sleep 2
    is_stream_running && echo "✓ Streaming server đã chạy (log: server.log)" || echo "✗ Lỗi! Xem server.log"
}

stop_stream() {
    if ! is_stream_running; then echo "Server đang dừng rồi."; return; fi
    pkill -f "server_streaming.py"
    sleep 1
    echo "✓ Đã dừng streaming server."
}

start_tunnel() {
    if is_tunnel_running; then echo "Tunnel đang chạy rồi."; return; fi
    nohup cloudflared tunnel --url http://localhost:3000 > "$BATCH_DIR/tunnel.log" 2>&1 &
    sleep 5
    URL=$(grep -o "https://[a-zA-Z0-9.-]*\.trycloudflare\.com" "$BATCH_DIR/tunnel.log" | head -1)
    if [ -n "$URL" ]; then
        echo "✓ Tunnel đã chạy!"
        echo "  URL: $URL"
        echo "  Dán URL này vào app iPhone."
    else
        echo "Tunnel đang khởi động, xem URL trong tunnel.log sau vài giây."
    fi
}

stop_tunnel() {
    if ! is_tunnel_running; then echo "Tunnel đang dừng rồi."; return; fi
    pkill -f "cloudflared tunnel"
    echo "✓ Đã dừng tunnel."
}

enable_cron() {
    crontab -l 2>/dev/null | sed 's/^#\([^#]*local_batch\)/\1/' | crontab -
    echo "✓ Đã BẬT batch cron."
}

disable_cron() {
    crontab -l 2>/dev/null | sed 's/^[^#]*local_batch/#&/' | crontab -
    echo "✓ Đã TẮT batch cron."
}

pull_latest() {
    echo "Đang kéo code mới từ GitHub..."
    cd "$BATCH_DIR" || exit 1
    # Tìm root git (có thể là sparse checkout)
    GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -n "$GIT_ROOT" ]; then
        cd "$GIT_ROOT" && git pull --ff-only
    else
        echo "✗ Không tìm thấy git repo."
    fi
}

# --- Menu chính ---
while true; do
    clear
    echo "╔══════════════════════════════════════╗"
    echo "║     AudioVerse Control Panel         ║"
    echo "╚══════════════════════════════════════╝"
    echo ""
    show_status
    echo "  1. Chạy streaming server"
    echo "  2. Dừng streaming server"
    echo "  3. Chạy Cloudflare tunnel (lấy URL cho iPhone)"
    echo "  4. Dừng Cloudflare tunnel"
    echo "  5. BẬT batch cron (worker cũ theo giờ)"
    echo "  6. TẮT batch cron"
    echo "  7. Kéo code mới từ GitHub"
    echo "  8. Xem log streaming server"
    echo "  0. Thoát"
    echo ""
    read -p "Chọn [0-8]: " choice
    echo ""
    case $choice in
        1) start_stream ;;
        2) stop_stream ;;
        3) start_tunnel ;;
        4) stop_tunnel ;;
        5) enable_cron ;;
        6) disable_cron ;;
        7) pull_latest ;;
        8) tail -50 "$STREAM_LOG" 2>/dev/null || echo "Chưa có log." ;;
        0) echo "Tạm biệt!"; exit 0 ;;
        *) echo "Lựa chọn không hợp lệ." ;;
    esac
    echo ""
    read -p "Nhấn Enter để tiếp tục..."
done
