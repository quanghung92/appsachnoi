# AppSachNoi / AudioVerse — Kiến Trúc Hệ Thống

> File này dành cho AI (Muse, Gemini, ...) đọc trước khi sửa code.
> Cập nhật file này mỗi khi thay đổi kiến trúc. Chi tiết thay đổi từng lần xem `AI_CHANGELOG.md`.

## Tổng quan

App nghe sách nói tiếng Việt (Expo React Native, iOS + Web), giọng AI Kokoro chạy trên server riêng.
3 chế độ phát, ưu tiên theo thứ tự:

1. **Offline** — file MP3 đã tải về máy (`audioverse-offline/`, không bị xóa bởi cache)
2. **Drive** — file MP3 có sẵn trên Google Drive (stream trực tiếp hoặc tải về)
3. **Stream** — gen real-time từ server qua Cloudflare Tunnel (giọng Kokoro)

## Sơ đồ hệ thống

```
iPhone (Expo App)
  ├──> Cloudflare Tunnel (URL đổi mỗi lần restart)
  │      └──> server_streaming.py (port 3000, máy nhà / Ubuntu)
  │             ├──> Kokoro TTS (model ONNX, giọng duc_an)
  │             ├──> stream_cache/{book_id}/{chapter_id}/ (chunk MP3 + manifest + full_chapter.mp3)
  │             └──> auto-upload Drive mỗi 30 phút
  ├──> Google Drive (file MP3 public, thư mục "AudioVerse")
  ├──> Modal API (https://linhsamiu--audioverse-batch-api.modal.run)
  │      └──> /index — metadata 470 chương (download_url, drive_file_id, title)
  └──> GitHub Gist — URL tunnel mới nhất của từng máy
```

## App (Expo SDK 57)

### Entry & màn hình
| File | Vai trò |
|------|---------|
| `App.tsx` (~1540 dòng) | Entry point, điều phối phát (offline → Drive → stream), lưu reading progress |
| `src/screens/HomeScreen.tsx` | Trang chủ, danh sách sách |
| `src/screens/LibraryScreen.tsx` | Thư viện sách đã lưu |
| `src/screens/QueueScreen.tsx` | Hàng đợi |

### Services (quan trọng nhất)
| File | Vai trò | Lưu ý |
|------|---------|-------|
| `src/services/ttsService.ts` (~1990 dòng) | **Core**: TTS streaming, device fallback, offline download, auto-upgrade, BGM, gist | Singleton `ttsService`. Đọc kỹ trước khi sửa |
| `src/services/batchService.ts` | Giao tiếp Modal API: index, queue, download chapter audio từ Drive | Dùng `fetchWithTimeout` |
| `src/services/crawlerService.ts` | Crawl nội dung chương từ web truyện, parse file TXT local | `parseLocalFile` chỉ hỗ trợ `.txt` |
| `src/utils/fetchWithTimeout.ts` | Helper fetch có timeout, luôn clear timer trong `finally` | Dùng thay pattern AbortController thủ công |

### Components chính
| File | Vai trò |
|------|---------|
| `src/components/ChapterListModal.tsx` | Mục lục chương: tìm kiếm, tải offline, badge trạng thái audio |
| `src/components/VoiceSelectorModal.tsx` | Cài đặt server: nhập URL tay, chọn máy từ Gist, test kết nối |
| `src/components/FullPlayerModal.tsx` | Trình phát full: read-along highlight, seek theo câu |
| `src/components/UrlImportModal.tsx` | Import sách từ URL hoặc file TXT |

### Luồng phát trong `ttsService.ts`

```
streamChapter({bookId, chapterId, text, startSentenceIndex})
  ├──> POST /api/stream/start → nhận session_id + total_chunks
  ├──> playChunk(idx): GET /api/stream/chunk?sess=...&idx=N
  │      ├──> Ping-pong 2 slot (A/B) để phát gapless
  │      ├──> Prefetch chunk N+1, N+2
  │      └──> onSentence(idx) → UI highlight câu đang đọc
  └──> Nếu server lỗi → fallback speak() (giọng máy expo-speech)
         └──> markDeviceFallback() → watcher 30s → server có lại → auto-upgrade
```

**Các bẫy đã biết:**
- `speak()` gọi `stop()` đầu tiên, `stop()` gọi `clearDeviceFallback()` → watcher auto-upgrade bị hủy ngay. Đây là hành vi cố ý (không upgrade khi đã chuyển sang giọng máy hẳn).
- Watcher kiểm tra `sentenceIndex >= sentences.length - 1` thì không upgrade (đã đọc hết).
- `App.tsx` resume: nếu `isAtEnd` thì bắt đầu từ câu 0, không resume từ câu cuối.

### Cấu hình server URL (thứ tự ưu tiên)
1. URL người dùng nhập tay (`@audioverse/server_type = 'custom'`)
2. URL từ Gist (`TUNNEL_GIST_ID`, không ghi đè custom)
3. Các IP LAN thử tự động
4. `LOCAL_SERVER_IP` mặc định (`192.168.110.172`)

### Gist tunnel URL
- `TUNNEL_GIST_ID = '8e0af2e9e8b496fca8a8b052267fd38e'`
- Format: `{"machines": {"<tên-máy>": {"url": "...", "updated_at": "..."}}}`
- Mỗi máy ghi entry riêng → không đè nhau. App hiện danh sách cho người dùng chọn.
- Token GitHub (scope `gist`) nằm trong `.gist.env` local (gitignore), KHÔNG commit.

### Background audio (iOS)
- `app.json`: `UIBackgroundModes: ["audio"]`
- `setAudioModeAsync({playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix'})`
- Gọi trong constructor `TTSService` + trước mỗi lần tạo player mới.

## Server (`audioverse_batch/server_streaming.py`, ~1300 dòng)

Chạy: `bash audioverse_batch/control.sh` (menu 1-11), port 3000.

### API endpoints
| Endpoint | Chức năng |
|----------|-----------|
| `GET /health` | Kiểm tra server sống |
| `POST /api/stream/start` | Tạo session stream, nhận `start_chunk_index` |
| `GET /api/stream/chunk?sess=...&idx=N` | Lấy chunk MP3 thứ N |
| `POST /api/stream/abort` | Hủy session |
| `GET /tts.wav`, `GET /tts.mp3` | TTS 1 câu đơn (fallback cũ) |
| `GET /api/crawl?url=...` | Crawl nội dung chương web |
| `GET /api/crawl_chapter_titles` | Crawl tiêu đề dãy chương |
| `GET /api/index` | Index chương đã có (proxy) |
| `POST /api/batch/backfill` | Gen bù chương thiếu |
| `GET /api/stream/download_full` | Tải full_chapter.mp3 đã stitch |
| `GET /api/music/{name}` | Nhạc nền (`novel_bg.mp3`, `book_bg1.mp3`, `book_bg2.mp3` từ `music/`) |
| `POST /api/stream/clear_cache` | Xóa cache |

### Cache & Drive
- `data/stream_cache/{book_id}/{chapter_id}/`: `chunk_N.mp3` + `manifest.json` + `full_chapter.mp3`
- Manifest: `{total_chunks, completed_chunks, is_complete, drive_file_id}` — **không lưu tên truyện**
- `auto_upload_drive_worker()`: mỗi 30 phút, upload chương hoàn chỉnh lên folder Drive "AudioVerse", đặt tên `{book_id}__{chapter_id}.mp3`
- Cần env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

### control.sh (menu)
1. Chạy/khởi động streaming server | 2. Dừng server
3. Chạy Cloudflare tunnel | 4. Dừng tunnel
5/6. Bật/tắt batch cron (chỉ Linux) | 7. Pull code GitHub
8. Xem log | 9. Upload Drive tay | 10. Cập nhật gist tay | 11. Cấu hình gist
- Tự tìm Python (venv Linux/Windows → python3 → python)
- `is_stream_running()` ưu tiên check `curl /health` trước PID (tránh PID stale)
- Hỗ trợ Windows (Git Bash): PID file, taskkill, `venv/Scripts/python.exe`

## Quy ước cho AI sửa code

1. **Đọc `AI_CHANGELOG.md` trước** để biết ngữ cảnh thay đổi gần nhất.
2. **Sau khi sửa, ghi vào `AI_CHANGELOG.md`**: ngày, file nào, sửa gì, tại sao, đã test gì.
3. **Không push** khi chưa được Nguyễn nói rõ "đẩy/push".
4. **Trước khi báo xong**: chạy `npx tsc --noEmit` và `python3 -m py_compile`.
5. **Khi review**: ghi rõ "đã review X, chưa verify Y" — không nói "đạt" nếu chỉ đọc code.
6. **Không hardcode secret** vào file commit lên git. Token/config local dùng `.gist.env` (đã gitignore).
7. **Tuân thủ Rules of Hooks**: không `return` trước hook trong component React.
8. Dùng `fetchWithTimeout()` thay vì pattern `AbortController + setTimeout` thủ công.
