# 🎧 AudioVerse - Trình Nghe Sách Nói & Truyện Chữ AI Đa Nguồn

> **Ứng dụng Sách Nói & Truyện Chữ AI chuyên nghiệp** được xây dựng bằng **React Native / Expo (TypeScript)**, hỗ trợ đa nguồn tài liệu (Google Drive, Web Truyện theo chương, Link tùy ý), tích hợp giọng đọc AI biểu cảm và sẵn sàng xuất bản qua **Expo EAS Build miễn phí cho iOS & Android**.

---

## 📑 Mục Lục
1. [Giới Thiệu Tổng Quan](#-giới-thiệu-tổng-quan)
2. [Kiến Trúc Hệ Thống](#-kiến-trúc-hệ-thống)
3. [Chi Tiết Các Phân Hệ Đã Xây Dựng](#-chi-tiết-các-phân-hệ-đã-xây-dựng)
   - [3.1. Đa Nguồn Tài Liệu (Multi-Source Engine)](#31-đa-nguồn-tài-liệu-multi-source-engine)
   - [3.2. Engine Giọng Đọc AI & Neural TTS](#32-engine-giọng-đọc-ai--neural-tts)
   - [3.3. Trình Phát Âm Thanh Chuyên Nghiệp (Audiobook Player)](#33-trình-phát-âm-thanh-chuyên-nghiệp-audiobook-player)
   - [3.4. Giao Diện Người Dùng (UI/UX Luxury Dark Theme)](#34-giao-diện-người-dùng-uiux-luxury-dark-theme)
4. [Cấu Trúc Thư Mục Dự Án](#-cấu-trúc-thư-mục-dự-án)
5. [Hướng Dẫn Chạy & Cài Đặt Ứng Dụng](#-hướng-dẫn-chạy--cài-đặt-ứng-dụng)
   - [Chạy thử nghiệm trên iPhone & Android (Expo Go)](#chạy-thử-nghiệm-trên-iphone--android-expo-go)
   - [Chạy thử trên trình duyệt máy tính (Web)](#chạy-thử-trên-trình-duyệt-máy-tính-web)
   - [Build file cài đặt độc lập với EAS Build (Free Tier)](#build-file-cài-đặt-độc-lập-với-eas-build-free-tier)
6. [Lộ Trình Phát Triển Tiếp Theo (Roadmap)](#-lộ-trình-phát-triển-tiếp-theo-roadmap)

---

## 🌟 Giới Thiệu Tổng Quan

**AudioVerse** giải quyết bài toán: Người dùng có rất nhiều nguồn sách hay trên mạng (như kho Google Drive, các trang web truyện chữ đọc theo chương, hoặc các tệp PDF/EPUB trong điện thoại) nhưng việc tự đọc bằng mắt rất mỏi và tốn thời gian. 

AudioVerse biến mọi nguồn sách và truyện chữ này thành **sách nói chất lượng cao** với các giọng đọc truyền cảm, có thể nghe khi làm việc, đi xe, tập thể dục hoặc trước khi đi ngủ.

---

## 🏗 Kiến Trúc Hệ Thống

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CÁC NGUỒN SÁCH & TRUYỆN                         │
│  ├── 1. Kho Google Drive (46+ sách PDF kinh điển)                      │
│  ├── 2. Kho Truyện Chữ Online (Phân chương tự động: TruyenFull, ...)   │
│  ├── 3. Dán Link URL Trực Tiếp (Google Drive, Web Blog, ...)           │
│  └── 4. Tệp Cá Nhân (Tải file .pdf, .epub, .txt từ điện thoại)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     BỘ XỬ LÝ VĂN BẢN (Crawler & Parser)                │
│  • Bóc tách nội dung thuần, lọc bỏ quảng cáo & ký tự rác               │
│  • Thuật toán ngắt nghỉ câu biểu cảm (Punctuation Cadence)             │
│  • Chia nhỏ theo phân đoạn (Chunking) để phát âm thanh tức thì         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   ENGINE GIỌNG ĐỌC AI (Speech & Neural TTS)            │
│  • Giọng Hoài My (Nữ - Truyền cảm, ngọt ngào, ấm áp)                   │
│  • Giọng Nam Minh (Nam - Trầm ấm, dõng dạc, phát thanh viên)           │
│  • Server Neural Edge-TTS cục bộ (server.py) tạo MP3 chất lượng cao     │
│  • Tự động lưu bộ nhớ đệm (Audio Cache) để nghe lại mượt mà            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                TRÌNH PHÁT APP MOBILE (AudioVerse Client)               │
│  • Mini Player nổi trên tất cả các tab                                 │
│  • Full Player Modal (Tua 15s, chỉnh tốc độ 1.0x-2.0x, hẹn giờ ngủ)    │
│  • Tự động chuyển chương liên tục (Auto-next chapter)                  │
│  • Chế độ đọc văn bản song song (Lyrics/Reader Mode)                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠 Chi Tiết Các Phân Hệ Đã Xây Dựng

### 3.1. Đa Nguồn Tài Liệu (Multi-Source Engine)
* **Kho Sách Google Drive (`src/data/books.ts`)**:
  * Tích hợp sẵn danh mục **46+ đầu sách bán chạy nhất thế giới** được bóc tách từ trang Google Sites ban đầu (*Đắc Nhân Tâm, Cha Giàu Cha Nghèo, Nhà Giả Kim, Tư Duy Nhanh Và Chậm, 7 Thói Quen Của Người Thành Đạt, Muôn Kiếp Nhân Sinh...*).
  * Lưu trữ metadata gồm tiêu đề, tác giả, thể loại, ảnh bìa gốc và liên kết Google Drive tương ứng.
* **Kho Truyện Chữ Cập Nhật Theo Chương (`src/data/novels.ts`)**:
  * Tích hợp các bộ truyện hot: *Phàm Nhân Tu Tiên, Đấu Phá Thương Khung, Mục Thần Ký, Thôn Phệ Tinh Không...*
  * Mỗi bộ truyện được cấu trúc sẵn các chương với thời lượng ước tính và nội dung văn bản sạch.
  * **Cơ chế Tự động nhảy chương (Auto-next chapter)**: Khi giọng AI đọc hết một chương, app tự động nạp chương tiếp theo và đọc liên tục như danh sách phát nhạc.
* **Bộ Bóc Tách URL Đa Năng (`src/services/crawlerService.ts`)**:
  * **Nhận diện link Google Drive**: Trích xuất ID tệp và tạo sách mới vào tủ sách.
  * **Nhận diện link Web Truyện**: Bóc tách tên truyện, tên chương từ URL của các trang truyện chữ online.
  * **Hỗ trợ tệp cá nhân**: Sử dụng `expo-document-picker` để người dùng chọn tệp từ bộ nhớ máy.

---

### 3.2. Engine Giọng Đọc AI & Neural TTS
* **Bộ Giọng Tiếng Việt Chuẩn Phòng Thu (`src/services/ttsService.ts`)**:
  * **Hoài My (Nữ)**: Phong cách kể chuyện truyền cảm, luyến láy, ngắt nghỉ câu tự nhiên (thích hợp cho tiểu thuyết, truyện chữ và tản văn).
  * **Nam Minh (Nam)**: Phong cách phát thanh viên đĩnh đạc, trầm ấm, tròn vành rõ chữ (thích hợp cho sách kinh doanh, kỹ năng, tài chính, triết học).
* **Thuật toán Ngắt Nghỉ Biểu Cảm (Expressive Cadence)**:
  * Tự động điều chỉnh khoảng dừng tự nhiên sau các dấu câu (chấm, phẩy, chấm phẩy, xuống dòng) giúp nhịp điệu đọc khoan thai, có cảm xúc như người thật.
  * Cân chỉnh tần số âm sắc (Pitch) và tốc độ đọc (Rate) ở mức tối ưu (~0.85x – 0.9x) để tránh giọng đọc bị vội vã.
* **Server Neural Edge-TTS Cục Bộ (`server.py`)**:
  * Xây dựng server nhẹ bằng Python phục vụ luồng âm thanh MP3 từ mạng nơ-ron học sâu của Microsoft Edge.
  * Tự động băm mã MD5 để lưu cache âm thanh vào thư mục `audio_cache/`, giúp phát ngay lập tức từ lần nghe thứ hai mà không tốn băng thông mạng.

---

### 3.3. Trình Phát Âm Thanh Chuyên Nghiệp (Audiobook Player)
* **Mini Player Nổi (`src/components/MiniPlayer.tsx`)**:
  * Nằm cố định ngay phía trên thanh điều hướng dưới đáy màn hình.
  * Hiển thị bìa sách thu nhỏ, tên sách, tên chương, thanh tiến độ phát thời gian thực, nút Play/Pause và nút Next Chapter nhanh.
  * Bấm vào bất kỳ đâu trên Mini Player để mở Full Player.
* **Trình Phát Đầy Đủ (`src/components/FullPlayerModal.tsx`)**:
  * Bìa sách kích thước lớn với hiệu ứng sóng âm thanh (Sound wave indicator) khi đang phát.
  * Thanh trượt (Slider) kéo tua thời gian chính xác từng giây.
  * Nút tua lùi 15 giây và tua tới 15 giây.
  * Nút chuyển chương trước (Previous Chapter) và chương sau (Next Chapter).
  * **Tùy chỉnh tốc độ đọc**: Chuyển đổi linh hoạt giữa $1.0\times$, $1.25\times$, $1.5\times$, $2.0\times$.
  * **Chế độ đọc chữ (Reader Mode)**: Bấm nút văn bản ở góc trên bên phải để cuộn đọc toàn bộ chữ của chương đang phát.
* **Hẹn Giờ Tắt Khi Ngủ (`src/components/SleepTimerModal.tsx`)**:
  * Lựa chọn hẹn giờ: 15 phút, 30 phút, 45 phút, 60 phút, hoặc tự động tắt khi kết thúc chương hiện tại.
* **Chọn Giọng Đọc (`src/components/VoiceSelectorModal.tsx`)**:
  * Hộp thoại chuyển đổi giữa giọng Hoài My và Nam Minh kèm nút **"Thử giọng"** phát đoạn âm thanh mẫu ngay lập tức.
* **Mục Lục Chương (`src/components/ChapterListModal.tsx`)**:
  * Danh sách toàn bộ các chương của sách/truyện kèm chỉ báo chương đang phát (Playing Wave icon).

---

### 3.4. Giao Diện Người Dùng (UI/UX Luxury Dark Theme)
* **Bảng màu Luxury Dark (`src/theme/colors.ts`)**:
  * Nền chính Deep Obsidian (`#0B0F19`), bề mặt Midnight Surface (`#121829`), thẻ Card (`#1A2238`).
  * Điểm nhấn Neon Emerald (`#06D6A0`), Royal Purple (`#8B5CF6`), Amber Gold (`#F59E0B`).
  * Độ tương phản chữ đạt chuẩn WCAG AA/AAA (chữ trắng `#FFFFFF`, chữ phụ `#94A3B8`).
* **3 Màn Hình Chính**:
  1. **Khám Phá (`src/screens/HomeScreen.tsx`)**: Hero banner sách nổi bật, thanh lọc thể loại cuộn ngang, lưới sách Google Drive 46+ cuốn, banner dán link nhanh, và danh sách truyện chữ hot.
  2. **Tìm Kiếm (`src/screens/SearchScreen.tsx`)**: Thanh tìm kiếm tức thì theo từ khóa, bộ lọc theo nguồn (Tất cả / Google Drive / Truyện Chữ).
  3. **Tủ Sách (`src/screens/LibraryScreen.tsx`)**: Danh sách sách đang nghe dở (lưu tiến độ nghe), sách đã lưu yêu thích và các sách đã nhập từ link ngoài.

---

## 📁 Cấu Trúc Thư Mục Dự Án

```
D:\dev\AppSachNoi\
├── App.tsx                      # Component gốc điều phối toàn bộ State, Navigation & Modals
├── index.ts                     # Điểm khởi chạy của Expo App
├── app.json                     # Cấu hình định danh ứng dụng, quyền hạn & background audio
├── eas.json                     # Cấu hình Expo Application Services (EAS Build cho iOS/Android)
├── server.py                    # Server Python phục vụ Microsoft Edge Neural TTS MP3
├── books_data.json              # Dữ liệu trích xuất từ Google Sites
├── package.json                 # Khai báo dependencies & scripts
├── tsconfig.json                # Cấu hình TypeScript
├── assets/                      # Icon, Splash Screen và các file âm thanh mẫu
│   ├── icon.png
│   ├── test_hoaimy.mp3
│   └── test_namminh.mp3
├── audio_cache/                 # Bộ nhớ đệm các đoạn MP3 đã sinh bởi TTS
└── src/
    ├── types/
    │   └── index.ts             # Định nghĩa Type: Book, Chapter, VoiceOption, PlaybackState
    ├── theme/
    │   └── colors.ts            # Bảng màu thiết kế chuẩn Dark Mode
    ├── data/
    │   ├── books.ts             # Dữ liệu 46+ sách Google Drive có sẵn
    │   └── novels.ts            # Dữ liệu các bộ truyện chữ hot theo chương
    ├── services/
    │   ├── ttsService.ts        # Service quản lý phát giọng đọc AI, ngắt nghỉ & tiến độ
    │   └── crawlerService.ts    # Service bóc tách link Google Drive, web truyện & file
    ├── components/
    │   ├── Header.tsx           # Thanh tiêu đề, logo AudioVerse, phím chọn giọng & hẹn giờ
    │   ├── SearchBar.tsx        # Thanh tìm kiếm hiện đại
    │   ├── CategoryPills.tsx    # Các tab thể loại cuộn ngang
    │   ├── BookCard.tsx         # Thẻ sách dạng lưới (Bìa, Đánh giá, Nút phát nhanh)
    │   ├── NovelCard.tsx        # Thẻ truyện chữ dạng hàng ngang (Số chương, thể loại)
    │   ├── MiniPlayer.tsx       # Thanh phát nhạc nổi phía dưới
    │   ├── FullPlayerModal.tsx  # Trình phát toàn màn hình đầy đủ tính năng
    │   ├── ChapterListModal.tsx # Hộp thoại mục lục chương
    │   ├── VoiceSelectorModal.tsx# Hộp thoại đổi giọng đọc AI kèm nghe thử
    │   ├── SleepTimerModal.tsx  # Hộp thoại hẹn giờ tắt khi ngủ
    │   └── UrlImportModal.tsx   # Hộp thoại dán link Drive/Web truyện hoặc mở file
    └── screens/
        ├── HomeScreen.tsx       # Màn hình Khám Phá
        ├── SearchScreen.tsx     # Màn hình Tìm Kiếm
        └── LibraryScreen.tsx    # Màn hình Tủ Sách Cá Nhân
```

---

## 🚀 Hướng Dẫn Chạy & Cài Đặt Ứng Dụng

### Chạy thử nghiệm trên iPhone & Android (Expo Go)
*Hoàn toàn miễn phí, không cần máy Mac, không cần mua tài khoản Apple Developer $99/năm.*

1. **Khởi động ứng dụng**:
   Tại thư mục `D:\dev\AppSachNoi`, mở terminal và chạy:
   ```powershell
   npm start
   ```
2. **Cài app Expo Go trên điện thoại**:
   * **iPhone/iPad**: Cài đặt [Expo Go trên App Store](https://apps.apple.com/app/expo-go/id982107779).
   * **Android**: Cài đặt [Expo Go trên Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent).
3. **Mở app trên điện thoại**:
   * **Cách 1**: Mở Camera điện thoại quét mã QR hiển thị trong terminal.
   * **Cách 2**: Mở Expo Go $\rightarrow$ Chọn mục **"Enter URL manually"** $\rightarrow$ Nhập địa chỉ IP Wi-Fi của máy tính:
     ```text
     exp://192.168.110.172:8081
     ```

> ⚠️ **Mẹo quan trọng khi test trên iPhone**:
> * Hãy đảm bảo **nút gạt chuông/im lặng bên sườn trái iPhone đang ở chế độ Bật chuông** (không hiện vạch cam) và âm lượng media được mở lớn để nghe rõ giọng đọc.

---

### Chạy thử trên trình duyệt máy tính (Web)
Trong cửa sổ terminal đang chạy `npm start`, nhấn phím **`w`** trên bàn phím máy tính $\rightarrow$ Trình duyệt Chrome/Edge sẽ tự động mở app lên để trải nghiệm.

---

### Build file cài đặt độc lập với EAS Build (Free Tier)
Expo cung cấp gói Cloud Build miễn phí hàng tháng (khoảng 30 lượt Android và 15–30 lượt iOS):

1. **Đăng nhập Expo CLI**:
   ```powershell
   npx eas login
   ```
2. **Cấu hình dự án**:
   ```powershell
   npx eas build:configure
   ```
3. **Xuất file APK cho Android (Cài trực tiếp lên điện thoại Android)**:
   ```powershell
   npx eas build -p android --profile preview
   ```
4. **Build file cho iOS**:
   ```powershell
   npx eas build -p ios --profile preview
   ```

---

## 🔮 Lộ Trình Phát Triển Tiếp Theo (Roadmap)

- [ ] **Tích hợp Nhạc Nền (Ambient Background Music)**: Thêm tùy chọn bật nhạc piano/lofi chạy nhỏ 15% ngầm dưới giọng đọc AI để tăng cảm xúc.
- [ ] **Clone Voice theo yêu cầu**: Cho phép người dùng tải lên đoạn ghi âm 1 phút giọng MC yêu thích và clone bằng ElevenLabs hoặc F5-TTS.
- [ ] **Karaoke Word Highlighting**: Tô màu từng chữ/câu văn bản đang được đọc theo thời gian thực.
- [ ] **Đồng bộ hóa đám mây**: Lưu trữ lịch sử nghe sách và vị trí chương lên Supabase hoặc Firebase.
