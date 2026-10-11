# Batch TTS: Gemini đọc chương mỗi đêm → lưu MP3 lên Google Drive

## Nó làm gì?

Mỗi đêm 3h sáng (giờ VN), Modal tự động:
1. Đọc hàng đợi chương cần gen (do app đẩy lên).
2. Gọi **Gemini TTS** (tối đa 10 chương/đêm — giữ dưới quota free ~15 request/ngày).
3. Convert sang **MP3** (nhẹ ~10 lần so với WAV).
4. Upload lên thư mục **AudioVerse** trong Google Drive của bạn.
5. Cập nhật index để app biết chương nào có audio sẵn.

App sau này chỉ việc tải MP3 về nghe — không synth realtime, không chờ, không tốn tiền lúc nghe.

## Setup (1 lần duy nhất)

### Bước 1: Gemini API key → Modal Secret

Lấy key tại https://aistudio.google.com/app/apikey (miễn phí), rồi trên PC:

```
modal secret create gemini-api-key GEMINI_API_KEY=<dán-key-vào-đây>
```

### Bước 2: Google Drive OAuth (lằng nhằng nhất, làm 1 lần)

1. Vào https://console.cloud.google.com/ → tạo project mới (tên tùy ý, vd "AudioVerse").
2. **APIs & Services → Library** → tìm "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → Create:
   - Điền tên app + email của bạn → Save.
   - Tới bước **Test users** → **Add users** → thêm chính email của bạn → Save.
4. **APIs & Services → Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application type: **Desktop app** → Create.
   - Copy **Client ID** và **Client secret**.
5. Trên PC, cài rồi chạy script đính kèm:
   ```
   pip install google-auth-oauthlib
   python drive_oauth.py
   ```
   - Dán Client ID + Client Secret khi được hỏi.
   - Trình duyệt mở ra → đăng nhập → **Continue** → **Allow**.
   - Script in ra **refresh token** — giữ kín.
6. Tạo Modal secret:
   ```
   modal secret create google-drive-oauth GOOGLE_CLIENT_ID=<id> GOOGLE_CLIENT_SECRET=<secret> GOOGLE_REFRESH_TOKEN=<token>
   ```

> Scope xin quyền là `drive.file` — server **chỉ** thấy file do chính nó tạo trong thư mục AudioVerse,
> không đọc được các file khác trên Drive của bạn.

### Bước 3: Deploy

```
cd <thư-mục-chứa-modal_batch.py>
modal deploy modal_batch.py
```

> Lần deploy đầu build image hơi lâu (torch + onnxruntime ~5-10 phút), các lần sau nhanh.
> App `audioverse-kokoro` (chứa model) KHÔNG cần deploy lại — batch dùng chung Volume
> `audioverse-kokoro-data` của nó.

Xong nó in ra URL, vd `https://linhsamiu--audioverse-batch-api.modal.run`.

Kiểm tra: mở `https://<url>/health` → `{"status":"ok","service":"audioverse-batch"}`.

### Bước 4 (tùy chọn): chạy thử ngay không chờ 3h sáng

```
modal run modal_batch.py::batch_nightly
```

Lệnh này chạy batch 1 lần luôn (tối đa 10 chương trong hàng đợi).

## Đổi giọng đọc

Sửa `VOICE_NAME` trong `modal_batch.py` (lấy tên từ nút **</> Get code** trong AI Studio),
rồi `modal deploy` lại. Các chương đã gen giữ giọng cũ; chương mới dùng giọng mới.

## API cho app

- `POST /import_book` `{"drive_url": "...", "title": "..."}` — server tải PDF (link public),
  extract text, tách chương, lưu text vào Volume → trả `{book_id, title, chapters:[{id,title,chars}]}`.
- `POST /import_novel` `{"url": "..."}` — server cào thử lấy tên truyện → trả `{book_id, title}`.
  App tự sinh URL các chương theo pattern `chuong-N`; server cào lúc batch.
- `POST /enqueue` — app đẩy chương cần gen:
  `{"items": [{"book_id": "sach1", "chapter_id": "c5", "title": "Chương 5", "url": "...", "engine": "kokoro"|"gemini", "voice": "duc_an"}], "position": "back"|"front"}`
  `url` (truyện web) → server tự cào; sách → server tra text đã lưu. Không cần gửi text.
  `"position": "front"` = ưu tiên cao nhất (lên đầu hàng đợi). Trùng chương đã có audio
  **đúng engine+giọng** → tự bỏ qua; khác → gen lại.
- `POST /queue/move` `{"book_id": "...", "chapter_id": "...", "direction": "up"|"down"}` — đổi độ ưu tiên.
- `POST /queue/remove` `{"book_id": "...", "chapter_id": "..."}` — xóa 1 chương khỏi hàng đợi.
- `GET /queue?book_id=sach1` — toàn bộ hàng đợi theo thứ tự ưu tiên: `{queue: [{book_id, chapter_id, title, engine}]}`.
- `POST /trigger` `{"max_chapters": 10}` — gen ngay không chờ 3h sáng (chạy nền).
- `GET /index?book_id=sach1` — danh sách chương đã có audio + link tải Drive.
- `POST /remove_book` `{"book_id": "sach1"}` — xóa sách: dọn hàng đợi + index + file Drive + text đã lưu.
- `GET /status` — `{"pending": 3, "done": 12, "gemini_voice": "Zubenelgenubi", "kokoro_voice": "duc_an"}`.
- `GET /health` — kiểm tra sống.

## Phân giọng

- **Truyện web → Gemini** (`gemini-3.8-flash-tts`, giọng `Zubenelgenubi`).
- **Sách PDF → Kokoro** chạy in-process (giọng `duc_an`, đổi trong `KOKORO_VOICE`).
- 1 sách/truyện = 1 giọng duy nhất từ đầu đến cuối, không pha trộn.

## Lưu ý quota Gemini free

- Cron gen tối đa **10 chương/đêm** (`MAX_CHAPTERS_PER_RUN`), để trừ hao nếu bạn
  dùng API trực tiếp trong ngày (tổng RPD free ~15).
- Gặp lỗi 429 (hết quota) → cron **dừng ngay**, để dành quota cho hôm sau.
- Chương dài quá 20.000 ký tự → tự cắt thành nhiều phần (`c5_p1`, `c5_p2`...).

## Chi phí ước tính

- Modal: cron chạy vài chục phút/đêm (CPU + convert MP3) ≈ vài cent/đêm, nằm trong $30 free.
- Gemini: $0 trong quota free.
- Drive: 15GB free ≈ 1.500 giờ MP3.
