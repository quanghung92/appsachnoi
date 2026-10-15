# Báo cáo rà soát bug và vấn đề tồn đọng

**Dự án:** AppSachNoi / AudioVerse  
**Ngày rà soát:** 15/10/2026  
**Phạm vi:** App Expo/React Native (`App.tsx`, `src/`), backend streaming (`audioverse_batch/server_streaming.py`) và đối chiếu `APP_OVERVIEW.md`.

## Tóm tắt

- `npx tsc --noEmit`: đạt, không có lỗi TypeScript.
- `npx expo lint`: thất bại do 1 lỗi ESLint và có 4 cảnh báo.
- Đã xác nhận ít nhất 2 lỗi chức năng/ổn định có thể xử lý độc lập. Một số điểm khác là rủi ro vận hành cần kiểm tra với cấu hình triển khai thực tế.
- `APP_OVERVIEW.md` mô tả một số tính năng như nhập EPUB/PDF/TXT thật; hiện code import file chỉ dựng nội dung mẫu, nên tài liệu đang tuyên bố vượt quá triển khai.

## Danh sách theo ưu tiên

### P1 — Hooks gọi có điều kiện trong `ChapterListModal`

**Bằng chứng:** `src/components/ChapterListModal.tsx:74-79` trả về `null` khi `book` rỗng trước khi gọi `React.useEffect`. Khi `book` chuyển từ `null` sang có dữ liệu (hoặc ngược lại) trên cùng instance, số thứ tự hook giữa các render thay đổi. ESLint xác nhận `react-hooks/rules-of-hooks` là lỗi.

**Tác động:** Có thể gây lỗi runtime “Rendered more/fewer hooks than expected” khi đóng/mở hoặc đổi sách trong mục lục; lint hiện không qua.

**Cách xử lý:** Đặt tất cả hook trước nhánh return; effect phải tự kiểm tra `book` tồn tại.

**Tiêu chí hoàn tất:** Lint không còn lỗi hooks; mở mục lục khi `book` null rồi chọn sách và đổi sách không làm app crash.

### P1 — Chọn file nhưng không đọc nội dung file

**Bằng chứng:** `src/components/UrlImportModal.tsx:128-136` gọi DocumentPicker, sau đó chỉ truyền `file.name` vào `crawlerService.parseLocalFile`. Hàm ở `src/services/crawlerService.ts:444-463` tạo đoạn văn bản mẫu khi không có `contentSnippet`; URI/bytes của file không được đọc.

**Tác động:** TXT/EPUB/PDF được báo là đã thêm nhưng app phát lời giới thiệu giả thay vì nội dung người dùng chọn. Tính năng nhập file trong UI/tài liệu không hoạt động thực chất.

**Cách xử lý:** Đọc TXT từ URI; hỗ trợ EPUB/PDF bằng parser tương thích Expo hoặc giới hạn định dạng được hỗ trợ và báo rõ. Không tạo sách thành công nếu trích xuất thất bại.

**Tiêu chí hoàn tất:** File TXT/EPUB/PDF có nội dung mẫu đã xác minh cho ra text thật; file không đọc được có thông báo lỗi, không được lưu như sách đã nhập.

### P1 — Dọn timer timeout chỉ khi fetch thành công ở nhiều request

**Bằng chứng:** `src/services/ttsService.ts:186-193`, `365-367`, `394-397`, `1803-1808`; `src/services/crawlerService.ts:43-52`, `118-121`, `155-157`; `src/services/batchService.ts:138-146` và các request cùng mẫu. `clearTimeout` nằm sau `await fetch`, trong khi nhánh reject/abort đi vào `catch` trước.

**Tác động:** Timeout đã chạy thường tự hết, nhưng timer vẫn tồn tại tới hạn sau khi request lỗi sớm; nhiều request liên tiếp có thể tích lũy timer ngắn hạn và abort controller đã hoàn tất. Đây chủ yếu là rò rỉ tài nguyên nhỏ/khó thấy, mức P2 nếu chưa quan sát được ảnh hưởng.

**Cách xử lý:** Bọc fetch bằng `try/finally` để luôn clear timeout; ưu tiên helper dùng chung để tránh sót.

**Tiêu chí hoàn tất:** Mọi request có timeout đều clear timer cả khi resolve, reject và abort.

### P2 — Nhãn “tải audio giọng Gemini” sai với trạng thái batch hiện tại

**Bằng chứng:** `src/components/ChapterListModal.tsx:230-232` ghi “Có audio giọng Gemini”, trong khi `src/services/batchService.ts:11-14,47` nói engine đang dùng là Kokoro và type chỉ cho phép `kokoro`.

**Tác động:** Người dùng thấy thông tin giọng/engine không đúng khi chương đã có audio.

**Cách xử lý:** Đổi nhãn thành tên engine/giọng lấy từ metadata audio thực tế; tránh hardcode Gemini.

### P2 — Cấu hình server phát TTS phụ thuộc IP LAN hardcode và HTTP

**Bằng chứng:** `src/services/ttsService.ts:73-75` đặt IP mặc định `192.168.110.172`, port `3000`; `setServerUrl` tự thêm `http://` tại dòng 342; các luồng tunnel/dev cũng ghép URL `http://` (ví dụ dòng 732). Fallback này chỉ hoạt động khi thiết bị cùng mạng và máy chủ còn dùng đúng IP; HTTP từ trang HTTPS có thể bị trình duyệt chặn mixed content.

**Tác động:** Cài app trên thiết bị khác/mạng khác có thể không kết nối; production Web qua HTTPS có thể không phát từ proxy HTTP. Gist discovery/tunnel có thể giảm một phần nhưng không loại bỏ các URL hardcode.

**Cách xử lý:** Chuyển cấu hình endpoint theo môi trường/deployment; dùng HTTPS cho endpoint công khai; hướng dẫn nhập server URL và kiểm tra kết nối trước khi phát.

### P2 — Mở mục lục có thể gọi crawl lặp và effect thiếu dependencies

**Bằng chứng:** `ChapterListModal.tsx:79-88`; effect đọc `book`, `onFetchChapterRange`, `isCurrentLoading` nhưng dependency list không gồm các giá trị này (lint cảnh báo). Nó tự tải 30 tiêu đề đầu tiên còn generic mỗi khi điều kiện trigger thay đổi.

**Tác động:** Có thể gọi crawl lại ngoài dự kiến hoặc dùng callback/dữ liệu cũ; phụ thuộc cách parent tạo callback và cập nhật book.

**Cách xử lý:** Đưa dependencies đầy đủ/ổn định, xác định rõ điều kiện chỉ fetch một lần cho mỗi sách/dải chương và chống request trùng.

### P2 — Giới hạn input/API của streaming server cần được xác thực

**Bằng chứng:** `/api/stream/start` nhận `text`, `book_id`, `chapter_id`, `voice`, `speed` từ request (`audioverse_batch/server_streaming.py:922-929`) và đưa text vào phân đoạn/synthesis; code hiện chưa thể hiện giới hạn độ dài text hoặc allowlist voice ở model request. Máy chủ còn bật CORS `allow_origins=["*"]` ở dòng 112.

**Tác động:** Nếu endpoint được public qua tunnel, client có thể gửi payload rất lớn hoặc giá trị không dự kiến làm tăng CPU/bộ nhớ; CORS rộng làm mọi origin trình duyệt gọi được API. Chưa đủ bằng chứng để kết luận server đang public hay có authentication.

**Cách xử lý:** Xác nhận exposure thực tế; đặt giới hạn Pydantic cho kích thước text/ID và allowlist voice/speed; thêm auth/rate limit nếu public; thu hẹp CORS theo origin app.

### P3 — Các cảnh báo lint còn lại

- `FullPlayerModal.tsx:93`: dependency `chapter.id` thừa trong `useMemo` (lint cảnh báo).
- `VoiceSelectorModal.tsx:41` và `ttsService.ts:182`: dùng `Array<T>` thay vì `T[]`.
- `ChapterListModal.tsx:88`: dependency effect thiếu, đã nêu ở P2.

**Tác động:** Chưa phải bug runtime đã xác nhận, nhưng khiến lint không sạch và che khuất lỗi mới.

## Thông tin cần kiểm thử thủ công

1. Trên Android/iOS, nhập TXT/EPUB/PDF và xác nhận text phát ra khớp nội dung gốc.
2. Web production chạy HTTPS: thử phát audio Drive và audio qua proxy port 3001, kiểm tra lỗi mixed content/CORS.
3. Đổi sách liên tục khi modal mục lục đang mount; xem số request `/api/crawl_chapter_titles` và lỗi console.
4. Kiểm tra backend có được expose Internet không; nếu có, xác nhận auth/rate limit, giới hạn payload và quyền gọi endpoint xóa cache.
5. Chạy thử offline download, seek giữa câu/chương và background playback trên thiết bị thật; phần này không thể kết luận đầy đủ chỉ từ static review.

## Chất lượng bằng chứng và giới hạn

Đây là static review cộng với lint/typecheck, không phải kiểm thử thiết bị thật hay kiểm thử tích hợp backend. Không sửa code trong lượt này; file này là backlog để xử lý từng mục và cần cập nhật trạng thái sau khi sửa.

## Lộ trình tính năng nên làm tiếp

Lộ trình dưới đây ưu tiên hoàn thiện các luồng cốt lõi trước, rồi mới mở rộng đồng bộ và cá nhân hóa. Các mục là đề xuất; đánh dấu trạng thái khi bắt đầu triển khai.

### Giai đoạn 1 — Hoàn thiện các chức năng đang được giới thiệu

- [ ] **Nhập file đúng nội dung (P0):** Đọc TXT từ URI thực tế; bổ sung parser EPUB/PDF có hỗ trợ Expo hoặc giới hạn định dạng rõ ràng. Không tạo sách với nội dung mẫu khi trích xuất thất bại. Tham chiếu lỗi P1 “Chọn file nhưng không đọc nội dung file”.
- [ ] **Nhập truyện/link với kết quả thật:** Xác nhận mọi URL import đều crawl nội dung thật; hiển thị trạng thái đang xử lý, lỗi nguồn chặn crawl, nội dung rỗng và thử lại. Không báo nhập thành công nếu mới chỉ dựng metadata/chương giả.
- [ ] **Tiến độ nghe bền vững:** Lưu và khôi phục sách, chương, câu/vị trí audio; xác nhận cập nhật khi pause, đổi chương, đóng app và khởi động lại. Xử lý trường hợp sách/chương đã bị xóa hoặc nội dung chương thay đổi.
- [ ] **Tải offline có quản lý:** Hiển thị trạng thái tải/đang tải/lỗi, cho tải lại và xóa audio từng chương, kiểm tra file còn tồn tại trước khi phát; hiển thị dung lượng đã dùng.
- [ ] **Hoàn thiện phát nền:** Điều khiển play/pause/next trên lock screen và notification, xử lý audio focus/cuộc gọi/tai nghe, tiếp tục đúng vị trí khi app quay lại. Kiểm chứng trên Android và iOS.

### Giai đoạn 2 — Thư viện và trải nghiệm đọc/nghe

- [ ] **Yêu thích thực sự:** Thêm/bỏ yêu thích, lưu bền vững, lọc danh sách yêu thích; kiểm tra mục yêu thích hiện có trong Library không chỉ là nhãn/giao diện.
- [ ] **Dấu trang và ghi chú:** Tạo bookmark từ câu đang nghe/đang đọc, lưu sách + chương + sentence index + trích đoạn + thời điểm; cho sửa/xóa và mở lại đúng vị trí.
- [ ] **Tìm kiếm trong thư viện người dùng:** Tìm trên sách đã import/crawl và metadata cục bộ; thêm lọc thể loại/tác giả/loại nguồn, trạng thái rỗng và lịch sử tìm kiếm nếu hữu ích.
- [ ] **Cài đặt đọc/phát được ghi nhớ:** Lưu tốc độ, giọng đọc, cỡ chữ, giao diện sáng/tối và thiết lập nhạc nền; cho đặt mặc định toàn app hoặc tùy chỉnh theo sách.
- [ ] **Chất lượng và dung lượng audio:** Chỉ cung cấp lựa chọn bitrate/chất lượng khi backend thật sự tạo hoặc chuyển mã được các mức tương ứng; hiển thị ước tính dung lượng và chất lượng hiện tại.
- [ ] **Trạng thái và thông báo nhất quán:** Thay nhãn engine hardcode bằng metadata thật (Kokoro/giọng tương ứng); trạng thái batch, offline và lỗi cần nhất quán giữa hàng đợi, mục lục và thư viện.

### Giai đoạn 3 — Độ tin cậy, riêng tư và đa thiết bị

- [ ] **Đồng bộ đa thiết bị (sau khi chốt tài khoản/backend):** Đồng bộ tiến độ, yêu thích, bookmark và cài đặt; xử lý xung đột cập nhật, đăng xuất, mất mạng và xóa dữ liệu. Chọn Supabase/Firebase sau khi xác định yêu cầu tài khoản và chính sách dữ liệu.
- [ ] **Cấu hình server theo môi trường:** Loại bỏ phụ thuộc IP LAN hardcode khi phát hành; có cấu hình endpoint an toàn, kiểm tra kết nối, thông báo endpoint không khả dụng; HTTPS cho Web production.
- [ ] **Bảo vệ backend public:** Nếu streaming/batch API được public, bổ sung xác thực, giới hạn payload/tốc độ và quyền cho endpoint tiêu tốn tài nguyên hoặc xóa cache; thu hẹp CORS theo origin cần thiết.
- [ ] **Khả năng tiếp cận và đa nền tảng:** Kiểm tra screen reader/accessibility labels, cỡ chữ lớn, bàn phím và điều hướng Web, Safe Area, màn hình nhỏ/lớn, Android/iOS/Web.
- [ ] **Quan sát lỗi có kiểm soát:** Ghi nhận loại lỗi crawl/TTS/tải/offline và phiên bản app mà không thu nội dung sách cá nhân; cung cấp thông tin đủ để người dùng tự chẩn đoán server/mạng.

## Thứ tự đề xuất để bắt đầu

1. Nhập TXT thật và chặn nội dung mẫu gây hiểu nhầm (Giai đoạn 1).
2. Phát nền và lock screen (Giai đoạn 1).
3. Tiến độ nghe + tải offline bền vững (Giai đoạn 1).
4. Yêu thích, bookmark và tìm kiếm trên thư viện (Giai đoạn 2).
5. Cấu hình endpoint/an toàn backend và đồng bộ đa thiết bị (Giai đoạn 3).

**Nguyên tắc hoàn tất mỗi mục:** mô tả hành vi mong đợi, kiểm tra luồng thành công và lỗi trên nền tảng liên quan, cập nhật mục này cùng `APP_OVERVIEW.md` để tài liệu khớp với chức năng thực tế.
