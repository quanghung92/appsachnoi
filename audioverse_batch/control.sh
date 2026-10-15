#!/bin/bash
# -*- coding: utf-8 -*-
# AudioVerse Control Panel - Menu điều khiển batch worker & streaming server
# Đặt trong thư mục audioverse_batch, chạy: bash control.sh

BATCH_DIR="$(cd "$(dirname "$0")" && pwd)"

# Nạp cấu hình gist từ file local (nếu có)
GIST_ENV_FILE="$BATCH_DIR/.gist.env"
if [ -f "$GIST_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; . "$GIST_ENV_FILE"; set +a
fi
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

# Đẩy URL tunnel lên GitHub Gist để app tự lấy (không cần dán tay).
# Cần 2 env var: GITHUB_TOKEN (scope: gist), GIST_ID.
# Mỗi máy ghi entry riêng theo MACHINE_NAME (mặc định: hostname) nên không đè nhau.
# App hiện danh sách máy cho người dùng chọn.
update_tunnel_gist() {
    local tunnel_url="$1"
    [ -z "$tunnel_url" ] && return 1
    if [ -z "$GITHUB_TOKEN" ] || [ -z "$GIST_ID" ]; then
        echo "  (Bỏ qua cập nhật gist: chưa đặt GITHUB_TOKEN/GIST_ID)"
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "  (Bỏ qua cập nhật gist: thiếu python3)"
        return 1
    fi
    local machine="${MACHINE_NAME:-$(hostname 2>/dev/null || echo unknown)}"
    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)

    # Ghi script python ra file tạm (heredoc không ổn định trên Git Bash Windows)
    local py_tmp
    py_tmp=$(mktemp 2>/dev/null || echo "$BATCH_DIR/.gist_update_tmp.py")
    cat > "$py_tmp" <<'PYEOF'
import json, os, sys, urllib.request, urllib.error

token = os.environ.get("GITHUB_TOKEN", "")
gist_id = os.environ.get("GIST_ID", "")
url = os.environ.get("TUNNEL_URL", "")
machine = os.environ.get("MACHINE", "unknown")
now = os.environ.get("NOW", "")
api = f"https://api.github.com/gists/{gist_id}"
headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
           "User-Agent": "AudioVerse-control.sh"}

try:
    req = urllib.request.Request(api, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        gist = json.load(r)
    content = gist.get("files", {}).get("audioverse-tunnel.json", {}).get("content", "{}")
    try:
        data = json.loads(content)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if "url" in data and "machines" not in data:
        data = {"machines": {"legacy": {"url": data["url"], "updated_at": data.get("updated_at", now)}}}
    machines = data.get("machines", {})
    if not isinstance(machines, dict):
        machines = {}
    machines[machine] = {"url": url, "updated_at": now}
    data["machines"] = machines

    payload = json.dumps({"files": {"audioverse-tunnel.json": {"content": json.dumps(data)}}}).encode()
    req = urllib.request.Request(api, data=payload, headers=headers, method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as r:
        print(r.status)
except urllib.error.HTTPError as e:
    print(f"HTTP_ERROR:{e.code}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"ERROR:{e}", file=sys.stderr)
    sys.exit(1)
PYEOF

    local result
    result=$(GITHUB_TOKEN="$GITHUB_TOKEN" GIST_ID="$GIST_ID" TUNNEL_URL="$tunnel_url" MACHINE="$machine" NOW="$now" python3 "$py_tmp" 2>&1)
    local py_exit=$?
    rm -f "$py_tmp"

    if [ $py_exit -eq 0 ] && [ "$result" = "200" ]; then
        echo "  ✓ Đã cập nhật gist (máy: $machine)"
        return 0
    else
        echo "  ✗ Cập nhật gist thất bại: $result"
        return 1
    fi
}

# Cấu hình Gist: xem/sửa/lưu token, gist ID, tên máy vào file local .gist.env
setup_gist_config() {
    echo "========== CẤU HÌNH GIST =========="
    local cur_token="${GITHUB_TOKEN:-}"
    local cur_gist="${GIST_ID:-}"
    local cur_machine="${MACHINE_NAME:-$(hostname 2>/dev/null || echo '')}"

    if [ -n "$cur_token" ]; then
        echo "  Token hiện tại : ${cur_token:0:7}...${cur_token: -4} (đã lưu)"
    else
        echo "  Token hiện tại : (chưa có)"
    fi
    echo "  Gist ID hiện tại: ${cur_gist:-(chưa có)}"
    echo "  Tên máy hiện tại: ${cur_machine:-(chưa có)}"
    echo ""
    echo "Nhập giá trị mới (Enter để giữ nguyên):"

    read -p "  GitHub token (scope gist): " new_token
    read -p "  Gist ID: " new_gist
    read -p "  Tên máy (vd: nha, ubuntu): " new_machine

    [ -n "$new_token" ] && cur_token="$new_token"
    [ -n "$new_gist" ] && cur_gist="$new_gist"
    [ -n "$new_machine" ] && cur_machine="$new_machine"

    if [ -z "$cur_token" ] || [ -z "$cur_gist" ]; then
        echo "✗ Thiếu token hoặc Gist ID, chưa lưu."
        return 1
    fi

    cat > "$GIST_ENV_FILE" <<EOF
# Cấu hình Gist cho AudioVerse - file local, KHÔNG commit lên git
GITHUB_TOKEN=$cur_token
GIST_ID=$cur_gist
MACHINE_NAME=$cur_machine
EOF
    # Nạp ngay để dùng luôn trong phiên này
    GITHUB_TOKEN="$cur_token"
    GIST_ID="$cur_gist"
    MACHINE_NAME="$cur_machine"
    echo "✓ Đã lưu vào $GIST_ENV_FILE"
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
        update_tunnel_gist "$URL"
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

# Lần đầu mở: nếu chưa cấu hình gist thì hỏi luôn
if [ -z "$GITHUB_TOKEN" ] || [ -z "$GIST_ID" ]; then
    echo "Chưa cấu hình GitHub Gist cho tunnel URL."
    read -p "Cấu hình ngay? (Y/n): " ask_setup
    if [[ ! "$ask_setup" =~ ^[Nn]$ ]]; then
        setup_gist_config
        echo ""
        read -p "Nhấn Enter để vào menu chính..."
    fi
fi
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
    echo "  10. Cập nhật URL tunnel lên Gist (cho app tự lấy)"
    echo "  11. Cấu hình Gist (xem/sửa token, Gist ID, tên máy)"
    echo "  0. Thoát"
    echo ""
    read -p "Chọn [0-11]: " choice
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
        10)
            CUR_URL=$(grep -o "https://[a-zA-Z0-9.-]*\.trycloudflare\.com" "$BATCH_DIR/tunnel.log" 2>/dev/null | head -1)
            if [ -n "$CUR_URL" ]; then
                echo "URL hiện tại: $CUR_URL"
                update_tunnel_gist "$CUR_URL"
            else
                echo "✗ Chưa thấy URL trong tunnel.log — tunnel có đang chạy không?"
            fi
            ;;
        11) setup_gist_config ;;
        0) echo "Tạm biệt!"; exit 0 ;;
        *) echo "Lựa chọn không hợp lệ." ;;
    esac
    echo ""
    read -p "Nhấn Enter để tiếp tục..."
done
