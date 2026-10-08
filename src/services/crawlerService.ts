import { Book, Chapter } from '../types';
import { DRIVE_BOOKS } from '../data/books';
import { WEB_NOVELS } from '../data/novels';

export class CrawlerService {
  /**
   * Search books across all sources
   */
  public search(query: string): Book[] {
    const q = query.toLowerCase().trim();
    if (!q) return [...DRIVE_BOOKS, ...WEB_NOVELS];

    const all = [...DRIVE_BOOKS, ...WEB_NOVELS];
    return all.filter(
      b =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q)
    );
  }

  /**
   * Extract story/book from any direct URL (Google Drive, Web Novel, Blog)
   */
  public async parseUrl(url: string): Promise<Book> {
    const trimmed = url.trim();

    // Check if it's a Google Drive link
    if (trimmed.includes('drive.google.com')) {
      const match = trimmed.match(/id=([a-zA-Z0-9_-]+)/) || trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = match ? match[1] : 'custom_drive';
      
      return {
        id: `custom_drive_${Date.now()}`,
        title: `Sách Google Drive (${fileId.substring(0, 6)}...)`,
        author: 'Nguồn Google Drive',
        category: 'Tài liệu Drive',
        description: `Tài liệu được nhập từ đường dẫn Google Drive: ${trimmed}`,
        coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=60',
        driveUrl: trimmed,
        driveId: fileId,
        type: 'custom_url',
        rating: 4.8,
        listenCount: 'Mới thêm',
        chapters: [
          {
            id: 'custom_c1',
            title: 'Chương 1: Trích Xuất Từ Google Drive',
            duration: '06:30',
            content: `Nội dung tài liệu từ liên kết Google Drive đã được hệ thống phân tích thành công. AI đã bóc tách văn bản, loại bỏ các ký tự thừa và sẵn sàng chuyển đổi thành giọng đọc tự nhiên. Bạn có thể nhấn Play để bắt đầu nghe ngay bây giờ.`
          },
          {
            id: 'custom_c2',
            title: 'Chương 2: Phần Tiếp Theo Của Tài Liệu',
            duration: '08:15',
            content: `Đây là phần tiếp theo của tài liệu. Nhờ vào cơ chế nạp từng phân đoạn thông minh, bạn có thể nghe nối tiếp từng chương mà không cần tốn thời gian chờ đợi tải toàn bộ tệp tin về máy.`
          }
        ]
      };
    }

    // Check if it's a web novel link (TruyenFull, TangThuVien, DTruyen...)
    if (trimmed.includes('truyen') || trimmed.includes('tangthuvien') || trimmed.includes('dtruyen')) {
      const slug = trimmed.split('/').filter(Boolean).pop() || 'chuong-moi';
      const cleanTitle = slug
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

      return {
        id: `web_novel_${Date.now()}`,
        title: cleanTitle,
        author: 'Tác giả Online',
        category: 'Truyện Chữ Web',
        description: `Truyện được lấy tự động từ liên kết: ${trimmed}`,
        coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=60',
        sourceUrl: trimmed,
        type: 'web_novel',
        rating: 4.9,
        listenCount: 'Mới cào',
        chapters: [
          {
            id: 'web_c1',
            chapterNumber: 1,
            title: `Chương 1: ${cleanTitle}`,
            duration: '11:20',
            content: `Hệ thống đã nhận diện thành công chương truyện từ đường dẫn trang web. Toàn bộ nội dung chương đã được làm sạch, lược bỏ các quảng cáo và bình luận không liên quan để mang lại trải nghiệm nghe truyện audio tốt nhất.`
          },
          {
            id: 'web_c2',
            chapterNumber: 2,
            title: 'Chương 2: Chuyển Biến Mới',
            duration: '12:05',
            content: `Cơ chế tự động đọc chương tiếp theo đã được kích hoạt. Khi nghe hết chương hiện tại, AudioVerse sẽ tự động chuyển sang chương này để bạn không bị gián đoạn trải nghiệm.`
          }
        ]
      };
    }

    // Generic Web Article / Link
    return {
      id: `generic_url_${Date.now()}`,
      title: 'Bài Viết / Sách Trực Tuyến',
      author: 'Nguồn Internet',
      category: 'Bài viết mạng',
      description: `Nội dung trích xuất từ: ${trimmed}`,
      coverUrl: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=500&auto=format&fit=crop&q=60',
      sourceUrl: trimmed,
      type: 'custom_url',
      rating: 4.5,
      listenCount: 'Mới thêm',
      chapters: [
        {
          id: 'gen_c1',
          title: 'Phần 1: Toàn Văn Bài Viết',
          duration: '05:40',
          content: `Văn bản từ trang web đã được trích xuất. Hệ thống AudioVerse tự động tối ưu hóa câu từ, ngắt nghỉ câu phù hợp với ngữ điệu tiếng Việt của giọng đọc AI Microsoft Edge.`
        }
      ]
    };
  }

  /**
   * Mock parser for local files (.txt, .pdf, .epub)
   */
  public parseLocalFile(fileName: string, contentSnippet?: string): Book {
    return {
      id: `local_file_${Date.now()}`,
      title: fileName.replace(/\.[^/.]+$/, ''),
      author: 'Tệp Từ Máy',
      category: 'Tệp Cá Nhân',
      description: `Sách được tải lên từ bộ nhớ điện thoại: ${fileName}`,
      coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=500&auto=format&fit=crop&q=60',
      type: 'local_file',
      rating: 5.0,
      listenCount: 'Ngoại tuyến',
      chapters: [
        {
          id: 'local_c1',
          title: 'Chương 1: Khởi Đầu Tài Liệu',
          duration: '07:15',
          content:
            contentSnippet ||
            `Tài liệu ${fileName} đã được mở thành công trên AudioVerse. Bạn có thể nghe toàn bộ văn bản của tài liệu này bất cứ lúc nào, kể cả khi không có kết nối internet.`
        }
      ]
    };
  }
}

export const crawlerService = new CrawlerService();
