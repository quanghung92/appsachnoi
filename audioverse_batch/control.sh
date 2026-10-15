#!/bin/bash
# -*- coding: utf-8 -*-
# AudioVerse Control Panel - Menu điều khiển batch worker & streaming server
# Đặt trong thư mục audioverse_batch, chạy: bash control.sh

BATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
# Tự tìm python: ưu tiên venv trong thư mục project (cả Linux và Windows), rồi mới tới python hệ thống
if [ -x "$BATCH_DIR/venv/bin/python" ]; then
    VENV_PY="$BATCH_DIR/venv/bin/python"
elif [ -x "$BATCH_DIR/venv/Scripts/python.exe" ]; then
    VENV_PY="$BATCH_DIR/venv/Scripts/python.exe"
elif [ -x "$(dirname "$BATCH_DIR")/venv/bin/python" ]; then
    VENV_PY="$(dirname "$BATCH_DIR")/venv/bin/python"
elif [ -x "$(dirname "$BATCH_DIR")/venv/Scripts/python.exe" ]; then
    VENV_PY="$(dirname "$BATCH_DIR")/venv/Scripts/python.exe"
elif command -v python3 >/dev/null 2>&1 && python3 --version >/dev/null 2>&1; then
    VENV_PY="python3"
elif command -v python >/dev/null 2>&1; then
    VENV_PY="python"
else
    VENV_PY="python3"
fi

WORKER="/home/hungnq/only_me/local_batch.py"
STREAM_LOG="$BATCH_DIR/server.log"
STREAM_PID_FILE="$BATCH_DIR/server.pid"
TUNNEL_PID_FILE="$BATCH_DIR/tunnel.pid"

# --- Hàm kiểm tra tiến trình đa nền tảng (Linux / Git Bash Windows) ---
is_pid_running() {
    local pid="$1"
    [ -z "$pid" ] && return 1
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    elif command -v tasklist >/dev/null 2>&1; then
        tasklist 2>/dev/null | grep -q "[[:space:]]$pid[[:space:]]" && return 0
    fi
    return 1
}

is_stream_running() {
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -f "server_streaming.py" > /dev/null 2>&1 && return 0
    fi
    if [ -f "$STREAM_PID_FILE" ]; then
        local spid
        spid=$(cat "$STREAM_PID_FILE" 2>/dev/null)
        if is_pid_running "$spid"; then return 0; fi
    fi
    if command -v curl >/dev/null 2>&1; then
        curl -s -m 1 http://127.0.0.1:3000/docs >/dev/null 2>&1 && return 0
    fi
    return 1
}

is_tunnel_running() {
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -f "cloudflared tunnel" > /dev/null 2>&1 && return 0
    fi
    if [ -f "$TUNNEL_PID_FILE" ]; then
        local tpid
        tpid=$(cat "$TUNNEL_PID_FILE" 2>/dev/null)
        if is_pid_running "$tpid"; then return 0; fi
    fi
    if command -v tasklist >/dev/null 2>&1; then
        tasklist 2>/dev/null | grep -i -q "cloudflared" && return 0
    fi
    return 1
}

is_cron_enabled() {
    if ! command -v crontab >/dev/null 2>&1; then
        return 1
    fi
    crontab -l 2>/dev/null | grep -q "^[^#].*local_batch"
}

show_status() {
    echo "========== TRẠNG THÁI =========="
    is_stream_running && echo "  [●] Streaming server : ĐANG CHẠY" || echo "  [○] Streaming server : DỪNG"
    is_tunnel_running && echo "  [●] Cloudflare tunnel: ĐANG CHẠY" || echo "  [○] Cloudflare tunnel: DỪNG"
    if command -v crontab >/dev/null 2>&1; then
        is_cron_enabled && echo "  [●] Batch cron        : BẬT" || echo "  [○] Batch cron        : TẮT"
    else
        echo "  [-] Batch cron        : KHÔNG KHẢ DỤNG (chỉ chạy trên Linux)"
    fi
    echo "================================"
    echo ""
}

# --- Hành động ---
start_stream() {
    if is_stream_running; then echo "Server đang chạy rồi."; return; fi
    cd "$BATCH_DIR" || exit 1
    nohup "$VENV_PY" server_streaming.py > "$STREAM_LOG" 2>&1 &
    local pid=$!
    echo "$pid" > "$STREAM_PID_FILE"
    sleep 2
    is_stream_running && echo "✓ Streaming server đã chạy (PID: $pid, log: server.log)" || echo "✗ Lỗi! Xem server.log"
}

stop_stream() {
    if ! is_stream_running; then echo "Server đang dừng rồi."; return; fi
    if [ -f "$STREAM_PID_FILE" ]; then
        local spid
        spid=$(cat "$STREAM_PID_FILE" 2>/dev/null)
        if [ -n "$spid" ]; then
            kill "$spid" 2>/dev/null || kill -9 "$spid" 2>/dev/null || taskkill //PID "$spid" //F >/dev/null 2>&1
        fi
        rm -f "$STREAM_PID_FILE"
    fi
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "server_streaming.py" 2>/dev/null
    fi
    sleep 1
    echo "✓ Đã dừng streaming server."
}

get_cloudflared_bin() {
    if command -v cloudflared >/dev/null 2>&1; then
        echo "cloudflared"
    elif [ -x "$BATCH_DIR/cloudflared.exe" ]; then
        echo "$BATCH_DIR/cloudflared.exe"
    elif [ -x "$BATCH_DIR/cloudflared" ]; then
        echo "$BATCH_DIR/cloudflared"
    fi
}

start_tunnel() {
    if is_tunnel_running; then echo "Tunnel đang chạy rồi."; return; fi
    local cf_bin
    cf_bin=$(get_cloudflared_bin)
    if [ -z "$cf_bin" ]; then
        echo "✗ Chưa tìm thấy cloudflared."
        echo "  Cách 1: Chạy lệnh cài đặt: winget install --id Cloudflare.cloudflared -e"
        echo "  Cách 2: Tải cloudflared-windows-amd64.exe từ Cloudflare rồi đổi tên thành cloudflared.exe bỏ vào thư mục audioverse_batch này."
        return
    fi
    nohup "$cf_bin" tunnel --url http://localhost:3000 > "$BATCH_DIR/tunnel.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$TUNNEL_PID_FILE"
    sleep 5
    URL=$(grep -o "https://[a-zA-Z0-9.-]*\.trycloudflare\.com" "$BATCH_DIR/tunnel.log" | head -1)
    if [ -n "$URL" ]; then
        echo "✓ Tunnel đã chạy! (PID: $pid)"
        echo "  URL: $URL"
        echo "  Dán URL này vào app iPhone."
    else
        echo "Tunnel đang khởi động, xem URL trong tunnel.log sau vài giây."
    fi
}

stop_tunnel() {
    if ! is_tunnel_running; then echo "Tunnel đang dừng rồi."; return; fi
    if [ -f "$TUNNEL_PID_FILE" ]; then
        local tpid
        tpid=$(cat "$TUNNEL_PID_FILE" 2>/dev/null)
        if [ -n "$tpid" ]; then
            kill "$tpid" 2>/dev/null || kill -9 "$tpid" 2>/dev/null || taskkill //PID "$tpid" //F >/dev/null 2>&1
        fi
        rm -f "$TUNNEL_PID_FILE"
    fi
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "cloudflared tunnel" 2>/dev/null
    elif command -v taskkill >/dev/null 2>&1; then
        taskkill //IM "cloudflared.exe" //F >/dev/null 2>&1
    fi
    echo "✓ Đã dừng tunnel."
}

enable_cron() {
    if ! command -v crontab >/dev/null 2>&1; then
        echo "✗ crontab không tồn tại trên hệ thống này (chỉ hỗ trợ trên Linux)."
        return
    fi
    crontab -l 2>/dev/null | sed 's/^#\([^#]*local_batch\)/\1/' | crontab -
    echo "✓ Đã BẬT batch cron."
}

disable_cron() {
    if ! command -v crontab >/dev/null 2>&1; then
        echo "✗ crontab không tồn tại trên hệ thống này (chỉ hỗ trợ trên Linux)."
        return
    fi
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

upload_to_drive() {
    echo "Đang quét các chương đã stream xong để đẩy lên Drive..."
    cd "$BATCH_DIR" || exit 1
    if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ] || [ -z "$GOOGLE_REFRESH_TOKEN" ]; then
        echo "✗ Thiếu env var: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN"
        echo "  Export 3 biến này trước khi chạy."
        return
    fi
    "$VENV_PY" batch_upload_drive.py
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
    echo "  9. Đẩy chương đã stream xong lên Google Drive"
    echo "  0. Thoát"
    echo ""
    read -p "Chọn [0-9]: " choice
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
        9) upload_to_drive ;;
        0) echo "Tạm biệt!"; exit 0 ;;
        *) echo "Lựa chọn không hợp lệ." ;;
    esac
    echo ""
    read -p "Nhấn Enter để tiếp tục..."
done
