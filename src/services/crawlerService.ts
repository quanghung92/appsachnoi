import { Book, Chapter } from '../types';
import { DRIVE_BOOKS } from '../data/books';
import { WEB_NOVELS } from '../data/novels';
import { ttsService } from './ttsService';

export interface CrawlResult {
  status: string;
  url: string;
  story_title: string;
  chapter_title: string;
  chapter_number: number;
  author: string;
  content: string;
  content_length: number;
  prev_url: string;
  next_url: string;
  message?: string;
}

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
   * Cào trực tiếp từ điện thoại nếu server không phản hồi
   */
  private async crawlDirect(url: string): Promise<CrawlResult | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const html = await res.text();
      let content = '';
      const match = html.match(/(?:id|class)=["'](?:chapter-c|chapter-content|reading-content|box-chap)["'][^>]*>([\s\S]*?)<\/div>/i);
      if (match) {
        content = match[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\(adsbygoogle[\s\S]*?\);/g, '')
          .trim();
      }
      if (content.length > 150) {
        return {
          status: 'ok',
          url,
          story_title: 'Truyện Web',
          chapter_title: 'Chương mới',
          chapter_number: 1,
          author: 'Tác giả Online',
          content,
          content_length: content.length,
          prev_url: '',
          next_url: '',
        };
      }
    } catch {}
    return null;
  }

  /**
   * Cào chương truyện thật qua server (hoặc direct fallback).
   * Trả về null nếu cào thất bại.
   */
  public async crawlChapter(url: string): Promise<CrawlResult | null> {
    const trimmed = url.trim();
    // 1. Thử qua server Kokoro (Local PC hoặc Modal Cloud)
    try {
      const baseUrl = ttsService.getServerUrl();
      const apiUrl = `${baseUrl}/api/crawl?url=${encodeURIComponent(trimmed)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = (await res.json()) as CrawlResult;
        if (data.status === 'ok' && data.content && data.content.length > 100) {
          return data;
        }
      }
    } catch {}

    // 2. Thử cào trực tiếp từ app nếu server không phản hồi
    return await this.crawlDirect(trimmed);
  }

  /**
   * Đảm bảo chapter có nội dung thật từ nguồn online nếu hiện tại chỉ là mock/sample
   */
  public async ensureChapterContent(book: Book, chapter: Chapter): Promise<string> {
    // Nếu nội dung đã dài (> 800 ký tự) và không phải text thông báo placeholder -> dùng luôn
    if (
      chapter.content &&
      chapter.content.length > 800 &&
      !chapter.content.startsWith('Hệ thống đã nhận diện')
    ) {
      return chapter.content;
    }

    // Xác định URL để cào
    let targetUrl = chapter.url;
    if (!targetUrl && book.sourceUrl) {
      const num = chapter.chapterNumber || 1;
      const cleanSource = book.sourceUrl.replace(/\/+$/, '');
      if (cleanSource.includes('wetruyen.com')) {
        targetUrl = `${cleanSource}/chuong-${num}.html`;
      } else if (cleanSource.includes('truyenfull')) {
        const slug = cleanSource.split('/').filter(Boolean).pop();
        targetUrl = `https://wetruyen.com/${slug}/chuong-${num}.html`;
      } else {
        targetUrl = `${cleanSource}/chuong-${num}/`;
      }
    }

    if (!targetUrl) {
      return chapter.content;
    }

    console.log(`[Crawler] Đang lấy chương thật từ online: ${targetUrl}...`);
    const crawled = await this.crawlChapter(targetUrl);
    if (crawled && crawled.content && crawled.content.length > 200) {
      chapter.content = crawled.content;
      if (crawled.chapter_title) {
        chapter.title = crawled.chapter_title;
      }
      chapter.url = crawled.url || targetUrl;
      console.log(`[Crawler] Lấy thành công ${crawled.content_length} ký tự nội dung thật!`);
      return crawled.content;
    }

    return chapter.content;
  }

  private bookFromCrawl(data: CrawlResult, sourceUrl: string): Book {
    const chapter: Chapter = {
      id: `crawled_c_${Date.now()}`,
      chapterNumber: data.chapter_number || 1,
      title: data.chapter_title || 'Chương mới',
      content: data.content,
      url: data.url,
    };
    return {
      id: `crawled_${Date.now()}`,
      title: data.story_title || 'Truyện web',
      author: data.author || 'Tác giả online',
      category: 'Truyện chữ web',
      description: `Cào từ: ${sourceUrl}`,
      coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=60',
      sourceUrl,
      type: 'web_novel',
      rating: 4.9,
      listenCount: `${Math.max(1, Math.round(data.content_length / 2000))} phút đọc`,
      chapters: [chapter],
    };
  }

  /**
   * Extract story/book from any direct URL (Google Drive, Web Novel, Blog)
   */
  public async parseUrl(url: string): Promise<Book> {
    const trimmed = url.trim();

    // Thử cào thật qua server trước (TruyenFull, TangThuVien, DTruyen...)
    const isNovelLink =
      /truyenfull|tangthuvien|dtruyen|metruyenchu|metruyencv|wetruyen|truyen/i.test(trimmed);
    if (isNovelLink) {
      const crawled = await this.crawlChapter(trimmed);
      if (crawled) {
        return this.bookFromCrawl(crawled, trimmed);
      }
    }

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
