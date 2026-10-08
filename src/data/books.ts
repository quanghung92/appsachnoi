import { Book } from '../types';

export const DRIVE_BOOKS: Book[] = [
  {
    id: "drive_1",
    title: "Đắc Nhân Tâm",
    author: "Dale Carnegie",
    category: "Kỹ năng sống",
    description: "Nghệ thuật thu phục lòng người và đối nhân xử thế kinh điển nhất mọi thời đại.",
    coverUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1mlIagmYc0_B7E38xHcmyEYLSZj-qlLGM",
    type: "drive_book",
    rating: 4.9,
    listenCount: "128K",
    chapters: [
      {
        id: "d1_c1",
        title: "Chương 1: Muốn Lấy Mật Đừng Phá Tổ Ong",
        duration: "10:15",
        content: "Chỉ trích là vô ích vì nó đặt người ta vào thế tự vệ và thường khiến họ cố gắng tìm cách biện hộ. Chỉ trích là nguy hiểm vì nó làm tổn thương niềm tự hào quý giá của người ta, gây tổn thương cho cảm giác quan trọng của họ và khơi dậy lòng oán giận. Thay vì lên án người khác, chúng ta hãy thử hiểu họ. Hãy thử tìm hiểu tại sao họ lại làm những điều họ làm. Điều đó đem lại nhiều ích lợi và thú vị hơn là chỉ trích; và nó sinh ra sự cảm thông, khoan dung và lòng nhân ái. Biết tất cả là tha thứ tất cả."
      },
      {
        id: "d1_c2",
        title: "Chương 2: Bí Quyết Lớn Nhất Trong Đối Nhân Xử Thế",
        duration: "14:20",
        content: "Chỉ có một cách duy nhất trên thế giới này để khiến bất kỳ ai làm bất cứ điều gì. Bạn đã bao giờ nghĩ về điều đó chưa? Đúng vậy, chỉ có một cách, đó là khiến cho người khác muốn làm điều đó. Hãy nhớ rằng, không có cách nào khác. Sigmund Freud nói rằng mọi hành động của chúng ta xuất phát từ hai động cơ: ham muốn tình dục và khát vọng trở nên vĩ đại. John Dewey, một trong những triết gia sâu sắc nhất của nước Mỹ, đã diễn đạt điều đó hơi khác một chút: Động lực sâu xa nhất trong bản tính con người là khát khao được cảm thấy mình quan trọng."
      },
      {
        id: "d1_c3",
        title: "Chương 3: Ai Làm Được Điều Này Sẽ Có Cả Thế Giới",
        duration: "18:05",
        content: "Mùa hè nào tôi cũng đi câu cá ở Maine. Cá nhân tôi rất thích dâu tây và kem, nhưng tôi thấy rằng vì một lý do kỳ lạ nào đó, cá lại thích giun. Vì vậy, khi tôi đi câu cá, tôi không nghĩ về những gì tôi muốn. Tôi nghĩ về những gì con cá muốn. Tôi không móc mồi dâu tây và kem vào lưỡi câu. Thay vào đó, tôi treo một con sâu hoặc một con châu chấu trước mặt cá và nói: Bạn có muốn ăn cái này không? Tại sao chúng ta không sử dụng cùng một lẽ thường này khi câu con người?"
      }
    ]
  },
  {
    id: "drive_2",
    title: "Cha Giàu Cha Nghèo",
    author: "Robert T. Kiyosaki",
    category: "Tài chính",
    description: "Bí quyết dạy con làm giàu và tư duy tài chính khác biệt giữa người giàu và tầng lớp trung lưu.",
    coverUrl: "https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1MobeoGLxrv0hVEbCRo4VuOW4gV_EYoYf",
    type: "drive_book",
    rating: 4.8,
    listenCount: "95K",
    chapters: [
      {
        id: "d2_c1",
        title: "Bài Học 1: Người Giàu Không Làm Việc Vì Tiền",
        duration: "12:50",
        content: "Người nghèo và tầng lớp trung lưu làm việc vì tiền bạc. Người giàu buộc tiền bạc phải làm việc cho mình. Hầu hết mọi người để cho hai cảm xúc chi phối cuộc đời họ: nỗi sợ hãi và lòng tham. Đầu tiên, nỗi sợ không có tiền thúc đẩy họ làm việc chăm chỉ, và sau đó, khi nhận được tiền lương, lòng tham hoặc ước muốn bắt đầu khiến họ nghĩ về tất cả những điều tuyệt vời mà tiền có thể mua được. Đó là cái bẫy mang tên Vòng luẩn quẩn của chuột (Rat Race)."
      },
      {
        id: "d2_c2",
        title: "Bài Học 2: Tại Sao Phải Dạy Con Về Tài Chính?",
        duration: "16:10",
        content: "Vấn đề không phải là bạn kiếm được bao nhiêu tiền, mà là bạn giữ được bao nhiêu tiền. Người giàu mua tài sản. Người nghèo và trung lưu mua tiêu sản nhưng họ lại nghĩ rằng đó là tài sản. Quy tắc số một: Bạn phải biết sự khác biệt giữa tài sản và tiêu sản, và hãy mua tài sản. Tài sản là thứ bỏ tiền vào túi bạn. Tiêu sản là thứ rút tiền ra khỏi túi bạn."
      }
    ]
  },
  {
    id: "drive_3",
    title: "Nhà Giả Kim",
    author: "Paulo Coelho",
    category: "Văn học",
    description: "Hành trình theo đuổi vận mệnh cuộc đời và bài học lắng nghe tiếng gọi trái tim của chàng chăn cừu Santiago.",
    coverUrl: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1eGdd6K5-fIaFrdid4vq7lMtRIlMxMo5h",
    type: "drive_book",
    rating: 5.0,
    listenCount: "210K",
    chapters: [
      {
        id: "d3_c1",
        title: "Phần 1: Chàng Chăn Cừu Và Giấc Mơ Kho Báu",
        duration: "15:40",
        content: "Cậu bé tên là Santiago. Hoàng hôn vừa buông xuống khi cậu cùng đàn cừu đến một nhà thờ cổ hoang phế. Mái nhà thờ đã sụp từ lâu và một cây tiêu khổng lồ mọc lên ngay nơi trước kia từng là phòng thánh. Cậu quyết định ngủ lại đó đêm nay. Trong giấc mơ lặp đi lặp lại, một đứa trẻ dẫn cậu tới chân Kim Tự Tháp Ai Cập và bảo: Nếu cậu đến đây, cậu sẽ tìm thấy một kho báu ẩn giấu."
      },
      {
        id: "d3_c2",
        title: "Phần 2: Lên Đường Đến Sa Mạc Sahara",
        duration: "21:15",
        content: "Vua xứ Salem nói với cậu: Bất kể anh là ai hay làm gì, khi anh thực sự mong muốn một điều gì đó, thì đó là vì mong muốn đó bắt nguồn từ tâm hồn của vũ trụ. Đó là sứ mệnh của anh trên trái đất. Và khi bạn thực sự khao khát một điều gì, toàn bộ vũ trụ sẽ hợp lực giúp bạn đạt được điều đó."
      }
    ]
  },
  {
    id: "drive_4",
    title: "Tư Duy Nhanh Và Chậm",
    author: "Daniel Kahneman",
    category: "Tâm lý học",
    description: "Kiệt tác về hai hệ thống tư duy quyết định mọi lựa chọn và sai lầm nhận thức của con người.",
    coverUrl: "https://images.unsplash.com/photo-1506784365847-bbad939e9335?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1lnH7pEs0KHKVp7D8r_OsXqm8pQsCo6hr",
    type: "drive_book",
    rating: 4.7,
    listenCount: "82K",
    chapters: [
      {
        id: "d4_c1",
        title: "Chương 1: Hai Nhân Vật Của Tâm Trí (Hệ Thống 1 & 2)",
        duration: "13:40",
        content: "Hệ thống 1 vận hành tự động và nhanh chóng, không tốn hoặc tốn rất ít nỗ lực, và không có sự kiểm soát tự giác. Hệ thống 2 tập trung sự chú ý vào những hoạt động tinh thần đòi hỏi nỗ lực, bao gồm cả những phép tính phức tạp. Khi bạn nhìn thấy một bức ảnh giận dữ, Hệ thống 1 lập tức nhận biết. Nhưng khi gặp phép tính 17 nhân 24, Hệ thống 2 mới bắt đầu hoạt động."
      }
    ]
  },
  {
    id: "drive_5",
    title: "Nghĩ Giàu Làm Giàu (Think and Grow Rich)",
    author: "Napoleon Hill",
    category: "Phát triển bản thân",
    description: "13 nguyên tắc thành công vượt thời gian đúc kết từ 500 nhân vật kiệt xuất nhất nước Mỹ.",
    coverUrl: "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1t0-EVWPVMI0eZFB6DVcvHgPcoxiuEYMV",
    type: "drive_book",
    rating: 4.8,
    listenCount: "115K",
    chapters: [
      {
        id: "d5_c1",
        title: "Bước 1: Khát Vọng - Điểm Khởi Đầu Của Mọi Thành Tựu",
        duration: "11:20",
        content: "Điểm khởi đầu của mọi thành tựu là khát vọng. Hãy luôn ghi nhớ điều này. Khát vọng yếu ớt mang lại kết quả yếu ớt, giống như một đốm lửa nhỏ chỉ tạo ra một chút nhiệt. Nếu bạn muốn thành công, bạn phải đốt lên ngọn lửa khát vọng cháy bỏng đến mức nó trở thành nỗi ám ảnh tích cực trong tâm trí bạn."
      }
    ]
  },
  {
    id: "drive_6",
    title: "Muôn Kiếp Nhân Sinh",
    author: "Nguyên Phong",
    category: "Tâm linh",
    description: "Bức tranh toàn cảnh về tiền kiếp, nhân quả và tương lai nhân loại qua câu chuyện có thật của tỷ phú Thomas.",
    coverUrl: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=500&auto=format&fit=crop&q=60",
    driveUrl: "https://drive.google.com/open?id=1hDwTGnNfNfdAqa4DVeumEBcLmwKCjUXD",
    type: "drive_book",
    rating: 4.9,
    listenCount: "174K",
    chapters: [
      {
        id: "d6_c1",
        title: "Chương 1: Những Dấu Hiệu Tiền Kiếp Tại Atlantis",
        duration: "19:30",
        content: "Cuộc gặp gỡ định mệnh với hòa thượng Thích Thánh Nghiêm đã mở ra cánh cửa ký ức của Thomas về nền văn minh Atlantis cổ đại. Nơi đó, khoa học công nghệ phát triển vượt bậc nhưng con người lại suy đồi về đạo đức, lạm dụng năng lượng tinh thần để trục lợi, dẫn đến thảm họa diệt vong do chính sự ngạo mạn của mình tạo nên."
      }
    ]
  }
];
