# KẾ HOẠCH TRIỂN KHAI: TÍNH NĂNG ON-DEMAND AUDIO STREAMING & BATCH QUEUE
**Dự án:** AudioVerse (AppSáchNói)  
**Phiên bản:** 6.0 (Bản đặc tả kỹ thuật hoàn chỉnh - Master Specification)  
**Ngày cập nhật:** 13/10/2026  
**Trọng tâm:** Kokoro-Only, Benchmark First, Gapless Playback, Text Normalization, Sparse Cache, Seed Cache 470 Files, Multi-Player BGM, Priority Preemption, Full API Contract

---

## 1. NGUYÊN TẮC CỐT LÕI (ENGINEERING PRINCIPLES)

1. **Benchmark First (Đo đạc trước khi code)**:
   * Không giả định độ trễ "dưới 2 giây" trên lý thuyết. Cần đo lường RTF (Real-Time Factor) và Latency thực tế của Kokoro trên CPU máy thật trước khi dựng hệ thống.
2. **Kokoro-Only Engine**:
   * Loại bỏ hoàn toàn VieNeu. Sử dụng **Kokoro ONNX** làm engine duy nhất cho toàn bộ hệ thống (cả Stream và Batch).
3. **Bảo tồn & Tận dụng 470 file cũ (Seed Cache)**:
   * 470 file MP3 đã có sẵn trên Google Drive đóng vai trò là "Seed Cache". Toàn bộ các chương này được đánh dấu hoàn thành 100%, phát trực tiếp từ Drive mà không gen lại.
4. **Quyền ưu tiên tuyệt đối cho Live Stream (Preemption)**:
   * Trải nghiệm người dùng nghe trực tiếp là số 1. Mọi tác vụ Batch/Self-healing chạy ngầm đều phải nhường CPU/GPU cho Live Stream.
5. **Zero-Waste Sparse Cache & Resumable Backfill**:
   * Mọi câu/đoạn sau khi gen đều được lưu trữ cố định. Tua nhảy cóc hoặc chuyển chương không làm mất dữ liệu. Khi cần tải trọn bộ, hệ thống chỉ gen bù các câu còn thiếu.
6. **Synchronized Read-Along & Gapless Playback**:
   * Vừa nghe vừa đọc chữ với highlight theo câu đang đọc, tự động cuộn màn hình và chạm vào chữ để phát ngay.

---

## 2. GIẢI QUYẾT TOÀN DIỆN CÁC BÀI TOÁN KỸ THUẬT

### 2.1. Benchmark Kokoro thực tế (Latency & Chunk Size)
* **Mục tiêu**: Đo thời gian phonemize (vig2p) và ONNX inference trên CPU với các kích thước chunk (20, 40, 60 từ).
* **Tiêu chuẩn**: Audio Duration > 2.5 × Inference Time (RTF < 0.4) để đảm bảo server luôn nạp gối đầu kịp trước khi câu hiện tại đọc xong.
* **Hành động**: Viết script `tools/benchmark_kokoro.py` đo trực tiếp trước khi lập trình API.

### 2.2. Gapless Playback (Xóa bỏ khe hở âm thanh 100–300ms)
* **Mobile (Expo-Audio)**: **Dual-Player Ping-Pong (A/B)**:
  * Khởi tạo 2 Player instance. Khi Player A đang phát câu N, Player B nạp sẵn câu N+1 vào RAM.
  * Khi Player A kết thúc câu (hoặc còn 50ms), Player B kích hoạt `play()` ngay lập tức trong cùng 1 tick event loop $\rightarrow$ Triệt tiêu overhead khởi tạo native.
* **Web**: **Web Audio API (`AudioBufferSourceNode`)**:
  * Xếp lịch phát chính xác từng mili-giây: `sourceNode.start(nextStartTime)`. Độ trễ nối câu đạt **0.000ms tuyệt đối**.

### 2.3. Pipeline Chuẩn hóa Tiếng Việt (Text Normalization)
Module tiền xử lý bắt buộc trước TTS dùng chung cho cả Stream và Batch:
* **Số & Đơn vị**: `"năm 2024"` $\rightarrow$ `"năm hai nghìn không trăm hai mươi tư"`, `"10%"` $\rightarrow$ `"mười phần trăm"`, `"5km"` $\rightarrow$ `"năm ki-lô-mét"`.
* **Viết tắt & Danh xưng**: `"TP."`, `"TS."`, `"v.v."`, `"đ/c"` $\rightarrow$ mở rộng thành chữ đầy đủ.
* **Ký tự hội thoại**: Chuẩn hóa dấu gạch ngang thoại `- "..."`, lọc sạch rác quảng cáo web, ép chuẩn Unicode NFC.

---

### 2.4. Migration & Kế thừa 470 file MP3 cũ (Seed Cache)
* Hiện tại hệ thống đã có **470 file MP3** trên Google Drive từ các đợt chạy batch trước đó.
* **Cơ chế kế thừa**:
  * Khi khởi động, Server nạp toàn bộ danh sách 470 file này vào `index.json` làm **Seed Cache**.
  * File manifest của 470 chương này được đánh dấu mặc định:
    ```json
    { "is_complete": true, "drive_file_id": "...", "source": "legacy_batch" }
    ```
  * Khi người dùng chọn nghe bất kỳ chương nào trong 470 chương này:
    * App nhận diện ngay `is_complete: true` $\rightarrow$ **Phát thẳng file MP3 từ Google Drive (hoặc proxy web)**.
    * **Tuyệt đối không chạy live stream và không tốn 1 ms CPU nào để gen lại.**

---

### 2.5. Kiến trúc Nhạc nền song song ở Client (Dual-Channel Audio & Ducking)
Tách biệt hoàn toàn âm thanh giọng đọc và nhạc nền (không trộn tại server để tránh nhạc bị giật giữa các chunk):

```text
[Kênh 1: TTS Voice Player]  -------- (Phát Chunk giọng đọc Kokoro) ---------> Loa
                                            | (Gửi tín hiệu IsSpeaking)
                                            v
[Kênh 2: BGM Loop Player]   -------- (Nhạc nền cổ tranh / piano loop) -------> Loa
                             [Âm lượng bình thường: 100% | Khi nói: Giảm còn 15%]
```

1. **2 Player hoàn toàn độc lập**:
   * Kênh giọng đọc: `activePlayer` (Expo Audio / WebAudio).
   * Kênh nhạc nền: `bgmPlayer` phát lặp vô tận (Loop) các file nhạc cục bộ (`novel_bg.mp3`, `book_bg1.mp3`).
2. **Tự động né âm (Audio Ducking)**:
   * Khi TTS bắt đầu cất giọng: Âm lượng BGM tự động hạ xuống mức **12% – 15%**.
   * Khi hết câu hoặc tạm dừng: Âm lượng BGM tự động tăng nhẹ nhàng về mức mặc định (fade in 300ms).
3. **Thanh chỉnh âm lượng riêng biệt**:
   * Giao diện FullPlayer có 2 thanh slider riêng: **Âm lượng Giọng đọc** và **Âm lượng Nhạc nền** để người dùng tự do điều chỉnh theo sở thích.

---

### 2.6. Trọng tài tài nguyên: Quyền ưu tiên Tuyệt đối cho Live Stream (Preemption)
Khi server đang chạy ngầm các tác vụ nặng (như Background Self-healing vá lỗ thủng hoặc Batch ban đêm), mà có người dùng mở app bấm nghe trực tiếp:

1. **Cơ chế Preemption (Chiếm quyền)**:
   * Mọi worker đều lắng nghe cờ ưu tiên: `PRIORITY_STREAM > PRIORITY_BATCH`.
   * Khi nhận request `POST /api/stream/start`:
     * Worker đang chạy batch lập tức **tạm dừng tác vụ batch ngay sau khi gen xong câu hiện tại** (không hủy ngang câu đang gen để tránh lãng phí).
     * Dồn **100% tài nguyên CPU/GPU** phục vụ stream cho người dùng.
2. **Tự động khôi phục (Resume)**:
   * Sau khi người dùng thoát app hoặc ngưng stream trong **60 giây**, worker mới tiếp tục chạy lại tác vụ Batch/Self-healing từ điểm đã tạm dừng.

---

### 2.7. Xử lý Thủng lỗ khi Tua / Chuyển chương (Sparse Cache & Resumable Backfill)
* **Tua câu làm thủng lỗ**: Nghe câu `0..10`, tua sang `30..40` $\rightarrow$ khuyết đoạn `11..29`.
* **Hit-or-Miss khi nghe lại**: Trình phát kiểm tra từng câu: câu đã có phát từ cache (0ms); gặp đoạn thủng tự động stream bù; gặp lại câu có sẵn lại phát từ cache.
* **Resumable Backfill khi Tải Offline**: Gửi danh sách `missing_chunks: [11..29]`, server chỉ gen bù đúng các câu thiếu, sau đó ghép đủ 40 câu thành 1 file MP3.
* **Background Self-Healing**: Server tự động vá ngầm các chương thủng vào lúc rảnh rỗi.

---

### 2.8. Tự động nâng cấp lên Kokoro sau khi Fallback giọng máy
* Khi mất mạng và gặp đoạn dở dang: App tự dùng giọng máy (`expo-speech`) đọc tạm và gắn cờ `temp_fallback: true`.
* Khi có mạng trở lại: App âm thầm gửi danh sách câu cần vá lên server $\rightarrow$ Server gen Kokoro xịn $\rightarrow$ Tải về ghi đè lên đoạn giọng máy để đảm bảo cuốn sách luôn đạt chất lượng cao nhất.

---

### 2.9. Xử lý Nhiều User cùng Stream 1 Chương (Single-Flight Coalescing)
* Khi nhiều người cùng bấm nghe 1 chương chưa có audio: Server chỉ kích hoạt Kokoro gen **đúng 1 lần duy nhất**, các user khác cùng chờ và nhận chung kết quả (Shared Broadcast).
* User đến sau nghe các câu user trước vừa nghe với **0ms độ trễ** trực tiếp từ Shared Cache.

---

### 2.10. Tính năng Vừa nghe vừa đọc chữ & Highlight đồng bộ (Read-Along)
* **Highlight câu đang đọc**: Câu hiện tại sáng nổi bật (nền vàng/xanh pastel nhẹ), các câu đã qua làm mờ nhẹ (Dimmed), câu chưa đọc màu bình thường.
* **Auto-Scroll thông minh**: Màn hình tự cuộn mượt đưa câu đang đọc vào vị trí 1/3 phía trên tầm mắt. Tạm dừng cuộn 5s nếu người dùng chạm tay lướt trang.
* **Tap-to-Seek**: Chạm vào bất kỳ câu nào trên màn hình văn bản $\rightarrow$ Audio nhảy tới phát ngay câu đó.

---

## 3. ĐẶC TẢ API CONTRACT (CLIENT $\leftrightarrow$ BACKEND)

Toàn bộ giao tiếp giữa Mobile App và Server TTS được chuẩn hóa như sau:

### 3.1. Lấy mục lục sách/truyện (TOC)
* **`GET /api/toc?source={url_hoac_drive_id}&type={web_novel|drive_book}`**
* **Response**:
```json
{
  "book_id": "pham_nhan_tu_tien",
  "title": "Phàm Nhân Tu Tiên",
  "total_chapters": 2450,
  "chapters": [
    { "id": "c1", "index": 1, "title": "Chương 1: Sơn thôn thiếu niên", "url": "https://..." },
    { "id": "c2", "index": 2, "title": "Chương 2: Thất Huyền Môn", "url": "https://..." }
  ]
}
```

### 3.2. Tra cứu trạng thái chương (Kiểm tra 470 file cũ & Cache)
* **`GET /api/index?book_id={book_id}`**
* **Response**:
```json
{
  "chapters": {
    "c1": { "is_complete": true, "drive_file_id": "1A2B...", "download_url": "https://..." },
    "c2": { "is_complete": false, "cached_chunks": [0, 1, 2, 3], "total_chunks": 45 }
  }
}
```

### 3.3. Khởi tạo phiên Stream trực tiếp (Live Stream Session)
* **`POST /api/stream/start`**
* **Request Body**:
```json
{
  "book_id": "pham_nhan_tu_tien",
  "chapter_id": "c2",
  "url": "https://...",
  "voice": "duc_an",
  "speed": 1.0,
  "start_chunk_index": 0
}
```
* **Response**:
```json
{
  "session_id": "sess_99f1a2",
  "total_chunks": 45,
  "sentences": [
    "Đêm đã về khuya, gió rít qua khe cửa sổ.",
    "Tiếng bước chân khe khẽ vang lên trên hành lang vắng lặng."
  ],
  "first_chunk": {
    "index": 0,
    "audio_url": "http://.../api/stream/chunk?sess=sess_99f1a2&idx=0"
  }
}
```

### 3.4. Kéo Audio của Chunk (Prefetching & Playback)
* **`GET /api/stream/chunk?sess={session_id}&idx={chunk_index}`**
* **Response**: Binary Audio Stream (`audio/wav` hoặc `audio/mpeg`).

### 3.5. Hủy hoặc Tạm dừng Stream khi đổi chương
* **`POST /api/stream/abort`**
* **Request Body**: `{ "session_id": "sess_99f1a2" }`
* **Response**: `{ "status": "aborted", "saved_chunks": 4 }`

### 3.6. Yêu cầu Gen bù đoạn thủng (Backfill Missing Chunks)
* **`POST /api/batch/backfill`**
* **Request Body**:
```json
{
  "book_id": "pham_nhan_tu_tien",
  "chapter_id": "c2",
  "missing_chunks": [11, 12, 13, 14, 15, ..., 29],
  "auto_stitch": true
}
```
* **Response**: `{ "status": "enqueued", "queue_position": 1 }`

---

## 4. LỘ TRÌNH TRIỂN KHAI HOÀN CHỈNH (ROADMAP)

| Bước | Nhiệm vụ | Tiêu chí nghiệm thu |
| :--- | :--- | :--- |
| **BƯỚC 0** | **Benchmark Kokoro máy thật** | Đo RTF và Latency trên CPU; xác định kích thước chunk tối ưu (25–45 từ). |
| **BƯỚC 1** | **Vietnamese Normalizer** | Module chuẩn hóa số, ngày tháng, viết tắt, ký tự hội thoại dùng chung cho Stream & Batch. |
| **BƯỚC 2** | **Streaming Backend & Preemption** | Xây dựng API Contract (/stream/start, /stream/chunk, /abort); tích hợp Seed Cache 470 file cũ; cơ chế ưu tiên Stream ngắt Batch. |
| **BƯỚC 3** | **Client Gapless Player & Dual BGM** | Dual-Player Ping-Pong (A/B) 0ms gap; Kênh BGM độc lập với Audio Ducking 15%; Giao diện Read-Along Highlight câu đang đọc & Auto-Scroll. |
| **BƯỚC 4** | **Offline Sync, Backfill & Drive Stitch** | Ghép đủ 100% chunk thành MP3 lên Drive; Tải offline về máy; Auto-Upgrade Kokoro sau khi fallback giọng máy. |
