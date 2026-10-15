# AI Change Log — AppSachNoi / AudioVerse

> **Quy tắc bắt buộc:** Mỗi AI (Muse, Gemini, ...) sau khi sửa code PHẢI ghi vào file này:
> - Ngày sửa
> - Ai sửa (Muse / Gemini / ...)
> - File nào, sửa gì, tại sao
> - Đã test gì (ghi rõ: đã chạy thật / chỉ typecheck / chưa test)
>
> Người/AI tiếp theo đọc file này trước khi sửa để hiểu ngữ cảnh, khỏi dò lại toàn bộ code.

---

## 16/10/2026 — Muse

### Fix P1+P2 từ CODE_REVIEW_ISSUES.md + background audio
**File:**
- `src/components/ChapterListModal.tsx` — đưa `useEffect` lên trước `if (!book) return null` (fix lỗi conditional hooks); đổi nhãn "giọng Gemini" → "giọng Kokoro"
- `src/components/UrlImportModal.tsx` — đọc nội dung file `.txt` thật bằng `FileSystem.readAsStringAsync`; file không phải `.txt` thì báo "chưa hỗ trợ" thay vì tạo sách giả
- `src/services/crawlerService.ts` — `parseLocalFile` chia nội dung thật thành chương (theo tiêu đề Chương/Hồi/Quyển, hoặc cắt theo 5000 ký tự ở ranh giới câu)
- `src/services/ttsService.ts`, `src/services/batchService.ts`, `src/services/crawlerService.ts` — thay 15+ chỗ dùng pattern `AbortController + setTimeout` thủ công bằng helper mới `src/utils/fetchWithTimeout.ts` (luôn clear timer trong `finally`)
- `src/services/ttsService.ts` — thêm `interruptionMode: 'doNotMix'` vào cả 3 chỗ `setAudioModeAsync` (background audio iOS); thêm comment giải thích thứ tự ưu tiên server URL
- `src/utils/fetchWithTimeout.ts` — **mới**: helper fetch có timeout dùng chung

**Test:** `npx tsc --noEmit` OK (0 lỗi). Chưa test runtime trên iPhone. Chưa chạy `npx expo lint`.

---

## 15/10/2026 — Muse

### Gist tunnel URL multi-máy
**File:** `audioverse_batch/control.sh`, `src/services/ttsService.ts`, `src/components/VoiceSelectorModal.tsx`
**Nội dung:** Mỗi máy tự đẩy URL Cloudflare tunnel lên GitHub Gist (entry riêng theo tên máy, không đè nhau). App hiện danh sách máy cho người dùng chọn. `control.sh` thêm option 10 (cập nhật tay), 11 (cấu hình gist), tự hỏi cấu hình lần đầu mở. Token trong `.gist.env` local (gitignore).
**Test:** `bash -n` OK, `tsc` OK. Đã test cập nhật gist thật từ máy nhà (HTTP 200). Chưa test app đọc gist trên iPhone.

### Fix `is_stream_running()` báo sai
**File:** `audioverse_batch/control.sh`
**Nội dung:** Ưu tiên `curl /health` trước kiểm tra PID (tránh trường hợp PID còn sống nhưng server đã chết).
**Test:** `bash -n` OK. Chưa test trên Windows thật.

### Review code Gemini (commit 4c7a6af)
**Kết quả:** TypeScript + Python compile OK. Fix "chỉ đọc 1 câu cuối" đúng hướng (guard `isAtEnd` ở watcher và resume logic). Lưu ý: nhạc nền đổi sang `/api/music/` cần 3 file MP3 trong `music/` trên server (folder này gitignore, chưa có trong repo).

---

## 15/10/2026 — Gemini (via Nguyễn push)

### Fix "chỉ đọc 1 câu cuối" + BGM local + crawler title
**File:** `src/services/ttsService.ts`, `App.tsx`, `src/services/crawlerService.ts`, `audioverse_batch/server_streaming.py`
**Nội dung:**
- Watcher auto-upgrade: không upgrade khi `sentenceIndex` đã ở câu cuối
- `App.tsx` resume: nếu `isAtEnd` thì bắt đầu từ câu 0
- Nhạc nền: chuyển từ URL Google sang `/api/music/{name}` trên server local
- Crawler: tách tiêu đề chương tốt hơn
- Server: endpoint `/api/music/{name}`, hàm `auto_stitch_full_chapter`
**Test:** Chưa rõ (Nguyễn tự build).

---

## 15/10/2026 — Muse

### BƯỚC 4: Offline Sync, Backfill & Drive Stitch
**File:** `App.tsx`, `audioverse_batch/server_streaming.py`, `src/components/ChapterListModal.tsx`, `src/services/ttsService.ts`
**Nội dung:**
- Server: worker tự upload `full_chapter.mp3` lên Drive mỗi 30 phút
- App: tải chương về nghe offline, badge "Đã tải offline", thứ tự ưu tiên offline → Drive → stream
- App: auto-upgrade từ giọng máy sang Kokoro khi server có lại (watcher 30s)
**Test:** `py_compile` OK, `tsc` OK (có pipe, chưa chắc exit code). Chưa test runtime thật.
**Bug phát hiện sau:** watcher auto-upgrade không check `isAtEnd` → gây lỗi "chỉ đọc 1 câu cuối" (Gemini đã fix).

---

## 14-15/10/2026 — Muse + Gemini

### Streaming server + gapless player
- `server_streaming.py`: chunk adaptive, single-flight, prefetch, backfill, stitch
- Fix chunk N+1 phát 2 lần (Gemini)
- Fix file chunk rỗng HTTP 200 (Muse: file <1KB coi như fail)
- Nguyễn xác nhận 15/10: "tốc độ stream khá ổn không bị khựng"

---

## Template cho lần sau

```markdown
## DD/MM/YYYY — <Tên AI>

### <Tiêu đề ngắn>
**File:** ...
**Nội dung:** ...
**Lý do:** ...
**Test:** ... (ghi rõ: đã chạy thật / chỉ typecheck / chưa test)
**Lưu ý / bug liên quan:** ...
```
