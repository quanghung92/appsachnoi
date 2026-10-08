# 🎧 AudioVerse - App Sách Nói & Truyện Chữ AI Đa Nguồn

Ứng dụng Sách Nói và Truyện Chữ AI chuyên nghiệp được xây dựng bằng **React Native / Expo**, hỗ trợ **EAS Build miễn phí cho iOS và Android**.

---

## 🌟 Tính Năng Nổi Bật

1. **Kho Sách Bán Chạy (Google Drive)**:
   - Tích hợp sẵn 46+ đầu sách kinh điển (*Đắc Nhân Tâm, Cha Giàu Cha Nghèo, Nhà Giả Kim, Tư Duy Nhanh Và Chậm, Muôn Kiếp Nhân Sinh...*).
   - Đọc trực tiếp từ kho liên kết Google Drive công khai.
2. **Truyện Chữ Online Cập Nhật Theo Chương**:
   - Tích hợp các bộ truyện hot (*Phàm Nhân Tu Tiên, Đấu Phá Thương Khung, Mục Thần Ký, Thôn Phệ Tinh Không...*).
   - **Tự động chuyển chương (Auto-next chapter)**: Khi nghe hết một chương, AI tự động chuyển và đọc tiếp chương sau mà không cần bấm nút.
3. **Đọc Trực Tiếp Từ Link Bất Kỳ (Universal Link Reader)**:
   - Dán bất kỳ liên kết nào: Google Drive, web truyện (*TruyenFull, TangThuVien...*) hoặc bài viết báo mạng.
   - Hỗ trợ chọn tệp `.pdf`, `.epub`, `.txt` trực tiếp từ bộ nhớ điện thoại để nghe ngoại tuyến.
4. **Giọng Đọc AI Chuẩn Microsoft Edge (Miễn Phí 100%)**:
   - **Hoài My (Nữ)**: Giọng truyền cảm, ấm áp, ngắt nghỉ câu mượt mà (chuyên đọc truyện, tiểu thuyết).
   - **Nam Minh (Nam)**: Giọng phát thanh viên trầm ấm, dõng dạc (chuyên đọc sách kinh doanh, kỹ năng, tài chính).
   - Hỗ trợ chuyển đổi giọng đọc chỉ bằng 1 chạm, tùy chỉnh tốc độ ($1.0\times, 1.25\times, 1.5\times, 2.0\times$).
5. **Trình Phát Chuyên Nghiệp (Audiobook Player)**:
   - **Mini Player nổi**: Luôn hiển thị thanh điều khiển nổi phía trên các tab.
   - **Full Player đẳng cấp**: Bìa sách sắc nét, thanh trượt thời gian, tua 15s trước/sau, danh sách mục lục chương.
   - **Chế độ đọc chữ (Lyrics/Reader Mode)**: Vừa nghe vừa theo dõi chữ đang đọc trên màn hình.
   - **Hẹn giờ tắt (Sleep Timer)**: 15p, 30p, 45p, 60p hoặc khi đọc hết chương.

---

## 📱 Hướng Dẫn Chạy & Build App

Thư mục dự án: `D:\dev\AppSachNoi`

### 1. Chạy thử nghiệm ngay trên iPhone / Android (Miễn phí 100%)
Không cần tài khoản Apple Developer $99/năm, không cần máy Mac:

1. Mở terminal tại thư mục `D:\dev\AppSachNoi`:
   ```bash
   npm start
   ```
2. Cài app **Expo Go** trên điện thoại:
   - [Expo Go trên App Store (iOS)](https://apps.apple.com/app/expo-go/id982107779)
   - [Expo Go trên Google Play (Android)](https://play.google.com/store/apps/details?id=host.exp.exponent)
3. Mở camera điện thoại quét mã QR xuất hiện trên màn hình terminal: **App sẽ mở và chạy ngay lập tức trên điện thoại của bạn!**

---

### 2. Build file cài đặt độc lập với Expo EAS Build (Gói Free)

Expo cung cấp lượt build cloud miễn phí hàng tháng (khoảng 30 lượt Android và 15–30 lượt iOS).

#### Bước 1: Đăng nhập Expo CLI
```bash
npx eas login
```
*(Nếu chưa có tài khoản, đăng ký miễn phí tại [expo.dev](https://expo.dev))*

#### Bước 2: Cấu hình dự án với EAS
```bash
npx eas build:configure
```

#### Bước 3: Build file cài đặt
* **Build file APK cho Android (Cài trực tiếp vào điện thoại)**:
  ```bash
  npx eas build -p android --profile preview
  ```
* **Build file cho iOS**:
  ```bash
  npx eas build -p ios --profile preview
  ```
  *(Expo Cloud sẽ tự động biên dịch trên server Mac và cung cấp link tải file về)*.
