# Chạy Kokoro TTS trên Modal (Free $30/tháng, không cần thẻ)

## 🎯 Vì sao là Modal?

- **Serverless**: Có request tới từ app AudioVerse là container tự tỉnh, đọc xong tự ngủ sau 5 phút không dùng. **Không cần bấm nút bật/tắt.**
- **URL cố định**: Sau khi deploy bạn có 1 URL cố định dạng `https://<ten-ban>--audioverse-kokoro-api.modal.run` — dán vào app AudioVerse **1 lần duy nhất**.
- **Miễn phí $30/tháng**: Với nhu cầu nghe sách cá nhân (mỗi lần 2–3 tiếng), mức $30/tháng (gói Starter free không cần add thẻ tín dụng) dùng không bao giờ hết (Kokoro chạy ONNX CPU rất nhẹ và tiết kiệm).
- **Hỗ trợ đầy đủ**: GET /tts.wav, POST /tts, bóc tách chương truyện web /api/crawl, CORS cho điện thoại.

---

## 🚀 Các bước cài đặt (Làm 1 lần duy nhất)

Thư mục chạy: `C:\Users\OS\Downloads\modal_kokoro`

### Bước 1: Đăng ký tài khoản Modal
1. Mở trình duyệt vào [https://modal.com](https://modal.com).
2. Bấm **Sign up** (đăng nhập bằng GitHub hoặc Google). Không yêu cầu thẻ tín dụng.

### Bước 2: Cài Modal CLI trên PC
Mở PowerShell tại máy tính và chạy:
```powershell
pip install modal
```

### Bước 3: Đăng nhập Modal CLI
Chạy lệnh:
```powershell
modal setup
```
Trình duyệt sẽ tự động bật lên tab xác thực. Bấm **Allow / Authorize** để hoàn tất đăng nhập.

### Bước 4: Di chuyển vào thư mục `modal_kokoro`
Mở PowerShell và chuyển vào thư mục:
```powershell
cd C:\Users\OS\Downloads\modal_kokoro
```

Thư mục gồm có:
```text
modal_kokoro/
├── modal_kokoro.py       # File cấu hình & logic serverless trên Modal
├── HUONG_DAN_MODAL.md    # File hướng dẫn này
└── kokoro_vietnamese/    # Mã nguồn bóc tách âm thanh ONNX Kokoro
    ├── __init__.py
    ├── core.py
    ├── onnx_cli.py
    └── onnx_utils.py
```

### Bước 5: Tải Model vào Modal Volume (1 lần duy nhất, ~3–5 phút)
Chạy lệnh sau:
```powershell
modal run modal_kokoro.py::download_model
```
> **Giải thích**: Lệnh này chạy trên máy chủ Modal, tự động tải model Kokoro ONNX (~300MB), `config.json` và 14 giọng đọc vào Modal Volume (`audioverse-kokoro-data`). Sau khi tải xong, dữ liệu lưu vĩnh viễn trên mây.

### Bước 6: Deploy Server lên Modal
Chạy lệnh:
```powershell
modal deploy modal_kokoro.py
```
Sau khi deploy xong, terminal sẽ in ra URL công khai có dạng:
```text
Created api => https://ten-ban--audioverse-kokoro-api.modal.run
```

### Bước 7: Dán URL vào App AudioVerse
1. Mở App **AudioVerse** trên điện thoại.
2. Vào màn hình **Chọn giọng đọc** (biểu tượng tai nghe hoặc menu Cài đặt).
3. Bấm vào icon **Cây bút ✏️** tại dòng thông tin Server.
4. Dán URL vừa nhận được vào:
   ```text
   https://ten-ban--audioverse-kokoro-api.modal.run
   ```
5. Bấm **Lưu & Thử**. Banner hiển thị chấm xanh `Sẵn sàng` là kết nối thành công!

---

## 💡 Lưu ý khi sử dụng

1. **Cold Start (Khởi động nguội)**:
   - Câu đầu tiên của mỗi buổi nghe khi container đang ngủ sẽ mất khoảng 10–25 giây để container tỉnh dậy và nạp model.
   - Các câu tiếp theo sẽ phát tức thì vì container được cấu hình giữ ấm 5 phút (`container_idle_timeout=300`) và app có tính năng prefetch gối đầu câu tiếp theo.
2. **Đổi giọng đọc mới**:
   - Khi đổi sang 1 trong 14 giọng đọc mới, container sẽ nạp voicepack đó lần đầu (mất ~1–2 giây), sau đó lưu vào RAM.
3. **Quản lý / Dừng server**:
   - Xem dashboard và logs trực tiếp tại: [https://modal.com/apps](https://modal.com/apps).
   - Dừng app nếu muốn: `modal app stop audioverse-kokoro`.
