# Deploy AudioVerse batch với VieNeu-TTS

## Có gì mới
- **TTS**: VieNeu v3 Turbo thay Gemini + Kokoro.
  - Truyện → giọng **Mai Anh**
  - Sách → giọng **Thiện Minh**
- **Nhạc nền tự động**: truyện → guzheng, sách → piano xoay vòng (2 track).
- Container RAM 4GB (VieNeu cần ~2.5GB).

## Bước 1: Diff với bản trên máy chính
File này làm từ bản workspace (có thể cũ hơn bản trên máy chính của bạn).
So sánh `modal_batch_vieneu.py` với `modal_batch.py` trên máy chính,
giữ lại mọi sửa riêng của bạn (nếu có), rồi mới deploy.

## Bước 2: Tải model VieNeu lên Volume (1 lần duy nhất)
```powershell
modal run modal_batch_vieneu.py::download_vieneu_model
```
Tải ~541MB (backbone 454MB + codec 87MB). Mất vài phút.

## Bước 3: Upload nhạc nền lên Volume
```powershell
# Cach 1: dung modal volume put
modal volume put audioverse-batch novel_bg.mp3 /data/music/novel_bg.mp3
modal volume put audioverse-batch book_bg1.mp3 /data/music/book_bg1.mp3
modal volume put audioverse-batch book_bg2.mp3 /data/music/book_bg2.mp3
```
Nếu thiếu file nhạc, batch vẫn chạy (bỏ qua nhạc, chỉ báo log).

## Bước 4: Deploy
```powershell
set PYTHONIOENCODING=utf-8 && chcp 65001 && modal deploy modal_batch_vieneu.py
```
App name vẫn là `audioverse-batch`, URL không đổi.

## Bước 5: Dọn queue cũ + chạy lại từ đầu
1. Xóa c13 còn kẹt (nếu chưa xóa):
```powershell
curl -X POST https://linhsamiu--audioverse-batch-api.modal.run/queue/remove -H "Content-Type: application/json" -d '{"book_id":"b9e3d10582f","chapter_id":"c13"}'
```
2. Import lại truyện Phàm Nhân Tu Tiên (để folder Drive hiện đúng tên).
3. Enqueue lại các chương (39 items backup + c1, c3 sách bị mất).
4. POST /trigger để test 1-2 chương trước, nghe thử rồi mới chạy hết.

## Lưu ý
- Secret `gemini-api-key` không còn dùng (có thể xóa).
- Secret `google-drive-oauth` vẫn cần.
- Tốc độ: ~3-5 phút/chương. 200 chương ~10-16h — nên chia nhiều run hoặc tăng timeout.
- VieNeu output 48kHz, code tự downsample về 24kHz cho đồng nhất.
