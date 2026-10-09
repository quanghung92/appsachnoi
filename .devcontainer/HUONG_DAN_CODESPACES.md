# Chạy server TTS AudioVerse trên GitHub Codespaces (free, không cần thẻ)
#
# ## Cách dùng (làm 1 lần)
# 1. Vào repo trên github.com, bấm nút xanh "Code" -> tab "Codespaces"
#    -> "Create codespace on main". Chờ ~3-5 phút (lần đầu nó tự
#    cài thư viện qua devcontainer.json).
# 2. Trong terminal của Codespace, chạy:
#        python server.py
#    (Lần đầu nó tải model Kokoro ~300MB, một lần duy nhất.)
# 3. Mở tab "PORTS" (cạnh TERMINAL), tìm port 3000, chuột phải
#    -> "Port Visibility" -> "Public".
# 4. Copy địa chỉ ở cột "Forwarded Address", dạng:
#        https://ten-codespace-3000.app.github.dev
# 5. Dán vào ô server trong chỗ chọn giọng của app -> "Lưu & Thử".
#
# ## Lưu ý gói free
# - 60 giờ/tháng cho máy 2-core (không cần thẻ, hết giờ thì chờ tháng sau).
# - Codespace tự tắt sau 30 phút không dùng. Mỗi lần nghe: vào
#   github.com/codespaces bấm Start, chờ ~1 phút rồi nghe như bình thường.
# - URL public ổn định cho từng codespace, không đổi mỗi lần bật.
