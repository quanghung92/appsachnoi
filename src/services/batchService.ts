import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * BatchService: nối app với batch server (Modal cron) — "nhà máy" audio.
 *
 * Kiến trúc mới (không stream realtime qua Modal nữa):
 *  1. App import sách/truyện: POST /import_book (PDF Drive) hoặc /import_novel (URL).
 *     Server tự tải PDF / cào truyện, tách chương, lưu text vào Volume.
 *  2. App đẩy chương cần gen: POST /enqueue {book_id, chapter_id, url?, engine, voice?}.
 *     TRUYỆN -> Kokoro (duc_an), SÁCH -> Kokoro (duc_an). Server chỉ chạy Kokoro từ đêm 11/10
 *     (Gemini đã tắt) — app không bao giờ gửi engine 'gemini' nữa.
 *  3. Mỗi đêm 3h (hoặc bấm "Gen ngay" -> POST /trigger), server gen MP3 -> Drive.
 *  4. App vào THẲNG Drive lấy MP3 (stream hoặc tải về máy tùy cấu hình).
 *
 * Nếu BATCH_SERVER_URL chưa được đặt (server chưa deploy) thì mọi hàm
 * trả về null/false một cách lặng lẽ.
 */

// URL của audioverse-batch sau khi `modal deploy modal_batch.py`
export const BATCH_SERVER_URL = 'https://linhsamiu--audioverse-batch-api.modal.run';

const INDEX_TTL_MS = 5 * 60 * 1000; // cache index trong RAM 5 phút
const SAVE_TO_DEVICE_KEY = '@audioverse/save_audio_to_device';

export type BatchEngine = 'kokoro';

export interface BatchChapterItem {
  book_id: string;
  chapter_id: string;
  title: string;
  url?: string;
  engine: BatchEngine;
  voice?: string;
}

/** 1 item trong hàng đợi batch (thứ tự mảng = độ ưu tiên). */
export interface BatchQueueItem {
  book_id: string;
  chapter_id: string;
  title: string;
  engine: BatchEngine;
}

export type QueuePosition = 'front' | 'back';

const AUTO_BATCH_KEY = '@audioverse/auto_batch_current_book';

export interface ImportedChapter {
  id: string;
  title: string;
  chars: number;
}

export interface ImportBookResult {
  book_id: string;
  title: string;
  chapters: ImportedChapter[];
}

export interface ImportNovelResult {
  book_id: string;
  title: string;
  sample_chapter: string;
}

export interface BatchChapterAudio {
  drive_file_id: string;
  download_url: string;
  voice: string;
  title: string;
  book_id: string;
  chapter_id: string;
}

let indexCacheState: { bookId: string; at: number; chapters: Record<string, BatchChapterAudio> } | null = null;

function audioCacheDir(): string {
  return `${(FileSystem.cacheDirectory as string) || ''}tts-audio-cache/`;
}

async function ensureAudioCacheDir(): Promise<string> {
  const dir = audioCacheDir();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  return dir;
}

class BatchService {
  public isConfigured(): boolean {
    return BATCH_SERVER_URL.trim().length > 0;
  }

  public getServerUrl(): string {
    return BATCH_SERVER_URL.replace(/\/+$/, '');
  }

  /** Nhập sách PDF từ link Drive: server tải -> extract -> tách chương. */
  public async importBook(driveUrl: string, title?: string): Promise<ImportBookResult | null> {
    if (!this.isConfigured()) return null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(`${this.getServerUrl()}/import_book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drive_url: driveUrl, title: title || '' }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.log('[Batch] import_book failed:', err);
        return null;
      }
      return (await res.json()) as ImportBookResult;
    } catch (e) {
      console.log('[Batch] importBook error:', e);
      return null;
    }
  }

  /** Nhập truyện web: server cào thử để lấy tên truyện. */
  public async importNovel(url: string): Promise<ImportNovelResult | null> {
    if (!this.isConfigured()) return null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`${this.getServerUrl()}/import_novel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      return (await res.json()) as ImportNovelResult;
    } catch (e) {
      console.log('[Batch] importNovel error:', e);
      return null;
    }
  }

  /** Kích hoạt gen ngay không chờ 3h sáng (batch chạy nền). */
  public async triggerNow(maxChapters: number = 10): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${this.getServerUrl()}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_chapters: maxChapters }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      console.log('[Batch] trigger error:', e);
      return false;
    }
  }

  /**
   * Cấu hình: lưu audio về máy để nghe lại (true) hay chỉ stream từ Drive (false).
   * Mặc định: true (tải về).
   */
  public async getSaveToDevice(): Promise<boolean> {
    try {
      const v = await AsyncStorage.getItem(SAVE_TO_DEVICE_KEY);
      return v !== '0';
    } catch {
      return true;
    }
  }

  public async setSaveToDevice(save: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(SAVE_TO_DEVICE_KEY, save ? '1' : '0');
    } catch {}
  }

  /**
   * Cấu hình: tự động batch các chương của sách đang nghe khi gặp chương chưa có audio.
   * Mặc định: true.
   */
  public async getAutoBatch(): Promise<boolean> {
    try {
      const v = await AsyncStorage.getItem(AUTO_BATCH_KEY);
      return v !== '0';
    } catch {
      return true;
    }
  }

  public async setAutoBatch(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(AUTO_BATCH_KEY, enabled ? '1' : '0');
    } catch {}
  }

  /** Đẩy danh sách chương vào hàng đợi gen của batch server. */
  public async enqueueChapters(items: BatchChapterItem[], position: QueuePosition = 'back'): Promise<number> {
    if (!this.isConfigured() || items.length === 0) return 0;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${this.getServerUrl()}/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, position }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return 0;
      const data = await res.json();
      return data.added || 0;
    } catch (e) {
      console.log('[Batch] enqueue error:', e);
      return 0;
    }
  }

  /** Lấy index chương đã có audio của 1 sách (có cache RAM 5 phút). */
  public async getChapterIndex(bookId: string): Promise<Record<string, BatchChapterAudio>> {
    if (!this.isConfigured()) return {};
    const now = Date.now();
    if (
      indexCacheState &&
      indexCacheState.bookId === bookId &&
      now - indexCacheState.at < INDEX_TTL_MS
    ) {
      return indexCacheState.chapters;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(
        `${this.getServerUrl()}/index?book_id=${encodeURIComponent(bookId)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!res.ok) return indexCacheState?.chapters || {};
      const data = await res.json();
      const chapters = (data.chapters || {}) as Record<string, BatchChapterAudio>;
      indexCacheState = { bookId, at: now, chapters };
      return chapters;
    } catch (e) {
      console.log('[Batch] index error:', e);
      return indexCacheState?.chapters || {};
    }
  }

  /** Xóa cache index trong RAM (gọi sau khi biết có chương mới được gen xong). */
  public invalidateIndexCache() {
    indexCacheState = null;
  }

  /**
   * Lấy toàn bộ hàng đợi theo thứ tự ưu tiên (có thể lọc theo sách).
   */
  public async getQueue(bookId?: string): Promise<BatchQueueItem[]> {
    if (!this.isConfigured()) return [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const url = bookId
        ? `${this.getServerUrl()}/queue?book_id=${encodeURIComponent(bookId)}`
        : `${this.getServerUrl()}/queue`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.queue || []) as BatchQueueItem[];
    } catch (e) {
      console.log('[Batch] getQueue error:', e);
      return [];
    }
  }

  /**
   * Lấy danh sách chương đang chờ gen trên server (đồng bộ hiển thị với server).
   */
  public async getPendingChapters(bookId: string): Promise<Set<string>> {
    const queue = await this.getQueue(bookId);
    return new Set(queue.map((it) => it.chapter_id));
  }

  /** Đổi độ ưu tiên 1 chương trong hàng đợi (up = lên trước, down = xuống sau). */
  public async moveQueueItem(
    bookId: string,
    chapterId: string,
    direction: 'up' | 'down'
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await fetch(`${this.getServerUrl()}/queue/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, chapter_id: chapterId, direction }),
      });
      return res.ok;
    } catch (e) {
      console.log('[Batch] moveQueueItem error:', e);
      return false;
    }
  }

  /** Xóa 1 chương khỏi hàng đợi. */
  public async removeQueueItem(bookId: string, chapterId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await fetch(`${this.getServerUrl()}/queue/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, chapter_id: chapterId }),
      });
      return res.ok;
    } catch (e) {
      console.log('[Batch] removeQueueItem error:', e);
      return false;
    }
  }

  /**
   * Xóa sách khỏi server: dọn hàng đợi + index + file Drive (đồng bộ với client).
   */
  public async removeBook(bookId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${this.getServerUrl()}/remove_book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.invalidateIndexCache();
      return res.ok;
    } catch (e) {
      console.log('[Batch] removeBook error:', e);
      return false;
    }
  }

  /**
   * Lấy audio 1 chương: trả về đường dẫn file local (nếu cấu hình lưu máy)
   * hoặc URL Drive trực tiếp (nếu chỉ stream). Null nếu chương chưa được gen.
   */
  public async getChapterAudioFile(bookId: string, chapterId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const index = await this.getChapterIndex(bookId);
      const entry = index[chapterId];
      if (!entry || !entry.download_url) return null;

      const saveToDevice = await this.getSaveToDevice();
      if (!saveToDevice) {
        return entry.download_url; // stream trực tiếp từ Drive, không lưu máy
      }

      const dir = await ensureAudioCacheDir();
      const localPath = `${dir}batch_${bookId}_${chapterId}.mp3`;
      const info: any = await FileSystem.getInfoAsync(localPath).catch(() => null);
      if (info && info.exists && (info.size || 0) > 1024) {
        return localPath;
      }
      console.log(`[Batch] Tải audio chương ${chapterId} về máy...`);
      const result = await FileSystem.downloadAsync(entry.download_url, localPath);
      if (result && result.status === 200) {
        const done: any = await FileSystem.getInfoAsync(localPath).catch(() => null);
        if (done && done.exists && (done.size || 0) > 1024) {
          return localPath;
        }
      }
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
      return null;
    } catch (e) {
      console.log('[Batch] download chapter audio error:', e);
      return null;
    }
  }

  /** Trạng thái hàng đợi batch (để hiển thị "còn N chương đang chờ gen"). */
  public async getStatus(): Promise<{ pending: number; done: number } | null> {
    if (!this.isConfigured()) return null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${this.getServerUrl()}/status`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      return (await res.json()) as { pending: number; done: number };
    } catch {
      return null;
    }
  }
}

export const batchService = new BatchService();
